// Conduit compute backend factory (task group 2a: wasm flag wiring).
//
// `createConduitBackend()` returns the compute surface the ui/ modules use,
// selected by `?core=wasm` or `localStorage['conduit.core']` ('wasm' opts in,
// default is the JS `@conduit-core` package). Wasm path is lazy: the binding
// is imported only when selected, so the JS-first boot pays nothing.
//
// Shape parity: both backends expose the same function names over the JS
// network object ({version, frame, units, sourceModels, settings, nodes,
// runs, nextId}). The wasm backend translates at the edges (JS network <->
// wasm file JSON) and delegates pure computation to the binding; stateful
// helpers (command stack, markers, SHA, CSV/IFC text) stay JS by design
// (conduit-wasm.md R4: TS-side stays TS-side).

import * as jsBackend from '@conduit-core';

function readFlag() {
  try {
    const q = new URLSearchParams(window.location.search).get('core');
    if (q === 'wasm' || q === 'js') return q;
    if (localStorage.getItem('conduit.core') === 'wasm') return 'wasm';
  } catch { /* non-browser / denied storage: default JS */ }
  return 'js';
}

async function loadWasmBinding() {
  // Built by `wasm-pack build bindings/conduit-wasm` (pkg/ is gitignored).
  // Constructed URL defeats static analysis so the JS-first bundle never
  // requires the file at build time; a missing build fails loudly here and
  // the caller falls back to JS with a console warning.
  const url = new URL('../../bindings/conduit-wasm/pkg/conduit_wasm.js', import.meta.url).href;
  const mod = await import(/* @vite-ignore */ url);
  await mod.default?.();
  return mod;
}

// JS network <-> wasm file-JSON translation (frame/units/stick preserved).
function toFileJson(network) {
  return JSON.stringify({
    version: network.version ?? 1,
    frame: network.frame ?? 'ifc-original',
    units: network.units ?? 'm',
    stick_length: network.settings?.stickLength ?? network.stick_length ?? 3.048,
    source_models: network.sourceModels ?? [],
    nodes: (network.nodes ?? []).map((n) => ({ id: n.id, x: n.x, y: n.y, z: n.z ?? 0 })),
    runs: (network.runs ?? []).map((r) => ({
      id: r.id, name: r.name ?? (r.id ?? '').toUpperCase(), size: r.size ?? '',
      system: r.system ?? '', node_ids: r.nodeIds ?? r.node_ids ?? [],
    })),
    next_id: network.nextId ?? network.next_id ?? 1,
  });
}

function fromFileJson(fileJson, sourceModels) {
  const f = typeof fileJson === 'string' ? JSON.parse(fileJson) : fileJson;
  return {
    version: f.version ?? 1,
    frame: f.frame ?? 'ifc-original',
    units: f.units ?? 'm',
    sourceModels: sourceModels ?? f.source_models ?? [],
    settings: { stickLength: f.stick_length ?? 3.048 },
    nodes: (f.nodes ?? []).map((n) => ({ id: n.id, x: n.x, y: n.y, z: n.z ?? 0 })),
    runs: (f.runs ?? []).map((r) => ({
      id: r.id, name: r.name ?? r.id, size: r.size ?? '', system: r.system ?? '',
      nodeIds: r.node_ids ?? r.nodeIds ?? [],
    })),
    nextId: f.next_id ?? f.nextId ?? 1,
  };
}

function wrapWasm(wasm) {
  const call = (fn, ...args) => {
    const raw = wasm[fn](...args);
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && 'code' in parsed && !('ok' in parsed)) {
      throw new Error(`wasm ${fn}: ${parsed.code} — ${parsed.message ?? ''}`);
    }
    return parsed;
  };
  const pt = (p) => ({ x: p.x, y: p.y, z: p.z ?? 0 });
  return {
    backend: 'wasm',
    // -- network mutations via network_mutate (one op per call) --
    addNode: (network, point) => {
      const out = call('network_mutate', JSON.stringify({ op: 'add_node', point: pt(point) }), toFileJson(network));
      return { network: fromFileJson(out, network.sourceModels), nodeId: out.nodes[out.nodes.length - 1].id };
    },
    startRun: (network, opts, firstNodeId) => {
      const out = call('network_mutate', JSON.stringify({ op: 'start_run', size: String(opts.size), system: opts.system ?? '', name: opts.name ?? '', first_node: firstNodeId }), toFileJson(network));
      const run = out.runs[out.runs.length - 1];
      return { network: fromFileJson(out, network.sourceModels), runId: run.id };
    },
    appendToRun: (network, runId, nodeId) => fromFileJson(
      call('network_mutate', JSON.stringify({ op: 'append_to_run', run_id: runId, node_id: nodeId }), toFileJson(network)), network.sourceModels),
    deleteRun: (network, runId) => fromFileJson(
      call('network_mutate', JSON.stringify({ op: 'delete_run', run_id: runId }), toFileJson(network)), network.sourceModels),
    nodeById: (network, nodeId) => network.nodes.find((n) => n.id === nodeId) ?? null,
    // -- pure computation via wasm; text rendering stays JS --
    computeTakeoff: (network) => call('network_takeoff', toFileJson(network)),
    computeRunTakeoff: (network, runId) => call('network_run_takeoff', toFileJson(network), runId),
    findSnap: (network, point, tolerance) => call('snap_find', toFileJson(network), JSON.stringify(pt(point)), tolerance),
    analyzeRunBends: (points) => call('fitting_run_bends', JSON.stringify(points.map(pt))),
    computeDetailedBom: (network, options = {}) => call('bom_detailed', toFileJson(network), JSON.stringify(options)),
    optimizeStickCutting: (cuts, stock, kerf) => call('bom_optimize', JSON.stringify(cuts), stock, kerf),
  };
}

export function backendFlag() { return readFlag(); }

export async function createConduitBackend() {
  const flag = readFlag();
  if (flag !== 'wasm') return { backend: 'js', ...jsBackend };
  try {
    const wasm = await loadWasmBinding();
    return wrapWasm(wasm);
  } catch (err) {
    console.warn('[conduit backend] wasm load failed, falling back to JS:', err?.message ?? err);
    return { backend: 'js', ...jsBackend };
  }
}
