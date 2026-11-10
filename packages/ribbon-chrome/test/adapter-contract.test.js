import test from 'node:test';
import assert from 'node:assert/strict';
import { setupMockDom } from './dom-mock.js';
import { createRibbon, AdapterError } from '../src/index.js';

test('Adapter contract: verifies all structural constraints at startup', () => {
  const { doc } = setupMockDom();
  const host = doc.createElement('div');
  const ctx = {};

  const baseDef = () => ({
    appId: 'tray',
    tabs: [
      {
        id: 'tab1',
        label: 'Tab 1',
        keytip: 'T1',
        groups: [
          {
            id: 'g1',
            label: 'Group 1',
            items: [
              [
                {
                  id: 'cmd1',
                  label: 'Cmd 1',
                  icon: 'open',
                  size: 'big',
                  keytip: 'C1',
                  run() {}
                }
              ]
            ]
          }
        ]
      }
    ],
    contextual: [],
    qat: []
  });

  // Valid def succeeds
  const api = createRibbon(host, baseDef(), ctx);
  assert.ok(api);
  api.destroy();

  // Missing keytip on command -> throws AdapterError
  const def1 = baseDef();
  delete def1.tabs[0].groups[0].items[0][0].keytip;
  assert.throws(() => createRibbon(host, def1, ctx), (err) => {
    return err instanceof AdapterError && err.message.includes("Command 'cmd1' is missing a required keytip string");
  });

  // Empty string keytip on command -> throws AdapterError
  const def2 = baseDef();
  def2.tabs[0].groups[0].items[0][0].keytip = '';
  assert.throws(() => createRibbon(host, def2, ctx), (err) => {
    return err instanceof AdapterError && err.message.includes("Command 'cmd1' is missing a required keytip string");
  });

  // Missing run function on command -> throws AdapterError
  const def3 = baseDef();
  delete def3.tabs[0].groups[0].items[0][0].run;
  assert.throws(() => createRibbon(host, def3, ctx), (err) => {
    return err instanceof AdapterError && err.message.includes("missing a run() function");
  });

  // Missing QAT command id -> throws AdapterError
  const def4 = baseDef();
  def4.qat = ['cmd.does.not.exist'];
  assert.throws(() => createRibbon(host, def4, ctx), (err) => {
    return err instanceof AdapterError && err.message.includes("QAT references unknown command id");
  });

  // Duplicate tab keytip -> throws AdapterError
  const def5 = baseDef();
  def5.tabs.push({
    id: 'tab2',
    label: 'Tab 2',
    keytip: 't1', // case-insensitive clash
    groups: []
  });
  assert.throws(() => createRibbon(host, def5, ctx), (err) => {
    return err instanceof AdapterError && err.message.includes("Duplicate tab keytip");
  });

  // Companion splitWith missing from group -> throws AdapterError
  const def6 = baseDef();
  def6.tabs[0].groups[0].items[0][0].splitWith = 'missing.companion';
  assert.throws(() => createRibbon(host, def6, ctx), (err) => {
    return err instanceof AdapterError && err.message.includes("does not exist in group");
  });

  // Companion splitWith itself declaring splitWith -> throws AdapterError
  const def7 = baseDef();
  def7.tabs[0].groups[0].items[0].push({
    id: 'comp1',
    label: 'Comp 1',
    icon: 'cancel',
    size: 'small',
    keytip: 'CC1',
    splitWith: 'cmd1',
    run() {}
  });
  def7.tabs[0].groups[0].items[0][0].splitWith = 'comp1';
  assert.throws(() => createRibbon(host, def7, ctx), (err) => {
    return err instanceof AdapterError && err.message.includes("must not declare splitWith");
  });
});
