// Shared small helpers for the tray-viewer feature modules.
//
// Pure formatting and IFC-identity helpers extracted verbatim from
// `src/main.js` so every `src/ui/*` module shares one definition.
// Fns that need runtime state take the app context (`src/ui/context.js`)
// explicitly; nothing here touches module-level globals.

import { IFC_TYPE_MAP, getModernIfcTypeName } from './ifc-types.js';

/** Loading overlay controls (elements from `src/ui/dom.js`). */
export function showLoader(dom, title, status, progressVal) {
  dom.loadingOverlay.style.display = 'flex';
  dom.loaderTitle.innerText = title;
  dom.loaderStatus.innerText = status;
  dom.loaderProgress.style.width = `${progressVal}%`;
}

export function hideLoader(dom) {
  dom.loadingOverlay.style.display = 'none';
}

export function updateLoader(dom, status, progressVal) {
  dom.loaderStatus.innerText = status;
  dom.loaderProgress.style.width = `${progressVal}%`;
}

/** Human-readable byte size (SI k=1024 ladder, 2-decimal). */
export function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/** Normalize a `#rrggbb` hex color; null when invalid. */
export function normalizeHexColor(value) {
  const raw = String(value || '').trim();
  const withHash = raw.startsWith('#') ? raw : `#${raw}`;
  return /^#[0-9a-fA-F]{6}$/.test(withHash) ? withHash.toLowerCase() : null;
}

/** `modelId:localId` key shared by tagging, excel and editing panels. */
export function getAssignmentKey(modelId, localId) {
  return `${modelId}:${Number(localId)}`;
}

/** `modelId:localId` key used by the staged-IFC-edit map. */
export function ifcEditElementKey(modelId, localId) {
  return `${modelId}:${Number(localId)}`;
}

/** Tag-replacement confirmation dialog; resolves true when confirmed. */
export function requestTagReplacement(dom, localId, currentTag, replacementTag) {
  dom.tagReplaceMessage.textContent = `Element #${localId} belongs to tray system “${currentTag}”. Move it to “${replacementTag}”?`;
  dom.tagReplaceDialog.hidden = false;
  dom.tagReplaceConfirm.focus();

  return new Promise((resolve) => {
    const finish = (confirmed) => {
      dom.tagReplaceDialog.hidden = true;
      dom.tagReplaceConfirm.removeEventListener('click', confirm);
      dom.tagReplaceCancel.removeEventListener('click', cancel);
      dom.tagReplaceDialog.removeEventListener('click', cancelFromBackdrop);
      document.removeEventListener('keydown', cancelFromEscape);
      resolve(confirmed);
    };
    const confirm = () => finish(true);
    const cancel = () => finish(false);
    const cancelFromBackdrop = (event) => {
      if (event.target === dom.tagReplaceDialog) finish(false);
    };
    const cancelFromEscape = (event) => {
      if (event.key === 'Escape') finish(false);
    };

    dom.tagReplaceConfirm.addEventListener('click', confirm);
    dom.tagReplaceCancel.addEventListener('click', cancel);
    dom.tagReplaceDialog.addEventListener('click', cancelFromBackdrop);
    document.addEventListener('keydown', cancelFromEscape);
  });
}

/**
 * Minimal IFC element identity used across selection, tagging and export.
 * Prefers the indexed `getItemsData` path, falls back to `getProperties`.
 */
export async function readElementIdentity(model, localId, modelName) {
  let data = {};
  const read = (attribute) => attribute && typeof attribute === 'object' && 'value' in attribute
    ? attribute.value
    : attribute;

  if (model && typeof model.getItemsData === 'function') {
    try {
      data = (await model.getItemsData([Number(localId)], {
        attributesDefault: true,
        relationsDefault: { attributes: false, relations: false },
      }))?.[0] || {};
    } catch (err) {
      console.warn(`[readElementIdentity] getItemsData failed for #${localId}:`, err);
    }
  }

  if (!data || Object.keys(data).length === 0) {
    if (model && typeof model.getProperties === 'function') {
      try {
        data = (await model.getProperties(Number(localId))) || {};
      } catch (err) {
        console.warn(`[readElementIdentity] getProperties fallback failed for #${localId}:`, err);
      }
    }
  }

  return {
    modelId: model?.modelId || model?.uuid || '',
    modelName: modelName || '',
    localId: Number(localId),
    globalId: read(data.GlobalId ?? data._guid) || '',
    name: read(data.Name) || '',
    type: getModernIfcTypeName(data) || (data.type ? IFC_TYPE_MAP[data.type] || `IFC Type ${data.type}` : 'IfcElement'),
    ifcTag: read(data.Tag) || '',
  };
}
