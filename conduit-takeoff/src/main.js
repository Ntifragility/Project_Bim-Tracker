// Conduit Takeoff Viewer — application bootstrap (conduit-ui-split coordinator).
//
// `conduit-takeoff/src/main.js` is the thin composition root: it collects the
// DOM table, creates shared state, boots the single engine, and wires the 7
// feature modules under `conduit-takeoff/src/ui/` in dependency order.
// Cross-module calls go through the shared `api` object (7.1 pattern).
// `window.__drawingTool` is preserved (conduit HUD + external diagnostics).

import './style.css';
import { collectEls } from './ui/dom.js';
import { createConduitState } from './ui/state.js';
import { createViewerChrome } from './ui/viewer-chrome.js';
import { createModelLoad } from './ui/model-load.js';
import { createDrawToolbar } from './ui/draw-toolbar.js';
import { createRunsList } from './ui/runs-list.js';
import { createSummary } from './ui/summary.js';
import { createProjectIo } from './ui/project-io.js';

// Shared runtime API: feature modules register helpers here so later
// modules (and the coordinator below) can call across panel boundaries
// without importing each other.
export const api = {};

/** Bootstrap the conduit takeoff app: state, engine, feature modules. */
export async function initApp() {
  console.log('[Conduit Takeoff] Initializing engine...');
  const els = collectEls();
  api.els = els;
  const state = createConduitState();
  api.state = state;

  // 1. Viewer chrome (overlay, tabs, engine bootstrap + HUD fan-out).
  const chrome = createViewerChrome({ state, els, api });
  chrome.wireChrome();
  const { engine, drawingTool } = await chrome.bootEngine();
  api.engine = engine;
  api.drawingTool = drawingTool;

  // 2. Runs list + 3. summary (registered before draw fan-out needs them).
  createRunsList({ state, els, api });
  const summary = createSummary({ state, els, api });
  summary.wireSummaryControls();

  // 4. Draw toolbar (needs api.renderRunsList/renderSummary via commandStack).
  const toolbar = createDrawToolbar({ state, els, api });

  // 5. Model loading (needs api.showLoading/hideLoading from chrome).
  const models = createModelLoad({ state, els, engine, api });
  models.wireModelControls();

  // 6. Project I/O + shortcuts (needs toolbar + runs/summary renders).
  const projects = createProjectIo({ state, els, engine, api });
  projects.wireProjectControls(drawingTool);

  // 7. Draw controls last (needs everything registered above).
  toolbar.wireDrawControls(drawingTool);

  // Initial renders
  api.renderDiameterPicker();
  api.renderRunsList(drawingTool);
  api.renderSummary();
  api.updateUndoRedoButtons();
  console.log('[Conduit Takeoff] App initialized and ready.');
  return { state, els, engine, drawingTool, api };
}

async function init() {
  await initApp();
}

// Start app on load
window.addEventListener('DOMContentLoaded', init);
