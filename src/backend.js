// Tray compute backend factory (task group 2a: wasm flag wiring).
//
// Per-module flags (tray-wasm.md R6, legacy default until gate — now opt-in):
//   ?tagging=wasm | localStorage['tray.tagging']
//   ?routing=wasm | localStorage['tray.routing']
// Each module keeps the JS path by default; the wasm path is lazy-loaded and
// falls back to JS with a console warning when the build is missing.
// Coordinate frame: IFC Z-up f64 in the binding, never converted there (R3).
// Units: metres across the routing boundary; tags are unit-free (R5).

import { allocateElementTags, getSystemTag, normalizeTagScheme } from './tagging/tag-scheme.js';
import { classifyTaggableElement } from './tagging/element-classifier.js';
import { validateTagIntegrity } from './ifc/tag-validator.js';
import { deriveCenterline } from '../packages/routing-core/src/centerline.js';
import { buildConnectivityGraph, connectedComponents } from '../packages/routing-core/src/graph.js';
import { diagnoseGraph } from '../packages/routing-core/src/diagnostics.js';
import { shortestPath } from '../packages/routing-core/src/pathfinding.js';

function readModuleFlag(module, param) {
  try {
    const q = new URLSearchParams(window.location.search).get(param);
    if (q === 'wasm' || q === 'js') return q;
    if (localStorage.getItem(`tray.${module}`) === 'wasm') return 'wasm';
  } catch { /* non-browser: default JS */ }
  return 'js';
}

async function loadTrayWasm() {
  const url = new URL('../bindings/tray-wasm/pkg/tray_wasm.js', import.meta.url).href;
  const mod = await import(/* @vite-ignore */ url);
  await mod.default?.();
  return mod;
}

const callJson = (wasm, fn, ...args) => {
  const parsed = JSON.parse(wasm[fn](...args));
  if (parsed && typeof parsed === 'object' && 'code' in parsed && 'ok' in parsed === false && parsed.code) {
    throw new Error(`tray-wasm ${fn}: ${parsed.code} — ${parsed.message ?? ''}`);
  }
  return parsed;
};

export function moduleFlags() {
  return { tagging: readModuleFlag('tagging', 'tagging'), routing: readModuleFlag('routing', 'routing') };
}

export async function createTrayBackends() {
  const flags = moduleFlags();
  const backends = {
    flags,
    tagging: { backend: 'js', allocateElementTags, getSystemTag, normalizeTagScheme, classifyTaggableElement, validateTagIntegrity },
    routing: { backend: 'js', deriveCenterline, buildConnectivityGraph, connectedComponents, diagnoseGraph, shortestPath },
  };
  if (flags.tagging === 'wasm' || flags.routing === 'wasm') {
    try {
      const wasm = await loadTrayWasm();
      if (flags.tagging === 'wasm') {
        backends.tagging = {
          backend: 'wasm',
          allocateElementTags: (input) => callJson(wasm, 'tagging_allocate', JSON.stringify(input)),
          getSystemTag: (s) => callJson(wasm, 'tagging_format', JSON.stringify(s)),
          normalizeTagScheme: (s) => callJson(wasm, 'tagging_normalize', JSON.stringify(s)),
          classifyTaggableElement: (el) => callJson(wasm, 'tagging_classify', JSON.stringify(el)),
          validateTagIntegrity: (input) => callJson(wasm, 'tagging_validate_integrity', JSON.stringify(input)),
        };
      }
      if (flags.routing === 'wasm') {
        const f32 = (pts) => JSON.stringify((pts ?? []).map((p) => [p.x, p.y, p.z ?? 0]));
        backends.routing = {
          backend: 'wasm',
          deriveCenterline: (points, options = {}) => callJson(wasm, 'routing_centerline', JSON.stringify({ points: (points ?? []).map((p) => [p.x ?? p[0], p.y ?? p[1], p.z ?? p[2] ?? 0]), ...(options ?? {}) })),
          buildConnectivityGraph: (segments, options = {}) => callJson(wasm, 'routing_build_graph', JSON.stringify({ segments, ...(options ?? {}) })),
          connectedComponents: (graph) => callJson(wasm, 'routing_components', JSON.stringify(graph)),
          diagnoseGraph: (graph, options = {}) => callJson(wasm, 'routing_diagnose', JSON.stringify({ graph, ...(options ?? {}) })),
          shortestPath: (graph, from, to, options = {}) => callJson(wasm, 'routing_shortest_path', JSON.stringify({ graph, from, to, ...(options ?? {}) })),
        };
        void f32;
      }
    } catch (err) {
      console.warn('[tray backends] wasm load failed, falling back to JS:', err?.message ?? err);
    }
  }
  return backends;
}
