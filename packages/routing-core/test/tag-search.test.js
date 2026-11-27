import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  UNASSIGNED_FILTER,
  getDistinctPropertyValues,
  filterTaggedItems,
  buildModelIdMapFromItems,
} from '../../../src/tagging/tag-search.js';

describe('Cable Tray Buscador de TAGs (Revizto / Navisworks search & filters)', () => {
  const sample = [
    { modelId: 'm1', localId: 10, elementTag: 'PT1.01.10', plano: 'E-301', subTipo: 'ESCALERILLA', type: 'IFCCABLECARRIERSEGMENT' },
    { modelId: 'm1', localId: 2, elementTag: 'PT1.01.02', plano: 'E-301', subTipo: 'CURVA 90', type: 'IFCCABLECARRIERFITTING' },
    { modelId: 'm1', localId: 1, elementTag: 'PT1.01.01', plano: 'E-302', subTipo: '', type: 'IFCCABLECARRIERSEGMENT' },
    { modelId: 'm2', localId: 50, elementTag: '', plano: 'E-302', subTipo: 'TEE', type: 'IFCCABLECARRIERFITTING' },
  ];

  it('extracts sorted distinct PLANO and SUB_TIPO values', () => {
    assert.deepEqual(getDistinctPropertyValues(sample, 'plano'), ['E-301', 'E-302']);
    assert.deepEqual(getDistinctPropertyValues(sample, 'subTipo'), ['CURVA 90', 'ESCALERILLA', 'TEE']);
  });

  it('filters by multi-term AND query, PLANO, SUB_TIPO, and sorts naturally', () => {
    const all = filterTaggedItems(sample);
    assert.deepEqual(
      all.map((i) => i.elementTag || `#${i.localId}`),
      ['PT1.01.01', 'PT1.01.02', 'PT1.01.10', '#50'],
    );

    const multiTerm = filterTaggedItems(sample, { query: 'pt1.01 curva' });
    assert.equal(multiTerm.length, 1);
    assert.equal(multiTerm[0].elementTag, 'PT1.01.02');

    const byPlano = filterTaggedItems(sample, { planoFilter: 'E-301' });
    assert.deepEqual(byPlano.map((i) => i.elementTag), ['PT1.01.02', 'PT1.01.10']);

    const unassignedSubTipo = filterTaggedItems(sample, { subTipoFilter: UNASSIGNED_FILTER });
    assert.deepEqual(unassignedSubTipo.map((i) => i.elementTag), ['PT1.01.01']);

    const map = buildModelIdMapFromItems(byPlano);
    assert.deepEqual(Array.from(map.m1).sort((a, b) => a - b), [2, 10]);
  });
});
