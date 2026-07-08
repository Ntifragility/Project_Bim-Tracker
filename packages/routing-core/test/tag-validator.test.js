import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTagIntegrity } from '../../../src/ifc/tag-validator.js';

test('accepts unique matched IFC and Excel tags', () => {
  const result = validateTagIntegrity({
    elements: [{ localId: 1, systemTag: ' CT-001 ', componentId: 'CT-001-C001' }],
    excelTags: [{ rowNumber: 2, tag: 'ct-001' }],
  });
  assert.equal(result.valid, true);
  assert.equal(result.counts.matchedTags, 1);
  assert.equal(result.warnings.length, 0);
});

test('allows repeated system tags but blocks duplicate component IDs, duplicate Excel tags, and blanks', () => {
  const result = validateTagIntegrity({
    elements: [
      { localId: 1, systemTag: 'CT-001', componentId: 'CT-001-C001' },
      { localId: 2, systemTag: 'ct-001', componentId: 'ct-001-c001' },
    ],
    excelTags: [
      { rowNumber: 2, tag: 'CT-001' },
      { rowNumber: 3, tag: ' ct-001 ' },
      { rowNumber: 4, tag: ' ' },
    ],
  });
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors.map((issue) => issue.code), [
    'duplicate-component-id',
    'duplicate-excel-tag',
    'blank-excel-tag',
  ]);
});

test('reports unmatched tags as non-blocking warnings', () => {
  const result = validateTagIntegrity({
    elements: [{ localId: 1, systemTag: 'IFC-ONLY', componentId: 'IFC-ONLY-C001' }],
    excelTags: [{ rowNumber: 2, tag: 'EXCEL-ONLY' }],
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.warnings.map((issue) => issue.code), [
    'unassigned-excel-tags',
    'ifc-tags-missing-from-excel',
  ]);
});
