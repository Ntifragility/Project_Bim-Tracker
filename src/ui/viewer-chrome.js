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
  // Revit-style ribbon shell: MOVE (never clone) existing control subtrees
  // into ribbon slots, preserving every id and every wired listener.
  // Move units are whole subtrees (sections/panes), so sidebar tabs
  // (.sidebar-tab-btn[data-tab-target] + section[data-sidebar-panel]) and
  // tagging tabs (tagging-tab-assign/manage + batch panes, setTaggingMode)
  // keep working after the move. No new commands are created; the ribbon
  // only re-homes existing controls. Called from wireChromeControls() so
  // every feature module has wired its controls first (main.js stays thin
  // and must NOT add a second call).
  //
  // Slot map (id-preserving moves, listeners travel with the nodes):
  //   Model tab:      models section (btn-load-sample, btn-upload,
  //                   file-input, btn-upload-excel, excel-file-input,
  //                   btn-export-all-ifc) + controls section
  //                   (btn-reset-camera, btn-viewer-settings,
  //                   viewer-settings-panel + highlight inputs,
  //                   toggle-grid/wireframe/darkmode, highlight/labels
  //                   sidebar toggles).
  //   Tag tab:        tagging-mode-tabs (assign/manage switch reusing
  //                   setTaggingMode) + batch-tagging-pane (batch-prefix/
  //                   system/kind/codes/sequence/digits, btn-preview/
  //                   apply/undo-batch-tags, batch-status/preview) beside
  //                   tag-management-pane (system-tag-input, btn-assign-tag
  //                   et al.).
  //   Systems tab:    tag-validation-report only (validation readout).
  //   Edit-Export:    routing section (routing-tolerance, graph/start/end/
  //                   calculate buttons, status/summary) + whole ifc-edit
  //                   panel (metadata rows/stage, property/color stage,
  //                   pending list, clear/export) + excel-upload controls
  //                   (btn-upload-excel, excel-file-input). Export buttons
  //                   travel inside their subtrees — none duplicated.
  //
  // Left dock (#sidebar) keeps the element-props display (+ sidebar nav,
  // collapse, footer). Right dock (#excel-panel) keeps the loaded-models
  // list, the tray-system manager subtree (list/filter/sort, components,
  // continuity + btn-clear-continuity-colors, deletions +
  // btn-restore-all-deletions, manager actions), and the excel table
  // container — displays stay docked, only command inputs move up.
  function setupRibbonShell() {
    const ribbon = document.getElementById('ribbon');
    if (!ribbon || ribbon.dataset.ribbonReady === 'true') return;

    const byId = (id) => document.getElementById(id);
    const slot = (name) => ribbon.querySelector(`[data-ribbon-slot="${name}"]`);
    const moveInto = (slotName, nodes) => {
      const target = slot(slotName);
      if (!target) return;
      for (const node of nodes) {
        if (node && node.parentElement !== target) target.appendChild(node);
      }
    };

    const modelsSection = document.querySelector('section.control-group[data-sidebar-panel="models"]');
    const controlsSection = document.querySelector('section.control-group[data-sidebar-panel="controls"]');
    const routingSection = document.querySelector('section.control-group[data-sidebar-panel="routing"]');

    // ── Model tab ──
    // Whole models section (sample/upload/file-input), whole controls
    // section (reset camera, settings popover + highlight inputs,
    // grid/wireframe/dark/highlight/labels toggles). The excel-link row
    // (btn-upload-excel + excel-file-input) moves to Edit-Export beside
    // the other export controls; the loaded-models section STAYS in the
    // right dock (task: right dock = loaded models + systems + excel).
    if (modelsSection) {
      const excelUploadWrap = modelsSection.querySelector('.file-upload-wrapper:has(#excel-file-input)');
      moveInto('model-load', [modelsSection]);
      if (excelUploadWrap) moveInto('edit-export', [excelUploadWrap, byId('excel-file-input')].filter(Boolean));
      else moveInto('edit-export', [byId('btn-upload-excel'), byId('excel-file-input')].filter(Boolean));
    }
    if (controlsSection) moveInto('model-view', [controlsSection]);

    // ── Tag tab ──
    // tagging-tab-assign/manage buttons move WITH both panes into adjacent
    // slots, so the existing setTaggingMode('assign'|'manage') wiring keeps
    // toggling the pair. No new tab logic is introduced.
    const taggingTabs = document.querySelector('.tagging-mode-tabs');
    const batchPane = byId('batch-tagging-pane');
    const managePane = byId('tag-management-pane');
    moveInto('tag-batch', [taggingTabs, batchPane].filter(Boolean));
    moveInto('tag-assign', [managePane].filter(Boolean));

    // ── Systems tab ──
    // Validation readout only. The tray-system manager subtree (list/
    // filter/sort/components/continuity/deletions/actions) STAYS in the
    // right dock (task: right dock = loaded models + systems + excel).
    const validationReport = byId('tag-validation-report');
    moveInto('systems-validation', [validationReport].filter(Boolean));

    // ── Edit-Export tab ──
    // Whole routing section (tolerance/graph/start/end/calculate/status) +
    // whole ifc-edit panel (metadata rows, stage buttons, status/pending
    // lists) move intact; export buttons travel inside their subtrees
    // (btn-export-all-ifc in models section, btn-export-edited-ifc in the
    // ifc-edit panel) — no button is duplicated or recreated.
    if (routingSection) moveInto('edit-routing', [routingSection]);
    const ifcEditPanel = document.querySelector('.ifc-edit-panel');
    if (ifcEditPanel) moveInto('edit-metadata', [ifcEditPanel]);

    // Left dock (#sidebar): after the moves above it keeps the element
    // properties display only; the sidebar nav tabs stay and keep working.
    // Right dock (#excel-panel): keeps the loaded-models section, the full
    // tray-system manager subtree, the tagged-highlight toolbars, the
    // tray-selection summary row, and the excel table container — displays
    // stay docked, only command inputs move up.

    // Ribbon tab switching: plain hidden toggling, never touches sidebar
    // tabs or tagging tabs.
    const ribbonTabs = Array.from(ribbon.querySelectorAll('.ribbon-tab'));
    const ribbonPanels = Array.from(ribbon.querySelectorAll('.ribbon-panel'));
    const selectRibbonTab = (name) => {
      for (const tab of ribbonTabs) {
        const active = tab.dataset.ribbonTab === name;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', String(active));
      }
      for (const panel of ribbonPanels) {
        const active = panel.dataset.ribbonPanel === name;
        panel.classList.toggle('active', active);
        panel.hidden = !active;
      }
    };
    for (const tab of ribbonTabs) {
      tab.addEventListener('click', () => selectRibbonTab(tab.dataset.ribbonTab));
    }

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
    // The ribbon joins the guard list: it is an overlay after setupRibbonShell
    // moves the control subtrees into it (same nodes, new parent).
    const ribbonEl = document.getElementById('ribbon');
    for (const overlay of [ribbonEl, dom.sidebar, dom.excelPanel, dom.viewerSettingsPanel, dom.viewerContextMenu]) {
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

  return {
    setupSidebarTabs,
    setupRibbonShell,
    guardOverlays,
    wireChromeControls,
    excludeHiddenModelsFromPicker,
    resolveWorldGrid,
  };
}
