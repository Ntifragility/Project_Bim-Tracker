// CSV Exporter for conduit takeoff runs and summary tables.
// Formats columns with explicit units in headers and RFC 4180 CSV escaping.

import { formatLength, convertLength } from './coordinate-utils.js';

function escapeCsvField(val) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function formatRow(fields) {
  return fields.map(escapeCsvField).join(',');
}

export function exportRunsCsv({ runs = [], unit = 'METRE' }) {
  const rows = [
    formatRow(['Run ID', 'Diameter', 'System', `Length (${unit})`, 'Sticks (10ft)', 'Points Count', 'Notes']),
  ];

  for (const run of runs) {
    const lenConverted = convertLength(run.lengthM || run.length, 'METRE', unit);
    rows.push(
      formatRow([
        run.id,
        run.size || run.diameter || '',
        run.system || '',
        lenConverted.toFixed(3),
        run.sticks || 0,
        run.pointsCount || run.nodeIds?.length || 0,
        run.notes || '',
      ])
    );
  }

  return rows.join('\r\n');
}

export function exportSummaryCsv({ summary = [], markersSummary = {}, unit = 'METRE', wasteFactor = 0 }) {
  const rows = [
    '=== CONDUIT TAKEOFF SUMMARY ===',
    formatRow([
      'Diameter',
      'Run Count',
      `Base Length (${unit})`,
      'Waste %',
      `Order Length (${unit})`,
      'Total Sticks',
    ]),
  ];

  for (const item of summary) {
    const baseLen = convertLength(item.lengthM || item.length, 'METRE', unit);
    const orderLen = baseLen * (1 + wasteFactor);
    rows.push(
      formatRow([
        item.size || item.diameter,
        item.runCount || 0,
        baseLen.toFixed(3),
        `${(wasteFactor * 100).toFixed(0)}%`,
        orderLen.toFixed(3),
        item.sticks || 0,
      ])
    );
  }

  if (markersSummary && Object.keys(markersSummary).length > 0) {
    rows.push('');
    rows.push('=== FITTING & SUPPORT MARKERS ===');
    rows.push(formatRow(['Marker Type', 'Quantity']));
    for (const [type, count] of Object.entries(markersSummary)) {
      rows.push(formatRow([type, count]));
    }
  }

  return rows.join('\r\n');
}

export function exportCompleteCsv({ runs = [], summary = [], markers = [], unit = 'METRE', wasteFactor = 0 }) {
  const markerCounts = {};
  for (const m of markers) {
    markerCounts[m.type] = (markerCounts[m.type] || 0) + 1;
  }

  const summarySection = exportSummaryCsv({ summary, markersSummary: markerCounts, unit, wasteFactor });
  const runsSection = exportRunsCsv({ runs, unit });

  return `${summarySection}\r\n\r\n=== RUN DETAILS ===\r\n${runsSection}`;
}
