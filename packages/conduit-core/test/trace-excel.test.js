import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {
  exportOverlayIfc,
  extractConduitTracesFromStep,
  buildTracesFromNetwork,
  exportTracesToExcelBytes,
} from '../src/index.js';

describe('Conduit Multi-Trace IFC Grouping -> Excel (.xlsx) Schedule', () => {
  it('roundtrips 3 separate multi-segment traces in 1 IFC into 3 grouped Excel rows + Summary sheet', () => {
    const nodes = {
      a1: { id: 'a1', x: 0, y: 0, z: 3 },
      a2: { id: 'a2', x: 6, y: 0, z: 3 },
      a3: { id: 'a3', x: 6, y: 4, z: 3 },
      b1: { id: 'b1', x: 10, y: 0, z: 3 },
      b2: { id: 'b2', x: 15, y: 0, z: 3 },
      c1: { id: 'c1', x: 0, y: 10, z: 4 },
      c2: { id: 'c2', x: 8, y: 10, z: 4 },
    };
    const runs = [
      { id: 'r1', name: 'Run 1', tag: 'C-PWR-01', size: '3/4"', system: 'Power', color: '#f59e0b', comments: 'MCC to Panel A', nodeIds: ['a1', 'a2', 'a3'] },
      { id: 'r2', name: 'Run 2', tag: 'C-PWR-02', size: '3/4"', system: 'Power', color: '#f59e0b', comments: 'Panel A to Pump 1', nodeIds: ['b1', 'b2'] },
      { id: 'r3', name: 'Run 3', tag: 'C-LTG-01', size: '1/2"', system: 'Lighting', color: '#3b82f6', comments: 'Bay B lights', nodeIds: ['c1', 'c2'] },
    ];

    // 1. Export all 3 multi-segment traces into ONE single IFC
    const ifcStep = exportOverlayIfc({
      runs,
      nodes,
      schema: 'IFC4',
      getRunColor: (r) => r.color,
    });

    // 2. Re-extract grouped traces from that single IFC -> exactly 3 traces (NOT raw segments)
    const extracted = extractConduitTracesFromStep(ifcStep);
    assert.equal(extracted.length, 3);
    assert.equal(extracted[0].tag, 'C-PWR-01');
    assert.equal(extracted[0].totalLengthM, 10);
    assert.equal(extracted[0].colorHex, '#f59e0b');
    assert.equal(extracted[0].comments, 'MCC to Panel A');
    assert.equal(extracted[1].tag, 'C-PWR-02');
    assert.equal(extracted[1].totalLengthM, 5);
    assert.equal(extracted[2].tag, 'C-LTG-01');
    assert.equal(extracted[2].system, 'Lighting');
    assert.equal(extracted[2].colorHex, '#3b82f6');

    // 3. Direct network builder matches extracted IFC totals
    const liveTraces = buildTracesFromNetwork({ runs, nodes, getRunColor: (r) => r.color });
    assert.equal(liveTraces.length, 3);
    assert.equal(liveTraces[0].totalLengthM, extracted[0].totalLengthM);

    // 4. Generate Excel (.xlsx) workbook and read back both sheets
    const xlsxBytes = exportTracesToExcelBytes(extracted, { wasteFactor: 0.1 });
    assert.ok(xlsxBytes instanceof Uint8Array && xlsxBytes.byteLength > 500);

    const wb = XLSX.read(xlsxBytes, { type: 'array' });
    assert.deepEqual(wb.SheetNames, ['Conduit Traces', 'Summary by Size']);

    const traceRows = XLSX.utils.sheet_to_json(wb.Sheets['Conduit Traces']);
    assert.equal(traceRows.length, 3);
    assert.equal(traceRows[0]['Tag'], 'C-PWR-01');
    assert.equal(traceRows[0]['Total Length (m)'], 10);
    assert.equal(traceRows[2]['Tag'], 'C-LTG-01');

    const summaryRows = XLSX.utils.sheet_to_json(wb.Sheets['Summary by Size']);
    assert.equal(summaryRows.length, 2); // Power 3/4" (2 traces = 15m) + Lighting 1/2" (1 trace = 8m)
    const pwrRow = summaryRows.find((r) => r['System'] === 'Power' && r['Size'] === '3/4"');
    assert.equal(pwrRow['Trace Count'], 2);
    assert.equal(pwrRow['Net Length (m)'], 15);
  });
});
