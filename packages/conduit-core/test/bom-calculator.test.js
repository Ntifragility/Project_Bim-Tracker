import test from 'node:test';
import assert from 'node:assert/strict';
import {
  optimizeStickCutting,
  computeDetailedBom,
  generateContractorBomCsv,
} from '../src/bom-calculator.js';
import { createNetwork, addNode, startRun, appendToRun } from '../src/index.js';

const close = (actual, expected, tol = 1e-3) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${actual} ≠ ${expected} (tol ${tol})`);

test('optimizeStickCutting: packs cuts efficiently into 10-ft stock sticks', () => {
  // Two 1.4 m cuts can fit in one 3.048 m (10-ft) stick
  const res1 = optimizeStickCutting([1.4, 1.4], 3.048);
  assert.equal(res1.sticksNeeded, 1);
  close(res1.totalLengthM, 2.8);
  assert.ok(res1.totalWasteM > 0.2); // ~0.245 m drop/waste

  // Three 1.6 m cuts: each requires > half a stick, so needs 3 sticks
  const res2 = optimizeStickCutting([1.6, 1.6, 1.6], 3.048);
  assert.equal(res2.sticksNeeded, 3);
  close(res2.totalLengthM, 4.8);

  // An oversized 7.0 m continuous run spans 3 sticks
  const res3 = optimizeStickCutting([7.0], 3.048);
  assert.equal(res3.sticksNeeded, 3);
});

test('computeDetailedBom: hardware fittings and NEC code requirements', () => {
  let net = createNetwork({ stickLength: 3.048 });

  // Run 1: 8.0 m long with two 90° bends
  // Points: (0,0) -> (3,0) -> (3,5) -> (3,5,0)
  // Length: 3m + 5m = 8.0m => 3 sticks (ceil(8.0/3.048)) => 2 couplings
  let n1, n2, n3, r1;
  ({ network: net, nodeId: n1 } = addNode(net, { x: 0, y: 0, z: 0 }));
  ({ network: net, nodeId: n2 } = addNode(net, { x: 3, y: 0, z: 0 }));
  ({ network: net, nodeId: n3 } = addNode(net, { x: 3, y: 5, z: 0 }));

  ({ network: net, runId: r1 } = startRun(net, { size: '3/4"', system: 'Power' }, n1));
  net = appendToRun(net, r1, n2);
  net = appendToRun(net, r1, n3);

  const bom = computeDetailedBom(net, { stockLengthM: 3.048 });

  assert.equal(bom.totals.runs, 1);
  close(bom.totals.lengthM, 8.0);
  assert.equal(bom.totals.sticks, 3);
  assert.equal(bom.totals.couplings, 2); // 2 couplings for 3 sticks
  assert.equal(bom.totals.boxConnectors, 2); // 2 box connectors (start and end)
  assert.equal(bom.totals.elbows90, 1); // One 90° elbow
  assert.equal(bom.totals.pullBoxes, 0); // Within NEC limits
});

test('computeDetailedBom: identifies NEC 360° violations and recommends pull boxes', () => {
  let net = createNetwork({ stickLength: 3.048 });

  // Run with 5 consecutive 90° bends (450° total bends)
  const pts = [
    { x: 0, y: 0, z: 0 },
    { x: 2, y: 0, z: 0 },
    { x: 2, y: 2, z: 0 },
    { x: 4, y: 2, z: 0 },
    { x: 4, y: 0, z: 0 },
    { x: 6, y: 0, z: 0 },
    { x: 6, y: 2, z: 0 },
  ];

  let prevNodeId = null;
  let runId = null;
  for (let i = 0; i < pts.length; i++) {
    const { network: nextNet, nodeId } = addNode(net, pts[i]);
    net = nextNet;
    if (i === 0) {
      const { network: runNet, runId: rId } = startRun(net, { size: '1"', system: 'Data' }, nodeId);
      net = runNet;
      runId = rId;
    } else {
      net = appendToRun(net, runId, nodeId);
    }
  }

  const bom = computeDetailedBom(net);
  assert.equal(bom.runs[0].isNecCompliant, false);
  assert.ok(bom.runs[0].cumulativeBendsDeg > 360);
  assert.ok(bom.totals.pullBoxes >= 1); // Pull box recommended
});

test('generateContractorBomCsv: formats structured multi-section purchasing schedule', () => {
  let net = createNetwork({ stickLength: 3.048 });
  let n1, n2, r1;
  ({ network: net, nodeId: n1 } = addNode(net, { x: 0, y: 0, z: 0 }));
  ({ network: net, nodeId: n2 } = addNode(net, { x: 10, y: 0, z: 0 }));
  ({ network: net, runId: r1 } = startRun(net, { size: '½"', system: 'Lighting' }, n1));
  net = appendToRun(net, r1, n2);

  const bom = computeDetailedBom(net);
  const csv = generateContractorBomCsv(bom);

  assert.ok(csv.includes('### SECTION 1: CONDUIT STICKS SCHEDULE'));
  assert.ok(csv.includes('### SECTION 2: FITTINGS & HARDWARE SCHEDULE'));
  assert.ok(csv.includes('### SECTION 3: PULL BOXES & CODE COMPLIANCE'));
  assert.ok(csv.includes('### SECTION 4: RUN-BY-RUN DETAIL'));
  assert.ok(csv.includes('"½"'));
});
