import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allocateElementTags,
  formatElementTag,
  getSystemTag,
  parseGeneratedElementTag,
  validateTagScheme,
} from '../../../src/tagging/tag-scheme.js';
import { classifyTaggableElement } from '../../../src/tagging/element-classifier.js';

const scheme = {
  prefix: 'PT',
  system: '1',
  separator: '.',
  sequenceDigits: 2,
  startSequence: 1,
  typeCodes: { tray: '01', fitting: '02' },
};

test('formats the requested system and element tag pattern', () => {
  assert.equal(getSystemTag(scheme), 'PT1');
  assert.equal(formatElementTag({ systemTag: 'PT1', typeCode: '01', sequenceNumber: '03' }), 'PT1.01.03');
  assert.deepEqual(parseGeneratedElementTag('PT1.02.14', scheme), {
    systemTag: 'PT1', typeCode: '02', sequenceNumber: '14', sequence: 14,
  });
});

test('allocates independent sequences for trays and fittings', () => {
  const trays = allocateElementTags({
    elements: [{ localId: 1 }, { localId: 2 }, { localId: 3 }],
    elementKind: 'tray',
    scheme,
  });
  const fittings = allocateElementTags({
    elements: [{ localId: 4 }, { localId: 5 }],
    elementKind: 'fitting',
    scheme,
  });
  assert.deepEqual(trays.assignments.map((item) => item.elementTag), ['PT1.01.01', 'PT1.01.02', 'PT1.01.03']);
  assert.deepEqual(fittings.assignments.map((item) => item.elementTag), ['PT1.02.01', 'PT1.02.02']);
});

test('appends after existing tags without recycling sequence gaps', () => {
  const result = allocateElementTags({
    elements: [{ localId: 3 }],
    elementKind: 'tray',
    scheme,
    existingAssignments: [
      { componentId: 'PT1.01.01' },
      { componentId: 'PT1.01.03' },
    ],
  });
  assert.equal(result.assignments[0].elementTag, 'PT1.01.04');
});

test('blocks invalid schemes and sequence overflow', () => {
  assert.equal(validateTagScheme({ ...scheme, typeCodes: { tray: '01', fitting: '01' } }).valid, false);
  const result = allocateElementTags({
    elements: [{ localId: 100 }],
    elementKind: 'tray',
    scheme: { ...scheme, sequenceDigits: 2, startSequence: 99 },
    existingAssignments: [{ componentId: 'PT1.01.99' }],
  });
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /sequence is full/i);
});

test('classifies standard IFC classes and refuses ambiguous generic metadata', () => {
  assert.equal(classifyTaggableElement({ type: 'IfcCableCarrierSegment' }).kind, 'tray');
  assert.equal(classifyTaggableElement({ type: 'IfcCableCarrierFitting' }).kind, 'fitting');
  assert.equal(classifyTaggableElement({ type: 'IfcBuildingElementPart', name: 'Cable Tray with Fittings' }).kind, null);
});
