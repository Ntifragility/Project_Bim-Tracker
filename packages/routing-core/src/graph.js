import { distance, mean } from './vector.js';

class DisjointSet {
  constructor(size) {
    this.parent = Array.from({ length: size }, (_, index) => index);
    this.rank = new Array(size).fill(0);
  }

  find(value) {
    if (this.parent[value] !== value) this.parent[value] = this.find(this.parent[value]);
    return this.parent[value];
  }

  union(left, right) {
    let rootLeft = this.find(left);
    let rootRight = this.find(right);
    if (rootLeft === rootRight) return;
    if (this.rank[rootLeft] < this.rank[rootRight]) [rootLeft, rootRight] = [rootRight, rootLeft];
    this.parent[rootRight] = rootLeft;
    if (this.rank[rootLeft] === this.rank[rootRight]) this.rank[rootLeft] += 1;
  }
}

export function buildConnectivityGraph(segments, options = {}) {
  const tolerance = options.tolerance ?? 0.1;
  const endpoints = [];
  for (const segment of segments) {
    endpoints.push({ segmentId: segment.id, end: 'start', position: segment.start });
    endpoints.push({ segmentId: segment.id, end: 'end', position: segment.end });
  }

  const sets = new DisjointSet(endpoints.length);
  for (let left = 0; left < endpoints.length; left += 1) {
    for (let right = left + 1; right < endpoints.length; right += 1) {
      if (distance(endpoints[left].position, endpoints[right].position) <= tolerance) {
        sets.union(left, right);
      }
    }
  }

  const clusters = new Map();
  endpoints.forEach((endpoint, index) => {
    const root = sets.find(index);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(endpoint);
  });

  const nodes = new Map();
  const endpointToNode = new Map();
  let nodeNumber = 1;
  for (const cluster of clusters.values()) {
    const id = `node-${nodeNumber++}`;
    const node = {
      id,
      position: mean(cluster.map((endpoint) => endpoint.position)),
      endpointRefs: cluster,
      edgeIds: new Set(),
    };
    nodes.set(id, node);
    cluster.forEach((endpoint) => endpointToNode.set(`${endpoint.segmentId}:${endpoint.end}`, id));
  }

  const edges = new Map();
  const segmentToEdge = new Map();
  for (const segment of segments) {
    const from = endpointToNode.get(`${segment.id}:start`);
    const to = endpointToNode.get(`${segment.id}:end`);
    const edge = { id: segment.id, from, to, length: segment.length, segment };
    edges.set(edge.id, edge);
    segmentToEdge.set(segment.id, edge.id);
    nodes.get(from)?.edgeIds.add(edge.id);
    nodes.get(to)?.edgeIds.add(edge.id);
  }

  return { nodes, edges, segmentToEdge, tolerance };
}

export function connectedComponents(graph) {
  const components = [];
  const visited = new Set();
  for (const nodeId of graph.nodes.keys()) {
    if (visited.has(nodeId)) continue;
    const component = { nodeIds: new Set(), edgeIds: new Set() };
    const queue = [nodeId];
    visited.add(nodeId);
    while (queue.length) {
      const current = queue.shift();
      component.nodeIds.add(current);
      const node = graph.nodes.get(current);
      for (const edgeId of node.edgeIds) {
        component.edgeIds.add(edgeId);
        const edge = graph.edges.get(edgeId);
        const neighbor = edge.from === current ? edge.to : edge.from;
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    components.push(component);
  }
  return components.sort((a, b) => b.edgeIds.size - a.edgeIds.size);
}

