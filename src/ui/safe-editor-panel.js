// Safe editor panel glue (task 7.4).
//
// Exports `initSafeEditorPanel({ ctx, dom, api })`; NOT imported by any
// existing file (wiring happens later). Collects pending property/colour
// edits into caller-owned Maps keyed by `modelId + element localId`,
// validates against the safe-editor whitelist + typed-value table with
// explanatory status messages (never silently drops), and triggers export
// through the `editedIfcFileName` naming convention.
//
// Rules (spec docs/specs/tray/safe-ifc-editor.md):
//  - non-destructive: source bytes kept byte-identical; export uses
//    the `-edited.ifc` / `*_edited.ifc` suffix naming.
//  - whitelist: NEW properties only in BIM_TRACKER_EDIT / COSAPI_*; updates
//    to EXISTING properties allowed in any pset.
//  - 8 typed values (IFCLABEL, IFCTEXT, IFCIDENTIFIER, IFCBOOLEAN,
//    IFCINTEGER, IFCREAL, IFCDATE, IFCDATETIME).
//  - colour plan: hex + transparency clamp; entity-id allocation TS-side;
//    geometry untouched (only IFCPROPERTYSINGLEVALUE values + style chains).

import {
  CUSTOM_PROPERTY_SET_PATTERN,
  EDITABLE_IFC_VALUE_TYPES,
  applySafeIfcEdits,
  editedIfcFileName,
  formatTypedValue,
  rgbFromHex,
} from '../ifc/ifc-safe-editor.js';

export const SAFE_EDITOR_VALUE_TYPES = Object.freeze([
  'IFCLABEL',
  'IFCTEXT',
  'IFCIDENTIFIER',
  'IFCBOOLEAN',
  'IFCINTEGER',
  'IFCREAL',
  'IFCDATE',
  'IFCDATETIME',
]);

function pendingPropertyKey(modelId, localId, propertySet, property) {
  return `${String(modelId ?? '')}#${Number(localId)}:${String(propertySet).toLowerCase()}:${String(property).toLowerCase()}`;
}

function pendingColorKey(modelId, localId) {
  return `${String(modelId ?? '')}#${Number(localId)}`;
}

function normalizeHex(color) {
  const text = String(color ?? '').trim();
  return /^#?[0-9a-f]{6}$/i.test(text) ? (text.startsWith('#') ? text : `#${text}`) : null;
}

function clampTransparency(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(1, Math.max(0, number));
}

/**
 * Validate + stage one property edit. Returns a status message explaining
 * the outcome (accepted or why it was rejected). Never silently drops.
 */
export function validatePropertyEdit({ propertySet, property, value, valueType = 'IFCLABEL' }) {
  const pset = String(propertySet ?? '').trim();
  const name = String(property ?? '').trim();
  if (!pset || !name) {
    return { ok: false, message: 'Property set and property name are required.' };
  }
  const type = String(valueType || 'IFCLABEL').toUpperCase();
  if (!EDITABLE_IFC_VALUE_TYPES.has(type)) {
    return { ok: false, message: `IFC value type ${type} is not supported (use ${SAFE_EDITOR_VALUE_TYPES.join(', ')}).` };
  }
  try {
    formatTypedValue(type, value);
  } catch (error) {
    return { ok: false, message: error?.message || `Value is not a valid ${type}.` };
  }
  if (!CUSTOM_PROPERTY_SET_PATTERN.test(pset)) {
    return {
      ok: true,
      warning: 'New properties must live in BIM_TRACKER_EDIT or a COSAPI_* set; this edit will only apply if the property already exists.',
      message: 'Staged as an update to an existing property (new properties require BIM_TRACKER_EDIT or COSAPI_*).',
    };
  }
  return { ok: true, message: `Staged ${pset}.${name} (${type}).` };
}

export function validateColorEdit({ color, transparency = 0 }) {
  const hex = normalizeHex(color);
  if (!hex) {
    return { ok: false, message: `"${color}" is not a valid six-digit RGB color (e.g. #FF8800).` };
  }
  try {
    rgbFromHex(hex);
  } catch (error) {
    return { ok: false, message: error?.message || 'Invalid color.' };
  }
  const clamped = clampTransparency(transparency);
  const note = clamped !== Number(transparency)
    ? ` Transparency clamped to ${Math.round(clamped * 100)}%.`
    : '';
  return { ok: true, transparency: clamped, color: hex, message: `Staged color ${hex.toUpperCase()} (${Math.round(clamped * 100)}% transparent).${note}` };
}

/**
 * @param {object} options
 * @param {object} options.ctx app context (expects pendingIfcPropertyEdits / pendingIfcColorEdits Maps, loadedModels)
 * @param {object} options.dom DOM handles (optional; needs ifcEditStatus for messages)
 * @param {object} options.api shared runtime API (optional; may expose getSelectedModelIdMap/export hooks)
 */
export function initSafeEditorPanel({ ctx, dom, api } = {}) {
  const propertyEdits = ctx?.pendingIfcPropertyEdits instanceof Map
    ? ctx.pendingIfcPropertyEdits
    : new Map();
  const colorEdits = ctx?.pendingIfcColorEdits instanceof Map
    ? ctx.pendingIfcColorEdits
    : new Map();

  function setStatus(message) {
    if (dom?.ifcEditStatus) dom.ifcEditStatus.textContent = message;
  }

  function stagePropertyEdit({ modelId, localId, propertySet, property, value, valueType = 'IFCLABEL' }) {
    const validation = validatePropertyEdit({ propertySet, property, value, valueType });
    if (!validation.ok) {
      setStatus(`Edit not staged: ${validation.message}`);
      return { staged: false, ...validation };
    }
    const key = pendingPropertyKey(modelId, localId, propertySet, property);
    propertyEdits.set(key, {
      modelId,
      localId: Number(localId),
      propertySet: String(propertySet).trim(),
      property: String(property).trim(),
      value,
      valueType: String(valueType || 'IFCLABEL').toUpperCase(),
    });
    setStatus(validation.message);
    return { staged: true, key, ...validation };
  }

  function stageColorEdit({ modelId, localId, color, transparency = 0 }) {
    const validation = validateColorEdit({ color, transparency });
    if (!validation.ok) {
      setStatus(`Color not staged: ${validation.message}`);
      return { staged: false, ...validation };
    }
    const key = pendingColorKey(modelId, localId);
    colorEdits.set(key, {
      modelId,
      localId: Number(localId),
      color: validation.color,
      transparency: validation.transparency,
    });
    setStatus(validation.message);
    return { staged: true, key, ...validation };
  }

  function clearEdits() {
    propertyEdits.clear();
    colorEdits.clear();
    setStatus('All pending safe-editor edits cleared.');
  }

  function collectEditsFor(modelEntry) {
    const modelIds = new Set(
      [modelEntry?.uuid, modelEntry?.model?.uuid, modelEntry?.model?.modelId].filter(Boolean),
    );
    return {
      propertyEdits: Array.from(propertyEdits.values()).filter((edit) => modelIds.has(edit.modelId)),
      colorEdits: Array.from(colorEdits.values()).filter((edit) => modelIds.has(edit.modelId)),
    };
  }

  function exportEditedModels() {
    const models = ctx?.loadedModels ?? [];
    if (!models.length) {
      const message = 'No loaded IFC models to export.';
      setStatus(message);
      return { exported: [], message };
    }
    const exported = [];
    const skipped = [];
    for (const modelEntry of models) {
      const { propertyEdits: props, colorEdits: colors } = collectEditsFor(modelEntry);
      if (!props.length && !colors.length) continue;
      if (!modelEntry.sourceIfcBytes) {
        skipped.push({ model: modelEntry.name, reason: 'no source bytes available' });
        continue;
      }
      try {
        const result = applySafeIfcEdits(modelEntry.sourceIfcBytes, {
          propertyEdits: props,
          colorEdits: colors,
        });
        const fileName = editedIfcFileName(modelEntry.name);
        const download = typeof api?.downloadEditedIfc === 'function'
          ? () => api.downloadEditedIfc({ bytes: result.bytes, fileName, modelEntry })
          : null;
        exported.push({ model: modelEntry.name, fileName, applied: result.applied, skipped: result.skipped, download });
      } catch (error) {
        skipped.push({ model: modelEntry?.name, reason: error?.message || 'export failed' });
      }
    }
    if (!exported.length) {
      const message = skipped.length
        ? `Nothing exported: ${skipped.map((s) => `${s.model || 'model'} (${s.reason})`).join('; ')}.`
        : 'No staged property edits or colors to export.';
      setStatus(message);
      return { exported, skipped, message };
    }
    const message = `Export ready: ${exported.map((e) => e.fileName).join(', ')}${skipped.length ? ` (${skipped.length} skipped)` : ''}.`;
    setStatus(message);
    return { exported, skipped, message };
  }

  return {
    propertyEdits,
    colorEdits,
    stagePropertyEdit,
    stageColorEdit,
    clearEdits,
    collectEditsFor,
    exportEditedModels,
    editedFileNameFor: (name) => editedIfcFileName(name),
    setStatus,
  };
}
