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
    const hiddenCount = ctx.engine?.visibility?.getHiddenCount?.() ?? 0;
    const isIsolated = ctx.engine?.isolation?.isIsolated?.() ?? ctx.isolationActive;
    const currentSelectionIsAlreadyIsolated = isIsolated && api.areModelIdMapsEqual(selection, ctx.lastIsolatedSelectionMap);

    dom.contextFocusItem.hidden = selectionCount === 0 && !ctx.selectedIfcElement;
    if (dom.contextHideItem) {
      dom.contextHideItem.hidden = selectionCount === 0;
      dom.contextHideItem.textContent = selectionCount > 1
        ? `🙈 Hide ${selectionCount} Selected`
        : '🙈 Hide Selected';
    }
    if (dom.contextUnhideAll) {
      dom.contextUnhideAll.hidden = hiddenCount === 0;
      dom.contextUnhideAll.textContent = `👁 Unhide All (${hiddenCount})`;
    }
    dom.contextIsolateItem.hidden = selectionCount === 0 || currentSelectionIsAlreadyIsolated;
    dom.contextIsolateItem.textContent = selectionCount > 1
      ? `◌ Isolate ${selectionCount} Selected`
      : '◌ Isolate Selected';
    if (dom.contextIsolateGhost) {
      dom.contextIsolateGhost.hidden = selectionCount === 0;
      dom.contextIsolateGhost.textContent = selectionCount > 1
        ? `◈ Ghost Isolate ${selectionCount}`
        : '◈ Isolate in Transparency';
    }
    if (dom.contextSectionBox) {
      dom.contextSectionBox.hidden = selectionCount === 0;
    }
    dom.contextColorControl.hidden = selectionCount === 0;
    dom.contextSelectionColor.value = ctx.selectedAppearanceColor;
    dom.contextColorHex.value = ctx.selectedAppearanceColor.toUpperCase();
    dom.contextShowAll.hidden = !isIsolated && hiddenCount === 0;
  }

  function wireContextMenu() {
    ctx.engine?.visibility?.onChange?.((visState) => {
      ctx.isolationActive = visState.isolateMode !== 'none';
    });

    let rightDownPos = null;
    dom.container.addEventListener('pointerdown', (event) => {
      if (event.button === 2) {
        rightDownPos = { x: event.clientX, y: event.clientY };
      }
    });

    dom.container.addEventListener('contextmenu', (event) => {
      const moved = rightDownPos ? Math.hypot(event.clientX - rightDownPos.x, event.clientY - rightDownPos.y) : 0;
      rightDownPos = null;
      if (moved > 4) {
        event.preventDefault();
        return; // Right-drag orbit gesture — do not pop menu
      }
      closeViewerContextMenu();
      updateContextMenuActions();
      if (
        dom.contextFocusItem.hidden &&
        (dom.contextHideItem?.hidden ?? true) &&
        (dom.contextUnhideAll?.hidden ?? true) &&
        dom.contextIsolateItem.hidden &&
        (dom.contextIsolateGhost?.hidden ?? true) &&
        (dom.contextSectionBox?.hidden ?? true) &&
        dom.contextColorControl.hidden &&
        dom.contextShowAll.hidden
      ) return;

      event.preventDefault();
      dom.viewerContextMenu.hidden = false;
      const menuRect = dom.viewerContextMenu.getBoundingClientRect();
      dom.viewerContextMenu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - menuRect.width - 8))}px`;
      dom.viewerContextMenu.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - menuRect.height - 8))}px`;
      const firstVisibleAction = [
        dom.contextFocusItem,
        dom.contextHideItem,
        dom.contextUnhideAll,
        dom.contextIsolateItem,
        dom.contextIsolateGhost,
        dom.contextSectionBox,
        dom.contextColorControl.hidden ? null : dom.contextSelectionColor,
        dom.contextShowAll,
      ].filter(Boolean).find((item) => !item.hidden);
      firstVisibleAction?.focus();
    });

    dom.contextHideItem?.addEventListener('click', async () => {
      const selection = api.getSelectedModelIdMap();
      const selectionCount = api.countModelIdMapItems(selection);
      closeViewerContextMenu();
      if (!selectionCount || !ctx.engine?.visibility) return;
      const newly = await ctx.engine.visibility.hideSelection(selection);
      api.updateTagAssignmentUi(`Hid ${newly} element${newly === 1 ? '' : 's'}.`, 'success');
    });

    dom.contextUnhideAll?.addEventListener('click', async () => {
      closeViewerContextMenu();
      if (!ctx.engine?.visibility) return;
      await ctx.engine.visibility.unhideAll();
      api.updateTagAssignmentUi('Restored all hidden elements.', 'success');
    });

    dom.contextIsolateGhost?.addEventListener('click', async () => {
      const selection = api.getSelectedModelIdMap();
      const selectionCount = api.countModelIdMapItems(selection);
      closeViewerContextMenu();
      if (!selectionCount || !ctx.engine?.isolation) return;
      ensureModelObjectsVisible(selection);
      await ctx.engine.isolation.ghostIsolate(selection);
      ctx.isolationActive = true;
      ctx.lastIsolatedSelectionMap = api.cloneModelIdMap(selection);
      api.updateTagAssignmentUi(`Ghost isolated ${selectionCount} element${selectionCount === 1 ? '' : 's'}.`, 'success');
    });

    dom.contextSectionBox?.addEventListener('click', async () => {
      const selection = api.getSelectedModelIdMap();
      const selectionCount = api.countModelIdMapItems(selection);
      closeViewerContextMenu();
      if (!selectionCount || !ctx.engine?.section) return;
      await ctx.engine.section.setBoxToSelection(selection);
      api.updateTagAssignmentUi('Section Box fitted to selection.', 'success');
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
        if (ctx.engine?.isolation?.hardIsolate) {
          await ctx.engine.isolation.hardIsolate(selection);
        } else {
          await ctx.hider.isolate(selection);
        }
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
        if (ctx.engine?.isolation?.resetIsolation) {
          await ctx.engine.isolation.resetIsolation();
        } else {
          await ctx.hider.set(true);
        }
        await ctx.engine?.visibility?.unhideAll?.();
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
      const selection = api.getSelectedModelIdMap();
      const selectionCount = api.countModelIdMapItems(selection);
      const element = ctx.selectedIfcElement ? { ...ctx.selectedIfcElement } : null;
      closeViewerContextMenu();

      if (selectionCount > 1 || (!element && selectionCount > 0)) {
        ensureModelObjectsVisible(selection);
        try {
          const focused = await ctx.engine?.focusOnSelection?.(selection);
          if (focused) {
            api.updateTagAssignmentUi(`Focused on ${selectionCount} selected element${selectionCount === 1 ? '' : 's'}.`);
          } else {
            api.updateTagAssignmentUi('Warning: selected elements could not be focused.', 'warning');
          }
        } catch (error) {
          console.warn('[Focus on Item] Failed:', error);
          api.updateTagAssignmentUi('Warning: selected elements could not be focused.', 'warning');
        }
        return;
      }

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
