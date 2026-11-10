// conduit-takeoff/src/ui/project-io.js — save/load/export + shortcuts.
//
// Owns (conduit-ui-split module 7): save/load project JSON
// (`serializeProject`/`deserializeProject` + hash verify), CSV export
// (`exportCompleteCsv`), IFC overlay export (`exportOverlayIfc`), keyboard
// shortcuts. Registers `api.downloadFile` on the coordinator.

// Persistence/serialization helpers stay JS-side by design (conduit-wasm.md
// R4); `computeTakeoff` + `createNetwork` come from `state.backend`.
import {
  serializeProject,
  deserializeProject,
  verifySourceHash,
  exportCompleteCsv,
  exportOverlayIfc,
} from '@conduit-core';

export function createProjectIo({ state, els, engine, api }) {
  const backend = state.backend;
  function downloadFile(content, filename, type = 'application/json') {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Global ESC precedence chain (revit-ribbon): (1) typing guard — HUD
  // typing or focus in INPUT/TEXTAREA/SELECT → blur only, nothing else;
  // (2) cancel in-progress capture — activePoints.length > 0 →
  // cancelCurrentRun(), pick-elevation → off + .active removed; (3) clear
  // selection — state.selectedRunId → null + rerender; (4) stand down
  // trace tools — isDrawingMode/isOrthoActive/isPerpendicularActive →
  // false + .active removed + status text. Sticky prefs (workplane,
  // autoRiser, diameter, elevation) and sidebar tabs are never touched.
  function handleEscape(drawingTool) {
    // (1) Typing guard.
    if (api.isHudTyping?.()) return 'typing';
    const active = document.activeElement;
    if (active && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)) {
      active.blur();
      return 'typing';
    }
    // (2) Cancel in-progress capture.
    if (drawingTool.activePoints.length > 0) {
      drawingTool.cancelCurrentRun();
      api.updateUndoRedoButtons(drawingTool);
      return 'cancel-run';
    }
    if (drawingTool.isPickElevationActive) {
      drawingTool.isPickElevationActive = false;
      els.btnPickElevation?.classList.remove('active');
      els.statusText.textContent = 'Elevation eyedropper cancelled';
      return 'cancel-pick';
    }
    // (3) Clear selection.
    if (state.selectedRunId !== null && state.selectedRunId !== undefined) {
      state.selectedRunId = null;
      drawingTool.selectedRunId = null;
      drawingTool.renderRuns(state.network);
      api.renderRunsList(drawingTool);
      return 'clear-selection';
    }
    // (4) Stand down trace tools; sticky prefs untouched.
    drawingTool.isDrawingMode = false;
    drawingTool.isOrthoActive = false;
    drawingTool.isPerpendicularActive = false;
    els.btnDrawMode?.classList.remove('active');
    els.btnOrtho?.classList.remove('active');
    els.btnPerp?.classList.remove('active');
    api.updateUndoRedoButtons(drawingTool);
    els.statusText.textContent = 'Trace off: look around. Click Trace to place pipe';
    return 'stand-down';
  }

  function wireProjectControls(drawingTool) {
    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) {
        // Drive-by fix: the old guard swallowed Escape (and Enter/v/z)
        // while typing. Let Escape route through the precedence chain so
        // step 1 can blur; other shortcuts stay inert while typing.
        if (e.key === 'Escape') {
          e.preventDefault();
          handleEscape(drawingTool);
        }
        return;
      }

      if ((e.key.toLowerCase() === 'v' || e.key.toLowerCase() === 'z') && !e.ctrlKey) {
        drawingTool.isPerpendicularActive = !drawingTool.isPerpendicularActive;
        els.btnPerp.classList.toggle('active', drawingTool.isPerpendicularActive);
        els.statusText.textContent = drawingTool.isPerpendicularActive
          ? '⊥ Perpendicular to XY lock active (Vertical riser)'
          : 'Perpendicular lock released';
      } else if (e.key === 'Backspace' && !['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) {
        if (drawingTool.activePoints.length > 0) {
          drawingTool.undoLastPoint();
          api.updateUndoRedoButtons(drawingTool);
        }
      } else if (e.key === 'Enter') {
        const system = els.topSystemSelect?.value || 'Power';
        drawingTool.finishCurrentRun(() => state.network, (n) => { state.network = n; }, system);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        const outcome = handleEscape(drawingTool);
        if (outcome === 'cancel-run') {
          engine.highlighter?.clear('select')?.catch(() => {});
        }
      } else if (e.ctrlKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          if (state.commandStack.canRedo()) state.commandStack.redo();
        } else {
          if (drawingTool.activePoints.length > 0) {
            drawingTool.undoLastPoint();
            api.updateUndoRedoButtons(drawingTool);
          } else if (state.commandStack.canUndo()) {
            state.commandStack.undo();
          }
        }
      } else if (e.ctrlKey && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        if (state.commandStack.canRedo()) state.commandStack.redo();
      }
    });

    // Persistence: Save Project (.conduit.json)
    els.btnSave.addEventListener('click', () => {
      const json = serializeProject({
        network: state.network,
        markers: state.markerStore.getAll(),
        diameters: state.diameterRegistry.getAll(),
        sourceModel: state.sourceModel,
        settings: state.settings,
      });
      const filename = `${state.sourceModel.name || 'project'}.conduit.json`;
      downloadFile(json, filename, 'application/json');
      els.statusText.textContent = `Saved project to ${filename}`;
    });

    // Persistence: Load Project (.conduit.json)
    els.btnLoadProject.addEventListener('click', () => els.projectFileInput.click());

    els.projectFileInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const proj = deserializeProject(text);

        // Verify SHA-256 hash against current loaded model if one is open
        if (state.sourceModel.buffer && proj.sourceModel?.sha256) {
          const matches = await verifySourceHash(state.sourceModel.buffer, proj.sourceModel.sha256);
          if (!matches) {
            alert('⚠️ Warning: The source IFC file hash does not match the file this project was created with!');
          }
        }

        // Restore project network and settings
        state.network = backend.createNetwork();
        if (Array.isArray(proj.network?.nodes)) {
          state.network.nodes = [...proj.network.nodes];
        } else if (proj.network?.nodes && typeof proj.network.nodes === 'object') {
          state.network.nodes = Object.values(proj.network.nodes);
        }

        if (Array.isArray(proj.network?.runs)) {
          state.network.runs = [...proj.network.runs];
        } else if (proj.network?.runs && typeof proj.network.runs === 'object') {
          state.network.runs = Object.values(proj.network.runs);
        }

        state.settings = { ...state.settings, ...proj.settings };
        els.wasteFactorInput.value = Math.round(state.settings.wasteFactor * 100);

        drawingTool.renderRuns(state.network);
        api.renderRunsList(drawingTool);
        api.renderSummary();

        els.statusText.textContent = `Opened project ${file.name} successfully.`;
      } catch (err) {
        console.error('[Conduit Takeoff] Error reading project file:', err);
        alert(`Could not load project: ${err.message}`);
      }
    });

    // Export CSV
    els.btnExportCsv.addEventListener('click', () => {
      const takeoff = backend.computeTakeoff(state.network);

      const csvContent = exportCompleteCsv({
        runs: takeoff.runs,
        summary: takeoff.bySize,
        markers: state.markerStore.getAll(),
        unit: state.settings.unit,
        wasteFactor: state.settings.wasteFactor,
      });

      const filename = `${state.sourceModel.name || 'conduit'}_takeoff.csv`;
      downloadFile(csvContent, filename, 'text/csv');
      els.statusText.textContent = `Exported takeoff CSV to ${filename}`;
    });

    // Export Overlay IFC
    els.btnExportIfc.addEventListener('click', () => {
      const ifcContent = exportOverlayIfc({
        runs: state.network.runs,
        nodes: state.network.nodes,
        schema: state.sourceModel.schema || 'IFC4',
        projectName: `${state.sourceModel.name || 'Project'} Conduit Overlay`,
      });

      const filename = `${state.sourceModel.name || 'conduit'}_overlay.ifc`;
      downloadFile(ifcContent, filename, 'application/x-step');
      els.statusText.textContent = `Exported overlay IFC to ${filename}`;
    });
  }

  api.downloadFile = downloadFile;

  return { downloadFile, handleEscape, wireProjectControls };
}
