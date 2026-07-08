import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTagIntegrity } from '../../../src/ifc/tag-validator.js';

test('accepts unique matched IFC and Excel tags', () => {
  const result = validateTagIntegrity({
    elements: [{ localId: 1, tag: ' CT-001 ' }],
    excelTags: [{ rowNumber: 2, tag: 'ct-001' }],
  });
  assert.equal(result.valid, true);
  assert.equal(result.counts.matchedTags, 1);
  assert.equal(result.warnings.length, 0);
});

test('blocks duplicate IFC tags, duplicate Excel tags, and blank Excel tags', () => {
  const result = validateTagIntegrity({
    elements: [{ localId: 1, tag: 'CT-001' }, { localId: 2, tag: 'ct-001' }],
    excelTags: [
      { rowNumber: 2, tag: 'CT-001' },
      { rowNumber: 3, tag: ' ct-001 ' },
      { rowNumber: 4, tag: ' ' },
    ],
  });
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors.map((issue) => issue.code), [
    'duplicate-ifc-tag',
    'duplicate-excel-tag',
    'blank-excel-tag',
  ]);
});

test('reports unmatched tags as non-blocking warnings', () => {
  const result = validateTagIntegrity({
    elements: [{ localId: 1, tag: 'IFC-ONLY' }],
    excelTags: [{ rowNumber: 2, tag: 'EXCEL-ONLY' }],
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.warnings.map((issue) => issue.code), [
    'unassigned-excel-tags',
    'ifc-tags-missing-from-excel',
  ]);
});
