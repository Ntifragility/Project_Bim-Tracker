// conduit-takeoff/src/ui/viewer-chrome.js — engine bootstrap, chrome, HUD.
//
// Owns (conduit-ui-split module 8): sidebar tabs/toggle, loading overlay
// show/hide, status text, cursor coords, `init()` engine bootstrap (single
// engine instance) + `onStateChange` fan-out to the drawing tool, MEP HUD,
// viewport controls, and surface picker. Registers `api.showLoading` +
// `api.hideLoading` on the coordinator.

import { createCovillafEngine } from 'viewer-core';
import { createDrawingTool } from '../drawing-tool.js';
import { createMepHud } from '../mep-hud.js';
import { createViewportControls } from '../viewport-controls.js';
import { createSurfacePicker } from '../surface-picker.js';

export function createViewerChrome({ state, els, api }) {
  function showLoading(stage, percent = 0, detail = '') {
    els.loadingOverlay.hidden = false;
    els.loadingStage.textContent = stage;
    els.loadingBarFill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
    els.loadingDetail.textContent = detail;
  }

  function hideLoading() {
    els.loadingOverlay.hidden = true;
  }

  function wireChrome() {
    // Sidebar Tabs Navigation
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
      });
    });

    // Sidebar Toggle
    els.sidebarToggle.addEventListener('click', () => {
      els.sidebar.classList.toggle('collapsed');
    });

    // Update undo/redo state listeners
    state.commandStack.subscribe(() => {
      api.updateUndoRedoButtons();
      api.renderRunsList(window.__drawingTool);
      api.renderSummary();
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
          els.statusText.textContent = `Sampled elevation from model: ${change.elevationPicked.toFixed(2)} m`;
        }

        if (change.cursor) {
          els.cursorCoords.textContent = `X: ${change.cursor.x.toFixed(2)}  Y: ${change.cursor.y.toFixed(2)}  Z: ${change.cursor.z.toFixed(2)}${change.snapped ? ' (SNAP)' : ''}`;
        }

        if (change.activePoints && change.activePoints.length > 0) {
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
            els.statusText.textContent = `⊥ Perpendicular to XY (Vertical riser): Height Δ = ${(change.liveSegment || 0).toFixed(2)} m`;
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
            mepHud.update({
              screenX: change.screenPos.x,
              screenY: change.screenPos.y,
              lengthM: change.liveSegment || 0,
              angleDeg,
              isAngleSnapped: !!change.isVertical || (angleDeg % 45 < 2 || angleDeg % 45 > 43),
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
        }

        api.updateUndoRedoButtons(drawingTool);

        if (change.networkUpdated) {
          api.renderRunsList(drawingTool);
          api.renderSummary();
        }
      },
    });

    mepHud = createMepHud({
      container: els.viewerContainer,
      onCommitDistance: (distM) => {
        drawingTool.commitDistance(distM);
      },
    });

    window.__drawingTool = drawingTool;
    drawingTool.attach(els.viewerContainer);

    return { engine, drawingTool };
  }

  api.showLoading = showLoading;
  api.hideLoading = hideLoading;

  return { showLoading, hideLoading, wireChrome, bootEngine };
}
