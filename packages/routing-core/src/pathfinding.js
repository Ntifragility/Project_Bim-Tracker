export function shortestPath(graph, startNodeId, endNodeId, options = {}) {
  const excludedEdgeIds = new Set(options.excludeEdgeIds || []);
  if (!graph.nodes.has(startNodeId) || !graph.nodes.has(endNodeId)) {
    return { found: false, reason: 'unknown-node', nodeIds: [], edgeIds: [], length: Infinity };
  }

  const distances = new Map(Array.from(graph.nodes.keys(), (id) => [id, Infinity]));
  const previous = new Map();
  const remaining = new Set(graph.nodes.keys());
  distances.set(startNodeId, 0);

  while (remaining.size) {
    let current = null;
    for (const candidate of remaining) {
      if (current === null || distances.get(candidate) < distances.get(current)) current = candidate;
    }
    if (current === null || distances.get(current) === Infinity) break;
    remaining.delete(current);
    if (current === endNodeId) break;

    for (const edgeId of graph.nodes.get(current).edgeIds) {
      if (excludedEdgeIds.has(edgeId)) continue;
      const edge = graph.edges.get(edgeId);
      const neighbor = edge.from === current ? edge.to : edge.from;
      if (!remaining.has(neighbor)) continue;
      const candidateDistance = distances.get(current) + edge.length;
      if (candidateDistance < distances.get(neighbor)) {
        distances.set(neighbor, candidateDistance);
        previous.set(neighbor, { nodeId: current, edgeId });
      }
    }
  }

  if (distances.get(endNodeId) === Infinity) {
    return { found: false, reason: 'disconnected', nodeIds: [], edgeIds: [], length: Infinity };
  }

  const nodeIds = [endNodeId];
  const edgeIds = [];
  let cursor = endNodeId;
  while (cursor !== startNodeId) {
    const step = previous.get(cursor);
    if (!step) return { found: false, reason: 'incomplete-path', nodeIds: [], edgeIds: [], length: Infinity };
    edgeIds.unshift(step.edgeId);
    nodeIds.unshift(step.nodeId);
    cursor = step.nodeId;
  }

  return { found: true, nodeIds, edgeIds, length: distances.get(endNodeId) };
}
