import test from 'node:test';
import assert from 'node:assert/strict';
import { setupMockDom } from './dom-mock.js';
import { createRibbon } from '../src/index.js';

function createKeytipDef() {
  return {
    appId: 'tray',
    tabs: [
      {
        id: 'model',
        label: 'Model',
        keytip: 'M',
        groups: [
          {
            id: 'grp1',
            label: 'Group 1',
            items: [
              [
                {
                  id: 'cmd.open',
                  label: 'Open',
                  icon: 'open',
                  size: 'big',
                  keytip: 'MO',
                  run(ctx) { ctx.opened = true; }
                },
                {
                  id: 'cmd.save',
                  label: 'Save',
                  icon: 'save',
                  size: 'big',
                  keytip: 'MS',
                  run(ctx) { ctx.saved = true; }
                }
              ]
            ]
          }
        ]
      },
      {
        id: 'view',
        label: 'View',
        keytip: 'V',
        groups: [
          {
            id: 'grp2',
            label: 'Group 2',
            items: [
              [
                {
                  id: 'cmd.reset',
                  label: 'Reset',
                  icon: 'reset-view',
                  size: 'small',
                  keytip: 'VR',
                  run(ctx) { ctx.reset = true; }
                }
              ]
            ]
          }
        ]
      }
    ],
    contextual: [],
    qat: ['cmd.open']
  };
}

test('KeyTips: Alt toggles tabs overlay; second Alt closes it', () => {
  const { doc, win } = setupMockDom();
  const host = doc.createElement('div');
  const ctx = {};
  const api = createRibbon(host, createKeytipDef(), ctx);

  // Press Alt -> shows badges
  win.dispatchEvent({ type: 'keydown', key: 'Alt', preventDefault() {}, stopPropagation() {} });
  assert.equal(host.getAttribute('data-keytips'), 'tabs');
  assert.ok(host.querySelectorAll('.rc-keytip').length >= 3); // QAT (MO) + Model (M) + View (V)

  // Second Alt -> cancels
  win.dispatchEvent({ type: 'keydown', key: 'Alt', preventDefault() {}, stopPropagation() {} });
  assert.equal(host.hasAttribute('data-keytips'), false);
  assert.equal(host.querySelectorAll('.rc-keytip').length, 0);

  api.destroy();
});

test('KeyTips: Escape dismissal at tab level (R5 first ESC layer)', () => {
  const { doc, win } = setupMockDom();
  const host = doc.createElement('div');
  const ctx = {};
  const api = createRibbon(host, createKeytipDef(), ctx);

  win.dispatchEvent({ type: 'keydown', key: 'Alt', preventDefault() {}, stopPropagation() {} });
  assert.equal(host.getAttribute('data-keytips'), 'tabs');

  let defaultPrevented = false;
  let propagationStopped = false;
  win.dispatchEvent({
    type: 'keydown',
    key: 'Escape',
    preventDefault() { defaultPrevented = true; },
    stopPropagation() { propagationStopped = true; },
    stopImmediatePropagation() { propagationStopped = true; }
  });

  assert.equal(host.hasAttribute('data-keytips'), false);
  assert.equal(defaultPrevented, true);
  assert.equal(propagationStopped, true);

  api.destroy();
});

test('KeyTips: Navigation sequence Alt -> Tab -> Command executes run and hides badges', () => {
  const { doc, win } = setupMockDom();
  const host = doc.createElement('div');
  const ctx = {};
  const api = createRibbon(host, createKeytipDef(), ctx);

  // 1. Alt
  win.dispatchEvent({ type: 'keydown', key: 'Alt', preventDefault() {}, stopPropagation() {} });
  assert.equal(host.getAttribute('data-keytips'), 'tabs');

  // 2. Type 'V' (switch to View tab)
  win.dispatchEvent({ type: 'keydown', key: 'V', preventDefault() {}, stopPropagation() {} });
  assert.equal(host.getAttribute('data-keytips'), 'commands');
  assert.equal(host.querySelector('#rc-tab-view').getAttribute('aria-selected'), 'true');

  // 3. Type 'VR' (Reset command)
  win.dispatchEvent({ type: 'keydown', key: 'V', preventDefault() {}, stopPropagation() {} });
  win.dispatchEvent({ type: 'keydown', key: 'R', preventDefault() {}, stopPropagation() {} });

  assert.equal(ctx.reset, true);
  assert.equal(host.hasAttribute('data-keytips'), false);
  assert.equal(host.querySelectorAll('.rc-keytip').length, 0);

  api.destroy();
});

test('KeyTips: QAT command direct execution from tabs mode', () => {
  const { doc, win } = setupMockDom();
  const host = doc.createElement('div');
  const ctx = {};
  const api = createRibbon(host, createKeytipDef(), ctx);

  // 1. Alt
  win.dispatchEvent({ type: 'keydown', key: 'Alt', preventDefault() {}, stopPropagation() {} });

  // 2. Type 'MO' (QAT open command keytip)
  win.dispatchEvent({ type: 'keydown', key: 'M', preventDefault() {}, stopPropagation() {} });
  // Since 'M' is a tab keytip, it switched to commands mode for Model tab!
  assert.equal(host.getAttribute('data-keytips'), 'commands');

  // In commands mode, typing 'MO' executes cmd.open
  win.dispatchEvent({ type: 'keydown', key: 'M', preventDefault() {}, stopPropagation() {} });
  win.dispatchEvent({ type: 'keydown', key: 'O', preventDefault() {}, stopPropagation() {} });

  assert.equal(ctx.opened, true);
  assert.equal(host.hasAttribute('data-keytips'), false);

  api.destroy();
});

test('KeyTips: setKeytipsVisible programmatic toggle', () => {
  const { doc } = setupMockDom();
  const host = doc.createElement('div');
  const ctx = {};
  const api = createRibbon(host, createKeytipDef(), ctx);

  api.setKeytipsVisible(true);
  assert.equal(host.getAttribute('data-keytips'), 'tabs');

  api.setKeytipsVisible(false);
  assert.equal(host.hasAttribute('data-keytips'), false);

  api.destroy();
});
