import test from 'node:test';
import assert from 'node:assert/strict';
import { createUnhidePill } from '../src/unhide-pill.js';
import { setupMockDom } from './dom-mock.js';

test('createUnhidePill mounts pill, reacts to visibility changes, and calls unhideAll on click', () => {
  setupMockDom();
  const container = document.createElement('div');

  let visibilityCallback = null;
  let unhideCalled = false;

  const mockVisibility = {
    onVisibilityChange(cb) {
      visibilityCallback = cb;
      return () => { visibilityCallback = null; };
    },
    unhideAll() {
      unhideCalled = true;
    },
  };

  const pill = createUnhidePill(container, { visibility: mockVisibility });
  assert.ok(pill, 'pill should be created');
  assert.equal(typeof pill.update, 'function');
  assert.equal(typeof pill.destroy, 'function');

  // Verify initial state is hidden
  assert.ok(pill.element.classList.contains('hidden'), 'initially hidden');

  // Simulate hidden elements count > 0
  assert.ok(typeof visibilityCallback === 'function', 'registered visibility callback');
  visibilityCallback(4);
  assert.ok(!pill.element.classList.contains('hidden'), 'visible when count > 0');

  // Verify click calls unhideAll
  pill.element.click();
  assert.equal(unhideCalled, true, 'unhideAll called on click');

  // Simulate reset to 0 hidden elements
  visibilityCallback(0);
  assert.ok(pill.element.classList.contains('hidden'), 'hidden when count returns to 0');

  // Cleanup
  pill.destroy();
  assert.equal(visibilityCallback, null, 'listener unsubscribed on destroy');
});
