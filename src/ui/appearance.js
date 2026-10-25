// Appearance controls for the tray viewer.
//
// Owns selection-highlight color, appearance color maps, continuity group
// highlights, tagged-tray automatic highlighting and floating labels.
// Extracted verbatim from `src/main.js` (behaviour unchanged per R1); cross-
// panel refreshes arrive through the shared `api` object.

import * as THREE from 'three';
import { TagLabelManager } from '../tag-label-manager.js';
import { normalizeHexColor } from './helpers.js';

/**
 * @param {object} ctx app context (`src/ui/context.js`)
 * @param {object} dom DOM handles (`src/ui/dom.js`)
 * @param {object} api shared runtime API (populated by feature modules)
 */
export function initAppearance(ctx, dom, api) {
  function setSelectionHighlightStyle(color) {
    ctx.selectionHighlightColor = ctx.engine.setSelectionColor(normalizeHexColor(color) || '#6366f1');
    if (dom.selectionHighlightColorInput) dom.selectionHighlightColorInput.value = ctx.selectionHighlightColor;
    if (dom.selectionHighlightHex) dom.selectionHighlightHex.value = ctx.selectionHighlightColor.toUpperCase();
    localStorage.setItem('bim-selection-highlight-color', ctx.selectionHighlightColor);
  }

  async function applySelectionHighlightSetting(color) {
    setSelectionHighlightStyle(color);
    const selection = api.getSelectedModelIdMap();
    if (api.countModelIdMapItems(selection) === 0) return;

    ctx.highlighter.isProgrammaticSelect = true;
    try {
      await ctx.highlighter.clear('select');
      await ctx.highlighter.highlightByID('select', selection, false, false);
      ctx.currentSelectionMap = api.cloneModelIdMap(selection);
    } catch (error) {
      console.warn('[Selection Highlight] Could not refresh selected element color:', error);
      api.updateTagAssignmentUi('Warning: selected element highlight color could not be refreshed.', 'warning');
    } finally {
      ctx.highlighter.isProgrammaticSelect = false;
    }
  }

  async function reapplyAppearanceColors() {
    await ctx.engine.paintGroups(ctx.appearanceColorMaps);
  }

  async function applyAppearanceColorToCurrentSelection() {
    const selection = api.getSelectedModelIdMap();
    if (api.countModelIdMapItems(selection) === 0) return;
    ctx.highlighter.isProgrammaticSelect = true;
    try {
      for (const [, modelIdMap] of ctx.appearanceColorMaps) {
        api.removeModelIdMapItems(modelIdMap, selection);
      }
      if (!ctx.appearanceColorMaps.has(ctx.selectedAppearanceColor)) {
        ctx.appearanceColorMaps.set(ctx.selectedAppearanceColor, {});
      }
      api.addModelIdMapItems(ctx.appearanceColorMaps.get(ctx.selectedAppearanceColor), selection);
      await reapplyAppearanceColors();
      ctx.currentSelectionMap = api.cloneModelIdMap(selection);
      const transparency = Math.min(100, Math.max(0, Number(dom.ifcEditTransparency?.value) || 0)) / 100;
      if (dom.ifcEditColor) dom.ifcEditColor.value = ctx.selectedAppearanceColor;
      api.stageColorForSelection(ctx.selectedAppearanceColor, transparency);
    } catch (error) {
      console.warn('[Appearance Color] Could not color selected elements:', error);
      api.updateTagAssignmentUi('Warning: selected elements could not be colored.', 'warning');
    } finally {
      ctx.highlighter.isProgrammaticSelect = false;
    }
  }

  async function clearContinuityGroupHighlights() {
    for (const styleName of ctx.continuityHighlightStyleNames) {
      await ctx.highlighter.clear(styleName);
    }
    ctx.continuityHighlightStyleNames.clear();
  }

  async function applyContinuityGroupHighlights(groups = []) {
    await clearContinuityGroupHighlights();
    ctx.highlighter.isProgrammaticSelect = true;
    try {
      for (let index = 0; index < groups.length; index += 1) {
        const group = groups[index];
        const color = ctx.continuityGroupColors[index % ctx.continuityGroupColors.length];
        const styleName = `continuity-group-${index + 1}`;
        const fragmentMap = {};
        for (const member of group.members || []) {
          if (!fragmentMap[member.modelId]) fragmentMap[member.modelId] = new Set();
          fragmentMap[member.modelId].add(Number(member.localId));
        }
        if (api.countModelIdMapItems(fragmentMap) === 0) continue;
        ctx.highlighter.styles.set(styleName, {
          color: new THREE.Color(color),
          opacity: 0.85,
          transparent: true,
        });
        ctx.continuityHighlightStyleNames.add(styleName);
        await ctx.highlighter.highlightByID(styleName, fragmentMap, false, false);
      }
    } catch (error) {
      console.warn('[Tray Systems] Continuity group highlight failed:', error);
      api.updateTagAssignmentUi('Warning: continuity groups could not be colored in the viewer.', 'warning');
    } finally {
      ctx.highlighter.isProgrammaticSelect = false;
    }
  }

  // ──────────────────────────────────────────────
  //  TAGGED TRAY SYSTEM AUTOMATIC HIGHLIGHTING
  // ──────────────────────────────────────────────

  async function refreshTaggedTrayHighlights() {
    const taggedElements = typeof api.getEffectiveTaggedElements === 'function' ? api.getEffectiveTaggedElements() : [];
    const count = taggedElements.length;

    if (dom.taggedHighlightCountBadge) {
      dom.taggedHighlightCountBadge.textContent = `${count} tagged`;
    }
    if (dom.toggleHighlightTagged) {
      dom.toggleHighlightTagged.checked = ctx.isTaggedHighlightActive;
    }
    if (dom.toggleHighlightTaggedSidebar) {
      dom.toggleHighlightTaggedSidebar.checked = ctx.isTaggedHighlightActive;
    }
    if (dom.taggedHighlightColorInput) {
      dom.taggedHighlightColorInput.value = ctx.taggedHighlightColor;
    }
    if (dom.taggedHighlightHexInput) {
      dom.taggedHighlightHexInput.value = ctx.taggedHighlightColor.toUpperCase();
    }

    await refreshFloatingLabels();

    if (!ctx.isTaggedHighlightActive) {
      try {
        await ctx.highlighter.clear(ctx.taggedTrayHighlightStyle);
      } catch (err) {
        console.warn('[Tagged Tray Highlight] Clear failed:', err);
      }
      return;
    }

    const fragmentMap = {};
    for (const elem of taggedElements) {
      if (!elem.modelId) continue;
      if (!fragmentMap[elem.modelId]) fragmentMap[elem.modelId] = new Set();
      fragmentMap[elem.modelId].add(Number(elem.localId));
    }

    ctx.highlighter.isProgrammaticSelect = true;
    try {
      await ctx.highlighter.clear(ctx.taggedTrayHighlightStyle);
      if (api.countModelIdMapItems(fragmentMap) > 0) {
        ctx.highlighter.styles.set(ctx.taggedTrayHighlightStyle, {
          color: new THREE.Color(ctx.taggedHighlightColor),
          opacity: 0.85,
          transparent: true,
        });
        await ctx.highlighter.highlightByID(ctx.taggedTrayHighlightStyle, fragmentMap, false, false);
      }
    } catch (error) {
      console.warn('[Tagged Tray Highlight] Highlight failed:', error);
    } finally {
      ctx.highlighter.isProgrammaticSelect = false;
    }
  }

  function setTaggedHighlightActive(active) {
    ctx.isTaggedHighlightActive = Boolean(active);
    localStorage.setItem('bim-highlight-tagged-active', String(ctx.isTaggedHighlightActive));
    if (dom.toggleHighlightTagged) dom.toggleHighlightTagged.checked = ctx.isTaggedHighlightActive;
    if (dom.toggleHighlightTaggedSidebar) dom.toggleHighlightTaggedSidebar.checked = ctx.isTaggedHighlightActive;
    refreshTaggedTrayHighlights();
  }

  async function refreshFloatingLabels() {
    if (!ctx.tagLabelManager) return;
    await ctx.tagLabelManager.refreshLabels(api.getEffectiveTaggedElements(), ctx.loadedModels);
  }

  async function setFloatingLabelsActive(active) {
    ctx.isFloatingLabelsActive = Boolean(active);
    localStorage.setItem('bim-floating-labels-active', String(ctx.isFloatingLabelsActive));
    if (dom.toggleFloatingLabels) dom.toggleFloatingLabels.checked = ctx.isFloatingLabelsActive;
    if (dom.toggleFloatingLabelsSidebar) dom.toggleFloatingLabelsSidebar.checked = ctx.isFloatingLabelsActive;
    if (!ctx.tagLabelManager) return;

    await ctx.tagLabelManager.setVisible(ctx.isFloatingLabelsActive, ctx.loadedModels);
    if (ctx.isFloatingLabelsActive) await refreshFloatingLabels();
  }

  function setTaggedHighlightColorValue(color) {
    const normalized = normalizeHexColor(color);
    if (!normalized) return;
    ctx.taggedHighlightColor = normalized;
    localStorage.setItem('bim-highlight-tagged-color', ctx.taggedHighlightColor);
    if (dom.taggedHighlightColorInput) dom.taggedHighlightColorInput.value = ctx.taggedHighlightColor;
    if (dom.taggedHighlightHexInput) dom.taggedHighlightHexInput.value = ctx.taggedHighlightColor.toUpperCase();
    if (ctx.isTaggedHighlightActive) {
      refreshTaggedTrayHighlights();
    }
  }

  function initTagLabelManager() {
    ctx.tagLabelManager = new TagLabelManager(ctx.components, ctx.world, {
      clusterThreshold: 45,
      yOffset: 0.25,
      getHighlightColor: () => ctx.taggedHighlightColor,
      onClick: async (modelId, localId) => {
        const modelEntry = api.findLoadedModelEntry(modelId);
        if (!modelEntry?.model) return;

        const expressId = Number(localId);
        if (!Number.isInteger(expressId)) return;
        const fragmentMap = { [modelId]: new Set([expressId]) };

        try {
          await api.zoomToElementInModel(modelEntry.model, expressId);
          ctx.highlighter.isProgrammaticSelect = true;
          await ctx.highlighter.highlightByID('select', fragmentMap, true, true);
          ctx.currentSelectionMap = api.cloneModelIdMap(fragmentMap);
          ctx.activeModel = modelEntry.model;
          await api.displayElementProperties(modelEntry.model, expressId, modelEntry.name);
          ctx.selectedIfcElement = await api.readElementIdentity(modelEntry.model, expressId, modelEntry.name);
          ctx.routingController.setSelectedElement(modelEntry.model, expressId);
          api.updateTagAssignmentUi(`Focused on floating tag #${expressId}.`);
          api.refreshLoadedModelsList();
        } catch (err) {
          console.warn('[Floating Tag] Failed to focus element:', err);
        } finally {
          ctx.highlighter.isProgrammaticSelect = false;
        }
      },
    });
  }

  function wireHighlightToggles() {
    dom.toggleHighlightTagged?.addEventListener('change', (e) => {
      setTaggedHighlightActive(e.target.checked);
    });

    dom.toggleHighlightTaggedSidebar?.addEventListener('change', (e) => {
      setTaggedHighlightActive(e.target.checked);
    });

    dom.toggleFloatingLabels?.addEventListener('change', (e) => {
      void setFloatingLabelsActive(e.target.checked);
    });

    dom.toggleFloatingLabelsSidebar?.addEventListener('change', (e) => {
      void setFloatingLabelsActive(e.target.checked);
    });

    dom.taggedHighlightColorInput?.addEventListener('input', (e) => {
      setTaggedHighlightColorValue(e.target.value);
    });

    dom.taggedHighlightHexInput?.addEventListener('change', (e) => {
      setTaggedHighlightColorValue(e.target.value);
    });

    dom.selectionHighlightColorInput?.addEventListener('input', async () => {
      await applySelectionHighlightSetting(dom.selectionHighlightColorInput.value);
    });

    dom.selectionHighlightHex?.addEventListener('change', async () => {
      const normalized = normalizeHexColor(dom.selectionHighlightHex.value);
      if (!normalized) {
        dom.selectionHighlightHex.value = ctx.selectionHighlightColor.toUpperCase();
        return;
      }
      await applySelectionHighlightSetting(normalized);
    });
  }

  api.setSelectionHighlightStyle = setSelectionHighlightStyle;
  api.applySelectionHighlightSetting = applySelectionHighlightSetting;
  api.reapplyAppearanceColors = reapplyAppearanceColors;
  api.applyAppearanceColorToCurrentSelection = applyAppearanceColorToCurrentSelection;
  api.clearContinuityGroupHighlights = clearContinuityGroupHighlights;
  api.applyContinuityGroupHighlights = applyContinuityGroupHighlights;
  api.refreshTaggedTrayHighlights = refreshTaggedTrayHighlights;
  api.setTaggedHighlightActive = setTaggedHighlightActive;
  api.setFloatingLabelsActive = setFloatingLabelsActive;
  api.refreshFloatingLabels = refreshFloatingLabels;

  return {
    setSelectionHighlightStyle,
    applySelectionHighlightSetting,
    reapplyAppearanceColors,
    applyAppearanceColorToCurrentSelection,
    clearContinuityGroupHighlights,
    applyContinuityGroupHighlights,
    refreshTaggedTrayHighlights,
    setTaggedHighlightActive,
    setFloatingLabelsActive,
    refreshFloatingLabels,
    initTagLabelManager,
    wireHighlightToggles,
  };
}
