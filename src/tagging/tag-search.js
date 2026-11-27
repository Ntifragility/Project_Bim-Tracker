// src/tagging/tag-search.js
// Pure Revizto / Navisworks-style tag & property search engine for Cable Tray Viewer.
// Zero DOM / Three.js dependencies — 100% unit-testable.

import { compareNaturalTags } from './sequential-tagger.js';

export const UNASSIGNED_FILTER = '__UNASSIGNED__';

/**
 * Extracts sorted distinct non-empty values for a given property field (e.g. 'plano', 'subTipo').
 */
export function getDistinctPropertyValues(items = [], field = 'plano') {
  const seen = new Map(); // lower -> original
  for (const item of items || []) {
    const val = String(item?.[field] ?? '').trim();
    if (!val) continue;
    const lower = val.toLowerCase();
    if (!seen.has(lower)) seen.set(lower, val);
  }
  return Array.from(seen.values()).sort(compareNaturalTags);
}

/**
 * Filters and naturally sorts tagged/annotated elements using:
 * - space-separated multi-term AND text query across TAG UNICO, PLANO, SUB_TIPO, systemTag, type, name, globalId
 * - optional exact planoFilter ('' = all, UNASSIGNED_FILTER = empty, otherwise exact case-insensitive match)
 * - optional exact subTipoFilter ('' = all, UNASSIGNED_FILTER = empty, otherwise exact case-insensitive match)
 */
export function filterTaggedItems(items = [], {
  query = '',
  planoFilter = '',
  subTipoFilter = '',
} = {}) {
  const tokens = String(query ?? '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  const pFilter = String(planoFilter ?? '').trim();
  const sFilter = String(subTipoFilter ?? '').trim();

  const matches = [];
  for (const item of items || []) {
    if (!item || item.delete === true) continue;
    const tag = String(item.elementTag || item.componentId || '').trim();
    const plano = String(item.plano || '').trim();
    const subTipo = String(item.subTipo || '').trim();

    // Include elements that have at least a tag, plano, or subTipo
    if (!tag && !plano && !subTipo) continue;

    if (pFilter) {
      if (pFilter === UNASSIGNED_FILTER) {
        if (plano) continue;
      } else if (plano.toLowerCase() !== pFilter.toLowerCase()) {
        continue;
      }
    }

    if (sFilter) {
      if (sFilter === UNASSIGNED_FILTER) {
        if (subTipo) continue;
      } else if (subTipo.toLowerCase() !== sFilter.toLowerCase()) {
        continue;
      }
    }

    if (tokens.length > 0) {
      const haystack = [
        tag,
        item.systemTag,
        plano,
        subTipo,
        item.type,
        item.name,
        item.globalId,
        item.localId,
      ]
        .map((v) => String(v ?? '').toLowerCase())
        .join(' ');
      if (!tokens.every((tok) => haystack.includes(tok))) continue;
    }

    matches.push(item);
  }

  matches.sort((a, b) => {
    const tagA = a.elementTag || a.componentId || '';
    const tagB = b.elementTag || b.componentId || '';
    if (tagA && !tagB) return -1;
    if (!tagA && tagB) return 1;
    const cmp = compareNaturalTags(tagA, tagB);
    if (cmp !== 0) return cmp;
    return Number(a.localId || 0) - Number(b.localId || 0);
  });

  return matches;
}

/**
 * Converts a list of matched items into a Fragments modelIdMap (`{ [modelId]: Set<number> }`).
 */
export function buildModelIdMapFromItems(items = []) {
  const map = {};
  for (const item of items || []) {
    if (!item?.modelId || item.localId === undefined || item.localId === null) continue;
    const id = Number(item.localId);
    if (!Number.isFinite(id)) continue;
    if (!map[item.modelId]) map[item.modelId] = new Set();
    map[item.modelId].add(id);
  }
  return map;
}

/**
 * Groups items hierarchically by 'plano', 'systemTag', or 'subTipo' for the Tree Map view.
 * Naturally sorts group labels with "(Unassigned)" placed last.
 */
export function groupItemsByField(items = [], field = 'plano') {
  const groups = new Map(); // lowerKey -> { key, label, isUnassigned, items }

  for (const item of items || []) {
    if (!item || item.delete === true) continue;
    let rawVal = '';
    if (field === 'systemTag') {
      rawVal = String(item.systemTag || '').trim();
      if (!rawVal && (item.elementTag || item.componentId)) {
        rawVal = String(item.elementTag || item.componentId)
          .replace(/[.\-_]?\d+$/, '')
          .replace(/[.\-_]+$/, '')
          .trim();
      }
    } else {
      rawVal = String(item[field] || '').trim();
    }

    const isUnassigned = !rawVal;
    const lowerKey = isUnassigned ? UNASSIGNED_FILTER : rawVal.toLowerCase();
    if (!groups.has(lowerKey)) {
      groups.set(lowerKey, {
        key: lowerKey,
        label: isUnassigned ? '(Unassigned)' : rawVal,
        isUnassigned,
        items: [],
      });
    }
    groups.get(lowerKey).items.push(item);
  }

  const list = Array.from(groups.values());
  list.sort((a, b) => {
    if (a.isUnassigned && !b.isUnassigned) return 1;
    if (!a.isUnassigned && b.isUnassigned) return -1;
    return compareNaturalTags(a.label, b.label);
  });
  return list;
}

/**
 * Pure helper to add or remove a list of items from a modelIdMap (`{ [modelId]: Set<number> }`),
 * enabling checkbox-based select & unselect in the Classification Tree.
 */
export function toggleItemsInSelectionMap(currentMap = {}, items = [], shouldSelect = true) {
  const next = {};
  for (const [modelId, ids] of Object.entries(currentMap || {})) {
    const arr = ids instanceof Set ? Array.from(ids) : Array.isArray(ids) ? ids : [];
    if (arr.length) next[modelId] = new Set(arr.map(Number));
  }

  for (const item of items || []) {
    if (!item?.modelId || item.localId === undefined || item.localId === null) continue;
    const id = Number(item.localId);
    if (!Number.isFinite(id)) continue;
    if (shouldSelect) {
      if (!next[item.modelId]) next[item.modelId] = new Set();
      next[item.modelId].add(id);
    } else if (next[item.modelId]) {
      next[item.modelId].delete(id);
      if (next[item.modelId].size === 0) delete next[item.modelId];
    }
  }
  return next;
}

