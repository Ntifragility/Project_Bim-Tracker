// Selection handling for the tray viewer.
//
// Owns the highlighter select/clear event wiring, multi-selection header
// navigation, orbit-pivot/zoom helpers, and the tray-member highlight/isolate
// actions. Extracted verbatim from `src/main.js` (behaviour unchanged per
// R1); cross-panel refreshes go through the shared `api` object populated
// by the other feature modules at bootstrap.

import * as THREE from 'three';
import * as OBC from '@thatopen/components';
import { readElementIdentity, getAssignmentKey } from './helpers.js';

/**
 * @param {object} ctx app context (`src/ui/context.js`)
 * @param {object} dom DOM handles (`src/ui/dom.js`)
 * @param {object} api shared runtime API (populated by feature modules)
 */
export function initSelection(ctx, dom, api) {
  function cloneModelIdMap(modelIdMap = {}) {
    const clone = {};
    for (const [modelId, ids] of Object.entries(modelIdMap || {})) {
      const values = ids instanceof Set ? Array.from(ids) : Array.isArray(ids) ? ids : [];
      if (values.length) clone[modelId] = new Set(values.map(Number));
    }
    return clone;
  }

  function countModelIdMapItems(modelIdMap = {}) {
    return Object.values(modelIdMap).reduce((sum, ids) => {
      if (ids instanceof Set) return sum + ids.size;
      if (Array.isArray(ids)) return sum + ids.length;
      return sum;
    }, 0);
  }

  function areModelIdMapsEqual(a = {}, b = {}) {
    const aKeys = Object.keys(a).filter((key) => countModelIdMapItems({ [key]: a[key] }) > 0).sort();
    const bKeys = Object.keys(b).filter((key) => countModelIdMapItems({ [key]: b[key] }) > 0).sort();
    if (aKeys.length !== bKeys.length) return false;
    for (let i = 0; i < aKeys.length; i++) {
      const key = aKeys[i];
      if (key !== bKeys[i]) return false;
      const aValues = a[key] instanceof Set ? Array.from(a[key]) : Array.isArray(a[key]) ? a[key] : [];
      const bValues = b[key] instanceof Set ? Array.from(b[key]) : Array.isArray(b[key]) ? b[key] : [];
      if (aValues.length !== bValues.length) return false;
      const bSet = new Set(bValues.map(Number));
      if (aValues.some((id) => !bSet.has(Number(id)))) return false;
    }
    return true;
  }

  function getSelectedModelIdMap() {
    if (countModelIdMapItems(ctx.currentSelectionMap)) return cloneModelIdMap(ctx.currentSelectionMap);
    const selectedElements = (ctx.multiSelectionElements.length >= 2 && ctx.multiSelectionIndex === -1)
      ? ctx.multiSelectionElements
      : (ctx.multiSelectionIndex >= 0 && ctx.multiSelectionElements[ctx.multiSelectionIndex])
        ? [ctx.multiSelectionElements[ctx.multiSelectionIndex]]
        : [];
    if (selectedElements.length) {
      const selection = {};
      for (const element of selectedElements) {
        if (!element?.modelId || !Number.isFinite(Number(element.localId))) continue;
        if (!selection[element.modelId]) selection[element.modelId] = new Set();
        selection[element.modelId].add(Number(element.localId));
      }
      if (countModelIdMapItems(selection)) return selection;
    }
    if (!ctx.selectedIfcElement) return {};
    return { [ctx.selectedIfcElement.modelId]: new Set([Number(ctx.selectedIfcElement.localId)]) };
  }

  function addModelIdMapItems(target, source) {
    for (const [modelId, ids] of Object.entries(source || {})) {
      const values = ids instanceof Set ? Array.from(ids) : Array.isArray(ids) ? ids : [];
      if (!values.length) continue;
      if (!target[modelId]) target[modelId] = new Set();
      for (const id of values) target[modelId].add(Number(id));
    }
  }

  function removeModelIdMapItems(target, source) {
    for (const [modelId, ids] of Object.entries(source || {})) {
      if (!target[modelId]) continue;
      const values = ids instanceof Set ? Array.from(ids) : Array.isArray(ids) ? ids : [];
      for (const id of values) target[modelId].delete(Number(id));
      if (target[modelId].size === 0) delete target[modelId];
    }
  }

  function findLoadedModelEntry(modelId) {
    return ctx.loadedModels.find((entry) =>
      entry.model?.modelId === modelId ||
      entry.model?.uuid === modelId ||
      entry.uuid === modelId
    ) || null;
  }

  async function getElementsFromModelIdMap(modelIdMap) {
    const elements = [];
    for (const [modelId, ids] of Object.entries(modelIdMap || {})) {
      const modelEntry = findLoadedModelEntry(modelId);
      if (!modelEntry) continue;
      const values = ids instanceof Set ? Array.from(ids) : Array.isArray(ids) ? ids : [];
      for (const localId of values) {
        elements.push(await readElementIdentity(modelEntry.model, Number(localId), modelEntry.name));
      }
    }
    return elements;
  }

  async function getCurrentSelectionElements() {
    const selection = getSelectedModelIdMap();
    if (countModelIdMapItems(selection) > 0) return getElementsFromModelIdMap(selection);
    return ctx.selectedIfcElement ? [{ ...ctx.selectedIfcElement }] : [];
  }

  // Make an IFC element the pivot for subsequent left-mouse orbiting.
  async function setOrbitTargetToElement(model, expressId) {
    if (!model) return;
    const bboxer = ctx.components.get(OBC.BoundingBoxer);
    try {
      bboxer.list.clear();
      const modelId = model.modelId || model.uuid;
      await bboxer.addFromModelIdMap({ [modelId]: new Set([Number(expressId)]) });
      const box = bboxer.get();
      if (box && !box.isEmpty()) {
        const center = new THREE.Vector3();
        box.getCenter(center);
        ctx.world.camera.controls.setOrbitPoint(center.x, center.y, center.z);
      }
    } catch (error) {
      console.warn('[Camera Orbit] Could not set the selected element as pivot:', error);
    } finally {
      bboxer.list.clear();
    }
  }

  // Helper: Zoom to a specific Express ID inside a specific model
  async function zoomToElementInModel(model, expressId) {
    if (!model) return;
    try {
      const bboxer = ctx.components.get(OBC.BoundingBoxer);
      bboxer.list.clear();
      const modelId = model.modelId || model.uuid;
      await bboxer.addFromModelIdMap({ [modelId]: new Set([Number(expressId)]) });
      const box = bboxer.get();
      if (box && !box.isEmpty()) {
        const sphere = new THREE.Sphere();
        box.getBoundingSphere(sphere);
        if (sphere.radius < 0.5) sphere.radius = 1.0;
        ctx.world.camera.controls.fitToSphere(sphere, true);
      }
      bboxer.list.clear();
    } catch (e) {
      console.warn('zoomToElementInModel failed:', e);
    }
  }

  // Helper: Zoom to a specific Express ID inside activeModel
  async function zoomToElement(expressId) {
    await zoomToElementInModel(ctx.activeModel, expressId);
  }

  async function highlightTrayMembers(members, message) {
    if (!members.length) return false;
    const firstMember = members[0];
    const firstModelEntry = ctx.loadedModels.find((entry) =>
      entry.model?.modelId === firstMember.modelId || entry.model?.uuid === firstMember.modelId
    );
    if (!firstModelEntry) return false;

    const fragmentMap = {};
    for (const member of members) {
      const modelEntry = ctx.loadedModels.find((entry) =>
        entry.model?.modelId === member.modelId || entry.model?.uuid === member.modelId
      );
      if (!modelEntry) continue;
      if (!modelEntry.visible) {
        modelEntry.visible = true;
        const modelObject = modelEntry.model.object || modelEntry.model;
        if (modelObject) modelObject.visible = true;
      }
      if (!fragmentMap[member.modelId]) fragmentMap[member.modelId] = new Set();
      fragmentMap[member.modelId].add(Number(member.localId));
    }
    api.refreshLoadedModelsList();

    ctx.highlighter.isProgrammaticSelect = true;
    try {
      await ctx.highlighter.highlightByID('select', fragmentMap, true, true);
      ctx.currentSelectionMap = cloneModelIdMap(fragmentMap);
      ctx.activeModel = firstModelEntry.model;
      await api.displayElementProperties(firstModelEntry.model, firstMember.localId, firstModelEntry.name);
      ctx.selectedIfcElement = await readElementIdentity(firstModelEntry.model, firstMember.localId, firstModelEntry.name);
      ctx.routingController.setSelectedElement(firstModelEntry.model, firstMember.localId);
      api.updateTagAssignmentUi(message);
      return true;
    } catch (error) {
      console.warn('[Tray Systems] Member highlight failed:', error);
      api.updateTagAssignmentUi('Warning: the tray-system elements could not be highlighted.', 'warning');
      return false;
    } finally {
      ctx.highlighter.isProgrammaticSelect = false;
    }
  }

  async function isolateTrayMembers(members, message) {
    if (!members.length) return false;
    const fragmentMap = {};
    for (const member of members) {
      if (!fragmentMap[member.modelId]) fragmentMap[member.modelId] = new Set();
      fragmentMap[member.modelId].add(Number(member.localId));
    }

    try {
      api.ensureModelObjectsVisible(fragmentMap);
      await ctx.hider.isolate(fragmentMap);
      ctx.isolationActive = true;
      ctx.currentSelectionMap = cloneModelIdMap(fragmentMap);
      ctx.lastIsolatedSelectionMap = cloneModelIdMap(fragmentMap);
      api.updateTagAssignmentUi(message || `Isolated ${members.length} tray-system component${members.length === 1 ? '' : 's'}.`, 'success');
      return true;
    } catch (error) {
      console.warn('[Tray Systems] Member isolation failed:', error);
      api.updateTagAssignmentUi('Warning: the tray-system elements could not be isolated.', 'warning');
      return false;
    }
  }

  function wireSelectionEvents() {
    // Bidirectional highlighting: 3D Selection -> Excel Selection & Loaded Models Sync
    ctx.highlighter.events.select.onHighlight.add(async (fragmentMap) => {
      try {
        if (ctx.highlighter.isProgrammaticSelect) return;

        const visibleSelectionMap = Object.fromEntries(
          Object.entries(fragmentMap || {}).filter(([modelId]) => findLoadedModelEntry(modelId)?.visible)
        );
        ctx.currentSelectionMap = cloneModelIdMap(visibleSelectionMap);
        if (ctx.batchPreviewAssignments.length) api.clearBatchPreview('Selection changed. Preview the current selection again.');
        api.reconcileSelectionOrder(ctx.currentSelectionMap);
        let selectedModelId = null;
        let selectedExpressId = null;
        const viewportSelection = [];
        if (Object.keys(visibleSelectionMap).length > 0) {
          for (const modelId in visibleSelectionMap) {
            const ids = visibleSelectionMap[modelId];
            if (ids && ids.size > 0) {
              for (const id of ids) viewportSelection.push({ modelId, localId: Number(id) });
            } else if (Array.isArray(ids) && ids.length > 0) {
              for (const id of ids) viewportSelection.push({ modelId, localId: Number(id) });
            }
          }
          selectedModelId = viewportSelection[0]?.modelId ?? null;
          selectedExpressId = viewportSelection[0]?.localId ?? null;
        }

        if (viewportSelection.length > 0) {
          const identities = [];
          for (const selected of viewportSelection) {
            const modelEntry = ctx.loadedModels.find((entry) =>
              entry.model?.modelId === selected.modelId ||
              entry.model?.uuid === selected.modelId ||
              entry.uuid === selected.modelId
            );
            if (!modelEntry || !modelEntry.model) continue;
            try {
              const identity = await readElementIdentity(modelEntry.model, selected.localId, modelEntry.name);
              identities.push(identity);
            } catch (err) {
              console.warn('[onHighlight] Identity read failed for', selected.localId, err);
            }
          }
          ctx.multiSelectionElements = identities;
          if (viewportSelection.length > 1) {
            ctx.traySelection.clear();
            identities.forEach((identity) => ctx.traySelection.set(getAssignmentKey(identity.modelId, identity.localId), identity));
          }
        } else {
          ctx.multiSelectionElements = [];
        }

        if (selectedExpressId !== null) {
          const expressIdNum = Number(selectedExpressId);

          // Sync viewport selection back to active model state and Loaded Models sidebar list
          const foundModelEntry = ctx.loadedModels.find((entry) =>
            entry.model?.modelId === selectedModelId ||
            entry.model?.uuid === selectedModelId ||
            entry.uuid === selectedModelId
          );

          if (foundModelEntry && !foundModelEntry.visible) {
            console.debug(`[Selection] Discarded pick on hidden model "${foundModelEntry.name}" (element #${expressIdNum}).`);
            return;
          }

          if (foundModelEntry) {
            ctx.activeModel = foundModelEntry.model;
            ctx.routingController.setSelectedElement(foundModelEntry.model, expressIdNum);
            try {
              await setOrbitTargetToElement(foundModelEntry.model, expressIdNum);
            } catch (err) {
              console.warn('[onHighlight] setOrbitTargetToElement failed:', err);
            }

            // Prioritize displaying properties before any other asynchronous tasks
            if (ctx.multiSelectionElements.length > 1) {
              ctx.multiSelectionIndex = -1; // Combined View
              await api.displayCombinedProperties(ctx.multiSelectionElements);
            } else {
              ctx.multiSelectionIndex = -1;
              if (dom.multiSelectHeader) dom.multiSelectHeader.style.display = 'none';
              await api.displayElementProperties(foundModelEntry.model, expressIdNum, foundModelEntry.name);
            }

            // Set selectedIfcElement safely
            const matchedIdentity = ctx.multiSelectionElements.find((identity) => identity.localId === expressIdNum);
            if (matchedIdentity) {
              ctx.selectedIfcElement = matchedIdentity;
            } else {
              ctx.selectedIfcElement = await readElementIdentity(foundModelEntry.model, expressIdNum, foundModelEntry.name);
            }

            api.updateTagAssignmentUi();
            api.refreshLoadedModelsList();
          }
        }
      } catch (handlerErr) {
        console.error('[onHighlight] Selection handler failed:', handlerErr);
      }
    });

    if (dom.btnMultiCombined) {
      dom.btnMultiCombined.addEventListener('click', async () => {
        if (ctx.multiSelectionElements.length < 2) return;
        ctx.multiSelectionIndex = -1;
        await api.displayCombinedProperties(ctx.multiSelectionElements);
      });
    }

    if (dom.btnMultiPrev) {
      dom.btnMultiPrev.addEventListener('click', async () => {
        if (ctx.multiSelectionElements.length < 2 || ctx.multiSelectionIndex <= 0) return;
        ctx.multiSelectionIndex -= 1;
        const targetElem = ctx.multiSelectionElements[ctx.multiSelectionIndex];
        const modelEntry = ctx.loadedModels.find((e) => e.model?.modelId === targetElem.modelId || e.model?.uuid === targetElem.modelId || e.uuid === targetElem.modelId);
        if (modelEntry) {
          api.renderMultiSelectHeader();
          await api.displayElementProperties(modelEntry.model, targetElem.localId, modelEntry.name);
        }
      });
    }

    if (dom.btnMultiNext) {
      dom.btnMultiNext.addEventListener('click', async () => {
        if (ctx.multiSelectionElements.length < 2 || ctx.multiSelectionIndex >= ctx.multiSelectionElements.length - 1) return;
        ctx.multiSelectionIndex += 1;
        const targetElem = ctx.multiSelectionElements[ctx.multiSelectionIndex];
        const modelEntry = ctx.loadedModels.find((e) => e.model?.modelId === targetElem.modelId || e.model?.uuid === targetElem.modelId || e.uuid === targetElem.modelId);
        if (modelEntry) {
          api.renderMultiSelectHeader();
          await api.displayElementProperties(modelEntry.model, targetElem.localId, modelEntry.name);
        }
      });
    }

    ctx.highlighter.events.select.onClear.add(() => {
      if (ctx.highlighter.isProgrammaticSelect) return;

      ctx.activeModel = null;
      ctx.selectedIfcElement = null;
      ctx.currentSelectionMap = {};
      ctx.selectionOrderKeys = [];
      api.reconcileSelectionOrder({});
      api.clearBatchPreview('Select one or more IFC elements to begin.');
      ctx.traySelection.clear();
      ctx.routingController.setSelectedElement(null, null);
      api.updateTagAssignmentUi();
      ctx.autoRotateActive = false;
      if (dom.orbitIndicator) {
        dom.orbitIndicator.style.display = 'none';
      }

      // Reset element properties panel
      api.clearElementProperties();

      api.refreshLoadedModelsList();
    });
  }

  api.cloneModelIdMap = cloneModelIdMap;
  api.countModelIdMapItems = countModelIdMapItems;
  api.areModelIdMapsEqual = areModelIdMapsEqual;
  api.getSelectedModelIdMap = getSelectedModelIdMap;
  api.addModelIdMapItems = addModelIdMapItems;
  api.removeModelIdMapItems = removeModelIdMapItems;
  api.findLoadedModelEntry = findLoadedModelEntry;
  api.getElementsFromModelIdMap = getElementsFromModelIdMap;
  api.getCurrentSelectionElements = getCurrentSelectionElements;
  api.setOrbitTargetToElement = setOrbitTargetToElement;
  api.zoomToElement = zoomToElement;
  api.zoomToElementInModel = zoomToElementInModel;
  api.highlightTrayMembers = highlightTrayMembers;
  api.isolateTrayMembers = isolateTrayMembers;

  return {
    cloneModelIdMap,
    countModelIdMapItems,
    areModelIdMapsEqual,
    getSelectedModelIdMap,
    addModelIdMapItems,
    removeModelIdMapItems,
    findLoadedModelEntry,
    getElementsFromModelIdMap,
    getCurrentSelectionElements,
    setOrbitTargetToElement,
    zoomToElement,
    zoomToElementInModel,
    highlightTrayMembers,
    isolateTrayMembers,
    wireSelectionEvents,
  };
}
