// conduit-takeoff/src/ui/viewer-chrome.js — engine bootstrap, ribbon chrome, HUD.
//
// Owns (conduit-ui-split module 8): sidebar tabs/toggle, loading overlay
// show/hide, status text, cursor coords, `init()` engine bootstrap (single
// engine instance) + `onStateChange` fan-out to the drawing tool, MEP HUD,
// viewport controls, and surface picker.
// Bootstraps universal Revit-style ribbon via ribbon-chrome and conduit-adapter.

import { createCovillafEngine } from 'viewer-core';
import { createRibbon } from 'ribbon-chrome';
import { createConduitRibbonDef } from './conduit-adapter.js';
import { createLateralDock } from './lateral-dock.js';
import { createDrawingTool } from '../drawing-tool.js';
import { createMepHud } from '../mep-hud.js';
import { createViewportControls } from '../viewport-controls.js';
import { createSurfacePicker } from '../surface-picker.js';

export function createViewerChrome({ state, els, api }) {
  let ribbonApi = null;

  function showLoading(stage, percent = 0, detail = '') {
    els.loadingOverlay.hidden = false;
    els.loadingStage.textContent = stage;
    els.loadingBarFill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
    els.loadingDetail.textContent = detail;
  }

  function hideLoading() {
    els.loadingOverlay.hidden = true;
  }

  // Map each ribbon tab to the dock (sidebar) panel it focuses.
  const RIBBON_TAB_TO_PANEL = {
    model: 'model',
    trace: 'draw',
    quantities: 'summary',
    project: null, // Project tab has no dock panel; keep current panel open.
  };

  function setRibbonTab(name) {
    if (ribbonApi) {
      ribbonApi.setTab(name);
    }
    setDockPanel(RIBBON_TAB_TO_PANEL[name]);
    if (name === 'model') api.switchDockTab?.('browser');
    else if (name === 'trace') api.switchDockTab?.('properties');
    else if (name === 'quantities') api.switchDockTab?.('schedules');
  }

  function setDockPanel(name) {
    if (!name) return;
    els.tabs.forEach((t) => {
      const isSelected = t.dataset.tabTarget === name;
      t.classList.toggle('active', isSelected);
      t.setAttribute('aria-selected', isSelected);
    });
    els.panels.forEach((p) => {
      p.classList.toggle('active', p.dataset.sidebarPanel === name);
    });
  }

  // `mepHud` is created inside bootEngine; keep a module-level ref so
  // isHudTyping() (ESC step 1) can ask it without touching call order.
  let mepHudRef = null;

  // Exposed for project-io's ESC chain (step 1 typing guard) and tests:
  // HUD typing state OR focus inside an editable control.
  function isHudTyping() {
    try {
      if (typeof mepHudRef?.isInputActive === 'function' && mepHudRef.isInputActive()) return true;
    } catch { /* HUD unavailable — fall through to focus check */ }
    const active = document.activeElement;
    return Boolean(active && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName));
  }

  function wireChrome() {
    // 1. Mount universal Revit-style ribbon
    const ribbonHost = document.getElementById('ribbon');
    if (ribbonHost) {
      const ctx = {
        state,
        els,
        api,
        getTool: () => window.__drawingTool,
      };
      const def = createConduitRibbonDef(ctx);
      ribbonApi = createRibbon(ribbonHost, def, ctx);
      ctx.ribbonApi = ribbonApi;
      api.ribbonApi = ribbonApi;

      // Status segments binding
      const segStatus = ribbonHost.querySelector('.rc-status-segment[data-segment-id="status-text"]');
      if (segStatus) {
        segStatus.id = 'status-text';
        els.statusText = segStatus;
      }
      const segCoords = ribbonHost.querySelector('.rc-status-segment[data-segment-id="cursor-coords"]');
      if (segCoords) {
        segCoords.id = 'cursor-coords';
        els.cursorCoords = segCoords;
      }

      // Re-map elements in els to newly created ribbon controls
      const topSelect = ribbonHost.querySelector('#top-diameter-select');
      if (topSelect) els.topDiameterSelect = topSelect;
      const topElev = ribbonHost.querySelector('#top-elevation-input');
      if (topElev) els.topElevationInput = topElev;
      const btnPick = ribbonHost.querySelector('#btn-pick-elevation');
      if (btnPick) els.btnPickElevation = btnPick;
      const topSys = ribbonHost.querySelector('#top-system-select');
      if (topSys) els.topSystemSelect = topSys;
      const btnWorkplane = ribbonHost.querySelector('#btn-toggle-workplane');
      if (btnWorkplane) els.btnToggleWorkplane = btnWorkplane;
      const btnAutoriser = ribbonHost.querySelector('#btn-toggle-autoriser');
      if (btnAutoriser) els.btnToggleAutoriser = btnAutoriser;

      // Add static hint to Takeoff group in Quantities tab per spec
      const quantitiesPanel = ribbonHost.querySelector('#rc-panel-quantities');
      if (quantitiesPanel) {
        const groupContent = quantitiesPanel.querySelector('.rc-group-content');
        if (groupContent && !groupContent.querySelector('.rc-hint')) {
          const hint = document.createElement('span');
          hint.className = 'rc-hint';
          hint.textContent = 'Waste %, summary and runs live in the dock panel ▶';
          groupContent.appendChild(hint);
        }
      }

      // Ribbon tab click syncs dock panel and lateral dock tab
      ribbonHost.querySelectorAll('.rc-tab').forEach((tabBtn) => {
        tabBtn.addEventListener('click', () => {
          const tabId = tabBtn.id.replace('rc-tab-', '');
          if (tabId === 'model') api.switchDockTab?.('browser');
          else if (tabId === 'trace') api.switchDockTab?.('properties');
          else if (tabId === 'quantities') api.switchDockTab?.('schedules');
          const panel = RIBBON_TAB_TO_PANEL[tabId];
          if (panel) setDockPanel(panel);
        });
      });
    }

    // 2. Lateral Dock (Revit Properties Palette & Project Browser)
    const lateralDock = createLateralDock({ state, els, api });
    api.lateralDock = lateralDock;

    // 3. Sidebar Tabs Navigation (syncs ribbon tab)
    els.tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.tabTarget;
        els.tabs.forEach((t) => {
          const isSelected = t === tab;
          t.classList.toggle('active', isSelected);
          t.setAttribute('aria-selected', isSelected);
        });
        els.panels.forEach((p) => {
          p.classList.toggle('active', p.dataset.sidebarPanel === target);
        });
        const entry = Object.entries(RIBBON_TAB_TO_PANEL).find(([, p]) => p === target);
        if (entry && ribbonApi) {
          ribbonApi.setTab(entry[0]);
        }
      });
    });

    // 4. Sidebar Toggle
    els.sidebarToggle.addEventListener('click', () => {
      els.sidebar.classList.toggle('collapsed');
      document.body.classList.toggle('sidebar-is-collapsed', els.sidebar.classList.contains('collapsed'));
    });

    // 5. Update undo/redo state listeners
    state.commandStack.subscribe(() => {
      api.updateUndoRedoButtons();
      api.renderRunsList(window.__drawingTool);
      api.renderSummary();
      api.updatePropertiesPalette?.(state.selectedRunId);
      ribbonApi?.refresh();
    });
  }

  async function bootEngine() {
    console.log('[Conduit Takeoff] Initializing engine...');
    const engine = await createCovillafEngine(els.viewerContainer, { enableHighlighting: false });
    if (engine.highlighter) {
      engine.highlighter.enabled = false;
    }

    // Navisworks navigation is owned by the Rust viewport core:
    // right-drag orbits, middle-drag pans, and neither cancels the rubberband.
    const controls = engine.world?.camera?.controls;
    const viewport = await createViewportControls({ controls });
    const surfacePicker = createSurfacePicker({ engine });

    let mepHud = null;
    const drawingTool = createDrawingTool({
      engine,
      commandStack: state.commandStack,
      diameterRegistry: state.diameterRegistry,
      viewport,
      surfacePicker,
      onStateChange: (change) => {
        if (change.elevationPicked !== undefined) {
          if (els.topElevationInput) {
            els.topElevationInput.value = change.elevationPicked.toFixed(2);
          }
          if (els.btnPickElevation) {
            els.btnPickElevation.classList.remove('active');
          }
          if (els.statusText) {
            els.statusText.textContent = `Sampled elevation from model: ${change.elevationPicked.toFixed(2)} m`;
          }
          ribbonApi?.setStatus('status-text', `Sampled elevation from model: ${change.elevationPicked.toFixed(2)} m`);
          ribbonApi?.refresh();
        }

        if (change.cursor) {
          const coordsText = `X: ${change.cursor.x.toFixed(2)}  Y: ${change.cursor.y.toFixed(2)}  Z: ${change.cursor.z.toFixed(2)}${change.snapped ? ' (SNAP)' : ''}`;
          if (els.cursorCoords) {
            els.cursorCoords.textContent = coordsText;
          }
          ribbonApi?.setStatus('cursor-coords', coordsText);
        }

        if (change.activePoints && change.activePoints.length > 0) {
          // Show contextual tab Modify | Run
          ribbonApi?.showContextual('modify-run');

          // Sync lateral dock Properties Palette with in-progress run
          api.switchDockTab?.('properties');
          api.updatePropertiesPalette?.(null, { points: change.activePoints, liveSegment: change.liveSegment });

          // Automatically switch to draw tab if still on model tab
          const activeTab = document.querySelector('.tab-nav-btn.active');
          if (activeTab && activeTab.dataset.tabTarget === 'model') {
            document.querySelector('[data-tab-target="draw"]')?.click();
          }

          els.activeRunInfo.hidden = false;
          els.activeRunActions.hidden = false;
          els.verticalStepControls.hidden = false;
          if (els.topActiveRunSummary) els.topActiveRunSummary.hidden = false;

          // Compute running distance
          let runningDist = 0;
          for (let i = 1; i < change.activePoints.length; i++) {
            const p1 = change.activePoints[i - 1];
            const p2 = change.activePoints[i];
            runningDist += Math.hypot(p2.x - p1.x, p2.y - p1.y, p2.z - p1.z);
          }
          runningDist += change.liveSegment || 0;

          const sticks = Math.ceil(runningDist / state.settings.stickLengthM) || 0;
          els.runLength.textContent = `${runningDist.toFixed(2)} m`;
          els.runSticks.textContent = `${sticks}`;
          els.runSegments.textContent = `${Math.max(1, change.activePoints.length)}`;

          if (els.topRunLength) els.topRunLength.textContent = `${runningDist.toFixed(2)} m`;
          if (els.topRunSticks) els.topRunSticks.textContent = `${sticks}`;

          if (change.isVertical) {
            const verticalStatus = `⊥ Perpendicular to XY (Vertical riser): Height Δ = ${(change.liveSegment || 0).toFixed(2)} m`;
            if (els.statusText) els.statusText.textContent = verticalStatus;
            ribbonApi?.setStatus('status-text', verticalStatus);
          }

          // Live floating Revit MEP HUD
          if (mepHud && change.screenPos) {
            const lastPt = change.activePoints[change.activePoints.length - 1];
            const targetPt = change.cursor;
            let angleDeg = 0;
            if (targetPt && lastPt) {
              const dx = targetPt.x - lastPt.x;
              const dz = targetPt.z - lastPt.z;
              angleDeg = ((Math.atan2(dz, dx) * 180 / Math.PI) + 360) % 360;
            }
            const activeAngle = change.liveBendAngle !== undefined && change.activePoints.length >= 2 ? change.liveBendAngle : angleDeg;
            const angleLabel = change.cartesianHeading
              ? `${activeAngle.toFixed(1)}° ${change.cartesianHeading}`
              : `${activeAngle.toFixed(1)}°`;

            mepHud.update({
              screenX: change.screenPos.x,
              screenY: change.screenPos.y,
              lengthM: change.liveSegment || 0,
              angleDeg: activeAngle,
              angleLabel,
              isAngleSnapped: Boolean(change.isAngleSnapped || change.isVertical || (angleDeg % 45 < 2 || angleDeg % 45 > 43)),
              elevationM: drawingTool.activeElevation,
              visible: true,
            });
          }
        } else {
          mepHud?.hide();
          els.activeRunInfo.hidden = true;
          els.activeRunActions.hidden = true;
          els.verticalStepControls.hidden = true;
          if (els.topActiveRunSummary) els.topActiveRunSummary.hidden = true;

          // If not in drawing mode and no run selected, hide contextual tab
          if (!drawingTool.isDrawingMode && !state.selectedRunId) {
            ribbonApi?.hideContextual();
            api.updatePropertiesPalette?.(null);
          }
        }

        api.updateUndoRedoButtons(drawingTool);

        if (change.networkUpdated) {
          api.renderRunsList(drawingTool);
          api.renderSummary();
          api.updatePropertiesPalette?.(state.selectedRunId);
        }

        ribbonApi?.refresh();
      },
    });

    mepHud = createMepHud({
      container: els.viewerContainer,
      onCommitDistance: (distM) => {
        drawingTool.commitDistance(distM);
      },
    });
    mepHudRef = mepHud;

    window.__drawingTool = drawingTool;
    drawingTool.attach(els.viewerContainer);

    // Initial render of lateral dock components
    api.updatePropertiesPalette?.();
    api.updateProjectBrowserTree?.();

    return { engine, drawingTool };
  }

  api.showLoading = showLoading;
  api.hideLoading = hideLoading;
  api.isHudTyping = isHudTyping;
  api.setRibbonTab = setRibbonTab;
  api.showContextual = (id = 'modify-run') => ribbonApi?.showContextual(id);
  api.hideContextual = () => ribbonApi?.hideContextual();
  api.refreshRibbon = () => ribbonApi?.refresh();

  return { showLoading, hideLoading, isHudTyping, setRibbonTab, wireChrome, bootEngine };
}
