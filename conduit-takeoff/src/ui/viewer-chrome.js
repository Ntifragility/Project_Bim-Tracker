// conduit-takeoff/src/ui/viewer-chrome.js — engine bootstrap, ribbon chrome, HUD.
//
// Owns (conduit-ui-split module 8): sidebar tabs/toggle, loading overlay
// show/hide, status text, cursor coords, `init()` engine bootstrap (single
// engine instance) + `onStateChange` fan-out to the drawing tool, MEP HUD,
// viewport controls, and surface picker.
// Bootstraps universal Revit-style ribbon via ribbon-chrome and conduit-adapter.

import * as THREE from 'three';
import { createCovillafEngine, mountChunkedBundlePanel, mountPerfHud } from 'viewer-core';
import { createRibbon, createReviztoToolbar } from 'ribbon-chrome';
import { createConduitRibbonDef } from './conduit-adapter.js';
import { createLateralDock } from './lateral-dock.js';
import { initConduitContextMenu } from './context-menu.js';
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
      state.hasUnsavedChanges = true;
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
          let coordsText = '';
          if (state.coordinateMode === 'shared' && engine?.coordinates?.toOriginal) {
            const orig = engine.coordinates.toOriginal(change.cursor);
            coordsText = `E: ${orig.x.toFixed(2)} m  N: ${orig.y.toFixed(2)} m  Elev: ${orig.z.toFixed(2)} m (IFC)${change.snapped ? ' (SNAP)' : ''}`;
          } else {
            coordsText = `X: ${change.cursor.x.toFixed(2)} m  Y: ${change.cursor.z.toFixed(2)} m  Elev: ${change.cursor.y.toFixed(2)} m (Local)${change.snapped ? ' (SNAP)' : ''}`;
          }
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
              bendInfo: change.liveBendAngle >= 10.0 && change.activePoints.length >= 2 ? {
                angle: change.liveBendAngle,
                clr: change.bendRadius || 0.1143,
                gain: change.gain,
              } : null,
              warningText: change.necWarning || null,
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

        if (change.runSelected !== undefined) {
          state.selectedRunId = change.runSelected;
          api.renderRunsList(drawingTool);
          if (state.selectedRunId != null) {
            api.showContextual?.('modify-run');
            api.switchDockTab?.('properties');
          } else if (!drawingTool.isDrawingMode && (!drawingTool.activePoints || drawingTool.activePoints.length === 0)) {
            api.hideContextual?.();
          }
          api.updatePropertiesPalette?.(state.selectedRunId);
          engine.visibility?.notifySelectionChange?.();
        }

        if (change.networkUpdated) {
          api.renderRunsList(drawingTool);
          api.renderSummary();
          api.updatePropertiesPalette?.(state.selectedRunId);
          engine.visibility?.notifySelectionChange?.();
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

    // Unified BIM + Conduit participation in Visibility, Isolation, Section & 5-Mode Ruler
    if (engine.visibility?.registerExternalAdapter) {
      engine.visibility.registerExternalAdapter('conduit-runs', {
        getAllIds: () => Object.values(state.network?.runs || {}).map((r) => String(r.id)),
        getSelectedIds: () => (state.selectedRunId != null ? [String(state.selectedRunId)] : []),
        clearSelection: () => {
          state.selectedRunId = null;
          drawingTool.selectedRunId = null;
          api.renderRunsList?.(drawingTool);
          api.updatePropertiesPalette?.(null);
        },
        applyVisibility: ({ hiddenIds, ghostIds }) => {
          drawingTool.setExternalVisibilityState({ hiddenIds, ghostIds });
        },
      });
    }

    if (engine.section) {
      engine.section.registerClippedObject('conduit-completed-runs', drawingTool.completedRunsGroup);
      engine.section.registerExternalBounds('conduit-runs', () => {
        if (!drawingTool.completedRunsGroup?.children?.length) return null;
        return new THREE.Box3().setFromObject(drawingTool.completedRunsGroup);
      });
      engine.section.onChange(() => drawingTool.syncViewportMode());
    }

    if (engine.ruler) {
      engine.ruler.registerPickSource('conduit-completed-runs', drawingTool.completedRunsGroup);
      engine.ruler.onChange(() => drawingTool.syncViewportMode());
    }

    // Revizto-Style Floating Viewport Toolbar (Hide/Unhide, Isolate/Ghost, Section Plane/Box, 5-Mode Ruler)
    if (els.viewerContainer && engine?.visibility) {
      const reviztoToolbar = createReviztoToolbar(els.viewerContainer, {
        visibility: engine.visibility,
        isolation: engine.isolation,
        section: engine.section,
        ruler: engine.ruler,
        getSelectionMap: () => engine.highlighter?.selection?.select || {},
      });
      api.reviztoToolbar = reviztoToolbar;
      api.unhidePill = reviztoToolbar;

      els.viewerContainer.addEventListener('dblclick', (ev) => {
        const secState = engine.section?.getState?.() || {};
        if (secState.active && secState.mode === 'plane' && !engine.ruler?.active) {
          const rect = els.viewerContainer.getBoundingClientRect();
          if (!rect.width || !rect.height) return;
          const ndc = new THREE.Vector2(
            ((ev.clientX - rect.left) / rect.width) * 2 - 1,
            -((ev.clientY - rect.top) / rect.height) * 2 + 1,
          );
          engine.section.cutAtNdc(ndc);
        }
      });
    }

    // Drag-guarded right-click Revizto viewport context menu
    initConduitContextMenu({ state, els, engine, drawingTool });

    // Experimental opt-in LOD streaming test selector (defaults to 'default' — zero effect until switched)
    if (els.viewerContainer && engine.lodTuning && !els.viewerContainer.querySelector('#lod-test-pill')) {
      const pill = document.createElement('div');
      pill.id = 'lod-test-pill';
      pill.style.cssText =
        'position:absolute;right:12px;bottom:12px;z-index:25;display:flex;align-items:center;gap:6px;' +
        'background:rgba(15,23,42,0.82);color:#e2e8f0;padding:4px 8px;border-radius:6px;' +
        'border:1px solid rgba(148,163,184,0.28);font:11px/1.2 system-ui,sans-serif;backdrop-filter:blur(6px);';
      pill.innerHTML =
        '<label for="lod-test-select" style="opacity:0.8;white-space:nowrap;">LOD Test:</label>' +
        '<select id="lod-test-select" style="background:#0f172a;color:#f8fafc;border:1px solid #334155;' +
        'border-radius:4px;padding:2px 6px;font-size:11px;cursor:pointer;">' +
        '<option value="default" selected>Default (Original)</option>' +
        '<option value="fast-stream">Fast Stream (Live Zoom)</option>' +
        '<option value="high-detail">High Detail (GPU)</option>' +
        '</select>';
      const sel = pill.querySelector('#lod-test-select');
      sel.addEventListener('change', () => {
        const mode = engine.lodTuning.setMode(sel.value);
        if (els.statusText) {
          els.statusText.textContent =
            mode === 'fast-stream'
              ? 'LOD Test: Fast Stream active (live tile streaming while zooming)'
              : mode === 'high-detail'
                ? 'LOD Test: High Detail active (graphicsQuality=1)'
                : 'LOD Test: Default (original behavior restored)';
        }
      });
      els.viewerContainer.appendChild(pill);
    }

    // SVF2-Lite Chunked Bundle Panel (local / OneDrive-synced folder OR cloud HTTP URL + IndexedDB cache)
    if (els.viewerContainer && engine) {
      api.chunkedPanel = mountChunkedBundlePanel(els.viewerContainer, {
        engine,
        onStatus: (msg) => {
          if (els.statusText) els.statusText.textContent = msg;
          ribbonApi?.setStatus?.('status-text', msg);
        },
        onBundleOpened: ({ manifest, transport }) => {
          state.sourceModel.name = manifest.sourceName || 'Bundle';
          state.sourceModel.size = Number(manifest.totalCompressedBytes) || 0;
          state.sourceModel.schema = 'IFC4';
          state.sourceModel.bundleUrl = transport?.baseUrl || null;
          state.sourceModel.splitMode = manifest.splitMode || null;
          if (els.modelInfo) els.modelInfo.hidden = false;
          if (els.modelName) els.modelName.textContent = state.sourceModel.name;
          if (els.modelSchema) els.modelSchema.textContent = `Bundle (${manifest.chunks?.length || 0} chunks)`;
        },
      });
      api.perfHud = mountPerfHud(els.viewerContainer, {
        engine,
        chunkedManager: api.chunkedPanel?.manager,
        defaultOpen: true,
      });
    }

    // Inspect clicked Native IFC elements (including re-imported exported conduit traces & Pset_ConduitRun)
    const unwrapVal = (v) => (v && typeof v === 'object' && 'value' in v ? v.value : v);
    engine.highlighter?.events?.select?.onHighlight?.add?.(async (modelIdMap) => {
      try {
        if (drawingTool.isDrawingMode || state.selectedRunId != null) return;
        const entries = Object.entries(modelIdMap || {});
        if (!entries.length) return;
        const [modelId, idSet] = entries[0];
        const firstId = idSet instanceof Set ? idSet.values().next().value : Array.isArray(idSet) ? idSet[0] : null;
        if (firstId == null) return;
        const model =
          engine.fragments?.list?.get?.(modelId) ||
          engine.fragments?.core?.models?.list?.get?.(modelId);
        if (!model || typeof model.getItemsData !== 'function') return;

        const [itemData] = await model.getItemsData([Number(firstId)], {
          attributesDefault: true,
          relations: {
            IsDefinedBy: { attributes: true, relations: true },
            IsTypedBy: { attributes: true, relations: true },
            DefinesOccurrence: { attributes: true, relations: true },
          },
        });
        if (!itemData) return;

        const psets = {};
        const collectFromDefs = (defs) => {
          if (!Array.isArray(defs)) return;
          for (const pset of defs) {
            const psetName = String(unwrapVal(pset?.Name) || 'PropertySet');
            const hasProps = Array.isArray(pset?.HasProperties)
              ? pset.HasProperties
              : Array.isArray(pset?.Quantities)
                ? pset.Quantities
                : [];
            const rows = [];
            for (const prop of hasProps) {
              const pName = unwrapVal(prop?.Name);
              const pVal =
                unwrapVal(prop?.NominalValue) ??
                unwrapVal(prop?.LengthValue) ??
                unwrapVal(prop?.AreaValue) ??
                unwrapVal(prop?.VolumeValue) ??
                unwrapVal(prop?.CountValue) ??
                unwrapVal(prop?.WeightValue);
              if (pName != null && pVal != null && String(pVal) !== '') {
                rows.push({ name: String(pName), value: pVal });
              }
            }
            if (rows.length > 0) psets[psetName] = rows;
          }
        };
        collectFromDefs(itemData.IsDefinedBy);
        if (Array.isArray(itemData.IsTypedBy)) {
          for (const t of itemData.IsTypedBy) {
            collectFromDefs(t?.HasPropertySets);
          }
        }

        api.showIfcElementProperties?.({
          expressId: Number(firstId),
          globalId: unwrapVal(itemData.GlobalId) || unwrapVal(itemData._guid) || '',
          name: unwrapVal(itemData.Name) || '',
          description: unwrapVal(itemData.Description) || '',
          category: unwrapVal(itemData._category) || '',
          psets,
        });
        api.switchDockTab?.('properties');
      } catch (err) {
        console.warn('[Conduit Takeoff] IFC property inspect warning:', err);
      }
    });

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
