import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { exportTrayScheduleExcelBytes, readWorkbook } from 'excel-io';

describe('Cable Tray Excel Schedule (11-column formatted table with REV & ROUNDUP METRADO)', () => {
  it('exports Excel workbook with exact 11 columns (PLANO, REV, UNIQUE TAG, TENSION, ESC/ACC, SYSTEM TAG, ANCHO, SUB_TIPO, TIPO DE MATERIAL, DESCRIPCION DE MATERIAL, METRADO), AutoFilter, and ROUNDUP(..., 1)', () => {
    const bytes = exportTrayScheduleExcelBytes(
      [
        {
          plano: 'E-301',
          rev: '0',
          uniqueTag: 'CT01.01.01',
          tension: 'MT',
          escAcc: 'Bandeja',
          systemTag: 'CT01.01',
          ancho: 300,
          subTipo: 'ESCALERILLA',
          tipoMaterial: 'GALVANIZADO',
          descripcionMaterial: 'BANDEJA TIPO ESCALERILLA',
          metrado: 3.01,
        },
        {
          plano: 'E-301',
          rev: 'A',
          uniqueTag: 'CT01.02.01',
          tension: 'BT',
          escAcc: 'Accesorio',
          systemTag: 'CT01.02',
          ancho: 300,
          subTipo: 'CURVA 90',
          tipoMaterial: 'FRP',
          descripcionMaterial: 'CURVA HORIZONTAL 90°',
          metrado: 1.42,
        },
      ],
      [
        { 'UNIQUE TAG': 'CT01.01.01', PLANO: 'E-301', REV: '0', SUB_TIPO: 'ESCALERILLA', IFC_Type: 'IFCCABLECARRIERSEGMENT', Local_ID: 10 },
        { 'UNIQUE TAG': 'CT01.02.01', PLANO: 'E-301', REV: 'A', SUB_TIPO: 'CURVA 90', IFC_Type: 'IFCCABLECARRIERFITTING', Local_ID: 20 },
      ],
    );

    assert.ok(bytes instanceof Uint8Array && bytes.byteLength > 500);
    const wb = readWorkbook(bytes);
    assert.deepEqual(wb.sheetNames, ['Bandejas', 'Detalle']);

    const ws = wb.raw.Sheets['Bandejas'];
    assert.equal(ws['!autofilter']?.ref, 'A1:K3');
    assert.equal(ws['K2']?.f, 'ROUNDUP(3.1,1)');
    assert.equal(ws['K3']?.f, 'ROUNDUP(1.5,1)');

    const rows = wb.readSheet('Bandejas');
    assert.equal(rows.length, 2);
    assert.deepEqual(Object.keys(rows[0]), [
      'PLANO',
      'REV',
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
    assert.equal(rows[0]['REV'], '0');
    assert.equal(rows[0]['UNIQUE TAG'], 'CT01.01.01');
    assert.equal(rows[0]['TENSION'], 'MT');
    assert.equal(rows[0]['ESC/ACC'], 'Bandeja');
    assert.equal(rows[0]['SYSTEM TAG'], 'CT01.01');
    assert.equal(rows[0]['ANCHO'], 300);
    assert.equal(rows[0]['SUB_TIPO'], 'ESCALERILLA');
    assert.equal(rows[0]['TIPO DE MATERIAL'], 'GALVANIZADO');
    assert.equal(rows[0]['DESCRIPCION DE MATERIAL'], 'BANDEJA TIPO ESCALERILLA');
    assert.equal(rows[0]['METRADO'], 3.1);
    assert.equal(rows[1]['REV'], 'A');
    assert.equal(rows[1]['METRADO'], 1.5);
    assert.equal(rows[1]['ESC/ACC'], 'Accesorio');
    assert.equal(rows[1]['TIPO DE MATERIAL'], 'FRP');
  });
});
