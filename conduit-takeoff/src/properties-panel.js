// Revit-Style Properties Panel & Inspector for Conduit Runs
// Tracks run parameters, system types, stick counts, and cumulative NEC 360° bend limits.

import { analyzeRunBends } from '@conduit-core';

export function createPropertiesPanel({
  container = document.getElementById('run-list'),
  activeRunCard = document.getElementById('active-run-info'),
  diameterRegistry,
  onSelectRun,
  onDeleteRun,
  onChangeDiameter,
} = {}) {
  let runsData = [];
  let selectedRunId = null;

  /**
   * Update active in-progress run live statistics
   */
  function updateActiveRunStats({ points = [], lengthM = 0, stickLengthM = 3.048 }) {
    if (!activeRunCard) return;

    if (points.length < 2) {
      activeRunCard.hidden = true;
      return;
    }

    activeRunCard.hidden = false;

    const lenEl = activeRunCard.querySelector('#run-length');
    const sticksEl = activeRunCard.querySelector('#run-sticks');
    const segmentsEl = activeRunCard.querySelector('#run-segments');

    if (lenEl) lenEl.textContent = `${lengthM.toFixed(2)} m`;
    if (sticksEl) sticksEl.textContent = `${Math.ceil(lengthM / stickLengthM)}`;
    if (segmentsEl) segmentsEl.textContent = `${points.length - 1}`;

    // Cumulative bend calculation for in-progress run
    let bendStatEl = activeRunCard.querySelector('#run-bends-stat');
    if (!bendStatEl) {
      bendStatEl = document.createElement('div');
      bendStatEl.id = 'run-bends-stat';
      bendStatEl.className = 'run-stat';
      bendStatEl.innerHTML = `
        <span class="run-stat-label">Bends (NEC)</span>
        <span id="run-bends-val" class="run-stat-value">0°</span>
      `;
      activeRunCard.appendChild(bendStatEl);
    }

    const bendValEl = bendStatEl.querySelector('#run-bends-val');
    const analysis = analyzeRunBends(points);

    if (bendValEl) {
      bendValEl.textContent = `${analysis.totalDegrees}°`;
      if (analysis.exceedsNec360) {
        bendValEl.classList.add('text-danger');
        bendValEl.title = analysis.warning;
      } else {
        bendValEl.classList.remove('text-danger');
        bendValEl.title = 'Within NEC 360° pull limit';
      }
    }
  }

  /**
   * Render completed runs list with Revit-style properties inspection
   */
  function renderRuns(runs = []) {
    runsData = runs;
    if (!container) return;

    if (runs.length === 0) {
      container.innerHTML = `<p class="text-muted">No runs drawn yet. Click in the 3D viewport to trace conduit runs.</p>`;
      return;
    }

    container.innerHTML = '';

    runs.forEach((run, index) => {
      const isSelected = run.id === selectedRunId;
      const diameter = diameterRegistry?.getById(run.diameterId) || { label: '¾"', color: '#f59e0b' };
      const points = run.points || [];
      const analysis = analyzeRunBends(points);

      const card = document.createElement('div');
      card.className = `run-item-card ${isSelected ? 'selected' : ''}`;
      card.dataset.runId = run.id;

      card.innerHTML = `
        <div class="run-item-header">
          <div class="run-item-title">
            <span class="run-color-indicator" style="background-color: ${diameter.color};"></span>
            <strong>Run #${index + 1}</strong>
            <span class="run-size-badge">${diameter.label}</span>
          </div>
          <button class="btn btn-ghost btn-xs btn-delete-run" title="Delete run">🗑</button>
        </div>

        <div class="run-item-details">
          <div class="run-detail-row">
            <span>Length:</span>
            <strong>${(run.length || 0).toFixed(2)} m (${((run.length || 0) * 3.28084).toFixed(1)} ft)</strong>
          </div>
          <div class="run-detail-row">
            <span>Sticks (10ft):</span>
            <strong>${Math.ceil((run.length || 0) / 3.048)}</strong>
          </div>
          <div class="run-detail-row">
            <span>Bends:</span>
            <span class="nec-bend-badge ${analysis.exceedsNec360 ? 'nec-warning' : 'nec-ok'}" title="${analysis.warning || 'Compliant with NEC 360° limit'}">
              ${analysis.totalDegrees}° (${analysis.fittingsCount} fittings)
            </span>
          </div>
        </div>
      `;

      // Click to select run
      card.addEventListener('click', (e) => {
        if (e.target.closest('.btn-delete-run')) return;
        selectedRunId = isSelected ? null : run.id;
        renderRuns(runsData);
        if (typeof onSelectRun === 'function') {
          onSelectRun(selectedRunId);
        }
      });

      // Delete run
      const btnDelete = card.querySelector('.btn-delete-run');
      btnDelete.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof onDeleteRun === 'function') {
          onDeleteRun(run.id);
        }
      });

      container.appendChild(card);
    });
  }

  return {
    updateActiveRunStats,
    renderRuns,
    setSelectedRun(runId) {
      selectedRunId = runId;
      renderRuns(runsData);
    },
  };
}
