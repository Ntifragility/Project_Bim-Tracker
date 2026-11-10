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

    for (const run of runs) {
      const takeoff = backend.computeRunTakeoff(state.network, run.id);
      const color = state.diameterRegistry.getColor(run.size);
      const isSelected = state.selectedRunId === run.id;

      const runNodes = (run.nodeIds || []).map((nid) => backend.nodeById(state.network, nid)).filter(Boolean);
      const bendAnalysis = backend.analyzeRunBends(runNodes);

      const card = document.createElement('div');
      card.className = `run-item-card ${isSelected ? 'selected' : ''}`;
      card.innerHTML = `
        <div class="run-item-header">
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

      // Click to select
      card.addEventListener('click', (e) => {
        if (e.target.closest('.run-item-del-btn')) return;
        state.selectedRunId = isSelected ? null : run.id;
        drawingTool.selectedRunId = state.selectedRunId;
        drawingTool.renderRuns(state.network);
        renderRunsList(drawingTool);
        if (state.selectedRunId) {
          api.showContextual?.('modify-run');
        } else if (!drawingTool.isDrawingMode && (!drawingTool.activePoints || drawingTool.activePoints.length === 0)) {
          api.hideContextual?.();
        }
        api.refreshRibbon?.();
      });

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
          },
          undo() {
            state.network = prevNet;
            drawingTool.renderRuns(state.network);
            renderRunsList(drawingTool);
            api.renderSummary();
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
