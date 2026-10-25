// Safe IFC editing for the tray viewer.
//
// Owns the metadata row builder, staged property/color edits and the unified
// export (delegating to `src/ui/unified-export.js`). Extracted verbatim from
// `src/main.js` (behaviour unchanged per R1); assignment lookups arrive
// through the shared `api` object.

import { exportUnifiedIfc as runUnifiedExport } from './unified-export.js';
import { ifcEditElementKey, normalizeHexColor } from './helpers.js';

/**
 * @param {object} ctx app context (`src/ui/context.js`)
 * @param {object} dom DOM handles (`src/ui/dom.js`)
 * @param {object} api shared runtime API (populated by feature modules)
 */
export function initEditing(ctx, dom, api) {
  const METADATA_TYPES = [
    ['IFCLABEL', 'Label'],
    ['IFCTEXT', 'Text'],
    ['IFCIDENTIFIER', 'Identifier'],
    ['IFCINTEGER', 'Integer'],
    ['IFCREAL', 'Decimal'],
    ['IFCBOOLEAN', 'Boolean'],
    ['IFCDATE', 'Date'],
    ['IFCDATETIME', 'Date & Time'],
  ];

  function createMetadataRow(initial = {}) {
    const row = document.createElement('div');
    row.className = 'metadata-row';
    const property = document.createElement('input');
    property.type = 'text';
    property.className = 'metadata-property';
    property.placeholder = 'WBS';
    property.value = initial.property || '';
    property.setAttribute('aria-label', 'Metadata property name');
    const type = document.createElement('select');
    type.className = 'metadata-type';
    type.setAttribute('aria-label', 'Metadata IFC data type');
    for (const [value, label] of METADATA_TYPES) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      option.selected = value === (initial.valueType || 'IFCLABEL');
      type.appendChild(option);
    }
    const value = document.createElement('input');
    value.type = 'text';
    value.className = 'metadata-value';
    value.placeholder = 'Value';
    value.value = initial.value ?? '';
    value.setAttribute('aria-label', 'Metadata value');
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'metadata-row-remove';
    remove.textContent = '×';
    remove.title = 'Remove metadata row';
    remove.setAttribute('aria-label', 'Remove metadata row');
    remove.addEventListener('click', () => {
      row.remove();
      if (!dom.metadataRows.children.length) createMetadataRow();
    });
    row.append(property, type, value, remove);
    dom.metadataRows.appendChild(row);
    return row;
  }

  function readMetadataRows() {
    return Array.from(dom.metadataRows.querySelectorAll('.metadata-row')).map((row) => ({
      property: row.querySelector('.metadata-property').value.trim(),
      valueType: row.querySelector('.metadata-type').value,
      value: row.querySelector('.metadata-value').value,
    })).filter((item) => item.property || item.value);
  }

  function replaceMetadataRows(rows) {
    dom.metadataRows.innerHTML = '';
    for (const row of rows) createMetadataRow(row);
    if (!dom.metadataRows.children.length) createMetadataRow();
  }

  function renderPendingIfcEdits(message = '') {
    const propertyEdits = Array.from(ctx.pendingIfcPropertyEdits.values());
    const colorEdits = Array.from(ctx.pendingIfcColorEdits.values());
    const total = propertyEdits.length + colorEdits.length;
    dom.ifcEditCount.textContent = `${total} pending`;
    dom.btnClearIfcEdits.disabled = total === 0;
    dom.btnExportEditedIfc.disabled = total === 0;
    dom.ifcEditStatus.textContent = message || (total
      ? 'Changes are staged only. Export creates a new IFC.'
      : 'Select an element to begin.');
    dom.ifcEditPendingList.innerHTML = '';

    const appendItem = (edit, key, collection, label) => {
      const row = document.createElement('div');
      row.className = 'ifc-edit-pending-item';
      const text = document.createElement('span');
      text.textContent = `#${edit.localId} · ${label}`;
      text.title = text.textContent;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Remove';
      remove.addEventListener('click', () => {
        collection.delete(key);
        renderPendingIfcEdits('Pending edit removed.');
      });
      row.append(text, remove);
      dom.ifcEditPendingList.appendChild(row);
    };
    for (const [key, edit] of ctx.pendingIfcPropertyEdits) {
      appendItem(edit, key, ctx.pendingIfcPropertyEdits, `${edit.propertySet}.${edit.property} → ${edit.value}`);
    }
    for (const [key, edit] of ctx.pendingIfcColorEdits) {
      appendItem(edit, key, ctx.pendingIfcColorEdits, `${edit.color.toUpperCase()} · ${Math.round(edit.transparency * 100)}% transparent`);
    }
  }

  function stageColorForSelection(color, transparency = 0) {
    const selection = api.getSelectedModelIdMap();
    let staged = 0;
    for (const [modelId, ids] of Object.entries(selection)) {
      for (const localId of ids) {
        const key = ifcEditElementKey(modelId, localId);
        ctx.pendingIfcColorEdits.set(key, {
          modelId,
          localId: Number(localId),
          color,
          transparency,
        });
        staged += 1;
      }
    }
    if (staged) renderPendingIfcEdits(`Staged persistent color for ${staged} element${staged === 1 ? '' : 's'}.`);
    return staged;
  }

  function wireEditingControls() {
    replaceMetadataRows([
      { property: 'WBS', valueType: 'IFCIDENTIFIER', value: '' },
      { property: 'SOP', valueType: 'IFCIDENTIFIER', value: '' },
    ]);

    dom.btnAddMetadataRow.addEventListener('click', () => {
      createMetadataRow();
      dom.metadataRows.querySelector('.metadata-row:last-child .metadata-property')?.focus();
    });

    dom.btnCopyPreviousMetadata.addEventListener('click', () => {
      if (!ctx.lastMetadataTemplate) return;
      dom.metadataPset.value = ctx.lastMetadataTemplate.propertySet;
      replaceMetadataRows(ctx.lastMetadataTemplate.rows);
      renderPendingIfcEdits(`Copied the previous metadata template for element #${ctx.selectedIfcElement?.localId || '-'}.`);
    });

    dom.btnStageMetadata.addEventListener('click', () => {
      const targetElements = (ctx.multiSelectionElements.length >= 2 && ctx.multiSelectionIndex === -1)
        ? ctx.multiSelectionElements
        : (ctx.multiSelectionIndex >= 0 && ctx.multiSelectionElements[ctx.multiSelectionIndex])
          ? [ctx.multiSelectionElements[ctx.multiSelectionIndex]]
          : ctx.selectedIfcElement ? [ctx.selectedIfcElement] : [];

      if (!targetElements.length) {
        renderPendingIfcEdits('Select at least one IFC element before staging metadata.');
        return;
      }
      const propertySet = dom.metadataPset.value.trim();
      if (!/^(?:BIM_TRACKER_EDIT|COSAPI_[A-Z0-9_]+)$/i.test(propertySet)) {
        renderPendingIfcEdits('Use BIM_TRACKER_EDIT or a COSAPI_ prefixed property-set name.');
        return;
      }
      const rows = readMetadataRows();
      if (!rows.length) {
        renderPendingIfcEdits('Add at least one metadata property and value.');
        return;
      }
      const invalid = rows.find((row) => !row.property || row.value === '');
      if (invalid) {
        renderPendingIfcEdits('Every metadata row requires both a property name and value.');
        return;
      }

      let stagedEditsCount = 0;
      for (const elem of targetElements) {
        const modelId = elem.modelId;
        const localId = Number(elem.localId);
        for (const row of rows) {
          const key = `${ifcEditElementKey(modelId, localId)}:${propertySet.toLowerCase()}:${row.property.toLowerCase()}`;
          ctx.pendingIfcPropertyEdits.set(key, {
            modelId,
            localId,
            propertySet,
            property: row.property,
            value: row.value,
            valueType: row.valueType,
          });
          stagedEditsCount += 1;
        }
      }

      ctx.lastMetadataTemplate = {
        propertySet,
        rows: rows.map((row) => ({ ...row })),
      };
      dom.btnCopyPreviousMetadata.disabled = false;

      const countLabel = targetElements.length > 1
        ? `${rows.length} metadata property value(s) across ${targetElements.length} elements (${stagedEditsCount} total edits)`
        : `${rows.length} metadata value(s) for element #${targetElements[0].localId}`;
      renderPendingIfcEdits(`Staged ${countLabel}.`);
    });

    dom.btnStagePropertyEdit.addEventListener('click', () => {
      const targetElements = (ctx.multiSelectionElements.length >= 2 && ctx.multiSelectionIndex === -1)
        ? ctx.multiSelectionElements
        : (ctx.multiSelectionIndex >= 0 && ctx.multiSelectionElements[ctx.multiSelectionIndex])
          ? [ctx.multiSelectionElements[ctx.multiSelectionIndex]]
          : ctx.selectedIfcElement ? [ctx.selectedIfcElement] : [];

      if (!targetElements.length) {
        renderPendingIfcEdits('Select at least one IFC element before staging a property change.');
        return;
      }
      const propertySet = dom.ifcEditPset.value.trim();
      const property = dom.ifcEditProperty.value.trim();
      const value = dom.ifcEditValue.value;
      if (!propertySet || !property) {
        renderPendingIfcEdits('Property set and property name are required.');
        return;
      }

      for (const elem of targetElements) {
        const modelId = elem.modelId;
        const localId = Number(elem.localId);
        const key = `${ifcEditElementKey(modelId, localId)}:${propertySet.toLowerCase()}:${property.toLowerCase()}`;
        ctx.pendingIfcPropertyEdits.set(key, { modelId, localId, propertySet, property, value });
      }

      const countLabel = targetElements.length > 1
        ? `${propertySet}.${property} across ${targetElements.length} elements`
        : `${propertySet}.${property} for element #${targetElements[0].localId}`;
      renderPendingIfcEdits(`Staged ${countLabel}.`);
    });

    dom.btnStageColorEdit.addEventListener('click', async () => {
      const color = normalizeHexColor(dom.ifcEditColor.value);
      if (!color) {
        renderPendingIfcEdits('Choose a valid RGB color.');
        return;
      }
      ctx.selectedAppearanceColor = color;
      dom.contextSelectionColor.value = color;
      dom.contextColorHex.value = color.toUpperCase();
      await api.applyAppearanceColorToCurrentSelection();
    });

    dom.btnClearIfcEdits.addEventListener('click', () => {
      ctx.pendingIfcPropertyEdits.clear();
      ctx.pendingIfcColorEdits.clear();
      renderPendingIfcEdits('All pending IFC edits cleared.');
    });

    // Local export wrapper: validates, then delegates to `src/ui/unified-export.js`.
    // (The wrapper keeps the imported name; see the shadowing note below.)
    function exportUnifiedIfcLocal() {
      if (ctx.loadedModels.length === 0) {
        alert('No loaded IFC models to export.');
        return;
      }

      const validation = api.runTagValidation();
      if (ctx.tagAssignments.size > 0 && !validation.valid) {
        const msg = `Export blocked: resolve ${validation.counts.errors} tag validation error${validation.counts.errors === 1 ? '' : 's'} in the Tagging Workbench first.`;
        api.updateTagAssignmentUi(msg, 'warning');
        alert(msg);
        return;
      }

      const { exportedModels, appliedEditsCount, appliedTagsCount, skippedCount } = runUnifiedExport({
        loadedModels: ctx.loadedModels,
        pendingIfcPropertyEdits: ctx.pendingIfcPropertyEdits,
        pendingIfcColorEdits: ctx.pendingIfcColorEdits,
        tagAssignments: ctx.tagAssignments,
      });

      if (exportedModels === 0) {
        const msg = 'No staged property edits, colors, or tag assignments to export.';
        renderPendingIfcEdits(msg);
        api.updateTagAssignmentUi(msg, 'warning');
        alert(msg);
        return;
      }

      const details = [];
      if (appliedEditsCount > 0) details.push(`${appliedEditsCount} property/color edit(s)`);
      if (appliedTagsCount > 0) details.push(`${appliedTagsCount} tag assignment(s)`);
      const summaryMsg = `Successfully exported ${details.join(' and ')} across ${exportedModels} new IFC file(s)${skippedCount ? ` (${skippedCount} skipped)` : ''}.`;

      renderPendingIfcEdits(summaryMsg);
      api.updateTagAssignmentUi(summaryMsg, skippedCount ? 'warning' : 'success');
    }

    if (dom.btnExportAllIfc) {
      dom.btnExportAllIfc.addEventListener('click', exportUnifiedIfcLocal);
    }
    if (dom.btnExportEditedIfc) {
      dom.btnExportEditedIfc.addEventListener('click', exportUnifiedIfcLocal);
    }
    if (dom.btnExportTaggedIfc) {
      dom.btnExportTaggedIfc.addEventListener('click', exportUnifiedIfcLocal);
    }
  }

  api.renderPendingIfcEdits = renderPendingIfcEdits;
  api.stageColorForSelection = stageColorForSelection;

  return {
    createMetadataRow,
    readMetadataRows,
    replaceMetadataRows,
    renderPendingIfcEdits,
    stageColorForSelection,
    wireEditingControls,
  };
}
