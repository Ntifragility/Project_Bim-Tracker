// Snapping a new point onto the existing network. A node snap reuses that node;
// a segment snap splits the segment there. Both create a branch on purpose.
import { closestOnSegment, distance } from './geometry.js';
import { nodeById } from './network.js';

/**
 * Nearest node within `tolerance` metres, otherwise the nearest point on a
 * segment within `tolerance`. Returns null when nothing is close enough.
 */
export function findSnap(network, point, tolerance) {
  let best = null;
  for (const node of network.nodes) {
    const d = distance(node, point);
    if (d <= tolerance && (!best || d < best.distance)) {
      best = { kind: 'node', nodeId: node.id, point: { x: node.x, y: node.y, z: node.z }, distance: d };
    }
  }
  if (best) return best;

  for (const run of network.runs) {
    for (let index = 0; index < run.nodeIds.length - 1; index += 1) {
      const a = nodeById(network, run.nodeIds[index]);
      const b = nodeById(network, run.nodeIds[index + 1]);
      const hit = closestOnSegment(point, a, b);
      if (hit.t <= 0 || hit.t >= 1 || hit.distance > tolerance) continue;
      if (!best || hit.distance < best.distance) {
        best = { kind: 'segment', runId: run.id, index, point: hit.point, distance: hit.distance };
      }
    }
  }
  return best;
}
