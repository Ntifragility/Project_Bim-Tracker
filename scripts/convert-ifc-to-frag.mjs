#!/usr/bin/env node
// Streaming 64-bit Node CLI & library for converting large IFC files (1.5 GB+)
// into optimized .frag FlatBuffers caches using web-ifc OpenModelFromCallback.
//
// Usage:
//   npm run convert:frag -- <input.ifc> [output.frag] [--lean] [--raw]

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import * as FRAGS from "@thatopen/fragments";

const require = createRequire(import.meta.url);
const LARGE_ATTRIBUTE_CUTOFF_BYTES = 200 * 1024 * 1024; // 200 MB

function resolveWebIfcWasmDir() {
  const entryPath = require.resolve("web-ifc");
  const dir = path.dirname(entryPath);
  return dir.endsWith(path.sep) ? dir : `${dir}${path.sep}`;
}

/**
 * Builds a virtual random-access `readCallback(offset, size)` over an array of
 * non-contiguous Buffer/Uint8Array chunks in 64-bit Node memory (zero disk writes,
 * zero single-contiguous-buffer concatenation required).
 */
export function createChunkedReadCallback(chunks, totalBytes) {
  const offsets = new Array(chunks.length);
  let acc = 0;
  for (let i = 0; i < chunks.length; i++) {
    offsets[i] = acc;
    acc += chunks[i].byteLength;
  }
  const effectiveTotal = totalBytes ?? acc;
  let scratch = new Uint8Array(64 * 1024);

  return (offset, size) => {
    const remaining = Math.max(0, effectiveTotal - offset);
    const toRead = Math.min(size, remaining);
    if (toRead <= 0 || chunks.length === 0) return new Uint8Array(0);

    // Binary search for the chunk containing `offset`
    let lo = 0;
    let hi = chunks.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (offsets[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }

    const firstChunk = chunks[lo];
    const localStart = offset - offsets[lo];
    const availInFirst = firstChunk.byteLength - localStart;

    // Fast path: entire window fits inside a single chunk (99.9% of reads)
    if (availInFirst >= toRead) {
      return new Uint8Array(
        firstChunk.buffer,
        firstChunk.byteOffset + localStart,
        toRead,
      );
    }

    // Cross-boundary stitch into reusable scratch buffer
    if (toRead > scratch.byteLength) {
      scratch = new Uint8Array(toRead);
    }
    let copied = 0;
    let cIdx = lo;
    let cOffset = localStart;
    while (copied < toRead && cIdx < chunks.length) {
      const c = chunks[cIdx];
      const take = Math.min(toRead - copied, c.byteLength - cOffset);
      scratch.set(new Uint8Array(c.buffer, c.byteOffset + cOffset, take), copied);
      copied += take;
      cIdx++;
      cOffset = 0;
    }
    return scratch.subarray(0, copied);
  };
}

/**
 * Converts an array of in-memory IFC chunks (Buffer[]) directly to .frag bytes
 * in 64-bit Node memory without writing any temporary IFC file to disk (avoids ENOSPC).
 */
export async function convertIfcChunksToFrag(
  chunks,
  totalBytes,
  {
    lean = null,
    raw = false,
    onProgress = null,
  } = {},
) {
  const useLean = lean !== null ? Boolean(lean) : totalBytes > LARGE_ATTRIBUTE_CUTOFF_BYTES;
  const importer = new FRAGS.IfcImporter();
  importer.wasm = {
    path: resolveWebIfcWasmDir(),
    absolute: true,
  };
  importer.webIfcSettings = {
    COORDINATE_TO_ORIGIN: true,
    MEMORY_LIMIT: 4294967296, // 4 GB wasm32 ceiling
    TAPE_SIZE: 134217728, // 128 MB STEP token tape
  };

  if (!useLean) {
    importer.addAllAttributes();
    importer.addAllRelations();
  }

  const readCallback = createChunkedReadCallback(chunks, totalBytes);
  try {
    const t0 = performance.now();
    const fragBytes = await importer.process({
      readFromCallback: true,
      readCallback,
      raw,
      progressCallback: (progress, info) => {
        if (typeof onProgress === "function") {
          onProgress(progress, info);
        }
      },
    });
    const elapsedMs = Math.round(performance.now() - t0);
    return {
      fragBytes,
      inputBytes: totalBytes,
      outputBytes: fragBytes.byteLength,
      leanMode: useLean,
      elapsedMs,
    };
  } finally {
    importer.clean();
  }
}

/**
 * Converts an IFC file on disk to a .frag file using zero-copy OS file-descriptor
 * callback streaming (never loads the raw IFC file into JS RAM).
 */
export async function convertIfcFileToFrag(
  inputPath,
  outputPath = null,
  {
    lean = null,
    raw = false,
    onProgress = null,
  } = {},
) {
  const absInput = path.resolve(inputPath);
  if (!fs.existsSync(absInput)) {
    throw new Error(`Input IFC file not found: ${absInput}`);
  }

  const stat = fs.statSync(absInput);
  const fileSize = stat.size;
  const useLean = lean !== null ? Boolean(lean) : fileSize > LARGE_ATTRIBUTE_CUTOFF_BYTES;

  const parsed = path.parse(absInput);
  const absOutput = outputPath
    ? path.resolve(outputPath)
    : path.join(parsed.dir, `${parsed.name}.frag`);

  fs.mkdirSync(path.dirname(absOutput), { recursive: true });

  const importer = new FRAGS.IfcImporter();
  importer.wasm = {
    path: resolveWebIfcWasmDir(),
    absolute: true,
  };
  importer.webIfcSettings = {
    COORDINATE_TO_ORIGIN: true,
    MEMORY_LIMIT: 4294967296, // 4 GB wasm32 ceiling
    TAPE_SIZE: 134217728, // 128 MB STEP token tape
  };

  if (!useLean) {
    importer.addAllAttributes();
    importer.addAllRelations();
  }

  const fd = fs.openSync(absInput, "r");
  let readBuf = Buffer.allocUnsafe(64 * 1024);

  const readCallback = (offset, size) => {
    const remaining = Math.max(0, fileSize - offset);
    const toRead = Math.min(size, remaining);
    if (toRead <= 0) return new Uint8Array(0);
    if (toRead > readBuf.length) {
      readBuf = Buffer.allocUnsafe(toRead);
    }
    const bytesRead = fs.readSync(fd, readBuf, 0, toRead, offset);
    return new Uint8Array(readBuf.buffer, readBuf.byteOffset, bytesRead);
  };

  try {
    const t0 = performance.now();
    const fragBytes = await importer.process({
      readFromCallback: true,
      readCallback,
      raw,
      progressCallback: (progress, info) => {
        if (typeof onProgress === "function") {
          onProgress(progress, info);
        }
      },
    });

    fs.writeFileSync(absOutput, fragBytes);
    const elapsedMs = Math.round(performance.now() - t0);
    return {
      inputPath: absInput,
      outputPath: absOutput,
      inputBytes: fileSize,
      outputBytes: fragBytes.byteLength,
      leanMode: useLean,
      elapsedMs,
    };
  } finally {
    try {
      fs.closeSync(fd);
    } catch { /* noop */ }
    importer.clean();
  }
}

async function runCli() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith("--")));
  const positional = args.filter((a) => !a.startsWith("--"));

  if (positional.length === 0) {
    console.error("Usage: npm run convert:frag -- <input.ifc> [output.frag] [--lean] [--raw]");
    process.exit(1);
  }

  const inputPath = positional[0];
  const outputPath = positional[1] || null;
  const lean = flags.has("--lean") ? true : flags.has("--full") ? false : null;
  const raw = flags.has("--raw");

  console.log(`[convert-frag] Streaming ${inputPath} ...`);
  let lastPct = -1;
  const res = await convertIfcFileToFrag(inputPath, outputPath, {
    lean,
    raw,
    onProgress: (progress) => {
      const pct = Math.round((progress || 0) * 100);
      if (pct !== lastPct && pct % 10 === 0) {
        lastPct = pct;
        console.log(`[convert-frag] ${pct}%`);
      }
    },
  });

  const inMb = (res.inputBytes / (1024 * 1024)).toFixed(1);
  const outMb = (res.outputBytes / (1024 * 1024)).toFixed(1);
  console.log(
    `[convert-frag] Done in ${(res.elapsedMs / 1000).toFixed(1)}s: ${inMb} MB IFC -> ${outMb} MB .frag (${res.leanMode ? "lean geometry" : "full attributes"}) -> ${res.outputPath}`,
  );
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runCli().catch((err) => {
    console.error("[convert-frag] Failed:", err);
    process.exit(1);
  });
}
