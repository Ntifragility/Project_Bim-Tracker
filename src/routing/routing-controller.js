import * as THREE from 'three';
import {
  buildConnectivityGraph,
  diagnoseGraph,
  shortestPath,
} from '../../packages/routing-core/src/index.js';
import { extractTraySegments } from './ifc-extractor.js';

function vector3(point) {
  return new THREE.Vector3(point.x, point.y, point.z);
}

function lineObject(points, color, opacity = 1) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points.map(vector3));
  const material = new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity });
  return new THREE.LineSegments(geometry, material);
}

function disposeGroup(group) {
  group.traverse((object) => {
    object.geometry?.dispose?.();
    if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose?.());
    else object.material?.dispose?.();
  });
  group.clear();
}

export function initRoutingController({ world, getLoadedModels }) {
  const overlay = new THREE.Group();
  overlay.name = 'routing-diagnostic-overlay';
  world.scene.three.add(overlay);

  const buildButton = document.getElementById('btn-build-routing-graph');
  const clearButton = document.getElementById('btn-clear-routing-graph');
  const setStartButton = document.getElementById('btn-route-start');
  const setEndButton = document.getElementById('btn-route-end');
  const calculateButton = document.getElementById('btn-calculate-route');
  const toleranceInput = document.getElementById('routing-tolerance');
  const status = document.getElementById('routing-status');
  const summary = document.getElementById('routing-summary');

  let graph = null;
  let diagnostics = null;
  let selectedElement = null;
  let startEdgeId = null;
  let endEdgeId = null;
  let routeLine = null;

  function setStatus(message, tone = '') {
    status.textContent = message;
    status.dataset.tone = tone;
  }

  function updateRouteButtons() {
    const selectedEdgeId = selectedElement
      ? `${selectedElement.model?.modelId}:${selectedElement.localId}`
      : null;
    setStartButton.disabled = !graph?.edges.has(selectedEdgeId);
    setEndButton.disabled = !graph?.edges.has(selectedEdgeId);
    calculateButton.disabled = !startEdgeId || !endEdgeId;
  }

  function renderGraph() {
    disposeGroup(overlay);
    const connectedPoints = [];
    const lowConfidencePoints = [];
    for (const edge of graph.edges.values()) {
      const target = diagnostics.lowConfidenceEdges.includes(edge.id)
        ? lowConfidencePoints
        : connectedPoints;
      target.push(edge.segment.start, edge.segment.end);
    }
    if (connectedPoints.length) overlay.add(lineObject(connectedPoints, 0x22c55e, 0.8));
    if (lowConfidencePoints.length) overlay.add(lineObject(lowConfidencePoints, 0xf59e0b, 0.95));

    const danglingPoints = diagnostics.danglingNodes.map((nodeId) => graph.nodes.get(nodeId).position);
    if (danglingPoints.length) {
      const geometry = new THREE.BufferGeometry().setFromPoints(danglingPoints.map(vector3));
      const material = new THREE.PointsMaterial({ color: 0xef4444, size: 0.12, sizeAttenuation: true });
      overlay.add(new THREE.Points(geometry, material));
    }
  }

  async function build() {
    const loadedModels = getLoadedModels();
    if (!loadedModels.length) {
      setStatus('Load an IFC model before building the graph.', 'warning');
      return;
    }
    buildButton.disabled = true;
    setStatus('Extracting cable-tray geometry…');
    try {
      const results = await Promise.all(loadedModels.map(({ model }) => extractTraySegments(model)));
      const segments = results.flatMap((result) => result.segments);
      const rejectedCount = results.reduce((sum, result) => sum + result.rejected.length, 0);
      const fallbackCount = segments.filter((segment) => segment.geometrySource === 'bounding-box').length;
      const tolerance = Math.max(0.001, Number(toleranceInput.value) / 1000);
      graph = buildConnectivityGraph(segments, { tolerance });
      diagnostics = diagnoseGraph(graph);
      startEdgeId = null;
      endEdgeId = null;
      renderGraph();
      summary.textContent = `${diagnostics.segmentCount} segments · ${diagnostics.nodeCount} nodes · ${diagnostics.componentCount} components · ${diagnostics.danglingNodes.length} open ends · ${diagnostics.lowConfidenceEdges.length} low confidence`;
      setStatus(
        rejectedCount || fallbackCount
          ? `Graph built. ${rejectedCount} non-geometric candidates rejected; ${fallbackCount} centerlines used box fallback.`
          : 'Graph built successfully.',
        diagnostics.isConnected ? 'success' : 'warning',
      );
    } catch (error) {
      console.error('[Routing] Graph build failed:', error);
      setStatus(`Graph build failed: ${error.message}`, 'error');
    } finally {
      buildButton.disabled = false;
      updateRouteButtons();
    }
  }

  function setRouteEndpoint(kind) {
    if (!selectedElement || !graph) return;
    const edgeId = `${selectedElement.model.modelId}:${selectedElement.localId}`;
    if (!graph.edges.has(edgeId)) return;
    if (kind === 'start') startEdgeId = edgeId;
    else endEdgeId = edgeId;
    setStatus(`${kind === 'start' ? 'Start' : 'Destination'} set to element #${selectedElement.localId}.`);
    updateRouteButtons();
  }

  function calculate() {
    if (!graph || !startEdgeId || !endEdgeId) return;
    const startEdge = graph.edges.get(startEdgeId);
    const endEdge = graph.edges.get(endEdgeId);
    if (startEdgeId === endEdgeId) {
      if (routeLine) overlay.remove(routeLine);
      routeLine = lineObject([startEdge.segment.start, startEdge.segment.end], 0xfacc15, 1);
      routeLine.material.depthTest = false;
      routeLine.renderOrder = 10;
      overlay.add(routeLine);
      setStatus(`Start and destination are the same tray segment (${startEdge.length.toFixed(2)} m).`, 'success');
      return;
    }
    const candidatePairs = [
      [startEdge.from, endEdge.from], [startEdge.from, endEdge.to],
      [startEdge.to, endEdge.from], [startEdge.to, endEdge.to],
    ];
    const candidates = candidatePairs.map(([start, end]) => {
      const internal = shortestPath(graph, start, end, { excludeEdgeIds: [startEdgeId, endEdgeId] });
      return internal.found
        ? {
            ...internal,
            edgeIds: [startEdgeId, ...internal.edgeIds, endEdgeId],
            length: startEdge.length / 2 + internal.length + endEdge.length / 2,
          }
        : internal;
    });
    const route = candidates.filter((candidate) => candidate.found).sort((a, b) => a.length - b.length)[0];
    if (!route) {
      setStatus('No connected route exists between the selected tray elements.', 'error');
      return;
    }
    if (routeLine) overlay.remove(routeLine);
    const points = route.edgeIds.flatMap((edgeId) => {
      const segment = graph.edges.get(edgeId).segment;
      return [segment.start, segment.end];
    });
    routeLine = lineObject(points, 0xfacc15, 1);
    routeLine.material.depthTest = false;
    routeLine.renderOrder = 10;
    overlay.add(routeLine);
    setStatus(`Route found: ${route.edgeIds.length} segments, ${route.length.toFixed(2)} m.`, 'success');
  }

  buildButton.addEventListener('click', build);
  clearButton.addEventListener('click', () => {
    disposeGroup(overlay);
    graph = null;
    diagnostics = null;
    startEdgeId = null;
    endEdgeId = null;
    summary.textContent = 'No graph built';
    setStatus('Routing overlay cleared.');
    updateRouteButtons();
  });
  setStartButton.addEventListener('click', () => setRouteEndpoint('start'));
  setEndButton.addEventListener('click', () => setRouteEndpoint('end'));
  calculateButton.addEventListener('click', calculate);

  return {
    setSelectedElement(model, localId) {
      selectedElement = model && localId !== null ? { model, localId: Number(localId) } : null;
      updateRouteButtons();
    },
    getGraph: () => graph,
    getDiagnostics: () => diagnostics,
  };
}
