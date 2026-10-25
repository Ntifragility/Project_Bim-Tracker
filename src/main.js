// Tray Viewer — application bootstrap (Task 7.1 coordinator).
//
// `src/main.js` is the thin composition root for the tray app. All feature
// logic lives in `src/ui/*` modules; this file only creates the shared
// context, hands it to each feature module in dependency order, and starts
// the app on `DOMContentLoaded`.
//
// Wiring order matters — each module registers its helpers on the shared
// `api` object for later modules to consume:
//
// 1. `viewer-chrome` — sidebar tabs, overlay guard (needs DOM only).
// 2. `properties-panel` — registers display/clear/render helpers on `api`.
// 3. `selection` — needs properties helpers; registers map/selection fns.
// 4. `appearance` — needs selection maps; creates the tag-label manager.
// 5. `tagging-panel` — needs appearance update fns; registers assignment fns.
// 6. `system-manager` — needs tagging + appearance fns.
// 7. `excel-panel` — needs tagging helpers + dimensions.
// 8. `editing` — needs tagging validation + appearance staging.
// 9. `model-loader` — needs render callbacks from all panels.
// 10. `context-menu` — needs selection + appearance fns.

import './style.css';
import * as OBC from '@thatopen/components';
import { initExcelBridge } from './viewer-socket.js';
import { initRoutingController } from './routing/routing-controller.js';
import { createCovillafEngine } from 'viewer-core';
import { createAppContext } from './ui/context.js';
import * as dom from './ui/dom.js';
import { readElementIdentity } from './ui/helpers.js';
import { initPropertiesPanel } from './ui/properties-panel.js';
import { initSelection } from './ui/selection.js';
import { initAppearance } from './ui/appearance.js';
import { initTaggingPanel } from './ui/tagging-panel.js';
import { initSystemManager } from './ui/system-manager.js';
import { initExcelPanel } from './ui/excel-panel.js';
import { initEditing } from './ui/editing.js';
import { initModelLoader } from './ui/model-loader.js';
import { initViewerChrome } from './ui/viewer-chrome.js';
import { initContextMenu } from './ui/context-menu.js';

// Legacy export kept for the previous flat `state.js` import surface.
export { state } from './ui/state.js';

// Shared runtime API: feature modules register helpers here so later
// modules (and the coordinator below) can call across panel boundaries
// without importing each other.
export const api = {};

/** Bootstrap the tray viewer: engine, context, feature modules, bridge. */
export async function initApp() {
  console.log('Initializing COVILLAF engine...');

  const ctx = createAppContext();
  api.ctx = ctx;

  const engine = await createCovillafEngine(dom.container);
  const { components, world, fragments, highlighter, hider } = engine;
  Object.assign(ctx, { engine, components, world, fragments, highlighter, hider });

  // Current FragmentsModel versions expose relations through getItemsData().
  // Keep the legacy variable for the old-property fallback without requesting
  // the removed IfcRelationsIndexer component.
  ctx.indexer = null;

  // 7. Highlighter setup (setup + mouseMoveThreshold, allowing normal hand
  // jitter) lives in the engine; do not call setup here again. Apply only
  // app-specific selection behaviour below.
  highlighter.zoomToSelection = false;

  // 1. Viewer chrome (tabs, overlay guard, grid/wireframe/dark/orbit/resize).
  const chrome = initViewerChrome(ctx, dom, api);
  chrome.setupSidebarTabs();
  chrome.guardOverlays();

  // Shared helper available to every module from the start.
  api.readElementIdentity = readElementIdentity;

  // 2. Properties inspector (registers display/clear/render helpers).
  initPropertiesPanel(ctx, dom, api);

  // 3. Selection (registers map helpers, highlight/isolate, zoom, wiring).
  const selection = initSelection(ctx, dom, api);
  selection.wireSelectionEvents();

  // 4. Appearance (needs selection maps; creates the tag-label manager).
  const appearance = initAppearance(ctx, dom, api);
  appearance.initTagLabelManager();
  appearance.setSelectionHighlightStyle(ctx.selectionHighlightColor);

  // 5. Tagging workbench (needs appearance update fns).
  const tagging = initTaggingPanel(ctx, dom, api);
  tagging.wireBatchControls();
  tagging.wireAssignmentControls();

  // 6. System manager (needs tagging + appearance fns).
  const systems = initSystemManager(ctx, dom, api);
  systems.wireManagerControls();

  // 7. Excel linkage (needs tagging helpers + dimensions).
  const excel = initExcelPanel(ctx, dom, api);
  excel.wireExcelControls();

  // 8. Safe editing (needs tagging validation + appearance staging).
  const editing = initEditing(ctx, dom, api);
  editing.wireEditingControls();

  // Hider comes from the engine (destructured above); do not redeclare here.
  ctx.routingController = initRoutingController({
    world,
    getLoadedModels: () => ctx.loadedModels,
    onClear: () => {
      ctx.traySystemContinuityReport = null;
      api.renderTraySystemContinuityReport();
      appearance.clearContinuityGroupHighlights();
    },
  });

  // 9. Model loading (needs render callbacks from all panels above).
  const loader = initModelLoader(ctx, dom, {
    renderExcelTable: api.renderExcelTable,
    renderTraySystemManager: api.renderTraySystemManager,
    refreshValidationReportIfOpen: api.refreshValidationReportIfOpen,
    clearElementProperties: api.clearElementProperties,
    invalidateBatchUndo: api.invalidateBatchUndo,
  });
  api.refreshLoadedModelsList = loader.refreshLoadedModelsList;
  api.loadModel = loader.loadModel;
  api.setWireframe = loader.setWireframe;
  loader.wireFileInputs();

  // 10. Context menu (needs selection + appearance fns). Overlay picking
  // guard is owned by viewer-chrome; the menu module only wires its items.
  const menu = initContextMenu(ctx, dom, api);
  menu.wireContextMenu();

  // 11. Chrome engine wiring that requires the highlighter + renderer.
  chrome.wireChromeControls();

  await appearance.refreshTaggedTrayHighlights();
  await appearance.setFloatingLabelsActive(ctx.isFloatingLabelsActive);

  // Initialize Excel-IFC WebSocket bridge linkage (frozen per ARCHITECTURE §5).
  initExcelBridge(components, world);

  return { ctx, api };
}

// Start app on load
window.addEventListener('DOMContentLoaded', () => {
  initApp().catch((err) => {
    console.error('Failed to initialize the BIM app:', err);
  });
});
