import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { exportTrayScheduleExcelBytes, readWorkbook } from 'excel-io';

describe('Cable Tray Excel Schedule (TAG UNICO / ANCHO / LONGITUD / PLANO / SUB_TIPO)', () => {
  it('exports Excel workbook with exact TAG UNICO, ANCHO, LONGITUD, PLANO, SUB_TIPO columns on Bandejas sheet', () => {
    const bytes = exportTrayScheduleExcelBytes(
      [
        { tagUnico: 'CT01.01.01', ancho: 300, longitud: 3.0, plano: 'E-301', subTipo: 'ESCALERILLA' },
        { tagUnico: 'CT01.01.02', ancho: 300, longitud: 1.45, plano: 'E-301', subTipo: 'CURVA 90' },
      ],
      [
        { 'TAG UNICO': 'CT01.01.01', PLANO: 'E-301', SUB_TIPO: 'ESCALERILLA', IFC_Type: 'IFCCABLECARRIERSEGMENT', Local_ID: 10 },
        { 'TAG UNICO': 'CT01.01.02', PLANO: 'E-301', SUB_TIPO: 'CURVA 90', IFC_Type: 'IFCCABLECARRIERFITTING', Local_ID: 20 },
      ],
    );

    assert.ok(bytes instanceof Uint8Array && bytes.byteLength > 500);
    const wb = readWorkbook(bytes);
    assert.deepEqual(wb.sheetNames, ['Bandejas', 'Detalle']);

    const rows = wb.readSheet('Bandejas');
    assert.equal(rows.length, 2);
    assert.deepEqual(Object.keys(rows[0]), ['TAG UNICO', 'ANCHO', 'LONGITUD', 'PLANO', 'SUB_TIPO']);
    assert.equal(rows[0]['TAG UNICO'], 'CT01.01.01');
    assert.equal(rows[0]['ANCHO'], 300);
    assert.equal(rows[0]['LONGITUD'], 3);
    assert.equal(rows[0]['PLANO'], 'E-301');
    assert.equal(rows[0]['SUB_TIPO'], 'ESCALERILLA');
    assert.equal(rows[1]['LONGITUD'], 1.45);
    assert.equal(rows[1]['SUB_TIPO'], 'CURVA 90');
  });
});
