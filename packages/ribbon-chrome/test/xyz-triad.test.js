import test from 'node:test';
import assert from 'node:assert/strict';
import { createXyzTriad } from '../src/xyz-triad.js';
import { setupMockDom } from './dom-mock.js';

test('createXyzTriad mounts canvas and handles camera matrix updates', () => {
  const env = setupMockDom();
  const container = env.doc.createElement('div');

  const listeners = {};
  const mockControls = {
    addEventListener(name, fn) {
      listeners[name] = fn;
    },
    removeEventListener(name, fn) {
      if (listeners[name] === fn) delete listeners[name];
    },
  };

  const mockCamera = {
    matrixWorldInverse: {
      elements: [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
      ],
    },
  };

  const triad = createXyzTriad(container, {
    camera: mockCamera,
    controls: mockControls,
  });

  assert.ok(triad, 'triad should be created');
  assert.equal(typeof triad.render, 'function');
  assert.equal(typeof triad.destroy, 'function');

  // Verify container has triad element
  const triadEl = container.childNodes.find((c) => c.className === 'revit-xyz-triad');
  assert.ok(triadEl, 'revit-xyz-triad div mounted in container');

  // Verify render runs without error on update
  assert.ok(listeners['update'], 'controls registered update listener');
  listeners['update']();

  // Test cleanup
  triad.destroy();
  assert.equal(listeners['update'], undefined, 'controls listener removed on destroy');
});
