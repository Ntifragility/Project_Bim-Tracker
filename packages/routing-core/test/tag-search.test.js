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
import {
  addTraySystemAssignmentsToIfc,
  extractTraySystemAssignmentsFromIfc,
} from '../../../src/ifc/ifc-tag-exporter.js';
import {
  deriveEscAccFromUniqueTag,
  deriveEscAccFromSubTipo,
  parseMaterialDictionaryRows,
  resolveMaterialDescription,
  roundUpMetrado1,
} from '../../../src/tagging/material-dictionary.js';

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

  it('roundtrips PLANO, SUB_TIPO, ESC/ACC, TENSION, and TIPO DE MATERIAL inside exported IFC CCP_TRAY_SYSTEM PropertySet (tagged and untagged)', () => {
    const sampleIfc = [
      'ISO-10303-21;',
      'HEADER;',
      'ENDSEC;',
      'DATA;',
      "#10=IFCCABLECARRIERSEGMENT('guid1',$,'Tray-10',$,$,$,$,'OLD-10',.CABLELADDERSEGMENT.);",
      "#20=IFCCABLECARRIERFITTING('guid2',$,'Elbow-20',$,$,$,$,$,.BEND.);",
      'ENDSEC;',
      'END-ISO-10303-21;',
    ].join('\r\n');
    const sourceBytes = new TextEncoder().encode(sampleIfc);

    // 1. First export: #10 has full tag + all 5 custom properties; #20 has ONLY properties (no Unique Tag yet)
    const exp1 = addTraySystemAssignmentsToIfc(sourceBytes, [
      {
        localId: 10,
        systemTag: 'PT1.01',
        elementTag: 'PT1.01.01',
        componentId: 'PT1.01.01',
        sequenceNumber: '01',
        plano: 'E-301',
        rev: '0',
        subTipo: 'ESCALERILLA',
        escAcc: 'Bandeja',
        tension: 'MT',
        tipoMaterial: 'GALVANIZADO',
      },
      {
        localId: 20,
        systemTag: '',
        elementTag: '',
        componentId: '',
        sequenceNumber: '',
        plano: 'E-302',
        rev: 'A',
        subTipo: 'CURVA 90',
        escAcc: 'Accesorio',
        tension: 'BT',
        tipoMaterial: 'FRP',
      },
    ]);
    assert.equal(exp1.applied.length, 2);

    // 2. Re-upload / parse exported IFC bytes
    const parsed1 = extractTraySystemAssignmentsFromIfc(exp1.bytes);
    assert.equal(parsed1.size, 2);
    assert.equal(parsed1.get(10).elementTag, 'PT1.01.01');
    assert.equal(parsed1.get(10).plano, 'E-301');
    assert.equal(parsed1.get(10).rev, '0');
    assert.equal(parsed1.get(10).subTipo, 'ESCALERILLA');
    assert.equal(parsed1.get(10).escAcc, 'Bandeja');
    assert.equal(parsed1.get(10).tension, 'MT');
    assert.equal(parsed1.get(10).tipoMaterial, 'GALVANIZADO');

    assert.equal(parsed1.get(20).elementTag, '');
    assert.equal(parsed1.get(20).plano, 'E-302');
    assert.equal(parsed1.get(20).rev, 'A');
    assert.equal(parsed1.get(20).subTipo, 'CURVA 90');
    assert.equal(parsed1.get(20).escAcc, 'Accesorio');
    assert.equal(parsed1.get(20).tension, 'BT');
    assert.equal(parsed1.get(20).tipoMaterial, 'FRP');

    // 3. Second export on already-exported IFC: update #10 properties in-place and add Unique Tag to #20
    const exp2 = addTraySystemAssignmentsToIfc(exp1.bytes, [
      {
        localId: 10,
        systemTag: 'PT1.01',
        elementTag: 'PT1.01.01',
        componentId: 'PT1.01.01',
        sequenceNumber: '01',
        plano: 'E-301-REV2',
        rev: '1',
        subTipo: 'ESCALERILLA',
        escAcc: 'Bandeja',
        tension: 'CTRL',
        tipoMaterial: 'FRP',
      },
      {
        localId: 20,
        systemTag: 'PT1.02',
        elementTag: 'PT1.02.01',
        componentId: 'PT1.02.01',
        sequenceNumber: '01',
        plano: 'E-302',
        rev: 'B',
        subTipo: 'CURVA 90',
        escAcc: 'Accesorio',
        tension: 'INST',
        tipoMaterial: 'GALVANIZADO',
      },
    ]);
    const parsed2 = extractTraySystemAssignmentsFromIfc(exp2.bytes);
    assert.equal(parsed2.get(10).plano, 'E-301-REV2');
    assert.equal(parsed2.get(10).rev, '1');
    assert.equal(parsed2.get(10).tension, 'CTRL');
    assert.equal(parsed2.get(10).tipoMaterial, 'FRP');
    assert.equal(parsed2.get(20).elementTag, 'PT1.02.01');
    assert.equal(parsed2.get(20).rev, 'B');
    assert.equal(parsed2.get(20).escAcc, 'Accesorio');
    assert.equal(parsed2.get(20).tension, 'INST');
    assert.equal(parsed2.get(20).tipoMaterial, 'GALVANIZADO');
  });

  it('derives ESC/ACC from .01. (Bandeja) and .02. (Accesorio) inside Unique Tag, rounds METRADO up to 1 decimal, and resolves DESCRIPCION DE MATERIAL', () => {
    assert.equal(deriveEscAccFromUniqueTag('CT01.01.01'), 'Bandeja');
    assert.equal(deriveEscAccFromUniqueTag('PT1.01.15'), 'Bandeja');
    assert.equal(deriveEscAccFromUniqueTag('CT01.02.01'), 'Accesorio');
    assert.equal(deriveEscAccFromUniqueTag('PT1.02.09'), 'Accesorio');
    assert.equal(deriveEscAccFromUniqueTag('CT01.03.01'), '');
    assert.equal(deriveEscAccFromUniqueTag(''), '');
    // Alias check
    assert.equal(deriveEscAccFromSubTipo('CT01.01.05'), 'Bandeja');
    assert.equal(deriveEscAccFromSubTipo('CT01.02.05'), 'Accesorio');

    // REDONDEAR.MAS(DATA; 1) / ROUNDUP(DATA, 1)
    assert.equal(roundUpMetrado1(3.0), 3.0);
    assert.equal(roundUpMetrado1(3.01), 3.1);
    assert.equal(roundUpMetrado1(1.42), 1.5);
    assert.equal(roundUpMetrado1('2.345 m'), 2.4);
    assert.equal(roundUpMetrado1(''), '');

    // Built-in catalog match (Spanish + English)
    assert.equal(
      resolveMaterialDescription({ subTipo: 'ESCALERILLA' }),
      'BANDEJA PORTACABLES TIPO ESCALERILLA',
    );
    assert.equal(
      resolveMaterialDescription({ subTipo: 'CURVA 90' }),
      'CURVA HORIZONTAL 90 GRADOS PARA BANDEJA PORTACABLES',
    );
    assert.equal(
      resolveMaterialDescription({ subTipo: 'ELBOW 90' }),
      'ELBOW FITTING FOR CABLE TRAY',
    );

    // Custom Excel override takes precedence over built-in catalog
    const customRules = parseMaterialDictionaryRows([
      { SUB_TIPO: 'ESCALERILLA', 'DESCRIPCION DE MATERIAL': 'ESCALERILLA F°G° PESADA NEMA 20B' },
    ]);
    assert.equal(
      resolveMaterialDescription({ subTipo: 'ESCALERILLA' }, customRules),
      'ESCALERILLA F°G° PESADA NEMA 20B',
    );
  });
});

