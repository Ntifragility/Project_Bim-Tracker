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

/**
 * @param {object} ctx app context (`src/ui/context.js`)
 * @param {object} dom DOM handles (`src/ui/dom.js`)
 * @param {object} api shared runtime API (populated by feature modules)
 */
export function initViewerChrome(ctx, dom, api) {
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
  function guardOverlays() {
    for (const overlay of [dom.sidebar, dom.excelPanel, dom.viewerSettingsPanel, dom.viewerContextMenu]) {
      if (!overlay) continue;
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

    if (dom.btnViewerSettings && dom.viewerSettingsPanel) {
      dom.btnViewerSettings.addEventListener('click', () => {
        const willOpen = dom.viewerSettingsPanel.hidden;
        dom.viewerSettingsPanel.hidden = !willOpen;
        dom.btnViewerSettings.setAttribute('aria-expanded', String(willOpen));
      });
    }

    dom.toggleGrid.addEventListener('change', () => {
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

    dom.toggleWireframe.addEventListener('change', () => {
      api.setWireframe(dom.toggleWireframe.checked);
    });

    dom.toggleDarkMode.addEventListener('change', () => {
      const isDark = dom.toggleDarkMode.checked;
      const color = isDark ? new THREE.Color('#0a0b0e') : new THREE.Color('#f3f4f6');
      ctx.world.scene.three.background = color;
    });

    // Toggle Sidebar Collapse
    if (dom.btnSidebarToggle && dom.sidebar) {
      dom.btnSidebarToggle.addEventListener('click', () => {
        dom.sidebar.classList.toggle('collapsed');

        const isCollapsed = dom.sidebar.classList.contains('collapsed');
        const toggleSpan = dom.btnSidebarToggle.querySelector('span');
        if (toggleSpan) {
          toggleSpan.innerText = isCollapsed ? '▶' : '◀';
        }

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
    for (const overlay of [dom.sidebar, dom.excelPanel, dom.viewerSettingsPanel, dom.viewerContextMenu]) {
      if (!overlay) continue;
      overlay.addEventListener('pointerdown', () => {
        ctx.highlighter.config.selectEnabled = false;
      });
      const restoreViewportPicking = () => {
        window.setTimeout(() => {
          ctx.highlighter.config.selectEnabled = true;
        }, 0);
      };
      overlay.addEventListener('pointerup', restoreViewportPicking);
      overlay.addEventListener('pointercancel', restoreViewportPicking);
    }

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

  return {
    setupSidebarTabs,
    guardOverlays,
    wireChromeControls,
    excludeHiddenModelsFromPicker,
    resolveWorldGrid,
  };
}
