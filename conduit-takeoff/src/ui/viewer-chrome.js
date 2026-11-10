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

  // Map each ribbon tab to the dock (sidebar) panel it focuses. The ribbon
  // adds no commands: proxies below forward clicks to existing handlers.
  const RIBBON_TAB_TO_PANEL = {
    model: 'model',
    trace: 'draw',
    quantities: 'summary',
    project: null, // Project tab has no dock panel; keep current panel open.
  };

  // Sync one direction of ribbon-tab <-> dock (sidebar) tab selection.
  function setRibbonTab(name) {
    const tabs = Array.from(document.querySelectorAll('.ribbon-tab-btn'));
    const panels = Array.from(document.querySelectorAll('.ribbon-panel'));
    tabs.forEach((t) => {
      const isSelected = t.dataset.ribbonTab === name;
      t.classList.toggle('active', isSelected);
      t.setAttribute('aria-selected', isSelected);
    });
    panels.forEach((p) => {
      p.classList.toggle('active', p.dataset.ribbonPanel === name);
    });
    const ribbon = document.getElementById('ribbon');
    if (ribbon) ribbon.dataset.activeTab = name;
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

  function wireRibbonShim() {
    const ribbonTabs = Array.from(document.querySelectorAll('.ribbon-tab-btn'));
    if (ribbonTabs.length === 0) return { setRibbonTab };
    // Resolved lazily: wireChrome() runs before bootEngine() creates the
    // tool, so read it at event time (main.js call order is untouched).
    const getTool = () => window.__drawingTool;

    // Tab click: activate the ribbon panel and focus the matching dock
    // panel (sidebar buttons keep their handlers; this only mirrors state).
    ribbonTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const name = tab.dataset.ribbonTab;
        setRibbonTab(name);
        setDockPanel(RIBBON_TAB_TO_PANEL[name]);
      });
    });

    // Sidebar clicks keep the ribbon in sync (existing handlers untouched).
    els.tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.tabTarget;
        const entry = Object.entries(RIBBON_TAB_TO_PANEL).find(([, panel]) => panel === target);
        if (entry) setRibbonTab(entry[0]);
      });
    });

    // Draw-mode lifecycle events switch the dock to Draw; keep the ribbon
    // Trace group in view too.
    const syncTrace = () => setRibbonTab('trace');
    if (els.btnDrawMode) {
      els.btnDrawMode.addEventListener('click', () => {
        if (getTool()?.isDrawingMode) syncTrace();
      });
    }

    // Ribbon proxies forward to the real buttons: click for buttons,
    // click-through + focus for hidden file inputs. Disabled targets stay
    // disabled (the proxy mirrors the disabled state on init + on change).
    const proxies = Array.from(document.querySelectorAll('.ribbon-proxy[data-forward]'));
    const mirrorDisabled = (proxy, target) => {
      if ('disabled' in target) proxy.disabled = target.disabled;
      proxy.classList.toggle('active', target.classList.contains('active'));
      proxy.setAttribute('aria-disabled', target.disabled ? 'true' : 'false');
    };
    proxies.forEach((proxy) => {
      const target = document.getElementById(proxy.dataset.forward);
      if (!target) return;
      mirrorDisabled(proxy, target);
      new MutationObserver(() => mirrorDisabled(proxy, target)).observe(target, {
        attributes: true,
        attributeFilter: ['disabled', 'class'],
      });
      proxy.addEventListener('click', () => {
        if (target.disabled) return;
        if (target.tagName === 'INPUT' && target.type === 'hidden') {
          target.click();
          return;
        }
        target.click();
        if (target.tagName === 'INPUT' || target.tagName === 'SELECT') target.focus({ preventScroll: true });
      });
    });

    // Keep ribbon Trace proxies' .active state in sync when draw flags
    // change outside a ribbon click (sidebar clicks, keyboard shortcuts).
    const getFlag = (id) => {
      const tool = getTool();
      if (id === 'btn-draw-mode') return tool?.isDrawingMode;
      if (id === 'btn-ortho') return tool?.isOrthoActive;
      if (id === 'btn-perp') return tool?.isPerpendicularActive;
      return undefined;
    };
    const syncProxyActive = () => {
      proxies.forEach((proxy) => {
        const flag = getFlag(proxy.dataset.forward);
        if (flag === undefined) return;
        const target = document.getElementById(proxy.dataset.forward);
        proxy.classList.toggle('active', Boolean(flag || target?.classList.contains('active')));
      });
    };
    ['btn-draw-mode', 'btn-ortho', 'btn-perp'].forEach((id) => {
      document.getElementById(id)?.addEventListener('click', () => queueMicrotask(syncProxyActive));
    });

    return { setRibbonTab };
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

    wireRibbonShim();

    // Sidebar Toggle
    els.sidebarToggle.addEventListener('click', () => {
      els.sidebar.classList.toggle('collapsed');
      // Drive the ribbon offset below (the ribbon precedes the dock in the
      // DOM, so a body class is used instead of a sibling selector).
      document.body.classList.toggle('sidebar-is-collapsed', els.sidebar.classList.contains('collapsed'));
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
    mepHudRef = mepHud;

    window.__drawingTool = drawingTool;
    drawingTool.attach(els.viewerContainer);

    return { engine, drawingTool };
  }

  api.showLoading = showLoading;
  api.hideLoading = hideLoading;
  api.isHudTyping = isHudTyping;
  api.setRibbonTab = setRibbonTab;

  return { showLoading, hideLoading, isHudTyping, setRibbonTab, wireChrome, bootEngine };
}
