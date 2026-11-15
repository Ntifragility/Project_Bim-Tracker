// conduit-takeoff/src/ui/runs-list.js — per-run rows panel.
//
// Owns (conduit-ui-split module 5): `renderRunsList` — per-run rows,
// length/sticks/segments, select/delete, count badge. Registers
// `api.renderRunsList` on the coordinator for cross-module use.

// Compute fns come from `state.backend` (../backend.js factory); the static
// import below is the JS fallback for tests that build state without one.

export function createRunsList({ state, els, api }) {
  const backend = state.backend;
  function renderRunsList(drawingTool) {
    const runs = Object.values(state.network.runs);
    els.runsCountBadge.textContent = runs.length;

    if (runs.length === 0) {
      els.runList.innerHTML = '<p class="text-muted">No runs drawn yet. Click on the 3D model to begin tracing.</p>';
      els.btnSave.disabled = true;
      els.btnExportCsv.disabled = true;
      els.btnExportIfc.disabled = true;
      return;
    }

    els.btnSave.disabled = false;
    els.btnExportCsv.disabled = false;
    els.btnExportIfc.disabled = false;
    els.runList.innerHTML = '';

    // Initialize checkedRunIds for selective export (Option B / C)
    if (!state.checkedRunIds) state.checkedRunIds = new Set();
    const existingRunIds = new Set(runs.map((r) => r.id));
    for (const id of state.checkedRunIds) {
      if (!existingRunIds.has(id)) state.checkedRunIds.delete(id);
    }
    if (state.checkedRunIds.size === 0 && runs.length > 0) {
      for (const run of runs) state.checkedRunIds.add(run.id);
    }

    // Top selection toolbar for selective export
    const allChecked = runs.length > 0 && runs.every((r) => state.checkedRunIds.has(r.id));
    const checkedCount = runs.filter((r) => state.checkedRunIds.has(r.id)).length;
    const toolbar = document.createElement('div');
    toolbar.className = 'runs-list-toolbar';
    toolbar.innerHTML = `
      <label class="runs-select-all-label" title="Select or deselect all runs for IFC export">
        <input type="checkbox" id="runs-select-all-checkbox" ${allChecked ? 'checked' : ''} />
        <span>Export: <strong>${checkedCount}/${runs.length}</strong> checked</span>
      </label>
      <button type="button" class="btn-export-quick-btn" title="Open Selective IFC Export Dialog">Export IFC 📦</button>
    `;

    const selectAllCheckbox = toolbar.querySelector('#runs-select-all-checkbox');
    selectAllCheckbox.addEventListener('change', () => {
      if (selectAllCheckbox.checked) {
        for (const run of runs) state.checkedRunIds.add(run.id);
      } else {
        state.checkedRunIds.clear();
      }
      renderRunsList(drawingTool);
      api.updateExportDialogCounts?.();
    });

    const quickExportBtn = toolbar.querySelector('.btn-export-quick-btn');
    quickExportBtn.addEventListener('click', () => {
      api.openExportIfcDialog?.();
    });

    els.runList.appendChild(toolbar);

    for (const run of runs) {
      const takeoff = backend.computeRunTakeoff(state.network, run.id);
      const color = state.diameterRegistry.getColor(run.size);
      const isSelected = state.selectedRunId === run.id;
      const isChecked = state.checkedRunIds.has(run.id);

      const runNodes = (run.nodeIds || []).map((nid) => backend.nodeById(state.network, nid)).filter(Boolean);
      const bendAnalysis = backend.analyzeRunBends(runNodes);

      const card = document.createElement('div');
      card.className = `run-item-card ${isSelected ? 'selected' : ''}`;
      card.innerHTML = `
        <div class="run-item-header">
          <label class="run-item-check-label" title="Check to include in IFC export" onclick="event.stopPropagation()">
            <input type="checkbox" class="run-item-checkbox" data-run-id="${run.id}" ${isChecked ? 'checked' : ''} />
          </label>
          <span class="run-item-title">
            <span class="diameter-color-swatch" style="background: ${color}; color: ${color}"></span>
            <span>${run.name || `Run ${run.id}`} (${run.size})</span>
          </span>
          <button class="run-item-del-btn" title="Delete run">🗑</button>
        </div>
        <div class="run-item-stats">
          <span>${takeoff ? takeoff.length.toFixed(2) : '0'} m (${takeoff ? (takeoff.length / 0.3048).toFixed(1) : '0'} ft)</span>
          <span>${takeoff ? takeoff.sticks : 0} sticks</span>
          <span class="nec-bend-badge ${bendAnalysis.exceedsNec360 ? 'nec-warning' : 'nec-ok'}" title="${bendAnalysis.warning || 'Compliant with NEC 360° bend limit'}">
            ${bendAnalysis.totalDegrees}° bends
          </span>
        </div>
      `;

      // Checkbox for selective IFC export (Option B)
      const checkInput = card.querySelector('.run-item-checkbox');
      checkInput.addEventListener('change', (e) => {
        e.stopPropagation();
        if (checkInput.checked) {
          state.checkedRunIds.add(run.id);
        } else {
          state.checkedRunIds.delete(run.id);
        }
        renderRunsList(drawingTool);
        api.updateExportDialogCounts?.();
      });

      // Click to select/focus run in 3D
      card.addEventListener('click', (e) => {
        if (e.target.closest('.run-item-del-btn') || e.target.closest('.run-item-check-label')) return;
        state.selectedRunId = isSelected ? null : run.id;
        drawingTool.selectedRunId = state.selectedRunId;
        drawingTool.renderRuns(state.network);
        renderRunsList(drawingTool);
        if (state.selectedRunId) {
          api.showContextual?.('modify-run');
          api.switchDockTab?.('properties');
        } else if (!drawingTool.isDrawingMode && (!drawingTool.activePoints || drawingTool.activePoints.length === 0)) {
          api.hideContextual?.();
        }
        api.updatePropertiesPalette?.(state.selectedRunId);
        api.refreshRibbon?.();
      });

      if (isSelected) {
        requestAnimationFrame(() => {
          card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
      }

      // Delete run
      const delBtn = card.querySelector('.run-item-del-btn');
      delBtn.addEventListener('click', () => {
        const prevNet = state.network;
        const nextNet = backend.deleteRun(prevNet, run.id);

        const deleteCmd = {
          description: `Delete ${run.name || run.id}`,
          execute() {
            state.network = nextNet;
            if (state.selectedRunId === run.id) {
              state.selectedRunId = null;
              if (!drawingTool.isDrawingMode && (!drawingTool.activePoints || drawingTool.activePoints.length === 0)) {
                api.hideContextual?.();
              }
              api.refreshRibbon?.();
            }
            drawingTool.renderRuns(state.network);
            renderRunsList(drawingTool);
            api.renderSummary();
            api.updatePropertiesPalette?.(state.selectedRunId);
          },
          undo() {
            state.network = prevNet;
            drawingTool.renderRuns(state.network);
            renderRunsList(drawingTool);
            api.renderSummary();
            api.updatePropertiesPalette?.(state.selectedRunId);
          },
        };

        state.commandStack.execute(deleteCmd);
      });

      els.runList.appendChild(card);
    }
  }

  api.renderRunsList = renderRunsList;

  return { renderRunsList };
}
