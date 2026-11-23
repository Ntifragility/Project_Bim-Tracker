// packages/viewer-core/src/chunked-loader.js
// SVF2-Lite Chunked .frag Bundle Manager (shared by Conduit Takeoff & Tray Viewer).
// Pluggable transport design: Local / OneDrive-synced folder works offline right now;
// cloud transports (Cloudflare R2 / SharePoint / Google Drive) plug into the exact same interface.

import * as THREE from "three";

/**
 * Local / OneDrive-synced folder transport from <input webkitdirectory> or dropped File[].
 * Never reads .frag bytes until `readChunkBytes(filename)` is explicitly called.
 */
export function createLocalFolderTransport(fileList) {
  const files = Array.from(fileList || []);
  const byName = new Map();
  let manifestFile = null;

  for (const f of files) {
    const rawName = (f.webkitRelativePath || f.name || "").replace(/\\/g, "/");
    const base = rawName.split("/").pop();
    if (!base) continue;
    byName.set(base.toLowerCase(), f);
    if (base.toLowerCase() === "manifest.json") {
      manifestFile = f;
    }
  }

  return {
    kind: "local-folder",
    async readManifest() {
      if (!manifestFile) {
        throw new Error("Selected folder does not contain manifest.json (expected a .fragbundle folder).");
      }
      const text = await manifestFile.text();
      return JSON.parse(text);
    },
    async readChunkBytes(filename) {
      const f = byName.get(String(filename || "").toLowerCase());
      if (!f) {
        throw new Error(`Chunk file '${filename}' not found in selected bundle folder.`);
      }
      return new Uint8Array(await f.arrayBuffer());
    },
  };
}

/**
 * Validates a manifest.json object produced by `ifc2frag.exe --split-by-storey` / `--split-by-category`.
 */
export function validateBundleManifest(manifest) {
  if (!manifest || typeof manifest !== "object") {
    throw new Error("Invalid manifest.json: expected JSON object.");
  }
  if (manifest.format !== "fragbundle" || !Array.isArray(manifest.chunks)) {
    throw new Error("Unsupported manifest.json: expected format === 'fragbundle' and chunks[].");
  }
  return manifest;
}

/**
 * Computes a THREE.Box3 from a chunk's manifest bbox ({ min: [x,y,z], max: [x,y,z] }).
 */
export function chunkBboxToBox3(bbox) {
  if (!bbox || !Array.isArray(bbox.min) || !Array.isArray(bbox.max)) return null;
  const min = new THREE.Vector3(Number(bbox.min[0]), Number(bbox.min[1]), Number(bbox.min[2]));
  const max = new THREE.Vector3(Number(bbox.max[0]), Number(bbox.max[1]), Number(bbox.max[2]));
  if (
    !Number.isFinite(min.x) || !Number.isFinite(min.y) || !Number.isFinite(min.z) ||
    !Number.isFinite(max.x) || !Number.isFinite(max.y) || !Number.isFinite(max.z)
  ) {
    return null;
  }
  const box = new THREE.Box3(min, max);
  return box.isEmpty() ? null : box;
}

/**
 * Creates a reactive on-demand chunk loader/unloader bound to a viewer-core engine.
 */
export function createChunkedModelManager({ engine, onChange = null } = {}) {
  let activeTransport = null;
  let activeManifest = null;
  const loadedChunks = new Map(); // chunkId -> { model, modelId, chunk }
  const loadingChunks = new Set(); // chunkId
  const listeners = new Set();
  if (typeof onChange === "function") listeners.add(onChange);

  function getState() {
    const chunks = (activeManifest?.chunks || []).map((ch) => ({
      ...ch,
      loaded: loadedChunks.has(ch.id),
      loading: loadingChunks.has(ch.id),
    }));
    let loadedCompressedBytes = 0;
    let totalCompressedBytes = 0;
    for (const ch of chunks) {
      const b = Number(ch.compressedBytes) || 0;
      totalCompressedBytes += b;
      if (ch.loaded) loadedCompressedBytes += b;
    }
    return {
      active: Boolean(activeManifest),
      manifest: activeManifest,
      chunks,
      loadedCount: loadedChunks.size,
      totalCount: chunks.length,
      loadedCompressedBytes,
      totalCompressedBytes,
    };
  }

  function notify() {
    const snap = getState();
    for (const cb of listeners) {
      try { cb(snap); } catch (err) { console.warn("[chunked-loader] listener error:", err); }
    }
  }

  async function disposeLoadedChunk(entry) {
    const { model, modelId } = entry;
    const obj = model?.object || model;
    if (obj && engine?.world?.scene?.three) {
      try { engine.world.scene.three.remove(obj); } catch { /* noop */ }
    }
    try {
      if (typeof engine?.fragments?.core?.disposeModel === "function") {
        await engine.fragments.core.disposeModel(modelId);
      } else if (typeof model?.dispose === "function") {
        await model.dispose();
      }
    } catch (err) {
      console.warn(`[chunked-loader] disposeModel('${modelId}') warning:`, err);
    }
  }

  async function closeBundle() {
    for (const entry of loadedChunks.values()) {
      await disposeLoadedChunk(entry);
    }
    loadedChunks.clear();
    loadingChunks.clear();
    activeTransport = null;
    activeManifest = null;
    notify();
  }

  async function openBundle(transport) {
    if (!transport || typeof transport.readManifest !== "function" || typeof transport.readChunkBytes !== "function") {
      throw new Error("Invalid bundle transport.");
    }
    await closeBundle();
    const manifest = validateBundleManifest(await transport.readManifest());
    activeTransport = transport;
    activeManifest = manifest;

    // Fit camera to the union bounding box of all chunks (without loading any .frag yet)
    const unionBox = new THREE.Box3();
    for (const ch of manifest.chunks) {
      const b = chunkBboxToBox3(ch.bbox);
      if (b) unionBox.union(b);
    }
    if (!unionBox.isEmpty() && typeof engine?.focusOnBox === "function") {
      engine.focusOnBox(unionBox);
    }

    notify();
    return { manifest, unionBox: unionBox.isEmpty() ? null : unionBox };
  }

  async function loadChunk(chunkId) {
    if (!activeManifest || !activeTransport) return null;
    if (loadedChunks.has(chunkId)) return loadedChunks.get(chunkId).model;
    if (loadingChunks.has(chunkId)) return null;

    const chunk = activeManifest.chunks.find((c) => c.id === chunkId);
    if (!chunk) throw new Error(`Unknown chunk id '${chunkId}'.`);

    loadingChunks.add(chunkId);
    notify();
    try {
      const bytes = await activeTransport.readChunkBytes(chunk.file);
      const modelId = `chunk::${activeManifest.sourceName || "bundle"}::${chunk.id}`;
      const model = await engine.loadFrag(bytes, modelId);
      if (!model) throw new Error(`Failed to load chunk '${chunk.name}'.`);
      const obj = model.object || model;
      if (obj && engine?.world?.scene?.three && !engine.world.scene.three.children.includes(obj)) {
        engine.world.scene.three.add(obj);
      }
      loadedChunks.set(chunkId, { model, modelId, chunk });
      loadingChunks.delete(chunkId);
      notify();
      return model;
    } catch (err) {
      loadingChunks.delete(chunkId);
      notify();
      throw err;
    }
  }

  async function unloadChunk(chunkId) {
    const entry = loadedChunks.get(chunkId);
    if (!entry) return false;
    loadedChunks.delete(chunkId);
    await disposeLoadedChunk(entry);
    notify();
    return true;
  }

  async function toggleChunk(chunkId) {
    if (loadedChunks.has(chunkId)) {
      await unloadChunk(chunkId);
      return false;
    }
    await loadChunk(chunkId);
    return true;
  }

  function focusChunk(chunkId) {
    if (!activeManifest) return false;
    const chunk = activeManifest.chunks.find((c) => c.id === chunkId);
    if (!chunk) return false;
    const box = chunkBboxToBox3(chunk.bbox);
    if (!box || typeof engine?.focusOnBox !== "function") return false;
    engine.focusOnBox(box);
    return true;
  }

  function subscribe(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }

  return {
    openBundle,
    closeBundle,
    loadChunk,
    unloadChunk,
    toggleChunk,
    focusChunk,
    getState,
    subscribe,
  };
}
