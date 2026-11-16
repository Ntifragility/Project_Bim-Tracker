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
  assert.ok(ifcText.includes('IFCSWEPTDISKSOLID'));
  assert.ok(ifcText.includes('IFCFLOWSEGMENT'));
  assert.ok(ifcText.includes('Pset_ConduitRun'));
  assert.ok(ifcText.includes('IFCANNOTATION'));
  assert.ok(ifcText.endsWith('END-ISO-10303-21;'));

  // Test that a bent run exports smooth circular bend curve points
  const bentRuns = [{ id: 'r2', name: 'Corner Run', size: '3/4"', system: 'Power', nodeIds: ['p1', 'p2', 'p3'] }];
  const bentNodes = {
    p1: { x: 0, y: 0, z: 0 },
    p2: { x: 5, y: 0, z: 0 },
    p3: { x: 5, y: 5, z: 0 },
  };
  const bentIfc = exportOverlayIfc({ runs: bentRuns, nodes: bentNodes, schema: 'IFC4' });
  assert.ok(bentIfc.includes('IFCSWEPTDISKSOLID'));
  // Polyline for a 90° elbow with 12 arc subdivisions must have > 3 points (smooth curved bend)
  const polyMatch = bentIfc.match(/IFCPOLYLINE\(\(([^)]+)\)\)/);
  assert.ok(polyMatch, 'Contains polyline');
  const polyPointCount = polyMatch[1].split(',').length;
  assert.ok(polyPointCount >= 10, `Curved bend has smooth arc subdivisions (${polyPointCount} points)`);

  // Test toOriginal transformation (geolocalized origin shift + Z-up swap)
  const shiftIfc = exportOverlayIfc({
    runs,
    nodes,
    schema: 'IFC4',
    toOriginal: (p) => ({ x: p.x + 350000, y: -p.z + 8600000, z: p.y + 100 }),
  });
  assert.ok(shiftIfc.includes('350000.0000'), 'Easting applied to Cartesian points');
  assert.ok(shiftIfc.includes('8599997.5000'), 'Northing applied to Cartesian points');
  assert.ok(shiftIfc.includes('100.0000'), 'Elevation applied to Cartesian points');
});

test('exportOverlayIfc: produces valid 3D SweptDiskSolid triangles in web-ifc with UTM coordinates and deduplicated points', async () => {
  const { default: WebIFC } = await import('web-ifc');

  const runs = [
    { id: 'r-utm', name: 'Conduit UTM 1', size: '4"', system: 'Power', nodeIds: ['u1', 'u2', 'u3', 'u4'] },
  ];
  const nodes = {
    u1: { id: 'u1', x: 209296.9877, y: 391.0863, z: -8114447.8160 },
    u2: { id: 'u2', x: 209296.98772, y: 391.08631, z: -8114447.81601 }, // micro-duplicate (< 0.5mm)
    u3: { id: 'u3', x: 209290.6100, y: 380.4984, z: -8114457.4962 },
    u4: { id: 'u4', x: 209294.0728, y: 380.9349, z: -8114459.6225 },
  };

  const ifcText = exportOverlayIfc({
    runs,
    nodes,
    schema: 'IFC4',
    toOriginal: (p) => ({ x: p.x, y: -p.z, z: p.y }),
  });

  // Verify fallback length computation is non-zero
  assert.ok(!ifcText.includes('IFCLENGTHMEASURE(0.000)'), 'Computed fallback length must be non-zero');

  // Verify IFCSTYLEDITEM targets IFCSWEPTDISKSOLID entity rather than IFCSHAPEREPRESENTATION
  const sweptMatch = ifcText.match(/#(\d+)=IFCSWEPTDISKSOLID\(/);
  assert.ok(sweptMatch, 'IFC contains IFCSWEPTDISKSOLID');
  const sweptId = sweptMatch[1];
  assert.ok(
    ifcText.includes(`IFCSTYLEDITEM(#${sweptId},`),
    'IFCSTYLEDITEM targets IFCSWEPTDISKSOLID entity'
  );

  // Verify run placement uses f64 UTM anchor while polyline starts locally at origin
  assert.ok(ifcText.includes('(209296.9877,8114447.8160,391.0863)'), 'UTM world anchor present on placement');
  assert.ok(ifcText.includes('(0.0000,0.0000,0.0000)'), 'Local polyline origin starts at zero');

  // Verify web-ifc produces valid 3D triangles when re-opening the exported file
  const api = new WebIFC.IfcAPI();
  await api.Init((p) => `node_modules/web-ifc/${p}`);
  const modelID = api.OpenModel(new Uint8Array(Buffer.from(ifcText)), { COORDINATE_TO_ORIGIN: true });
  let meshCount = 0;
  let triangleCount = 0;
  api.StreamAllMeshes(modelID, (mesh) => {
    meshCount++;
    for (let i = 0; i < mesh.geometries.size(); i++) {
      const geom = api.GetGeometry(modelID, mesh.geometries.get(i).geometryExpressID);
      const indices = api.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize());
      triangleCount += indices.length / 3;
      geom.delete();
    }
  });
  const coordMat = api.GetCoordinationMatrix(modelID);
  api.CloseModel(modelID);

  assert.equal(meshCount, 1, 'Expected 1 3D mesh for the exported conduit run');
  assert.ok(triangleCount > 0, `Expected non-zero 3D triangles (got ${triangleCount})`);
  // Verify web-ifc coordination matrix restores the exact UTM site translation (-X, -Elev, +Y_ifc)
  assert.ok(Math.abs(coordMat[12] + 209296.9877) < 0.25, `Expected easting shift (~-209297), got ${coordMat[12]}`);
  assert.ok(Math.abs(coordMat[13] + 391.0863) < 0.25, `Expected elev shift (~-391), got ${coordMat[13]}`);
  assert.ok(Math.abs(coordMat[14] - 8114447.816) < 0.25, `Expected northing shift (~+8114448), got ${coordMat[14]}`);
});
