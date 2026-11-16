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
    const exportDialog = document.getElementById('export-ifc-dialog');
    if (exportDialog && !exportDialog.hidden) {
      exportDialog.hidden = true;
      return 'close-dialog';
    }
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
      if (!drawingTool.isDrawingMode && !state.selectedRunId) {
        api.hideContextual?.();
      }
      api.refreshRibbon?.();
      return 'cancel-run';
    }
    if (drawingTool.isPickElevationActive) {
      drawingTool.isPickElevationActive = false;
      els.btnPickElevation?.classList.remove('active');
      els.statusText.textContent = 'Elevation eyedropper cancelled';
      api.refreshRibbon?.();
      return 'cancel-pick';
    }
    // (3) Clear selection.
    if (state.selectedRunId !== null && state.selectedRunId !== undefined) {
      state.selectedRunId = null;
      drawingTool.selectedRunId = null;
      drawingTool.renderRuns(state.network);
      api.renderRunsList(drawingTool);
      if (!drawingTool.isDrawingMode && (!drawingTool.activePoints || drawingTool.activePoints.length === 0)) {
        api.hideContextual?.();
      }
      api.refreshRibbon?.();
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
    api.hideContextual?.();
    api.refreshRibbon?.();
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

      // Revizto-style Hide (Ctrl + H) and Unhide (Ctrl + Shift + H)
      if (e.ctrlKey && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        if (e.shiftKey) {
          engine.visibility?.unhideAll?.();
        } else {
          engine.visibility?.hideSelection?.();
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

    // Revit-Style Selective IFC Export Dialog (Option B & C)
    const exportDialog = document.getElementById('export-ifc-dialog');
    const exportCloseBtn = document.getElementById('export-dialog-close');
    const exportCancelBtn = document.getElementById('export-dialog-cancel');
    const exportConfirmBtn = document.getElementById('export-dialog-confirm');
    const exportSelectAllBtn = document.getElementById('btn-export-select-all');
    const exportDeselectAllBtn = document.getElementById('btn-export-deselect-all');
    const exportTableCheckAll = document.getElementById('export-table-check-all');
    const exportRunsTbody = document.getElementById('export-runs-tbody');
    const exportSchemaSelect = document.getElementById('export-ifc-schema');
    const exportFilenameInput = document.getElementById('export-ifc-filename');
    const exportSelectedCount = document.getElementById('export-selected-count');
    const exportAllCount = document.getElementById('export-all-count');

    function closeExportDialog() {
      if (exportDialog) exportDialog.hidden = true;
    }

    function updateExportDialogCounts() {
      const runs = Object.values(state.network.runs || {});
      const checkedCount = runs.filter((r) => state.checkedRunIds?.has(r.id)).length;
      if (exportSelectedCount) exportSelectedCount.textContent = checkedCount;
      if (exportAllCount) exportAllCount.textContent = runs.length;
      if (exportTableCheckAll) exportTableCheckAll.checked = runs.length > 0 && checkedCount === runs.length;

      // Update suggested filename dynamically if user hasn't heavily customized it
      if (exportFilenameInput) {
        const baseName = state.sourceModel.name || 'conduit';
        if (checkedCount === 1) {
          const singleId = Array.from(state.checkedRunIds || [])[0];
          exportFilenameInput.value = `${baseName}_run_${singleId}_overlay.ifc`;
        } else if (checkedCount === runs.length) {
          exportFilenameInput.value = `${baseName}_overlay.ifc`;
        } else {
          exportFilenameInput.value = `${baseName}_selected_traces.ifc`;
        }
      }
    }
    api.updateExportDialogCounts = updateExportDialogCounts;

    function renderExportTable() {
      if (!exportRunsTbody) return;
      exportRunsTbody.innerHTML = '';
      const runs = Object.values(state.network.runs || {});
      const backend = state.backend;

      for (const run of runs) {
        const takeoff = backend?.computeRunTakeoff?.(state.network, run.id);
        const color = state.diameterRegistry?.getColor?.(run.size) || '#f59e0b';
        const isChecked = state.checkedRunIds?.has(run.id);

        const runNodes = (run.nodeIds || []).map((nid) => backend?.nodeById?.(state.network, nid)).filter(Boolean);
        const bendAnalysis = backend?.analyzeRunBends?.(runNodes) || { totalDegrees: 0, exceedsNec360: false };

        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td style="text-align: center;">
            <input type="checkbox" class="export-row-checkbox" data-run-id="${run.id}" ${isChecked ? 'checked' : ''} />
          </td>
          <td>
            <span class="diameter-color-swatch" style="background: ${color}; display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 6px;"></span>
            <strong>${run.name || `Run ${run.id}`}</strong>
          </td>
          <td>${run.size}</td>
          <td>${takeoff ? takeoff.length.toFixed(2) : '0'} m (${takeoff ? (takeoff.length / 0.3048).toFixed(1) : '0'} ft)</td>
          <td>
            <span class="nec-bend-badge ${bendAnalysis.exceedsNec360 ? 'nec-warning' : 'nec-ok'}">
              ${bendAnalysis.totalDegrees}°
            </span>
          </td>
          <td>${takeoff ? takeoff.sticks : 0}</td>
        `;

        const rowCheckbox = tr.querySelector('.export-row-checkbox');
        rowCheckbox.addEventListener('change', () => {
          if (rowCheckbox.checked) {
            state.checkedRunIds?.add(run.id);
          } else {
            state.checkedRunIds?.delete(run.id);
          }
          updateExportDialogCounts();
          api.renderRunsList?.(drawingTool);
        });

        exportRunsTbody.appendChild(tr);
      }
      updateExportDialogCounts();
    }

    function openExportIfcDialog() {
      const runs = Object.values(state.network.runs || {});
      if (runs.length === 0) {
        els.statusText.textContent = 'No conduit runs drawn yet to export.';
        return;
      }
      if (!state.checkedRunIds) state.checkedRunIds = new Set();
      if (state.checkedRunIds.size === 0) {
        for (const run of runs) state.checkedRunIds.add(run.id);
      }
      renderExportTable();
      if (exportDialog) exportDialog.hidden = false;
    }
    api.openExportIfcDialog = openExportIfcDialog;

    if (exportCloseBtn) exportCloseBtn.addEventListener('click', closeExportDialog);
    if (exportCancelBtn) exportCancelBtn.addEventListener('click', closeExportDialog);

    if (exportSelectAllBtn) {
      exportSelectAllBtn.addEventListener('click', () => {
        const runs = Object.values(state.network.runs || {});
        for (const run of runs) state.checkedRunIds?.add(run.id);
        renderExportTable();
        api.renderRunsList?.(drawingTool);
      });
    }

    if (exportDeselectAllBtn) {
      exportDeselectAllBtn.addEventListener('click', () => {
        state.checkedRunIds?.clear();
        renderExportTable();
        api.renderRunsList?.(drawingTool);
      });
    }

    if (exportTableCheckAll) {
      exportTableCheckAll.addEventListener('change', () => {
        const runs = Object.values(state.network.runs || {});
        if (exportTableCheckAll.checked) {
          for (const run of runs) state.checkedRunIds?.add(run.id);
        } else {
          state.checkedRunIds?.clear();
        }
        renderExportTable();
        api.renderRunsList?.(drawingTool);
      });
    }

    if (exportConfirmBtn) {
      exportConfirmBtn.addEventListener('click', () => {
        const allRuns = Object.values(state.network.runs || {});
        const scopeMode = document.querySelector('input[name="export-scope-mode"]:checked')?.value || 'selected';
        let runsToExport = allRuns;

        if (scopeMode === 'selected') {
          runsToExport = allRuns.filter((r) => state.checkedRunIds?.has(r.id));
        }

        if (runsToExport.length === 0) {
          alert('Please select at least one conduit run to export.');
          return;
        }

        const selectedSchema = exportSchemaSelect?.value || state.sourceModel.schema || 'IFC4';
        const customFilename = exportFilenameInput?.value.trim() || `${state.sourceModel.name || 'conduit'}_overlay.ifc`;
        const coordMode = document.getElementById('export-ifc-coords')?.value || 'original';

        const colorMap = {};
        for (const r of runsToExport) {
          if (r.size && !colorMap[r.size]) {
            colorMap[r.size] = state.diameterRegistry?.getColor?.(r.size) || '#f59e0b';
          }
        }

        const toOriginalFn = coordMode === 'local'
          ? (pt) => ({ x: pt.x, y: -pt.z, z: pt.y })
          : (pt) => {
              if (typeof engine?.coordinates?.toOriginal === 'function') {
                return engine.coordinates.toOriginal(pt);
              }
              return { x: pt.x, y: -pt.z, z: pt.y };
            };

        const enrichedRuns = runsToExport.map((r) => {
          const takeoff = backend.computeRunTakeoff(state.network, r.id);
          return {
            ...r,
            length: takeoff?.length ?? r.length ?? 0,
          };
        });

        const ifcContent = exportOverlayIfc({
          runs: enrichedRuns,
          nodes: state.network.nodes,
          schema: selectedSchema,
          projectName: `${state.sourceModel.name || 'Project'} Conduit Overlay`,
          colorMap,
          toOriginal: toOriginalFn,
        });

        downloadFile(ifcContent, customFilename, 'application/x-step');
        closeExportDialog();
        els.statusText.textContent = `Exported ${runsToExport.length} conduit trace${runsToExport.length === 1 ? '' : 's'} to ${customFilename}`;
      });
    }

    // Export Overlay IFC button opens dialog
    els.btnExportIfc.addEventListener('click', () => {
      openExportIfcDialog();
    });
  }

  api.downloadFile = downloadFile;

  return { downloadFile, handleEscape, wireProjectControls };
}
