import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCommandStack,
  createDiameterRegistry,
  createMarkerStore,
  serializeProject,
  deserializeProject,
  computeSha256,
  verifySourceHash,
  exportRunsCsv,
  exportSummaryCsv,
  exportCompleteCsv,
  exportOverlayIfc,
} from '../src/index.js';

test('CommandStack: execute, undo, and redo sequence', () => {
  const stack = createCommandStack({ maxDepth: 5 });
  let state = 0;

  const makeAddCommand = (n) => ({
    execute() {
      state += n;
    },
    undo() {
      state -= n;
    },
  });

  assert.equal(stack.canUndo(), false);
  assert.equal(stack.canRedo(), false);

  stack.execute(makeAddCommand(10));
  assert.equal(state, 10);
  assert.equal(stack.canUndo(), true);

  stack.execute(makeAddCommand(5));
  assert.equal(state, 15);

  stack.undo();
  assert.equal(state, 10);
  assert.equal(stack.canRedo(), true);

  stack.redo();
  assert.equal(state, 15);

  stack.undo();
  stack.undo();
  assert.equal(state, 0);
  assert.equal(stack.canUndo(), false);
});

test('CommandStack: trims at maxDepth', () => {
  const stack = createCommandStack({ maxDepth: 3 });
  let val = 0;
  for (let i = 1; i <= 5; i++) {
    stack.execute({
      execute() { val += 1; },
      undo() { val -= 1; },
    });
  }
  assert.equal(stack.undoCount, 3);
});

test('DiameterRegistry: default trade sizes in inches and color mapping', () => {
  const reg = createDiameterRegistry();
  const all = reg.getAll();
  assert.ok(all.length >= 9);
  assert.ok(all.some((d) => d.label === '¾"'));
  assert.ok(all.some((d) => d.label === '1"'));

  const initialSelected = reg.getSelected();
  assert.equal(initialSelected.label, '¾"');

  const oneInch = reg.getByLabel('1"');
  assert.ok(oneInch);
  reg.setSelected(oneInch.id);
  assert.equal(reg.getSelected().label, '1"');

  const color = reg.getColor('1"');
  assert.ok(typeof color === 'string' && color.startsWith('#'));
});

test('MarkerStore: add, move, count by type, and remove', () => {
  const store = createMarkerStore();
  const m1 = store.addMarker({ type: 'Support', position: { x: 1, y: 2, z: 3 } });
  const m2 = store.addMarker({ type: 'Support', position: { x: 4, y: 5, z: 6 } });
  const m3 = store.addMarker({ type: 'Junction Box', position: { x: 7, y: 8, z: 9 } });

  assert.equal(store.getAll().length, 3);
  const counts = store.countByType();
  assert.equal(counts['Support'], 2);
  assert.equal(counts['Junction Box'], 1);

  store.moveMarker(m1.id, { x: 10, y: 20, z: 30 });
  assert.equal(store.getById(m1.id).position.x, 10);

  store.removeMarker(m2.id);
  assert.equal(store.getAll().length, 2);
  assert.equal(store.countByType()['Support'], 1);
});

test('ProjectIO: serialize, deserialize, and verify roundtrip', async () => {
  const sampleData = {
    sourceModel: {
      name: 'building.ifc',
      size: 1048576,
      sha256: 'deadbeef1234',
      unit: 'METRE',
      schema: 'IFC4',
    },
    settings: {
      stickLengthM: 3.048,
      wasteFactor: 0.1,
      unit: 'METRE',
    },
    diameters: [{ id: 'd1', label: '¾"', mm: 19.05, color: '#f59e0b' }],
    network: {
      nodes: { n1: { id: 'n1', x: 0, y: 0, z: 0 } },
      runs: { r1: { id: 'r1', size: '¾"', nodeIds: ['n1'] } },
    },
    markers: [{ id: 'm1', type: 'Support', position: { x: 0, y: 0, z: 0 } }],
  };

  const json = serializeProject(sampleData);
  assert.ok(typeof json === 'string');

  const loaded = deserializeProject(json);
  assert.equal(loaded.sourceModel.name, 'building.ifc');
  assert.equal(loaded.settings.wasteFactor, 0.1);
  assert.equal(loaded.network.runs.r1.size, '¾"');
  assert.equal(loaded.markers.length, 1);
});

test('ProjectIO: SHA-256 calculation and verification', async () => {
  const testBuffer = new TextEncoder().encode('Hello BIM Tracker').buffer;
  const hash = await computeSha256(testBuffer);
  assert.ok(typeof hash === 'string');
  assert.equal(hash.length, 64);

  const valid = await verifySourceHash(testBuffer, hash);
  assert.equal(valid, true);

  const invalid = await verifySourceHash(testBuffer, '0000000000000000000000000000000000000000000000000000000000000000');
  assert.equal(invalid, false);
});

test('CSV Export: generates formatted CSV with headers', () => {
  const runs = [
    { id: 'run-1', size: '¾"', system: 'Power', length: 10, lengthM: 10, sticks: 4, pointsCount: 3, notes: 'Overhead' },
  ];
  const summary = [
    { size: '¾"', runCount: 1, length: 10, lengthM: 10, sticks: 4 },
  ];
  const markers = [{ type: 'Support' }, { type: 'Support' }];

  const runsCsv = exportRunsCsv({ runs, unit: 'METRE' });
  assert.ok(runsCsv.includes('Run ID,Diameter,System'));
  assert.ok(runsCsv.includes('run-1,"¾""",Power,10.000,4,3,Overhead'));

  const summaryCsv = exportSummaryCsv({ summary, markersSummary: { Support: 2 }, unit: 'METRE', wasteFactor: 0.05 });
  assert.ok(summaryCsv.includes('=== CONDUIT TAKEOFF SUMMARY ==='));
  assert.ok(summaryCsv.includes('"¾""",1,10.000,5%,10.500,4'));
  assert.ok(summaryCsv.includes('Support,2'));

  const completeCsv = exportCompleteCsv({ runs, summary, markers, unit: 'METRE', wasteFactor: 0.05 });
  assert.ok(completeCsv.includes('=== RUN DETAILS ==='));
});

test('IFC Exporter: generates valid STEP IFC file with polylines and Pset_ConduitRun', () => {
  const runs = [
    {
      id: 'r1',
      name: 'Main Feed',
      size: '¾"',
      system: 'Power',
      length: 6.096,
      nodeIds: ['n1', 'n2'],
    },
  ];
  const nodes = {
    n1: { x: 0, y: 0, z: 2.5 },
    n2: { x: 6.096, y: 0, z: 2.5 },
  };

  const ifcText = exportOverlayIfc({ runs, nodes, schema: 'IFC4' });
  assert.ok(ifcText.startsWith('ISO-10303-21;'));
  assert.ok(ifcText.includes("FILE_SCHEMA(('IFC4'));"));
  assert.ok(ifcText.includes('IFCPOLYLINE'));
  assert.ok(ifcText.includes('Pset_ConduitRun'));
  assert.ok(ifcText.includes('IFCANNOTATION'));
  assert.ok(ifcText.endsWith('END-ISO-10303-21;'));
});
