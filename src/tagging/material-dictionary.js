// src/tagging/material-dictionary.js
// Pure bilingual (ES/EN) ESC/ACC detector & SUB_TIPO -> DESCRIPCION DE MATERIAL dictionary matcher.
// Combines the built-in repo catalog (src/tagging/material-catalog.json) with optional user-uploaded
// Excel dictionary overrides (applied at Excel export time; not written into the IFC file).

import defaultCatalog from './material-catalog.json' with { type: 'json' };

function normalizeToken(value = '') {
  return String(value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

const ACC_TOKENS = [
  'CURVA',
  'CODO',
  'TEE',
  'CRUZ',
  'REDUCCION',
  'REDUCTOR',
  'BAJANTE',
  'SUBIDA',
  'VERTICAL',
  'DERIVACION',
  'TAPA',
  'UNION',
  'ECLISA',
  'SOPORTE',
  'GRAPA',
  'ACCESORIO',
  'FITTING',
  'BEND',
  'ELBOW',
  'CROSS',
  'REDUCER',
  'RISER',
  'DROP',
  'COVER',
  'SPLICE',
  'CONNECTOR',
  'BRACKET',
  'HANGER',
  'CLAMP',
  'ACCESSORY',
  'ADAPTER',
  'OFFSET',
  'WYE',
];

const ESC_TOKENS = [
  'ESCALERILLA',
  'BANDEJA',
  'FONDO',
  'PERFORAD',
  'LISA',
  'DUCTO',
  'CANALETA',
  'MALLA',
  'TRAMO',
  'RECTO',
  'LADDER',
  'TRAY',
  'SOLID BOTTOM',
  'VENTILATED',
  'TROUGH',
  'CHANNEL',
  'WIRE MESH',
  'BASKET',
  'STRAIGHT',
  'SEGMENT',
  'DUCT',
  'TRUNKING',
];

/**
 * Automatically derives 'ESC' or 'ACC' from the Unique Tag (e.g. CT01.01.05 -> 'ESC', CT01.02.05 -> 'ACC'):
 *   - If there is '.02.' inside the Unique Tag -> 'ACC'
 *   - If there is '.01.' inside the Unique Tag -> 'ESC'
 *   - Otherwise returns '' (user can still edit ESC/ACC manually).
 */
export function deriveEscAccFromUniqueTag(uniqueTag = '') {
  const tag = String(uniqueTag ?? '').trim();
  if (!tag) return '';
  if (tag.includes('.02.')) return 'ACC';
  if (tag.includes('.01.')) return 'ESC';
  return '';
}

/**
 * Legacy alias kept for compatibility — derives ESC/ACC strictly from `.01.` / `.02.` in the tag/prefix.
 */
export function deriveEscAccFromSubTipo(uniqueTagOrSubTipo = '') {
  return deriveEscAccFromUniqueTag(uniqueTagOrSubTipo);
}

/**
 * Parses raw sheet objects (from excel-io readWorkbook().readSheet()) into normalized
 * dictionary rules `{ subTipo, key, tipoMaterial, ancho, descripcion }`.
 */
export function parseMaterialDictionaryRows(rawRows = []) {
  if (!Array.isArray(rawRows)) return [];
  const rules = [];

  for (const row of rawRows) {
    if (!row || typeof row !== 'object') continue;
    const entries = Object.entries(row);
    if (entries.length === 0) continue;

    let subTipo = '';
    let descripcion = '';
    let tipoMaterial = '';
    let ancho = '';

    for (const [rawKey, rawVal] of entries) {
      const k = normalizeToken(rawKey);
      const v = String(rawVal ?? '').trim();
      if (!v) continue;

      if (
        !subTipo &&
        (k === 'SUB_TIPO' ||
          k === 'SUBTIPO' ||
          k === 'SUB TIPO' ||
          k === 'SUBTYPE' ||
          k === 'SUB-TYPE' ||
          k === 'CODIGO' ||
          k === 'CODE' ||
          k === 'KEY')
      ) {
        subTipo = v;
      } else if (
        !descripcion &&
        (k.includes('DESCRIPCION') || k.includes('DESCRIPTION') || k === 'DESC' || k === 'MATERIAL DESCRIPTION')
      ) {
        descripcion = v;
      } else if (!tipoMaterial && (k.includes('TIPO DE MATERIAL') || k === 'TIPO_MATERIAL' || k === 'MATERIAL')) {
        tipoMaterial = v;
      } else if (!ancho && (k.startsWith('ANCHO') || k.startsWith('WIDTH'))) {
        ancho = v;
      }
    }

    // Fallback for simple 2-column headerless / arbitrary-header tables: col 0 = SUB_TIPO, col 1 = DESCRIPCION
    if ((!subTipo || !descripcion) && entries.length >= 2) {
      const firstVal = String(entries[0][1] ?? '').trim();
      const secondVal = String(entries[1][1] ?? '').trim();
      if (!subTipo && firstVal) subTipo = firstVal;
      if (!descripcion && secondVal) descripcion = secondVal;
    }

    const key = normalizeToken(subTipo);
    if (!key || !descripcion) continue;
    // Skip accidental header row repetition
    if ((key === 'SUB_TIPO' || key === 'SUBTIPO' || key === 'SUB TIPO') && normalizeToken(descripcion).includes('DESCRIPCION')) {
      continue;
    }

    rules.push({
      subTipo,
      key,
      tipoMaterial: normalizeToken(tipoMaterial),
      ancho: normalizeToken(ancho),
      descripcion,
    });
  }

  return rules;
}

const BUILTIN_RULES = parseMaterialDictionaryRows(defaultCatalog);

/**
 * Merges user-uploaded Excel dictionary rules (higher priority) with the built-in repo catalog.
 */
export function getEffectiveMaterialDictionary(customRules = []) {
  const custom = Array.isArray(customRules) ? customRules : [];
  return [...custom, ...BUILTIN_RULES];
}

/**
 * Resolves DESCRIPCION DE MATERIAL for an element or subTipo string at Excel export time.
 */
export function resolveMaterialDescription(itemOrSubTipo, customRules = []) {
  const isObj = itemOrSubTipo && typeof itemOrSubTipo === 'object';
  const rawSubTipo = isObj ? itemOrSubTipo.subTipo : itemOrSubTipo;
  const key = normalizeToken(rawSubTipo);
  if (!key) return '';

  const itemMat = isObj ? normalizeToken(itemOrSubTipo.tipoMaterial || '') : '';
  const allRules = getEffectiveMaterialDictionary(customRules);

  // 1. Exact SUB_TIPO + TIPO DE MATERIAL match (if rule specifies tipoMaterial)
  if (itemMat) {
    const exactWithMat = allRules.find((r) => r.key === key && r.tipoMaterial && r.tipoMaterial === itemMat);
    if (exactWithMat) return exactWithMat.descripcion;
  }

  // 2. Exact SUB_TIPO match
  const exact = allRules.find((r) => r.key === key && !r.tipoMaterial);
  if (exact) return exact.descripcion;

  const anyExact = allRules.find((r) => r.key === key);
  if (anyExact) return anyExact.descripcion;

  // 3. Prefix / substring match from longest key to shortest
  const sortedByLen = allRules.slice().sort((a, b) => b.key.length - a.key.length);
  const partial = sortedByLen.find((r) => key.includes(r.key) || r.key.includes(key));
  return partial ? partial.descripcion : '';
}
