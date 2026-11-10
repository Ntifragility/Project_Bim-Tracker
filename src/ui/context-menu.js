// Right-click context menu for the tray viewer.
//
// Owns focus/isolate/show-all/color actions on the current selection.
// Extracted verbatim from `src/main.js` (behaviour unchanged per R1);
// selection and highlight helpers arrive through the shared `api` object.

import { normalizeHexColor } from './helpers.js';

/**
 * @param {object} ctx app context (`src/ui/context.js`)
 * @param {object} dom DOM handles (`src/ui/dom.js`)
 * @param {object} api shared runtime API (populated by feature modules)
 */
export function initContextMenu(ctx, dom, api) {
  function closeViewerContextMenu() {
    dom.viewerContextMenu.hidden = true;
  }

  function ensureModelObjectsVisible(modelIdMap) {
    for (const modelId of Object.keys(modelIdMap || {})) {
      const modelEntry = ctx.loadedModels.find((entry) =>
        entry.model?.modelId === modelId ||
        entry.model?.uuid === modelId ||
        entry.uuid === modelId
      );
      if (!modelEntry) continue;
      modelEntry.visible = true;
      const modelObject = modelEntry.model.object || modelEntry.model;
      if (modelObject) modelObject.visible = true;
    }
    api.refreshLoadedModelsList();
  }

  function updateContextMenuActions() {
    const selection = api.getSelectedModelIdMap();
    const selectionCount = api.countModelIdMapItems(selection);
    const currentSelectionIsAlreadyIsolated = ctx.isolationActive && api.areModelIdMapsEqual(selection, ctx.lastIsolatedSelectionMap);
    dom.contextFocusItem.hidden = !ctx.selectedIfcElement;
    dom.contextIsolateItem.hidden = selectionCount === 0 || currentSelectionIsAlreadyIsolated;
    dom.contextColorControl.hidden = selectionCount === 0;
    dom.contextIsolateItem.textContent = selectionCount > 1
      ? `◌ Isolate ${selectionCount} Selected`
      : '◌ Isolate Selected';
    dom.contextSelectionColor.value = ctx.selectedAppearanceColor;
    dom.contextColorHex.value = ctx.selectedAppearanceColor.toUpperCase();
    dom.contextShowAll.hidden = !ctx.isolationActive;
  }

  function wireContextMenu() {
    dom.container.addEventListener('contextmenu', (event) => {
      closeViewerContextMenu();
      updateContextMenuActions();
      if (dom.contextFocusItem.hidden && dom.contextIsolateItem.hidden && dom.contextColorControl.hidden && dom.contextShowAll.hidden) return;

      event.preventDefault();
      dom.viewerContextMenu.hidden = false;
      const menuRect = dom.viewerContextMenu.getBoundingClientRect();
      dom.viewerContextMenu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - menuRect.width - 8))}px`;
      dom.viewerContextMenu.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - menuRect.height - 8))}px`;
      const firstVisibleAction = [
        dom.contextFocusItem,
        dom.contextIsolateItem,
        dom.contextColorControl.hidden ? null : dom.contextSelectionColor,
        dom.contextShowAll,
      ].filter(Boolean).find((item) => !item.hidden);
      firstVisibleAction?.focus();
    });

    dom.contextSelectionColor.addEventListener('input', async () => {
      ctx.selectedAppearanceColor = dom.contextSelectionColor.value.toLowerCase();
      dom.contextColorHex.value = ctx.selectedAppearanceColor.toUpperCase();
      await api.applyAppearanceColorToCurrentSelection();
    });

    dom.contextColorHex.addEventListener('change', async () => {
      const normalized = normalizeHexColor(dom.contextColorHex.value);
      if (!normalized) {
        dom.contextColorHex.value = ctx.selectedAppearanceColor.toUpperCase();
        return;
      }
      ctx.selectedAppearanceColor = normalized;
      dom.contextSelectionColor.value = ctx.selectedAppearanceColor;
      dom.contextColorHex.value = ctx.selectedAppearanceColor.toUpperCase();
      await api.applyAppearanceColorToCurrentSelection();
    });

    dom.contextIsolateItem.addEventListener('click', async () => {
      const selection = api.getSelectedModelIdMap();
      const selectionCount = api.countModelIdMapItems(selection);
      closeViewerContextMenu();
      if (!selectionCount) return;
      if (ctx.isolationActive && api.areModelIdMapsEqual(selection, ctx.lastIsolatedSelectionMap)) return;

      try {
        ensureModelObjectsVisible(selection);
        await ctx.hider.isolate(selection);
        ctx.isolationActive = true;
        ctx.lastIsolatedSelectionMap = api.cloneModelIdMap(selection);
        api.updateTagAssignmentUi(
          `Isolated ${selectionCount} selected element${selectionCount === 1 ? '' : 's'}.`,
          'success',
        );
      } catch (error) {
        console.warn('[Isolate] Failed:', error);
        api.updateTagAssignmentUi('Warning: selected elements could not be isolated.', 'warning');
      }
    });

    dom.contextShowAll.addEventListener('click', async () => {
      closeViewerContextMenu();
      try {
        await ctx.hider.set(true);
        ctx.isolationActive = false;
        ctx.lastIsolatedSelectionMap = {};
        for (const modelEntry of ctx.loadedModels) {
          modelEntry.visible = true;
          const modelObject = modelEntry.model.object || modelEntry.model;
          if (modelObject) modelObject.visible = true;
        }
        api.refreshLoadedModelsList();
        api.updateTagAssignmentUi('All IFC elements are visible again.', 'success');
      } catch (error) {
        console.warn('[Isolate] Show all failed:', error);
        api.updateTagAssignmentUi('Warning: hidden elements could not be restored.', 'warning');
      }
    });

    dom.contextFocusItem.addEventListener('click', async () => {
      const element = ctx.selectedIfcElement ? { ...ctx.selectedIfcElement } : null;
      closeViewerContextMenu();
      if (!element) return;

      const modelEntry = ctx.loadedModels.find((entry) =>
        entry.model?.modelId === element.modelId ||
        entry.model?.uuid === element.modelId ||
        entry.uuid === element.modelId
      );
      if (!modelEntry) return;

      if (!modelEntry.visible) {
        modelEntry.visible = true;
        const modelObject = modelEntry.model.object || modelEntry.model;
        if (modelObject) modelObject.visible = true;
        api.refreshLoadedModelsList();
      }

      const modelId = modelEntry.model.modelId || modelEntry.model.uuid || element.modelId;
      ctx.highlighter.isProgrammaticSelect = true;
      try {
        await ctx.highlighter.highlightByID(
          'select',
          { [modelId]: new Set([Number(element.localId)]) },
          true,
          true,
        );
        ctx.activeModel = modelEntry.model;
        await api.displayElementProperties(modelEntry.model, element.localId, modelEntry.name);
        ctx.selectedIfcElement = await api.readElementIdentity(modelEntry.model, element.localId, modelEntry.name);
        ctx.routingController.setSelectedElement(modelEntry.model, element.localId);
        await api.zoomToElementInModel(modelEntry.model, element.localId);
        api.updateTagAssignmentUi(`Focused on element #${element.localId}.`);
      } catch (error) {
        console.warn('[Focus on Item] Failed:', error);
        api.updateTagAssignmentUi(`Warning: element #${element.localId} could not be focused.`, 'warning');
      } finally {
        ctx.highlighter.isProgrammaticSelect = false;
      }
    });

    document.addEventListener('pointerdown', (event) => {
      if (!dom.viewerContextMenu.hidden && !dom.viewerContextMenu.contains(event.target)) {
        closeViewerContextMenu();
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeViewerContextMenu();
    });
    window.addEventListener('blur', closeViewerContextMenu);
    window.addEventListener('resize', closeViewerContextMenu);
  }

  api.ensureModelObjectsVisible = ensureModelObjectsVisible;
  api.closeViewerContextMenu = closeViewerContextMenu;

  return {
    closeViewerContextMenu,
    ensureModelObjectsVisible,
    updateContextMenuActions,
    wireContextMenu,
  };
}
