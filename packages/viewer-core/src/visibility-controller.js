// Unified Revizto-style Hide/Unhide & Isolate/Unisolate composer for viewer-core.
//
// Composes hidden sets and isolation sets (Hard + Ghost transparency) deterministically
// so Hide, Unhide, Isolate, Ghost Isolate, and Unisolate never overwrite each other.
// Supports optional external item adapters (e.g. drawn 3D conduit runs) cleanly.

import * as THREE from "three";

export const GHOST_STYLE_NAME = "ghost-isolation";

function countMapItems(mapObj) {
  let total = 0;
  for (const ids of mapObj.values()) total += ids.size;
  return total;
}

function toIdArray(ids) {
  if (ids instanceof Set) return Array.from(ids);
  if (Array.isArray(ids)) return ids;
  return ids !== undefined && ids !== null ? [ids] : [];
}

function toPlainObjectMap(mapObj) {
  const out = {};
  for (const [k, set] of mapObj) {
    if (set.size > 0) out[k] = Array.from(set);
  }
  return out;
}

function fromPlainObjectMap(obj = {}) {
  const out = new Map();
  for (const [k, ids] of Object.entries(obj || {})) {
    const arr = toIdArray(ids).map(Number).filter((n) => !Number.isNaN(n));
    if (arr.length > 0) out.set(k, new Set(arr));
  }
  return out;
}

/**
 * Pure helper computing effective visibility for a single item.
 * Rule R1: visible(id) = (!isolated || ghost || inIsolated) && !inHidden
 */
export function isItemEffectivelyVisible({ inHidden, isolationMode, inIsolated }) {
  if (inHidden) return false;
  if (isolationMode === "hard") return Boolean(inIsolated);
  return true;
}

export function createVisibilityController({
  hider = null,
  highlighter = null,
  fragments = null,
  appearanceHistory = null,
} = {}) {
  const hiddenIfcMap = new Map(); // modelId -> Set<number>
  const isolatedIfcMap = new Map(); // modelId -> Set<number>
  // Named boolean filter layers (e.g. 'tagged'): layerId -> Map<modelId, Set<number>>
  const filterLayers = new Map();
  let isolationMode = "none"; // 'none' | 'hard' | 'ghost'

  function isHiddenByMapOrFilter(modelId, numericId) {
    if (hiddenIfcMap.get(modelId)?.has(numericId)) return true;
    for (const layerMap of filterLayers.values()) {
      if (layerMap.get(modelId)?.has(numericId)) return true;
    }
    return false;
  }

  function buildCombinedHiddenIfcMap() {
    const combined = new Map();
    for (const [modelId, set] of hiddenIfcMap) {
      if (set.size > 0) combined.set(modelId, new Set(set));
    }
    for (const layerMap of filterLayers.values()) {
      for (const [modelId, set] of layerMap) {
        if (!set.size) continue;
        if (!combined.has(modelId)) combined.set(modelId, new Set());
        const target = combined.get(modelId);
        for (const id of set) target.add(id);
      }
    }
    return combined;
  }

  // External adapters (app-owned overlays such as drawn conduit runs):
  // adapter = { getAllIds(), getSelectedIds(), clearSelection(), applyVisibility({ hiddenIds, ghostIds, hardIsolatedIds }) }
  const externalAdapters = new Map();
  const hiddenExternalMap = new Map(); // adapterId -> Set<string>
  const isolatedExternalMap = new Map(); // adapterId -> Set<string>

  const visibilityListeners = new Set(); // cb(hiddenCount)
  const stateListeners = new Set(); // cb(fullState)

  if (highlighter?.styles && !highlighter.styles.has(GHOST_STYLE_NAME)) {
    highlighter.styles.set(GHOST_STYLE_NAME, {
      color: new THREE.Color("#64748b"),
      opacity: 0.14,
      transparent: true,
    });
  }

  function countIfcSelection() {
    const sel = highlighter?.selection?.select;
    if (!sel) return 0;
    let total = 0;
    for (const ids of Object.values(sel)) {
      total += ids instanceof Set ? ids.size : Array.isArray(ids) ? ids.length : 0;
    }
    return total;
  }

  function countExternalSelection() {
    let total = 0;
    for (const adapter of externalAdapters.values()) {
      try {
        total += (adapter.getSelectedIds?.() || []).length;
      } catch { /* ignore headless */ }
    }
    return total;
  }

  function getHiddenCount() {
    let total = countMapItems(hiddenIfcMap);
    for (const set of hiddenExternalMap.values()) total += set.size;
    return total;
  }

  function getIsolatedCount() {
    let total = countMapItems(isolatedIfcMap);
    for (const set of isolatedExternalMap.values()) total += set.size;
    return total;
  }

  function getState() {
    const ifcSelectionCount = countIfcSelection();
    const externalSelectionCount = countExternalSelection();
    const selectionCount = ifcSelectionCount + externalSelectionCount;
    return {
      selectionCount,
      hasSelection: selectionCount > 0,
      ifcSelectionCount,
      externalSelectionCount,
      hiddenCount: getHiddenCount(),
      isolationActive: isolationMode !== "none",
      isolationMode,
      isolateMode: isolationMode,
      ghostActive: isolationMode === "ghost",
      isolatedCount: getIsolatedCount(),
    };
  }

  function notifyAll() {
    const hiddenCount = getHiddenCount();
    const state = getState();
    for (const cb of visibilityListeners) {
      try { cb(hiddenCount); } catch (err) { console.error("[visibility] listener error:", err); }
    }
    for (const cb of stateListeners) {
      try { cb(state); } catch (err) { console.error("[visibility] state listener error:", err); }
    }
  }

  async function recomputeVisibility() {
    const combinedHiddenMap = buildCombinedHiddenIfcMap();

    // 1. Apply ghost highlight style on non-isolated IFC items when in 'ghost' mode
    if (highlighter) {
      const wasEnabled = highlighter.enabled;
      if (wasEnabled === false) {
        try { highlighter.enabled = true; } catch { /* noop */ }
      }
      try {
        try {
          await highlighter.clear(GHOST_STYLE_NAME);
        } catch { /* headless */ }

        if (isolationMode === "ghost" && fragments) {
          const inverseMap = {};
          const modelList =
            fragments.list?.size
              ? fragments.list
              : fragments.core?.models?.list?.size
                ? fragments.core.models.list
                : null;
          if (modelList) {
            for (const [modelId, model] of modelList) {
              const kept = isolatedIfcMap.get(modelId) || new Set();
              const hidden = combinedHiddenMap.get(modelId) || new Set();
              let allIds = [];
              if (typeof model?.getItemsIdsWithGeometry === "function") {
                try {
                  allIds = await model.getItemsIdsWithGeometry();
                } catch { /* ignore */ }
              }
              const nonKept = [];
              for (const expressId of allIds) {
                if (!kept.has(expressId) && !hidden.has(expressId)) {
                  nonKept.push(expressId);
                }
              }
              if (nonKept.length > 0) inverseMap[modelId] = nonKept;
            }
          } else if (fragments.groups) {
            for (const [modelId, model] of fragments.groups) {
              const kept = isolatedIfcMap.get(modelId) || new Set();
              const hidden = combinedHiddenMap.get(modelId) || new Set();
              const nonKept = [];
              if (model?.data?.keys) {
                for (const expressId of model.data.keys()) {
                  if (!kept.has(expressId) && !hidden.has(expressId)) {
                    nonKept.push(expressId);
                  }
                }
              }
              if (nonKept.length > 0) inverseMap[modelId] = nonKept;
            }
          }
          if (Object.keys(inverseMap).length > 0) {
            try {
              await highlighter.highlightByID(GHOST_STYLE_NAME, inverseMap, false, false);
            } catch (err) {
              console.warn("[visibility] ghost highlight failed:", err);
            }
          }
        }
      } finally {
        if (wasEnabled === false) {
          try { highlighter.enabled = false; } catch { /* noop */ }
        }
      }
    }

    // 2. Compose OBC.Hider visibility (isolation + explicit hides + active filter layers)
    if (hider) {
      try {
        if (isolationMode === "hard") {
          // Only show isolated items that are NOT explicitly hidden or filtered out
          const visibleIso = {};
          for (const [modelId, isoSet] of isolatedIfcMap) {
            const hiddenSet = combinedHiddenMap.get(modelId);
            const remaining = [];
            for (const id of isoSet) {
              if (!hiddenSet || !hiddenSet.has(id)) remaining.push(id);
            }
            if (remaining.length > 0) visibleIso[modelId] = remaining;
          }
          if (Object.keys(visibleIso).length > 0) {
            await hider.isolate(visibleIso);
          } else {
            await hider.set(false);
          }
        } else {
          await hider.set(true);
          const hiddenObj = toPlainObjectMap(combinedHiddenMap);
          if (Object.keys(hiddenObj).length > 0) {
            await hider.set(false, hiddenObj);
          }
        }
      } catch (err) {
        console.warn("[visibility] hider sync failed:", err);
      }
    }

    // 3. Apply composed visibility to registered external adapters (e.g. conduit runs)
    for (const [adapterId, adapter] of externalAdapters) {
      try {
        const allIds = adapter.getAllIds?.() || [];
        const hiddenSet = hiddenExternalMap.get(adapterId) || new Set();
        const isoSet = isolatedExternalMap.get(adapterId) || new Set();

        const hiddenIds = new Set();
        const ghostIds = new Set();
        for (const id of allIds) {
          if (hiddenSet.has(id)) {
            hiddenIds.add(id);
          } else if (isolationMode === "hard" && !isoSet.has(id)) {
            hiddenIds.add(id);
          } else if (isolationMode === "ghost" && !isoSet.has(id)) {
            ghostIds.add(id);
          }
        }
        adapter.applyVisibility?.({
          hiddenIds,
          ghostIds,
          isolationMode,
          isolatedIds: isoSet,
        });
      } catch (err) {
        console.warn(`[visibility] external adapter '${adapterId}' failed:`, err);
      }
    }

    notifyAll();
  }

  // Subscribe to highlighter selection changes so buttons morph automatically
  if (highlighter?.events?.select) {
    try {
      highlighter.events.select.onHighlight?.add?.(() => notifyAll());
      highlighter.events.select.onClear?.add?.(() => notifyAll());
    } catch { /* headless */ }
  }

  const visibility = {
    registerExternalAdapter(id, adapter) {
      if (!id || !adapter) return () => {};
      externalAdapters.set(id, adapter);
      if (!hiddenExternalMap.has(id)) hiddenExternalMap.set(id, new Set());
      if (!isolatedExternalMap.has(id)) isolatedExternalMap.set(id, new Set());
      notifyAll();
      return () => this.unregisterExternalAdapter(id);
    },

    unregisterExternalAdapter(id) {
      externalAdapters.delete(id);
      hiddenExternalMap.delete(id);
      isolatedExternalMap.delete(id);
      notifyAll();
    },

    notifySelectionChange() {
      notifyAll();
    },

    /**
     * Hide currently selected IFC elements (or targetMap) and any selected external items.
     */
    async hideSelection(targetMap = null) {
      const selection = targetMap || highlighter?.selection?.select || {};
      const ifcCount = Object.values(selection).reduce(
        (sum, ids) => sum + toIdArray(ids).length,
        0,
      );

      let extToHide = [];
      if (!targetMap || ifcCount === 0) {
        for (const [adapterId, adapter] of externalAdapters) {
          const selIds = adapter.getSelectedIds?.() || [];
          if (selIds.length > 0) extToHide.push({ adapterId, adapter, selIds });
        }
      }

      if (ifcCount === 0 && extToHide.length === 0) return 0;

      appearanceHistory?.push?.("hide");

      let newlyHiddenCount = 0;
      for (const [modelId, ids] of Object.entries(selection)) {
        if (!hiddenIfcMap.has(modelId)) hiddenIfcMap.set(modelId, new Set());
        const set = hiddenIfcMap.get(modelId);
        for (const rawId of toIdArray(ids)) {
          const numId = Number(rawId);
          if (!Number.isNaN(numId) && !set.has(numId)) {
            set.add(numId);
            newlyHiddenCount++;
          }
        }
      }

      for (const { adapterId, adapter, selIds } of extToHide) {
        if (!hiddenExternalMap.has(adapterId)) hiddenExternalMap.set(adapterId, new Set());
        const set = hiddenExternalMap.get(adapterId);
        for (const id of selIds) {
          if (!set.has(id)) {
            set.add(id);
            newlyHiddenCount++;
          }
        }
        try { adapter.clearSelection?.(); } catch { /* noop */ }
      }

      if (highlighter && typeof highlighter.clear === "function") {
        try { await highlighter.clear("select"); } catch { /* noop */ }
      }

      await recomputeVisibility();
      return newlyHiddenCount;
    },

    /**
     * Restore all explicitly hidden IFC elements & external items while preserving active isolation.
     */
    async unhideAll() {
      if (getHiddenCount() === 0 && isolationMode === "none") return;
      if (getHiddenCount() === 0) return;

      appearanceHistory?.push?.("unhideAll");
      hiddenIfcMap.clear();
      for (const set of hiddenExternalMap.values()) set.clear();
      await recomputeVisibility();
    },

    get hiddenCount() {
      return getHiddenCount();
    },

    get hasSelection() {
      return countIfcSelection() + countExternalSelection() > 0;
    },

    getHiddenCount,

    async toggleHideOrUnhide() {
      if (this.hasSelection) {
        await this.hideSelection();
        return "hidden";
      }
      if (getHiddenCount() > 0) {
        await this.unhideAll();
        return "unhidden";
      }
      return "noop";
    },

    getHiddenElements() {
      return toPlainObjectMap(hiddenIfcMap);
    },

    async setFilterLayer(layerId, modelIdMap = {}) {
      if (!layerId) return;
      const parsed = fromPlainObjectMap(modelIdMap);
      if (countMapItems(parsed) === 0) {
        filterLayers.delete(layerId);
      } else {
        filterLayers.set(layerId, parsed);
      }
      await recomputeVisibility();
    },

    async clearFilterLayer(layerId) {
      if (!layerId || !filterLayers.has(layerId)) return;
      filterLayers.delete(layerId);
      await recomputeVisibility();
    },

    hasFilterLayer(layerId) {
      return filterLayers.has(layerId) && countMapItems(filterLayers.get(layerId)) > 0;
    },

    isItemVisible(modelId, localId) {
      const numId = Number(localId);
      const inHidden = isHiddenByMapOrFilter(modelId, numId);
      const inIsolated = Boolean(isolatedIfcMap.get(modelId)?.has(numId));
      return isItemEffectivelyVisible({ inHidden, isolationMode, inIsolated });
    },

    onVisibilityChange(callback) {
      visibilityListeners.add(callback);
      try { callback(getHiddenCount()); } catch { /* noop */ }
      return () => visibilityListeners.delete(callback);
    },

    getState,

    onStateChange(callback) {
      stateListeners.add(callback);
      try { callback(getState()); } catch { /* noop */ }
      return () => stateListeners.delete(callback);
    },

    onChange(callback) {
      return this.onStateChange(callback);
    },

    exportSnapshot() {
      return {
        hiddenIfc: toPlainObjectMap(hiddenIfcMap),
        isolatedIfc: toPlainObjectMap(isolatedIfcMap),
        isolationMode,
        hiddenExt: Object.fromEntries(
          Array.from(hiddenExternalMap.entries()).map(([k, s]) => [k, Array.from(s)]),
        ),
        isolatedExt: Object.fromEntries(
          Array.from(isolatedExternalMap.entries()).map(([k, s]) => [k, Array.from(s)]),
        ),
      };
    },

    async importSnapshot(snap = {}) {
      hiddenIfcMap.clear();
      for (const [k, s] of fromPlainObjectMap(snap.hiddenIfc)) hiddenIfcMap.set(k, s);
      isolatedIfcMap.clear();
      for (const [k, s] of fromPlainObjectMap(snap.isolatedIfc)) isolatedIfcMap.set(k, s);
      isolationMode = snap.isolationMode || (snap.ghostActive ? "ghost" : "none");
      for (const [k, arr] of Object.entries(snap.hiddenExt || {})) {
        hiddenExternalMap.set(k, new Set(arr));
      }
      for (const [k, arr] of Object.entries(snap.isolatedExt || {})) {
        isolatedExternalMap.set(k, new Set(arr));
      }
      await recomputeVisibility();
    },
  };

  const isolation = {
    async isolate(targetMap = null, { mode = "hard" } = {}) {
      const selection = targetMap || highlighter?.selection?.select || {};
      const nextIfc = fromPlainObjectMap(selection);

      const nextExt = new Map();
      let extCount = 0;
      if (!targetMap || countMapItems(nextIfc) === 0) {
        for (const [adapterId, adapter] of externalAdapters) {
          const selIds = adapter.getSelectedIds?.() || [];
          if (selIds.length > 0) {
            nextExt.set(adapterId, new Set(selIds));
            extCount += selIds.length;
          }
        }
      }

      if (countMapItems(nextIfc) === 0 && extCount === 0) return false;

      appearanceHistory?.push?.(mode === "ghost" ? "ghostIsolate" : "hardIsolate");
      isolatedIfcMap.clear();
      for (const [k, s] of nextIfc) isolatedIfcMap.set(k, s);
      isolatedExternalMap.clear();
      for (const [k, s] of nextExt) isolatedExternalMap.set(k, s);
      isolationMode = mode === "ghost" ? "ghost" : "hard";

      await recomputeVisibility();
      return true;
    },

    async hardIsolate(targetMap = null) {
      return isolation.isolate(targetMap, { mode: "hard" });
    },

    async ghostIsolate(targetMap = null) {
      return isolation.isolate(targetMap, { mode: "ghost" });
    },

    async setIsolationMode(mode = "hard") {
      if (isolationMode === "none") return false;
      const next = mode === "ghost" ? "ghost" : "hard";
      if (isolationMode === next) return true;
      appearanceHistory?.push?.(next === "ghost" ? "ghostIsolate" : "hardIsolate");
      isolationMode = next;
      await recomputeVisibility();
      return true;
    },

    async unisolate() {
      if (isolationMode === "none") return;
      appearanceHistory?.push?.("unisolate");
      isolatedIfcMap.clear();
      isolatedExternalMap.clear();
      isolationMode = "none";
      await recomputeVisibility();
    },

    async resetIsolation() {
      return isolation.unisolate();
    },

    get mode() {
      return isolationMode;
    },

    isIsolated() {
      return isolationMode !== "none";
    },

    isIsolationActive() {
      return isolationMode !== "none";
    },

    isGhostActive() {
      return isolationMode === "ghost";
    },

    getMode() {
      return isolationMode;
    },

    getIsolatedElements() {
      return toPlainObjectMap(isolatedIfcMap);
    },
  };

  visibility.recomputeVisibility = recomputeVisibility;
  visibility.clearModelState = (modelId) => {
    if (!modelId) return;
    hiddenIfcMap.delete(modelId);
    isolatedIfcMap.delete(modelId);
    try {
      if (highlighter?.selection?.select && modelId in highlighter.selection.select) {
        delete highlighter.selection.select[modelId];
      }
    } catch { /* noop */ }
    notifyAll();
  };

  return {
    visibility,
    isolation,
    recomputeVisibility,
    exportSnapshot: visibility.exportSnapshot,
    importSnapshot: visibility.importSnapshot,
  };
}
