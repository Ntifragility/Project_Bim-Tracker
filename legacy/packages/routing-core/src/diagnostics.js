import { connectedComponents } from './graph.js';

export function diagnoseGraph(graph, options = {}) {
  const minimumConfidence = options.minimumConfidence ?? 0.65;
  const components = connectedComponents(graph);
  const danglingNodes = [];
  const ambiguousNodes = [];
  const lowConfidenceEdges = [];

  for (const node of graph.nodes.values()) {
    if (node.edgeIds.size === 1) danglingNodes.push(node.id);
    if (node.edgeIds.size > 4) ambiguousNodes.push(node.id);
  }
  for (const edge of graph.edges.values()) {
    if ((edge.segment.confidence ?? 1) < minimumConfidence) lowConfidenceEdges.push(edge.id);
  }

  return {
    segmentCount: graph.edges.size,
    nodeCount: graph.nodes.size,
    componentCount: components.length,
    components,
    danglingNodes,
    ambiguousNodes,
    lowConfidenceEdges,
    isConnected: components.length <= 1,
  };
}

