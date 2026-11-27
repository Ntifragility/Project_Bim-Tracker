import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  UNASSIGNED_FILTER,
  getDistinctPropertyValues,
  filterTaggedItems,
  buildModelIdMapFromItems,
  groupItemsByField,
  toggleItemsInSelectionMap,
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

  it('groups elements by PLANO and SYSTEM TAG and toggles selection map cleanly', () => {
    const byPlano = groupItemsByField(sample, 'plano');
    assert.deepEqual(byPlano.map((g) => g.label), ['E-301', 'E-302']);
    assert.equal(byPlano[0].items.length, 2);

    const bySystem = groupItemsByField(sample, 'systemTag');
    assert.deepEqual(bySystem.map((g) => g.label), ['PT1.01', '(Unassigned)']);
    assert.equal(bySystem[0].items.length, 3);
    assert.equal(bySystem[1].isUnassigned, true);

    // Select E-301 group -> { m1: Set(10, 2) }
    let sel = toggleItemsInSelectionMap({}, byPlano[0].items, true);
    assert.deepEqual(Array.from(sel.m1).sort((a, b) => a - b), [2, 10]);

    // Add E-302 group -> { m1: Set(1, 2, 10), m2: Set(50) }
    sel = toggleItemsInSelectionMap(sel, byPlano[1].items, true);
    assert.deepEqual(Array.from(sel.m1).sort((a, b) => a - b), [1, 2, 10]);
    assert.deepEqual(Array.from(sel.m2), [50]);

    // Unselect E-301 group -> only E-302 remains selected
    sel = toggleItemsInSelectionMap(sel, byPlano[0].items, false);
    assert.deepEqual(Array.from(sel.m1), [1]);
    assert.deepEqual(Array.from(sel.m2), [50]);
  });
});

