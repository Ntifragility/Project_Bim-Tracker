import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addNode,
  appendToRun,
  computeTakeoff,
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

test('straight run: length, sticks and stick couplings', () => {
  const { network } = drawRun(createNetwork({ stickLength: 3 }), [p(0, 0), p(10, 0)]);
  const takeoff = computeTakeoff(network);
  close(takeoff.totals.length, 10);
  assert.equal(takeoff.bySize[0].sticks, 4);
  assert.equal(takeoff.totals.couplings, 3);
  assert.equal(takeoff.totals.elbow90, 0);
  assert.equal(takeoff.totals.openEnds, 2);
});

test('a run exactly one stick long needs no coupling', () => {
  const { network } = drawRun(createNetwork({ stickLength: 3.048 }), [p(0, 0), p(3.048, 0)]);
  const takeoff = computeTakeoff(network);
  assert.equal(takeoff.bySize[0].sticks, 1);
  assert.equal(takeoff.totals.couplings, 0);
});

test('one 90 degree turn is one elbow and splits the straight sections', () => {
  const { network } = drawRun(createNetwork({ stickLength: 3 }), [p(0, 0), p(4, 0), p(4, 2)]);
  const takeoff = computeTakeoff(network);
  assert.equal(takeoff.totals.elbow90, 1);
  assert.equal(takeoff.totals.couplings, 1);
  close(takeoff.totals.length, 6);
});

test('45 degree and odd bends are classified apart', () => {
  const s = Math.SQRT1_2;
  const forty = drawRun(createNetwork(), [p(0, 0), p(2, 0), p(2 + s, s)]).network;
  assert.equal(computeTakeoff(forty).totals.elbow45, 1);
  const odd = drawRun(createNetwork(), [p(0, 0), p(2, 0), p(2 + Math.cos(Math.PI / 6), Math.sin(Math.PI / 6))]).network;
  const takeoff = computeTakeoff(odd);
  assert.equal(takeoff.totals.bends, 1);
  close(takeoff.fittings.find((f) => f.kind === 'bend').angle, 30, 1e-6);
});

test('a collinear point does not break the stick section', () => {
  const { network } = drawRun(createNetwork({ stickLength: 3 }), [p(0, 0), p(2, 0), p(5, 0)]);
  const takeoff = computeTakeoff(network);
  assert.equal(takeoff.totals.couplings, 1);
  assert.equal(takeoff.totals.elbow90 + takeoff.totals.bends, 0);
});

test('vertical segments are reported as risers', () => {
  const { network } = drawRun(createNetwork(), [p(0, 0, 0), p(0, 0, 3), p(2, 0, 3)]);
  const takeoff = computeTakeoff(network);
  close(takeoff.totals.riserLength, 3);
  close(takeoff.totals.length, 5);
  assert.equal(takeoff.totals.elbow90, 1);
});

test('a branch snapped onto a segment is one tee under the larger size', () => {
  let { network, runId: main } = drawRun(createNetwork(), [p(0, 0), p(10, 0)], { size: '1"' });
  let teeNode;
  ({ network, nodeId: teeNode } = splitSegment(network, main, 0, p(4, 0)));
  let branch;
  ({ network, runId: branch } = startRun(network, { size: '3/4"' }, teeNode));
  let end;
  ({ network, nodeId: end } = addNode(network, p(4, 5)));
  network = appendToRun(network, branch, end);

  const takeoff = computeTakeoff(network);
  assert.equal(takeoff.totals.tees, 1);
  assert.equal(takeoff.totals.openEnds, 3);
  assert.equal(takeoff.bySize.find((row) => row.size === '1"').tees, 1);
  close(takeoff.bySize.find((row) => row.size === '1"').length, 10);
  close(takeoff.bySize.find((row) => row.size === '3/4"').length, 5);
  assert.deepEqual(takeoff.fittings.find((f) => f.kind === 'tee').sizes.sort(), ['1"', '3/4"']);
});

test('a near miss without a snap stays two separate runs', () => {
  let { network } = drawRun(createNetwork(), [p(0, 0), p(10, 0)]);
  ({ network } = drawRun(network, [p(4, 0.2), p(4, 5)]));
  const takeoff = computeTakeoff(network);
  assert.equal(takeoff.totals.tees, 0);
  assert.equal(takeoff.totals.openEnds, 4);
});

test('two runs through one shared node make a cross', () => {
  let { network, runId: a } = drawRun(createNetwork(), [p(-5, 0), p(5, 0)]);
  let center;
  ({ network, nodeId: center } = splitSegment(network, a, 0, p(0, 0)));
  let b;
  let n;
  ({ network, nodeId: n } = addNode(network, p(0, -5)));
  ({ network, runId: b } = startRun(network, { size: '3/4"' }, n));
  network = appendToRun(network, b, center);
  ({ network, nodeId: n } = addNode(network, p(0, 5)));
  network = appendToRun(network, b, n);
  assert.equal(computeTakeoff(network).totals.crosses, 1);
});

test('snap prefers nodes, then segment interiors, within tolerance', () => {
  const { network } = drawRun(createNetwork(), [p(0, 0), p(10, 0)]);
  assert.equal(findSnap(network, p(0.05, 0.02), 0.1).kind, 'node');
  const onSegment = findSnap(network, p(4, 0.05), 0.1);
  assert.equal(onSegment.kind, 'segment');
  assert.deepEqual(onSegment.point, p(4, 0));
  assert.equal(findSnap(network, p(4, 0.5), 0.1), null);
});

test('ortho keeps the dominant axis, optionally on a rotated plan grid', () => {
  assert.deepEqual(constrainOrtho(p(0, 0), p(3, 1, 0.2)), p(3, 0, 0));
  assert.deepEqual(constrainOrtho(p(0, 0), p(0.1, 0.2, 2)), p(0, 0, 2));
  const angle = 30;
  const rad = (angle * Math.PI) / 180;
  const result = constrainOrtho(p(0, 0), p(5 * Math.cos(rad) - 0.1, 5 * Math.sin(rad) + 0.15, 0), { planAngle: angle });
  close(planAngleOf(p(0, 0), result), angle, 1e-9);
});

test('undo of the last point and run deletion drop unused nodes', () => {
  let { network, runId } = drawRun(createNetwork(), [p(0, 0), p(1, 0), p(2, 0)]);
  network = removeLastPoint(network, runId);
  assert.equal(network.nodes.length, 2);
  network = deleteRun(network, runId);
  assert.equal(network.nodes.length, 0);
  assert.equal(network.runs.length, 0);
});

test('a saved network reloads with identical quantities and fresh ids', () => {
  const { network } = drawRun(createNetwork({ sourceModels: ['plant.ifc'] }), [p(300000, 8600000, 100), p(300004, 8600000, 100), p(300004, 8600003, 100)]);
  const reloaded = validateNetwork(JSON.parse(JSON.stringify(network)));
  assert.deepEqual(computeTakeoff(reloaded), computeTakeoff(network));
  const { nodeId } = addNode(reloaded, p(0, 0));
  assert.ok(!network.nodes.some((node) => node.id === nodeId));
  assert.throws(() => validateNetwork({ ...network, runs: [{ id: 'r9', nodeIds: ['n99'] }] }), /missing node/);
});

test('sizes order by millimetres whether written in mm or inches', () => {
  close(sizeToMillimetres('3/4"'), 19.05);
  close(sizeToMillimetres('1 1/2"'), 38.1);
  close(sizeToMillimetres('25mm'), 25);
  close(sizeToMillimetres('1"'), 25.4);
});
