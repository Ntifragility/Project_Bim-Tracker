import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildConnectivityGraph,
  deriveCenterline,
  diagnoseGraph,
  shortestPath,
} from '../src/index.js';

const point = (x, y, z = 0) => ({ x, y, z });

test('derives a longitudinal centerline from a rotated tray-shaped point cloud', () => {
  const points = [];
  for (const along of [-2, 2]) {
    for (const across of [-0.25, 0.25]) {
      points.push(point(along - across, along + across, -0.1));
      points.push(point(along - across, along + across, 0.1));
    }
  }
  const result = deriveCenterline(points);
  assert.equal(result.valid, true);
  assert.ok(Math.abs(result.length - Math.sqrt(32)) < 0.05);
  assert.ok(result.confidence > 0.95);
});

test('clusters nearby endpoints into shared graph nodes', () => {
  const segments = [
    { id: 'a', start: point(0, 0), end: point(2, 0), length: 2, confidence: 1 },
    { id: 'b', start: point(2.04, 0), end: point(5, 0), length: 2.96, confidence: 1 },
  ];
  const graph = buildConnectivityGraph(segments, { tolerance: 0.05 });
  assert.equal(graph.nodes.size, 3);
  assert.equal(graph.edges.size, 2);
  const diagnostics = diagnoseGraph(graph);
  assert.equal(diagnostics.componentCount, 1);
  assert.equal(diagnostics.danglingNodes.length, 2);
});

test('reports disconnected networks and low-confidence geometry', () => {
  const graph = buildConnectivityGraph([
    { id: 'a', start: point(0, 0), end: point(1, 0), length: 1, confidence: 0.4 },
    { id: 'b', start: point(10, 0), end: point(11, 0), length: 1, confidence: 1 },
  ]);
  const diagnostics = diagnoseGraph(graph);
  assert.equal(diagnostics.componentCount, 2);
  assert.deepEqual(diagnostics.lowConfidenceEdges, ['a']);
  assert.equal(diagnostics.isConnected, false);
});

test('calculates the shortest weighted path', () => {
  const graph = buildConnectivityGraph([
    { id: 'a', start: point(0, 0), end: point(1, 0), length: 1 },
    { id: 'b', start: point(1, 0), end: point(2, 0), length: 1 },
    { id: 'c', start: point(0, 0), end: point(2, 0), length: 5 },
  ], { tolerance: 0.001 });
  const start = graph.edges.get('a').from;
  const end = graph.edges.get('b').to;
  const result = shortestPath(graph, start, end);
  assert.equal(result.found, true);
  assert.deepEqual(result.edgeIds, ['a', 'b']);
  assert.equal(result.length, 2);
});

test('can exclude endpoint edges from an internal route search', () => {
  const graph = buildConnectivityGraph([
    { id: 'start', start: point(0, 0), end: point(1, 0), length: 1 },
    { id: 'middle', start: point(1, 0), end: point(2, 0), length: 1 },
    { id: 'end', start: point(2, 0), end: point(3, 0), length: 1 },
  ], { tolerance: 0.001 });
  const result = shortestPath(
    graph,
    graph.edges.get('start').to,
    graph.edges.get('end').from,
    { excludeEdgeIds: ['start', 'end'] },
  );
  assert.equal(result.found, true);
  assert.deepEqual(result.edgeIds, ['middle']);
});
