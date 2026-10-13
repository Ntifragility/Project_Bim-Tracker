// Conduit network: nodes in original IFC coordinates (metres, Z up) and runs
// that are ordered lists of node ids. Two runs branch only where they share a
// node; a near miss stays two runs. Every edit returns a new network so the UI
// can keep snapshots for undo.

export const NETWORK_VERSION = 1;

export function createNetwork({ sourceModels = [], stickLength = 3 } = {}) {
  return {
    version: NETWORK_VERSION,
    frame: 'ifc-original',
    units: 'm',
    sourceModels: [...sourceModels],
    settings: { stickLength },
    nodes: [],
    runs: [],
    nextId: 1,
  };
}

function clone(network) {
  return {
    ...network,
    sourceModels: [...network.sourceModels],
    settings: { ...network.settings },
    nodes: network.nodes.map((node) => ({ ...node })),
    runs: network.runs.map((run) => ({ ...run, nodeIds: [...run.nodeIds] })),
  };
}

function takeId(network, prefix) {
  const id = `${prefix}${network.nextId}`;
  network.nextId += 1;
  return id;
}

export function nodeById(network, nodeId) {
  return network.nodes.find((node) => node.id === nodeId) ?? null;
}

export function runById(network, runId) {
  return network.runs.find((run) => run.id === runId) ?? null;
}

export function addNode(network, point) {
  const next = clone(network);
  const id = takeId(next, 'n');
  next.nodes.push({ id, x: point.x, y: point.y, z: point.z });
  return { network: next, nodeId: id };
}

export function startRun(network, { size, system = '', name = '' }, firstNodeId) {
  if (!nodeById(network, firstNodeId)) throw new Error(`Unknown node ${firstNodeId}.`);
  const next = clone(network);
  const id = takeId(next, 'r');
  next.runs.push({ id, name: name || id.toUpperCase(), size: String(size), system, nodeIds: [firstNodeId] });
  return { network: next, runId: id };
}

export function appendToRun(network, runId, nodeId) {
  const run = runById(network, runId);
  if (!run) throw new Error(`Unknown run ${runId}.`);
  if (!nodeById(network, nodeId)) throw new Error(`Unknown node ${nodeId}.`);
  if (run.nodeIds.at(-1) === nodeId) return network;
  const next = clone(network);
  runById(next, runId).nodeIds.push(nodeId);
  return next;
}

/** Inserts a node into segment `index` of a run (between nodeIds[index] and nodeIds[index + 1]). */
export function splitSegment(network, runId, index, point) {
  const run = runById(network, runId);
  if (!run || index < 0 || index >= run.nodeIds.length - 1) throw new Error(`Run ${runId} has no segment ${index}.`);
  const added = addNode(network, point);
  runById(added.network, runId).nodeIds.splice(index + 1, 0, added.nodeId);
  return added;
}

function pruneOrphanNodes(network) {
  const used = new Set(network.runs.flatMap((run) => run.nodeIds));
  network.nodes = network.nodes.filter((node) => used.has(node.id));
  return network;
}

/** Removes the last point of a run; a run left with no points is deleted. */
export function removeLastPoint(network, runId) {
  const next = clone(network);
  const run = runById(next, runId);
  if (!run) return network;
  run.nodeIds.pop();
  if (!run.nodeIds.length) next.runs = next.runs.filter((item) => item.id !== runId);
  return pruneOrphanNodes(next);
}

export function deleteRun(network, runId) {
  const next = clone(network);
  next.runs = next.runs.filter((run) => run.id !== runId);
  return pruneOrphanNodes(next);
}

/** Drops runs with fewer than two points (an unfinished click). */
export function dropIncompleteRuns(network) {
  const next = clone(network);
  next.runs = next.runs.filter((run) => run.nodeIds.length >= 2);
  return pruneOrphanNodes(next);
}

export function updateRun(network, runId, changes) {
  const next = clone(network);
  const run = runById(next, runId);
  if (!run) return network;
  for (const key of ['name', 'size', 'system']) {
    if (changes[key] !== undefined) run[key] = String(changes[key]);
  }
  return next;
}

export function setStickLength(network, stickLength) {
  if (!(stickLength > 0)) throw new Error('Stick length must be positive.');
  const next = clone(network);
  next.settings.stickLength = stickLength;
  return next;
}

export function validateNetwork(data) {
  if (!data || typeof data !== 'object') throw new Error('Not a conduit network file.');
  if (data.version !== NETWORK_VERSION) throw new Error(`Unsupported conduit file version ${data.version}.`);
  if (data.frame !== 'ifc-original' || data.units !== 'm') throw new Error('Conduit file must be in original IFC coordinates, metres.');
  const ids = new Set();
  for (const node of data.nodes ?? []) {
    if (![node.x, node.y, node.z].every(Number.isFinite)) throw new Error(`Node ${node.id} has invalid coordinates.`);
    ids.add(node.id);
  }
  for (const run of data.runs ?? []) {
    for (const nodeId of run.nodeIds ?? []) {
      if (!ids.has(nodeId)) throw new Error(`Run ${run.id} points to missing node ${nodeId}.`);
    }
  }
  const numericIds = [...ids, ...(data.runs ?? []).map((run) => run.id)]
    .map((id) => Number(String(id).slice(1)))
    .filter(Number.isFinite);
  return clone({
    ...createNetwork(),
    ...data,
    settings: { ...createNetwork().settings, ...data.settings },
    nextId: Math.max(data.nextId ?? 1, ...numericIds.map((n) => n + 1)),
  });
}
