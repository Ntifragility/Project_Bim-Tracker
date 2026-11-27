import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { exportTrayScheduleExcelBytes, readWorkbook } from 'excel-io';

describe('Cable Tray Excel Schedule (TAG UNICO / ANCHO / LONGITUD)', () => {
  it('exports Excel workbook with exact TAG UNICO, ANCHO, LONGITUD columns on Bandejas sheet', () => {
    const bytes = exportTrayScheduleExcelBytes(
      [
        { tagUnico: 'CT01.01.01', ancho: 300, longitud: 3.0 },
        { tagUnico: 'CT01.01.02', ancho: 300, longitud: 1.45 },
      ],
      [
        { 'TAG UNICO': 'CT01.01.01', IFC_Type: 'IFCCABLECARRIERSEGMENT', Local_ID: 10 },
        { 'TAG UNICO': 'CT01.01.02', IFC_Type: 'IFCCABLECARRIERFITTING', Local_ID: 20 },
      ],
    );

    assert.ok(bytes instanceof Uint8Array && bytes.byteLength > 500);
    const wb = readWorkbook(bytes);
    assert.deepEqual(wb.sheetNames, ['Bandejas', 'Detalle']);

    const rows = wb.readSheet('Bandejas');
    assert.equal(rows.length, 2);
    assert.deepEqual(Object.keys(rows[0]), ['TAG UNICO', 'ANCHO', 'LONGITUD']);
    assert.equal(rows[0]['TAG UNICO'], 'CT01.01.01');
    assert.equal(rows[0]['ANCHO'], 300);
    assert.equal(rows[0]['LONGITUD'], 3);
    assert.equal(rows[1]['LONGITUD'], 1.45);
  });
});
