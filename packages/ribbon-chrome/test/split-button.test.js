import test from 'node:test';
import assert from 'node:assert/strict';
import { setupMockDom } from './dom-mock.js';
import { createRibbon } from '../src/index.js';

function createSplitDef() {
  return {
    appId: 'conduit',
    tabs: [
      {
        id: 'trace',
        label: 'Trace',
        keytip: 'T',
        groups: [
          {
            id: 'run-group',
            label: 'Run',
            items: [
              [
                {
                  id: 'conduit.run-finish',
                  label: 'Finish Run',
                  icon: 'finish',
                  size: 'big',
                  keytip: 'TRF',
                  splitWith: 'conduit.run-cancel',
                  run(ctx) { ctx.runFinished = true; },
                  enabled(ctx) { return ctx.canFinishRun !== false; }
                },
                {
                  id: 'conduit.run-cancel',
                  label: 'Cancel Run',
                  icon: 'cancel',
                  size: 'small',
                  keytip: 'TRC',
                  run(ctx) { ctx.runCancelled = true; },
                  enabled(ctx) { return ctx.canCancelRun !== false; }
                }
              ]
            ]
          }
        ]
      }
    ],
    contextual: [],
    qat: []
  };
}

test('Split button: visual and compound structure', () => {
  const { doc } = setupMockDom();
  const host = doc.createElement('div');
  const ctx = {};
  const api = createRibbon(host, createSplitDef(), ctx);

  const splitEl = host.querySelector('.rc-split-btn');
  assert.ok(splitEl, 'Split button wrapper rendered');

  const primary = splitEl.querySelector('.rc-split-primary');
  const divider = splitEl.querySelector('.rc-split-divider');
  const companion = splitEl.querySelector('.rc-split-companion');

  assert.ok(primary, 'Primary part exists');
  assert.ok(divider, 'Divider line exists');
  assert.ok(companion, 'Companion part exists');

  assert.equal(primary.getAttribute('data-command-id'), 'conduit.run-finish');
  assert.equal(primary.getAttribute('aria-label'), 'Finish Run (primary)');
  assert.equal(companion.getAttribute('data-command-id'), 'conduit.run-cancel');
  assert.equal(companion.getAttribute('aria-label'), 'Cancel Run');

  // Verify companion is not rendered as a standalone button outside the split wrapper
  const allFinishes = host.querySelectorAll('[data-command-id="conduit.run-finish"]');
  const allCancels = host.querySelectorAll('[data-command-id="conduit.run-cancel"]');
  assert.equal(allFinishes.length, 1);
  assert.equal(allCancels.length, 1);

  api.destroy();
});

test('Split button: independent execution of primary and companion', () => {
  const { doc } = setupMockDom();
  const host = doc.createElement('div');
  const ctx = {};
  const api = createRibbon(host, createSplitDef(), ctx);

  const primary = host.querySelector('.rc-split-primary');
  const companion = host.querySelector('.rc-split-companion');

  primary.click();
  assert.equal(ctx.runFinished, true);
  assert.equal(ctx.runCancelled, undefined);

  companion.click();
  assert.equal(ctx.runCancelled, true);

  api.destroy();
});

test('Split button disabled cascade: primary disabled disables both parts', () => {
  const { doc } = setupMockDom();
  const host = doc.createElement('div');
  const ctx = { canFinishRun: false, canCancelRun: true };
  const api = createRibbon(host, createSplitDef(), ctx);

  const primary = host.querySelector('.rc-split-primary');
  const companion = host.querySelector('.rc-split-companion');

  assert.equal(primary.disabled, true);
  assert.equal(companion.disabled, true, 'Companion must be disabled when primary is disabled (§2.7)');

  // Enable primary
  ctx.canFinishRun = true;
  api.refresh();

  assert.equal(primary.disabled, false);
  assert.equal(companion.disabled, false);

  // Disable companion independently
  ctx.canCancelRun = false;
  api.refresh();

  assert.equal(primary.disabled, false);
  assert.equal(companion.disabled, true);

  api.destroy();
});
