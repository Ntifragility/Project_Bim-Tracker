import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('viewport-core wasm keeps orbit and pan off the selection path', async () => {
  const bytes = await readFile(new URL('../pkg/viewport_core.wasm', import.meta.url));
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
