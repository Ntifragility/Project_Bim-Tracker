import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { exportTrayScheduleExcelBytes, readWorkbook } from 'excel-io';

describe('Cable Tray Excel Schedule (10-column engineering schedule)', () => {
  it('exports Excel workbook with exact PLANO, UNIQUE TAG, TENSION, ESC/ACC, SYSTEM TAG, ANCHO, SUB_TIPO, TIPO DE MATERIAL, DESCRIPCION DE MATERIAL, METRADO columns on Bandejas sheet', () => {
    const bytes = exportTrayScheduleExcelBytes(
      [
        {
          plano: 'E-301',
          uniqueTag: 'CT01.01.01',
          tension: 'MT / 22.9kV',
          escAcc: 'ESC',
          systemTag: 'CT01.01',
          ancho: 300,
          subTipo: 'ESCALERILLA',
          tipoMaterial: 'F°G°',
          descripcionMaterial: 'BANDEJA TIPO ESCALERILLA',
          metrado: 3.0,
        },
        {
          plano: 'E-301',
          uniqueTag: 'CT01.01.02',
          tension: 'MT / 22.9kV',
          escAcc: 'ACC',
          systemTag: 'CT01.01',
          ancho: 300,
          subTipo: 'CURVA 90',
          tipoMaterial: 'F°G°',
          descripcionMaterial: 'CURVA HORIZONTAL 90°',
          metrado: 1.45,
        },
      ],
      [
        { 'UNIQUE TAG': 'CT01.01.01', PLANO: 'E-301', SUB_TIPO: 'ESCALERILLA', IFC_Type: 'IFCCABLECARRIERSEGMENT', Local_ID: 10 },
        { 'UNIQUE TAG': 'CT01.01.02', PLANO: 'E-301', SUB_TIPO: 'CURVA 90', IFC_Type: 'IFCCABLECARRIERFITTING', Local_ID: 20 },
      ],
    );

    assert.ok(bytes instanceof Uint8Array && bytes.byteLength > 500);
    const wb = readWorkbook(bytes);
    assert.deepEqual(wb.sheetNames, ['Bandejas', 'Detalle']);

    const rows = wb.readSheet('Bandejas');
    assert.equal(rows.length, 2);
    assert.deepEqual(Object.keys(rows[0]), [
      'PLANO',
      'UNIQUE TAG',
      'TENSION',
      'ESC/ACC',
      'SYSTEM TAG',
      'ANCHO',
      'SUB_TIPO',
      'TIPO DE MATERIAL',
      'DESCRIPCION DE MATERIAL',
      'METRADO',
    ]);
    assert.equal(rows[0]['PLANO'], 'E-301');
    assert.equal(rows[0]['UNIQUE TAG'], 'CT01.01.01');
    assert.equal(rows[0]['TENSION'], 'MT / 22.9kV');
    assert.equal(rows[0]['ESC/ACC'], 'ESC');
    assert.equal(rows[0]['SYSTEM TAG'], 'CT01.01');
    assert.equal(rows[0]['ANCHO'], 300);
    assert.equal(rows[0]['SUB_TIPO'], 'ESCALERILLA');
    assert.equal(rows[0]['TIPO DE MATERIAL'], 'F°G°');
    assert.equal(rows[0]['DESCRIPCION DE MATERIAL'], 'BANDEJA TIPO ESCALERILLA');
    assert.equal(rows[0]['METRADO'], 3);
    assert.equal(rows[1]['METRADO'], 1.45);
    assert.equal(rows[1]['SUB_TIPO'], 'CURVA 90');
    assert.equal(rows[1]['ESC/ACC'], 'ACC');
    assert.equal(rows[1]['DESCRIPCION DE MATERIAL'], 'CURVA HORIZONTAL 90°');
  });
});
