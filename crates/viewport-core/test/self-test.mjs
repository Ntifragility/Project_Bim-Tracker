import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// The committed build artifact (built by scripts/build-viewport-wasm.mjs,
// drift-checked by the viewport-wasm CI job). `crates/viewport-core/pkg/`
// is wasm-pack output: gitignored and never built here, so the test must
// not depend on it. Resolved from the repo root so `npm test` works from
// any cwd in npm-only flows (no Rust toolchain required).
const ROOT = new URL('../../..', import.meta.url);
const WASM_URL = new URL('public/assets/viewport_core.wasm', ROOT);

test('viewport-core wasm keeps orbit and pan off the selection path', async () => {
  const bytes = await readFile(WASM_URL);
  const { instance } = await WebAssembly.instantiate(bytes);
  assert.equal(instance.exports.viewport_self_test(), 0);

  // Per-instance handle test
  const handle = instance.exports.viewport_create();
  assert.notEqual(handle, 0);
  instance.exports.viewport_instance_set_mode(handle, 1); // Drawing mode
  assert.equal(instance.exports.viewport_instance_allow_highlight(handle), 0); // No highlight in drawing mode
  instance.exports.viewport_instance_set_mode(handle, 0); // Navigate mode
  assert.equal(instance.exports.viewport_instance_allow_highlight(handle), 1); // Allow highlight in navigate mode
  instance.exports.viewport_destroy(handle);
});
