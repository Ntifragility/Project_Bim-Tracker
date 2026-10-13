import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addNode,
  appendToRun,
  computeTakeoff,
  computeRunTakeoff,
  constrainOrtho,
  createNetwork,
  deleteRun,
  findSnap,
  planAngleOf,
  removeLastPoint,
  sizeToMillimetres,
  splitSegment,
  startRun,
  validateNetwork,
} from '../src/index.js';

const p = (x, y, z = 0) => ({ x, y, z });
const close = (actual, expected, tol = 1e-9) => assert.ok(Math.abs(actual - expected) <= tol, `${actual} != ${expected}`);

function drawRun(network, points, { size = '3/4"', system = '' } = {}) {
  let next = network;
  let nodeId;
  ({ network: next, nodeId } = addNode(next, points[0]));
  let runId;
  ({ network: next, runId } = startRun(next, { size, system }, nodeId));
  for (const point of points.slice(1)) {
    ({ network: next, nodeId } = addNode(next, point));
    next = appendToRun(next, runId, nodeId);
  }
  return { network: next, runId };
}

// --- Takeoff: per-run sticks ---

test('straight run: length and per-run sticks', () => {
  // 10 m run, 3 m sticks => ceil(10/3) = 4 sticks
  const { network } = drawRun(createNetwork({ stickLength: 3 }), [p(0, 0), p(10, 0)]);
  const takeoff = computeTakeoff(network);
  close(takeoff.totals.length, 10);
  assert.equal(takeoff.runs[0].sticks, 4);
  assert.equal(takeoff.totals.sticks, 4);
});

test('a run exactly one stick long needs 1 stick', () => {
  const { network } = drawRun(createNetwork({ stickLength: 3.048 }), [p(0, 0), p(3.048, 0)]);
  const takeoff = computeTakeoff(network);
  assert.equal(takeoff.runs[0].sticks, 1);
  assert.equal(takeoff.totals.sticks, 1);
});

test('per-run sticks: 25 ft run at 10 ft stick = 3 sticks', () => {
  // acceptance test #7 from the spec
  const stickLength = 3.048;  // 10 ft in metres
  const runLength = 7.62;     // 25 ft in metres
  const { network } = drawRun(createNetwork({ stickLength }), [p(0, 0), p(runLength, 0)]);
  const takeoff = computeTakeoff(network);
  assert.equal(takeoff.runs[0].sticks, 3);
});

test('multi-segment run: length is the sum of segments', () => {
  // 3-segment L-shaped run: 4 + 2 + 3 = 9 m
  const { network } = drawRun(createNetwork({ stickLength: 3 }), [
    p(0, 0), p(4, 0), p(4, 2), p(4, 5),
  ]);
  const takeoff = computeTakeoff(network);
  close(takeoff.runs[0].length, 9);
  assert.equal(takeoff.runs[0].sticks, 3); // ceil(9/3) = 3
});

test('two runs of same diameter: summary sums per-run sticks', () => {
  // Run A: 7 m => ceil(7/3) = 3 sticks
  // Run B: 5 m => ceil(5/3) = 2 sticks
  // Total sticks = 3 + 2 = 5 (NOT ceil(12/3) = 4)
  let net = createNetwork({ stickLength: 3 });
  ({ network: net } = drawRun(net, [p(0, 0), p(7, 0)], { size: '3/4"' }));
  ({ network: net } = drawRun(net, [p(0, 5), p(5, 5)], { size: '3/4"' }));
  const takeoff = computeTakeoff(net);
  assert.equal(takeoff.bySize.length, 1);
  assert.equal(takeoff.bySize[0].runs, 2);
  close(takeoff.bySize[0].length, 12);
  assert.equal(takeoff.bySize[0].sticks, 5); // 3 + 2, not ceil(12/3)
  assert.equal(takeoff.totals.sticks, 5);
});

test('different diameters are separate rows', () => {
  let net = createNetwork({ stickLength: 3 });
  ({ network: net } = drawRun(net, [p(0, 0), p(6, 0)], { size: '3/4"' }));
  ({ network: net } = drawRun(net, [p(0, 5), p(4, 5)], { size: '1"' }));
  const takeoff = computeTakeoff(net);
  assert.equal(takeoff.bySize.length, 2);
  assert.equal(takeoff.totals.runs, 2);
  close(takeoff.totals.length, 10);
});

test('no elbows, risers, or fittings are computed', () => {
  // A run with a 90° turn: takeoff reports only length and sticks
  const { network } = drawRun(createNetwork({ stickLength: 3 }), [
    p(0, 0), p(4, 0), p(4, 2),
  ]);
  const takeoff = computeTakeoff(network);
  close(takeoff.runs[0].length, 6);
  assert.equal(takeoff.runs[0].sticks, 2); // ceil(6/3) = 2
  // No elbow/riser/coupling/tee/cross fields
  assert.equal(takeoff.runs[0].elbow90, undefined);
  assert.equal(takeoff.runs[0].riserLength, undefined);
  assert.equal(takeoff.runs[0].couplings, undefined);
  assert.equal(takeoff.totals.elbow90, undefined);
});

test('zero-length run reports 0 sticks', () => {
  const net = createNetwork({ stickLength: 3 });
  const { network, nodeId } = addNode(net, p(0, 0));
  const { network: net2, runId } = startRun(network, { size: '1"' }, nodeId);
  // Run with only one vertex — no segments
  const takeoff = computeTakeoff(net2);
  assert.equal(takeoff.runs[0].sticks, 0);
  assert.equal(takeoff.runs[0].length, 0);
});

// --- Network operations ---

test('a collinear midpoint does not affect length', () => {
  const { network } = drawRun(createNetwork({ stickLength: 3 }), [p(0, 0), p(2, 0), p(5, 0)]);
  const takeoff = computeTakeoff(network);
  close(takeoff.runs[0].length, 5);
  assert.equal(takeoff.runs[0].sticks, 2); // ceil(5/3) = 2
});

test('snap prefers nodes, then segment interiors, within tolerance', () => {
  const { network } = drawRun(createNetwork(), [p(0, 0), p(10, 0)]);
  // Snap to node
  const nodeSnap = findSnap(network, p(0.001, 0.001, 0), 0.01);
  assert.equal(nodeSnap.kind, 'node');
  // Snap to segment
  const segSnap = findSnap(network, p(5, 0.005, 0), 0.01);
  assert.equal(segSnap.kind, 'segment');
  // No snap — too far
  const noSnap = findSnap(network, p(5, 1, 0), 0.01);
  assert.equal(noSnap, null);
});

test('ortho keeps the dominant axis, optionally on a rotated plan grid', () => {
  const result = constrainOrtho(p(0, 0, 0), p(3, 1, 0));
  close(result.x, 3);
  close(result.y, 0);

  const rotated = constrainOrtho(p(0, 0, 0), p(3, 1, 0), { planAngle: 45 });
  const len = Math.hypot(rotated.x, rotated.y);
  assert.ok(len > 0);
});

test('undo of the last point and run deletion drop unused nodes', () => {
  let { network, runId } = drawRun(createNetwork(), [p(0, 0), p(1, 0), p(2, 0)]);
  assert.equal(network.nodes.length, 3);
  network = removeLastPoint(network, runId);
  assert.equal(network.nodes.length, 2);
  network = deleteRun(network, runId);
  assert.equal(network.nodes.length, 0);
  assert.equal(network.runs.length, 0);
});

test('a saved network reloads with identical quantities and fresh ids', () => {
  const { network } = drawRun(createNetwork({ stickLength: 3 }), [p(0, 0), p(10, 0)]);
  const json = JSON.parse(JSON.stringify(network));
  const reloaded = validateNetwork(json);
  const original = computeTakeoff(network);
  const restored = computeTakeoff(reloaded);
  close(original.runs[0].length, restored.runs[0].length);
  assert.equal(original.runs[0].sticks, restored.runs[0].sticks);
});

test('sizes order by millimetres whether written in mm or inches', () => {
  assert.ok(sizeToMillimetres('3/4"') < sizeToMillimetres('1"'));
  assert.ok(sizeToMillimetres('25mm') < sizeToMillimetres('2"'));
  assert.ok(Number.isNaN(sizeToMillimetres('foo')));
});

test('splitSegment inserts a node inside a run', () => {
  const { network, runId } = drawRun(createNetwork(), [p(0, 0), p(10, 0)]);
  const { network: split } = splitSegment(network, runId, 0, p(5, 0));
  const run = split.runs.find((r) => r.id === runId);
  assert.equal(run.nodeIds.length, 3);
  close(computeTakeoff(split).runs[0].length, 10); // total length unchanged
});

test('per-run takeoff helper works standalone', () => {
  const { network, runId } = drawRun(createNetwork({ stickLength: 3 }), [p(0, 0), p(8, 0)]);
  const result = computeRunTakeoff(network, runId);
  close(result.length, 8);
  assert.equal(result.sticks, 3); // ceil(8/3) = 3
  assert.equal(result.points, 2);
});

test('system grouping: runs with different systems appear under same diameter', () => {
  let net = createNetwork({ stickLength: 3 });
  ({ network: net } = drawRun(net, [p(0, 0), p(6, 0)], { size: '3/4"', system: 'Power' }));
  ({ network: net } = drawRun(net, [p(0, 5), p(4, 5)], { size: '3/4"', system: 'Lighting' }));
  const takeoff = computeTakeoff(net);
  // Both runs are 3/4" — one diameter row
  assert.equal(takeoff.bySize.length, 1);
  assert.equal(takeoff.bySize[0].runs, 2);
  // But runs carry their system for filtering
  assert.equal(takeoff.runs[0].system, 'Power');
  assert.equal(takeoff.runs[1].system, 'Lighting');
});
