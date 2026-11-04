// conduit-takeoff/src/ui/summary.js — BOM-by-size summary table.
//
// Owns (conduit-ui-split module 6): `renderSummary` — BOM-by-size table,
// waste factor input, totals. Registers `api.renderSummary` on the
// coordinator for cross-module use.

// `computeTakeoff` comes from `state.backend`; `convertLength` is a pure
// unit helper that stays JS-side (presentation only).
import { convertLength } from '@conduit-core';

export function createSummary({ state, els, api }) {
  const backend = state.backend ?? { computeTakeoff: () => ({ bySize: [], totals: {} }) };
  function renderSummary() {
    const takeoff = backend.computeTakeoff(state.network);
    const bySize = takeoff.bySize || [];
    const totals = takeoff.totals || { runs: 0, length: 0, sticks: 0 };

    const wastePct = state.settings.wasteFactor;
    const unit = state.settings.unit;

    if (bySize.length === 0) {
      els.summaryTableContainer.innerHTML = '<p class="text-muted">Draw runs to see the summary.</p>';
      return;
    }

    let totalBaseLen = 0;
    let totalOrderLen = 0;

    let rowsHtml = '';
    for (const item of bySize) {
      const baseLen = convertLength(item.length, 'METRE', unit);
      const orderLen = baseLen * (1 + wastePct);
      totalBaseLen += baseLen;
      totalOrderLen += orderLen;

      const color = state.diameterRegistry.getColor(item.size);

      rowsHtml += `
        <tr>
          <td>
            <span style="display:inline-flex; align-items:center; gap:6px;">
              <span class="diameter-color-swatch" style="background:${color}; color:${color}"></span>
              <strong>${item.size}</strong>
            </span>
          </td>
          <td style="text-align:right;">${item.runs}</td>
          <td style="text-align:right;">${baseLen.toFixed(2)}</td>
          <td style="text-align:right;">${orderLen.toFixed(2)}</td>
          <td style="text-align:right; font-weight:700; color:var(--accent);">${item.sticks}</td>
        </tr>
      `;
    }

    els.summaryTableContainer.innerHTML = `
      <table class="summary-table">
        <thead>
          <tr>
            <th>Size</th>
            <th style="text-align:right;">Runs</th>
            <th style="text-align:right;">Base (${unit === 'FOOT' ? 'ft' : 'm'})</th>
            <th style="text-align:right;">Order</th>
            <th style="text-align:right;">Sticks</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
        <tfoot>
          <tr>
            <td>TOTAL</td>
            <td style="text-align:right;">${totals.runs}</td>
            <td style="text-align:right;">${totalBaseLen.toFixed(2)}</td>
            <td style="text-align:right;">${totalOrderLen.toFixed(2)}</td>
            <td style="text-align:right; font-size:1rem;">${totals.sticks}</td>
          </tr>
        </tfoot>
      </table>
    `;
  }

  function wireSummaryControls() {
    // Waste factor input change
    els.wasteFactorInput.addEventListener('input', (e) => {
      const val = Math.max(0, Math.min(100, Number(e.target.value) || 0));
      state.settings.wasteFactor = val / 100;
      renderSummary();
    });
  }

  api.renderSummary = renderSummary;

  return { renderSummary, wireSummaryControls };
}
