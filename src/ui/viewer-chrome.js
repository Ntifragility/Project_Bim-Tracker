// Viewer chrome for the tray viewer.
//
// Owns the app-shell controls: sidebar tabs/collapse, viewer settings panel,
// selection-highlight inputs, grid toggle, wireframe toggle, dark mode,
// auto-orbit indicator, window resize handling and the overlay
// stop-propagation guard.
//
// Two deliberate fixes vs the `src/main.js` monolith (recorded in the spec):
// 1. The grid toggle referenced a file-scope `grid` that neither the engine
//    (`packages/viewer-core/src/engine.js`) nor the app ever exposed, so
//    every toggle threw `ReferenceError`. The handler now resolves the grid
//    from the components registry (`OBC.Grids` list for this world) and
//    no-ops when no grid exists.
// 2. Same stop-propagation guard as the monolith's top-level overlay loop.

import * as OBC from '@thatopen/components';
import * as THREE from 'three';
import { createRibbon, createXyzTriad, createReviztoToolbar } from 'ribbon-chrome';
import { mountChunkedBundlePanel, mountPerfHud } from 'viewer-core';
import { createTrayRibbonDef } from './tray-adapter.js';

/**
 * @param {object} ctx app context (`src/ui/context.js`)
 * @param {object} dom DOM handles (`src/ui/dom.js`)
 * @param {object} api shared runtime API (populated by feature modules)
 */
export function initViewerChrome(ctx, dom, api) {
  // Universal Revit ribbon chrome bootstrap for Tray Viewer.
  // Replaces legacy DOM-move setup with declarative createRibbon() from ribbon-chrome.
  function setupRibbonShell() {
    const ribbon = document.getElementById('ribbon');
    if (!ribbon || ribbon.dataset.ribbonReady === 'true') return;

    const ribbonDef = createTrayRibbonDef(ctx);
    const ribbonInstance = createRibbon(ribbon, ribbonDef, ctx);

    api.ribbon = ribbonInstance;
    api.showContextual = (id) => ribbonInstance?.showContextual?.(id);
    api.hideContextual = () => ribbonInstance?.hideContextual?.();
    api.refreshRibbon = () => ribbonInstance?.refresh?.();
    api.setKeytipsVisible = (visible) => ribbonInstance?.setKeytipsVisible?.(visible);

    ribbon.dataset.ribbonReady = 'true';
    guardRibbonOverlays(ribbon);
  }

  // Keep ribbon clicks from raycasting through to the model behind, same as
  // the sidebar/excel-panel overlay guard (extends guardOverlays coverage).
  function guardRibbonOverlays(ribbon) {
    if (!ribbon) return;
    for (const eventName of ['pointerdown', 'pointerup', 'click', 'dblclick']) {
      ribbon.addEventListener(eventName, (event) => event.stopPropagation());
    }
    ribbon.addEventListener('pointerdown', () => {
      ctx.highlighter.config.selectEnabled = false;
    });
    const restoreViewportPicking = () => {
      window.setTimeout(() => {
        ctx.highlighter.config.selectEnabled = true;
      }, 0);
    };
    ribbon.addEventListener('pointerup', restoreViewportPicking);
    ribbon.addEventListener('pointercancel', restoreViewportPicking);
  }

  // Set up Sidebar Tabs navigation
  function setupSidebarTabs() {
    const tabButtons = document.querySelectorAll('.sidebar-tab-btn');
    const panels = document.querySelectorAll('section.control-group[data-sidebar-panel]');
    if (!tabButtons.length || !panels.length) return;

    tabButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const targetTab = button.dataset.tabTarget;
        tabButtons.forEach((btn) => {
          const isActive = btn === button;
          btn.classList.toggle('active', isActive);
          btn.setAttribute('aria-selected', String(isActive));
        });

        panels.forEach((panel) => {
          const isTarget = panel.dataset.sidebarPanel === targetTab;
          panel.classList.toggle('active', isTarget);
        });
      });
    });
  }

  // The highlighter listens for viewport pointer events at a shared level. Keep
  // clicks inside overlay controls from raycasting through to the model behind.
  // The ribbon is included: its moved subtrees keep their DOM identity, so
  // the original guards keep applying wherever the controls now live.
  function guardOverlays() {
    const ribbon = document.getElementById('ribbon');
    for (const overlay of [ribbon, dom.sidebar, dom.excelPanel, dom.viewerSettingsPanel, dom.viewerContextMenu]) {
      if (!overlay || overlay.dataset.guarded === 'true') continue;
      overlay.dataset.guarded = 'true';
      for (const eventName of ['pointerdown', 'pointerup', 'click', 'dblclick']) {
        overlay.addEventListener(eventName, (event) => event.stopPropagation());
      }
    }
  }

  function resolveWorldGrid() {
    try {
      const grids = ctx.components.get(OBC.Grids);
      for (const [worldId, grid] of grids?.list ?? []) {
        if (worldId === ctx.world?.uuid) return grid;
      }
      return grids?.list?.values?.().next?.().value ?? null;
    } catch {
      return null;
    }
  }

  function wireChromeControls() {
    // ──────────────────────────────────────────────
    //  AUTO-ORBIT CAMERA ROTATION (delegated to viewer-core)
    // ──────────────────────────────────────────────
    ctx.engine.autoOrbit.onChange((active) => {
      ctx.autoRotateActive = active;
      if (dom.orbitIndicator) {
        dom.orbitIndicator.style.display = active ? 'flex' : 'none';
      }
    });

    if (dom.orbitIndicator) {
      dom.orbitIndicator.style.cursor = 'pointer';
      dom.orbitIndicator.title = 'Click to toggle Auto-Orbit';
      dom.orbitIndicator.addEventListener('click', (e) => {
        e.stopPropagation();
        ctx.engine.autoOrbit.toggle();
      });
    }

    // Revit-Style Corner Orientation Triad (UCS Widget)
    if (dom.container && ctx.world?.camera) {
      const triad = createXyzTriad(dom.container, {
        camera: () => ctx.world?.camera?.three,
        controls: () => ctx.world?.camera?.controls,
        position: 'bottom-right',
      });
      api.xyzTriad = triad;
    }

    // Revizto-Style Viewport Toolbar (Hide/Unhide, Isolate/Ghost, Section Plane/Box, 5-Mode Ruler)
    let reviztoToolbar = null;
    if (dom.container && ctx.engine?.visibility) {
      reviztoToolbar = createReviztoToolbar(dom.container, {
        visibility: ctx.engine.visibility,
        isolation: ctx.engine.isolation,
        section: ctx.engine.section,
        ruler: ctx.engine.ruler,
        getSelectionMap: () => (typeof api.getSelectedModelIdMap === 'function' ? api.getSelectedModelIdMap() : {}),
        hideTaggedAction: {
          isActive: () => Boolean(api.taggingAuxBar?.isHideTaggedActive?.()),
          getCount: () => Number(api.taggingAuxBar?.getTaggedCount?.() || 0),
          onToggle: () => api.taggingAuxBar?.toggleHideTagged?.(),
        },
      });
      api.reviztoToolbar = reviztoToolbar;
      api.unhidePill = reviztoToolbar;

      // SVF2-Lite Chunked Bundle Panel (local / OneDrive-synced .fragbundle folder)
      api.chunkedPanel = mountChunkedBundlePanel(dom.container, {
        engine: ctx.engine,
      });
      api.perfHud = mountPerfHud(dom.container, {
        engine: ctx.engine,
        chunkedManager: api.chunkedPanel?.manager,
        defaultOpen: true,
      });

      const syncSelectPolicy = () => {
        if (!ctx.highlighter?.config) return;
        const secState = ctx.engine.section?.getState?.() || {};
        const rulActive = Boolean(ctx.engine.ruler?.active);
        const dragActive = Boolean(ctx.engine.section?.isDraggingHandle?.());
        ctx.highlighter.config.selectEnabled = !(rulActive || secState.surfacePickPending || dragActive);
      };

      ctx.engine.section?.onChange?.(syncSelectPolicy);
      ctx.engine.ruler?.onChange?.(syncSelectPolicy);
      ctx.highlighter?.events?.select?.onHighlight?.add?.(() => ctx.engine.visibility?.notifySelectionChange?.());
      ctx.highlighter?.events?.select?.onClear?.add?.(() => ctx.engine.visibility?.notifySelectionChange?.());

      const toNdc = (ev) => {
        const rect = dom.container.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        return new THREE.Vector2(
          ((ev.clientX - rect.left) / rect.width) * 2 - 1,
          -((ev.clientY - rect.top) / rect.height) * 2 + 1,
        );
      };

      let downPos = null;
      let draggingSectionHandle = false;

      dom.container.addEventListener('pointerdown', (ev) => {
        if (ev.button !== 0) return;
        downPos = { x: ev.clientX, y: ev.clientY };
        const ndc = toNdc(ev);
        if (ndc && ctx.engine.section?.handlePointerDown?.(ndc)) {
          draggingSectionHandle = true;
          syncSelectPolicy();
        }
      });

      dom.container.addEventListener('pointermove', (ev) => {
        const ndc = toNdc(ev);
        if (!ndc) return;
        if (ctx.engine.section?.active || draggingSectionHandle) {
          ctx.engine.section?.handlePointerMove?.(ndc);
        }
        if (ctx.engine.ruler?.active && !draggingSectionHandle) {
          ctx.engine.ruler?.handlePointerMove?.(ndc);
        }
      });

      dom.container.addEventListener('pointerup', (ev) => {
        if (ev.button !== 0) return;
        if (draggingSectionHandle) {
          draggingSectionHandle = false;
          ctx.engine.section?.handlePointerUp?.();
          syncSelectPolicy();
          downPos = null;
          return;
        }
        if (!downPos) return;
        const dist = Math.hypot(ev.clientX - downPos.x, ev.clientY - downPos.y);
        downPos = null;
        if (dist > 5) return;
        const ndc = toNdc(ev);
        if (!ndc) return;
        const secState = ctx.engine.section?.getState?.() || {};
        if (secState.surfacePickPending) {
          ctx.engine.section.handlePointerClick(ndc);
        } else if (ctx.engine.ruler?.active) {
          ctx.engine.ruler.handlePointerClick(ndc, { shiftKey: ev.shiftKey });
        }
      });

      dom.container.addEventListener('dblclick', (ev) => {
        const secState = ctx.engine.section?.getState?.() || {};
        if (secState.active && secState.mode === 'plane' && !ctx.engine.ruler?.active) {
          const ndc = toNdc(ev);
          if (ndc) ctx.engine.section.cutAtNdc(ndc);
        }
      });
    }

    if (dom.btnViewerSettings && dom.viewerSettingsPanel) {
      dom.btnViewerSettings.addEventListener('click', () => {
        const willOpen = dom.viewerSettingsPanel.hidden;
        dom.viewerSettingsPanel.hidden = !willOpen;
        dom.btnViewerSettings.setAttribute('aria-expanded', String(willOpen));
      });
    }

    dom.toggleGrid?.addEventListener('change', () => {
      // FIX (7.1): the monolith referenced a file-scope `grid` that no
      // module ever defined — every toggle threw `ReferenceError`. Resolve
      // the grid from the same registry the engine created it in.
      const grid = resolveWorldGrid();
      if (!grid) return;
      if ('visible' in grid) {
        grid.visible = dom.toggleGrid.checked;
      } else if (grid.three) {
        grid.three.visible = dom.toggleGrid.checked;
      }
    });

    dom.toggleAxes?.addEventListener('change', () => {
      if (ctx.engine?.axes) {
        ctx.engine.axes.visible = dom.toggleAxes.checked;
      }
    });

    dom.toggleWireframe?.addEventListener('change', () => {
      api.setWireframe(dom.toggleWireframe.checked);
    });

    dom.toggleDarkMode?.addEventListener('change', () => {
      const isDark = dom.toggleDarkMode.checked;
      const color = isDark ? new THREE.Color('#0a0b0e') : new THREE.Color('#f3f4f6');
      ctx.world.scene.three.background = color;
    });

    // Toggle Sidebar Collapse (reopen button only visible when sidebar is closed)
    if (dom.btnSidebarToggle && dom.sidebar) {
      dom.btnSidebarToggle.addEventListener('click', () => {
        dom.sidebar.classList.toggle('collapsed');
        document.body.classList.toggle('sidebar-is-collapsed', dom.sidebar.classList.contains('collapsed'));

        if (ctx.world.renderer && ctx.world.renderer.resize) {
          ctx.world.renderer.resize();
        }
      });

      dom.sidebar.addEventListener('transitionend', () => {
        if (ctx.world.renderer && ctx.world.renderer.resize) {
          ctx.world.renderer.resize();
        }
      });
    }

    // UI panels overlay the renderer. Temporarily disable viewport picking while
    // their pointer gesture is active so a button click cannot select geometry
    // underneath and collapse a valid multi-selection.
    // The ribbon joins the guard list: it is an overlay after setupRibbonShell
    // moves the control subtrees into it (same nodes, new parent).
    const ribbonEl = document.getElementById('ribbon');
    for (const overlay of [ribbonEl, dom.sidebar, dom.excelPanel, dom.viewerSettingsPanel, dom.viewerContextMenu, reviztoToolbar?.element]) {
      if (!overlay) continue;
      overlay.addEventListener('pointerdown', () => {
        ctx.highlighter.config.selectEnabled = false;
      });
      const restoreViewportPicking = () => {
        window.setTimeout(() => {
          const secState = ctx.engine?.section?.getState?.() || {};
          const rulActive = Boolean(ctx.engine?.ruler?.active);
          const dragActive = Boolean(ctx.engine?.section?.isDraggingHandle?.());
          ctx.highlighter.config.selectEnabled = !(rulActive || secState.surfacePickPending || dragActive);
        }, 0);
      };
      overlay.addEventListener('pointerup', restoreViewportPicking);
      overlay.addEventListener('pointercancel', restoreViewportPicking);
    }

    // Re-home existing controls into the ribbon AFTER every feature module
    // wired its listeners (order guaranteed by src/main.js: chrome wiring
    // runs last). Moves preserve listeners; nothing is cloned or recreated.
    setupRibbonShell();

    // Hidden federated models can remain in the FragmentsManager picker even
    // after their scene objects are hidden. Exclude them for the GPU pick only.
    const fragments = ctx.components.get(OBC.FragmentsManager);
    try {
      const raycasterComponent = OBC.Raycasters;
      if (raycasterComponent) {
        const raycaster = ctx.components.get(raycasterComponent).get(ctx.world);
        if (raycaster && typeof raycaster.castRay === 'function') {
          const originalCastRay = raycaster.castRay.bind(raycaster);
          raycaster.castRay = async (...args) => {
            const restore = api.excludeHiddenModelsFromPicker();
            try {
              return await originalCastRay(...args);
            } finally {
              restore();
            }
          };
        }
      }
    } catch (error) {
      console.warn('[Raycaster Wrapper] Could not exclude hidden models from picking:', error);
    }
    // Hider comes from the engine (destructured above); do not redeclare here.

    // Handle window resizing
    window.addEventListener('resize', () => {
      if (ctx.world.renderer && ctx.world.renderer.resize) {
        ctx.world.renderer.resize();
      }
    });
  }

  function excludeHiddenModelsFromPicker() {
    const fragments = ctx.components.get(OBC.FragmentsManager);
    const removed = new Map();
    if (!fragments?.list) return () => {};
    for (const modelEntry of ctx.loadedModels) {
      if (modelEntry.visible) continue;
      const modelId = modelEntry.model?.modelId || modelEntry.model?.uuid || modelEntry.uuid;
      if (modelId && fragments.list.has(modelId)) {
        removed.set(modelId, fragments.list.get(modelId));
        fragments.list.delete(modelId);
      }
    }
    return () => {
      for (const [id, model] of removed) fragments.list.set(id, model);
    };
  }

  api.excludeHiddenModelsFromPicker = excludeHiddenModelsFromPicker;
  api.resolveWorldGrid = resolveWorldGrid;
  let coordinateMode = 'project';
  api.getCoordMode = () => coordinateMode;
  api.setCoordMode = (mode) => {
    coordinateMode = mode;
    api.refreshRibbon?.();
    api.updatePropertiesPalette?.();
  };

  return {
    setupSidebarTabs,
    setupRibbonShell,
    guardOverlays,
    wireChromeControls,
    excludeHiddenModelsFromPicker,
    resolveWorldGrid,
  };
}
