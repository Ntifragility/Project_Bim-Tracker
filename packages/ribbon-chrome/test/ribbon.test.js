import test from 'node:test';
import assert from 'node:assert/strict';
import { setupMockDom } from './dom-mock.js';
import { createRibbon, AdapterError } from '../src/index.js';

function createSampleDef() {
  return {
    appId: 'tray',
    tabs: [
      {
        id: 'model',
        label: 'Model',
        keytip: 'M',
        groups: [
          {
            id: 'source',
            label: 'Source',
            items: [
              [
                {
                  id: 'tray.open',
                  label: 'Open',
                  icon: 'open',
                  size: 'big',
                  keytip: 'MO',
                  run(ctx) { ctx.called = 'tray.open'; },
                  enabled(ctx) { return ctx.canOpen !== false; },
                },
                {
                  id: 'tray.sample',
                  label: 'Sample',
                  icon: 'sample',
                  size: 'big',
                  keytip: 'MS',
                  run(ctx) { ctx.called = 'tray.sample'; },
                }
              ]
            ]
          }
        ]
      },
      {
        id: 'edit',
        label: 'Edit',
        keytip: 'E',
        groups: [
          {
            id: 'actions',
            label: 'Actions',
            launcher: {
              ariaLabel: 'Launch Settings',
              tooltip: 'Settings Dialog',
              run(ctx) { ctx.launcherCalled = true; }
            },
            items: [
              [
                {
                  id: 'tray.finish',
                  label: 'Finish Run',
                  icon: 'finish',
                  size: 'big',
                  keytip: 'EF',
                  splitWith: 'tray.cancel',
                  run(ctx) { ctx.called = 'tray.finish'; },
                  enabled(ctx) { return Boolean(ctx.canFinish); }
                },
                {
                  id: 'tray.cancel',
                  label: 'Cancel Run',
                  icon: 'cancel',
                  size: 'small',
                  keytip: 'EC',
                  run(ctx) { ctx.called = 'tray.cancel'; },
                  enabled(ctx) { return Boolean(ctx.canCancel); }
                }
              ]
            ]
          }
        ]
      }
    ],
    contextual: [
      {
        id: 'modify-system',
        label: 'MODIFY | TRAY SYSTEM',
        keytip: 'CT',
        groups: [
          {
            id: 'ctx-group',
            label: 'Tray System Actions',
            items: [
              [
                {
                  id: 'tray.highlight',
                  label: 'Highlight',
                  icon: 'highlight',
                  size: 'big',
                  keytip: 'CTH',
                  run(ctx) { ctx.called = 'tray.highlight'; }
                },
                {
                  kind: 'input',
                  id: 'tray.diameter',
                  label: 'Size:',
                  inputType: 'select',
                  options: [
                    { value: '100', label: '100mm' },
                    { value: '200', label: '200mm' }
                  ],
                  keytip: 'CTS',
                  value(ctx) { return ctx.diameter || '100'; },
                  onChange(val, ctx) { ctx.diameter = val; }
                }
              ]
            ]
          }
        ]
      }
    ],
    qat: ['tray.open', 'tray.sample'],
    statusSegments: [
      {
        id: 'selection-count',
        value(ctx) { return `Selection: ${ctx.selectionCount || 0} elements`; }
      },
      {
        id: 'backend-mode',
        value(ctx) { return ctx.wasmMode ? 'WASM mode' : 'JS mode'; }
      }
    ]
  };
}

test('Adapter contract: missing keytip or invalid config throws AdapterError', () => {
  const { doc } = setupMockDom();
  const host = doc.createElement('div');
  const ctx = {};

  // Missing host
  assert.throws(() => createRibbon(null, createSampleDef(), ctx), /host element is required/);

  // Missing def
  assert.throws(() => createRibbon(host, null, ctx), /RibbonDef is required/);

  // Missing tabs
  assert.throws(() => createRibbon(host, { tabs: [] }, ctx), /def.tabs must be a non-empty array/);

  // Command missing keytip
  const defMissingKeytip = createSampleDef();
  delete defMissingKeytip.tabs[0].groups[0].items[0][0].keytip;
  assert.throws(() => createRibbon(host, defMissingKeytip, ctx), /missing a required keytip string/);

  // Tab missing keytip
  const defMissingTabKeytip = createSampleDef();
  delete defMissingTabKeytip.tabs[0].keytip;
  assert.throws(() => createRibbon(host, defMissingTabKeytip, ctx), /missing a required keytip string/);

  // Duplicate tab keytip
  const defDupKeytip = createSampleDef();
  defDupKeytip.tabs[1].keytip = 'M';
  assert.throws(() => createRibbon(host, defDupKeytip, ctx), /Duplicate tab keytip/);

  // SplitWith referencing non-existent companion
  const defBadSplit = createSampleDef();
  defBadSplit.tabs[1].groups[0].items[0][0].splitWith = 'non.existent';
  assert.throws(() => createRibbon(host, defBadSplit, ctx), /which does not exist in group/);

  // Companion declaring splitWith
  const defCompanionDeclaresSplit = createSampleDef();
  defCompanionDeclaresSplit.tabs[1].groups[0].items[0][1].splitWith = 'tray.finish';
  assert.throws(() => createRibbon(host, defCompanionDeclaresSplit, ctx), /must not declare splitWith/);

  // QAT references unknown command
  const defBadQat = createSampleDef();
  defBadQat.qat = ['unknown.command'];
  assert.throws(() => createRibbon(host, defBadQat, ctx), /QAT references unknown command id/);
});

test('Tab switching: setTab changes aria-selected and shows correct panel', () => {
  const { doc } = setupMockDom();
  const host = doc.createElement('div');
  const ctx = {};
  const def = createSampleDef();

  const api = createRibbon(host, def, ctx);

  const modelTab = host.querySelector('#rc-tab-model');
  const editTab = host.querySelector('#rc-tab-edit');
  const modelPanel = host.querySelector('#rc-panel-model');
  const editPanel = host.querySelector('#rc-panel-edit');

  assert.equal(modelTab.getAttribute('aria-selected'), 'true');
  assert.equal(editTab.getAttribute('aria-selected'), 'false');
  assert.equal(modelPanel.hidden, false);
  assert.equal(editPanel.hidden, true);

  // Switch to Edit
  api.setTab('edit');
  assert.equal(modelTab.getAttribute('aria-selected'), 'false');
  assert.equal(editTab.getAttribute('aria-selected'), 'true');
  assert.equal(modelPanel.hidden, true);
  assert.equal(editPanel.hidden, false);

  // Unknown tab is no-op
  api.setTab('unknown');
  assert.equal(editTab.getAttribute('aria-selected'), 'true');

  api.destroy();
});

test('Contextual tabs: showContextual and hideContextual', () => {
  const { doc } = setupMockDom();
  const host = doc.createElement('div');
  const ctx = {};
  const def = createSampleDef();

  const api = createRibbon(host, def, ctx);

  const ctxStrip = host.querySelector('.rc-ctx-strip');
  const ctxPanel = host.querySelector('#rc-ctx-panel-modify-system');
  const modelPanel = host.querySelector('#rc-panel-model');

  assert.equal(ctxStrip.style.display, 'none');
  assert.equal(ctxPanel.hidden, true);
  assert.equal(modelPanel.hidden, false);

  // Show contextual tab
  api.showContextual('modify-system');
  assert.equal(ctxStrip.style.display, 'flex');
  assert.equal(ctxStrip.textContent, 'MODIFY | TRAY SYSTEM');
  assert.equal(ctxPanel.hidden, false);
  assert.equal(modelPanel.hidden, true);

  // Hide contextual tab: restores last active fixed tab
  api.hideContextual();
  assert.equal(ctxStrip.style.display, 'none');
  assert.equal(ctxPanel.hidden, true);
  assert.equal(modelPanel.hidden, false);

  api.destroy();
});

test('Split button: renders compound control and respects disable rule', () => {
  const { doc } = setupMockDom();
  const host = doc.createElement('div');
  const ctx = { canFinish: false, canCancel: true };
  const def = createSampleDef();

  const api = createRibbon(host, def, ctx);
  api.setTab('edit');

  const splitBtn = host.querySelector('.rc-split-btn');
  assert.ok(splitBtn, 'Split button container exists');

  const primaryBtn = splitBtn.querySelector('.rc-split-primary');
  const companionBtn = splitBtn.querySelector('.rc-split-companion');
  assert.ok(primaryBtn, 'Primary button exists');
  assert.ok(companionBtn, 'Companion button exists');

  // Both parts are disabled when primary is disabled (even though canCancel is true)
  assert.equal(primaryBtn.disabled, true);
  assert.equal(companionBtn.disabled, true);

  // Enable primary: primary becomes enabled, companion respects its own canCancel
  ctx.canFinish = true;
  api.refresh();
  assert.equal(primaryBtn.disabled, false);
  assert.equal(companionBtn.disabled, false);

  // Disable companion: primary stays enabled, companion becomes disabled
  ctx.canCancel = false;
  api.refresh();
  assert.equal(primaryBtn.disabled, false);
  assert.equal(companionBtn.disabled, true);

  // Primary click runs primary command
  primaryBtn.click();
  assert.equal(ctx.called, 'tray.finish');

  // Enable companion and click companion
  ctx.canCancel = true;
  api.refresh();
  companionBtn.click();
  assert.equal(ctx.called, 'tray.cancel');

  api.destroy();
});

test('Refresh pass: updates enabled, visible, inputs, and status segments', () => {
  const { doc } = setupMockDom();
  const host = doc.createElement('div');
  const ctx = {
    canOpen: true,
    selectionCount: 5,
    wasmMode: false,
    diameter: '100'
  };
  const def = createSampleDef();

  const api = createRibbon(host, def, ctx);

  const openBtn = host.querySelector('.rc-btn[data-command-id="tray.open"]');
  assert.equal(openBtn.disabled, false);

  const seg1 = host.querySelector('.rc-status-segment[data-segment-id="selection-count"]');
  const seg2 = host.querySelector('.rc-status-segment[data-segment-id="backend-mode"]');
  assert.equal(seg1.textContent, 'Selection: 5 elements');
  assert.equal(seg2.textContent, 'JS mode');

  // Mutate state and refresh
  ctx.canOpen = false;
  ctx.selectionCount = 12;
  ctx.wasmMode = true;
  api.refresh();

  assert.equal(openBtn.disabled, true);
  assert.equal(seg1.textContent, 'Selection: 12 elements');
  assert.equal(seg2.textContent, 'WASM mode');

  // Direct setStatus
  api.setStatus('selection-count', 'Selection: 42 elements');
  assert.equal(seg1.textContent, 'Selection: 42 elements');

  api.destroy();
});

test('Collapse and expand: persists state to sessionStorage', () => {
  const { doc, sessionStorage } = setupMockDom();
  const host = doc.createElement('div');
  const ctx = {};
  const def = createSampleDef();

  const api = createRibbon(host, def, ctx);
  assert.equal(host.hasAttribute('data-rc-collapsed'), false);

  // Collapse
  api.collapse();
  assert.equal(host.getAttribute('data-rc-collapsed'), 'true');
  assert.equal(sessionStorage.getItem('rc-collapsed'), '1');

  // Expand
  api.expand();
  assert.equal(host.hasAttribute('data-rc-collapsed'), false);
  assert.equal(sessionStorage.getItem('rc-collapsed'), null);

  // Toggle
  api.toggle();
  assert.equal(host.getAttribute('data-rc-collapsed'), 'true');
  api.toggle();
  assert.equal(host.hasAttribute('data-rc-collapsed'), false);

  api.destroy();
});

test('KeyTips navigation sequence: Alt -> tab -> command and Escape dismissal', () => {
  const { doc, win } = setupMockDom();
  const host = doc.createElement('div');
  const ctx = {};
  const def = createSampleDef();

  const api = createRibbon(host, def, ctx);

  // 1. Press Alt to show tabs keytips
  win.dispatchEvent({ type: 'keydown', key: 'Alt', preventDefault() {}, stopPropagation() {} });
  assert.equal(host.getAttribute('data-keytips'), 'tabs');
  const badges = host.querySelectorAll('.rc-keytip');
  assert.ok(badges.length > 0, 'Badges rendered in tabs mode');

  // 2. Escape dismisses immediately (R5 first ESC layer)
  let stopped = false;
  win.dispatchEvent({
    type: 'keydown',
    key: 'Escape',
    preventDefault() {},
    stopPropagation() { stopped = true; },
    stopImmediatePropagation() { stopped = true; }
  });
  assert.equal(host.hasAttribute('data-keytips'), false);
  assert.equal(stopped, true);

  // 3. Re-open via Alt, type 'M' (Model tab), then 'S' (Sample command)
  win.dispatchEvent({ type: 'keydown', key: 'Alt', preventDefault() {}, stopPropagation() {} });
  assert.equal(host.getAttribute('data-keytips'), 'tabs');

  win.dispatchEvent({ type: 'keydown', key: 'M', preventDefault() {}, stopPropagation() {} });
  assert.equal(host.getAttribute('data-keytips'), 'commands');

  win.dispatchEvent({ type: 'keydown', key: 'M', preventDefault() {}, stopPropagation() {} });
  win.dispatchEvent({ type: 'keydown', key: 'S', preventDefault() {}, stopPropagation() {} });

  assert.equal(ctx.called, 'tray.sample');
  assert.equal(host.hasAttribute('data-keytips'), false);

  api.destroy();
});

test('Render-loop contract: calling refresh inside rAF produces console.warn', async () => {
  const { doc, win } = setupMockDom();
  const host = doc.createElement('div');
  const ctx = {};
  const def = createSampleDef();

  const api = createRibbon(host, def, ctx);

  let warned = false;
  const originalWarn = console.warn;
  console.warn = (...args) => {
    if (args[0] && args[0].includes('requestAnimationFrame / render loop')) {
      warned = true;
    }
  };

  try {
    // Normal call does NOT warn
    api.refresh();
    assert.equal(warned, false);

    // Call inside requestAnimationFrame
    await new Promise((resolve) => {
      win.requestAnimationFrame(() => {
        api.refresh();
        resolve();
      });
    });

    assert.equal(warned, true, 'Calling refresh inside rAF triggered console.warn');
  } finally {
    console.warn = originalWarn;
    api.destroy();
  }
});
