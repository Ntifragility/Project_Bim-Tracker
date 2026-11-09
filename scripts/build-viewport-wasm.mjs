#!/usr/bin/env node
// Builds crates/viewport-core to public/assets/viewport_core.wasm.
//
// The conduit app imports this wasm through `viewport-controls.js`
// (`?url` import, with a virtual-module fallback to `/assets/viewport_core.wasm`
// when the file is absent). The file is a build artifact (gitignored via
// `target/` + `**/pkg/`-style rules do NOT cover it, so it lives under
// `public/assets/` and is copied verbatim by Vite into `dist/`).
//
// Pure Rust cdylib with a C API: plain `cargo build` emits a directly
// instantiable module, no wasm-pack / wasm-bindgen needed.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "target/wasm32-unknown-unknown/release/viewport_core.wasm");
const DEST = path.join(ROOT, "public/assets/viewport_core.wasm");

// npm-only environments (plain frontend dev machines, the CI `baseline` job)
// have no Rust toolchain. The CI `viewport-wasm` job is the hard gate for
// freshness; here, an existing artifact is good enough to unblock dev/build.
try {
  execFileSync("cargo", ["build", "-p", "viewport-core", "--target", "wasm32-unknown-unknown", "--release"], {
    cwd: ROOT,
    stdio: "inherit",
  });
} catch (err) {
  if (fs.existsSync(DEST)) {
    console.warn(`[build-viewport-wasm] cargo build failed (${err?.message ?? err}); reusing existing ${path.relative(ROOT, DEST)}.`);
    process.exit(0);
  }
  throw err;
}
fs.mkdirSync(path.dirname(DEST), { recursive: true });
fs.copyFileSync(SRC, DEST);
console.log(`viewport-core wasm -> ${path.relative(ROOT, DEST)} (${fs.statSync(DEST).size} bytes)`);
