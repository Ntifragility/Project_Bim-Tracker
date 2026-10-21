import test from 'node:test';
import assert from 'node:assert/strict';
import { readWorkbook, writeWorkbookBytes } from '../src/index.js';

test('excel-io: writes and reads workbook sheets roundtrip', () => {
  const sampleRows = [
    { Tag: 'CT-001', System: 'TRAY-A', Elevation: 3.5 },
    { Tag: 'CT-002', System: 'TRAY-A', Elevation: 3.5 },
  ];

  const bytes = writeWorkbookBytes({
    'Tag Register': sampleRows,
  });

  assert.ok(bytes && bytes.byteLength > 0);

  const parsed = readWorkbook(bytes);
  assert.deepEqual(parsed.sheetNames, ['Tag Register']);

  const rows = parsed.readSheet('Tag Register');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].Tag, 'CT-001');
  assert.equal(rows[1].Tag, 'CT-002');
  assert.equal(rows[0].Elevation, 3.5);
});
