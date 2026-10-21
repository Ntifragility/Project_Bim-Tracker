import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('viewport-core wasm keeps orbit and pan off the selection path', async () => {
  const bytes = await readFile(new URL('../pkg/viewport_core.wasm', import.meta.url));
  const { instance } = await WebAssembly.instantiate(bytes);
  assert.equal(instance.exports.viewport_self_test(), 0);
});
