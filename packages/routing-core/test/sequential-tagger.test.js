import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatSequentialTag,
  allocateSequentialTags,
  compareNaturalTags,
} from '../../../src/tagging/sequential-tagger.js';

describe('Cable Tray Sequential Tagger (Fixed + Variable)', () => {
  it('allocates Fixed + Variable sequential tags, skips collisions, and sorts naturally', () => {
    assert.equal(formatSequentialTag('CT01.01.', 1, 2), 'CT01.01.01');
    assert.equal(formatSequentialTag('BC-101-', 12, 3), 'BC-101-012');

    const elements = [{ localId: 10 }, { localId: 20 }, { localId: 30 }];
    const res = allocateSequentialTags({
      elements,
      prefix: 'CT01.01.',
      startSequence: 1,
      digits: 2,
      existingTags: ['CT01.01.02'],
    });
    assert.equal(res.valid, true);
    assert.deepEqual(
      res.assignments.map((a) => a.elementTag),
      ['CT01.01.01', 'CT01.01.03', 'CT01.01.04'],
    );
    assert.equal(res.nextSequence, 5);

    const sorted = ['CT01.01.10', 'CT01.01.02', 'CT01.01.01'].sort(compareNaturalTags);
    assert.deepEqual(sorted, ['CT01.01.01', 'CT01.01.02', 'CT01.01.10']);
  });
});
