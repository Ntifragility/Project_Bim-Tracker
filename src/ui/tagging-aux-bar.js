// src/ui/tagging-aux-bar.js
// Docked Auxiliary Sequential Tagging Bar for Cable Tray Viewer (Revit Options Bar style).
// Zero browser prompts — define Fixed prefix + Variable counter, click elements in sequence
// (Click-to-Tag mode) or tag multi-selection in one click, and export Excel (TAG UNICO | ANCHO | LONGITUD).

import { exportTrayScheduleExcel } from 'excel-io';
import {
  formatSequentialTag,
  getNextAvailableSequence,
  allocateSequentialTags,
  compareNaturalTags,
} from '../tagging/sequential-tagger.js';
import { getAssignmentKey } from './helpers.js';

const STORAGE_KEY = 'covillaf:trayAuxTagPattern';

function loadSavedPattern() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      prefix: typeof raw.prefix === 'string' && raw.prefix.trim() ? raw.prefix : 'CT01.01.',
      start: Math.max(1, Number.parseInt(raw.start, 10) || 1),
      digits: Math.max(1, Math.min(6, Number.parseInt(raw.digits, 10) || 2)),
    };
  } catch {
    return { prefix: 'CT01.01.', start: 1, digits: 2 };
  }
}

function savePattern(p) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch { /* noop */ }
}

export function initTaggingAuxBar(ctx, dom, api) {
  const container = dom.container;
  if (!container || typeof document === 'undefined') return null;

  const saved = loadSavedPattern();
  let isOpen = false;
  let clickToTagActive = true;
  let prefix = saved.prefix;
  let currentSeq = saved.start;
  let digits = saved.digits;
  let statusText = 'Click elements in 3D to tag sequentially.';
  const undoStack = []; // Array<{ prevSeq, entries: Array<{ key, previous }> }>

  const host = document.createElement('div');
  host.id = 'tray-tagging-aux-bar';
  host.style.cssText =
    'position:absolute;top:10px;left:50%;transform:translateX(-50%);z-index:28;' +
    'display:none;flex-direction:column;gap:4px;max-width:calc(100% - 24px);' +
    'background:rgba(15,23,42,0.94);color:#e2e8f0;border:1px solid #334155;' +
    'border-radius:8px;padding:7px 10px;font:12px/1.3 system-ui,-apple-system,sans-serif;' +
    'box-shadow:0 10px 28px rgba(0,0,0,0.45);backdrop-filter:blur(8px);';

  // Stop clicks/wheel inside bar from leaking to Three.js canvas / highlighter
  for (const ev of ['pointerdown', 'pointerup', 'click', 'dblclick', 'wheel', 'contextmenu']) {
    host.addEventListener(ev, (e) => e.stopPropagation());
  }

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:center;flex-wrap:wrap;gap:6px;';

  const mkLabel = (txt) => {
    const s = document.createElement('span');
    s.textContent = txt;
    s.style.cssText = 'font-size:11px;color:#94a3b8;white-space:nowrap;';
    return s;
  };

  const prefixInput = document.createElement('input');
  prefixInput.type = 'text';
  prefixInput.value = prefix;
  prefixInput.placeholder = 'CT01.01.';
  prefixInput.title = 'Fixed prefix (e.g. CT01.01. or BC-101-)';
  prefixInput.style.cssText =
    'width:110px;background:#1e293b;color:#f8fafc;border:1px solid #475569;border-radius:4px;' +
    'padding:3px 6px;font:600 12px/1.2 monospace;';

  const startInput = document.createElement('input');
  startInput.type = 'number';
  startInput.min = '1';
  startInput.value = String(currentSeq);
  startInput.title = 'Next sequence number';
  startInput.style.cssText =
    'width:56px;background:#1e293b;color:#f8fafc;border:1px solid #475569;border-radius:4px;' +
    'padding:3px 6px;font:600 12px/1.2 monospace;';

  const digitsSelect = document.createElement('select');
  digitsSelect.title = 'Sequence zero-padding digits';
  digitsSelect.style.cssText =
    'background:#1e293b;color:#f8fafc;border:1px solid #475569;border-radius:4px;padding:3px 5px;font-size:11px;';
  for (const d of [1, 2, 3, 4]) {
    const opt = document.createElement('option');
    opt.value = String(d);
    opt.textContent = `${d}d`;
    if (d === digits) opt.selected = true;
    digitsSelect.appendChild(opt);
  }

  const nextPreview = document.createElement('span');
  nextPreview.style.cssText =
    'padding:3px 8px;border-radius:4px;background:#0f172a;border:1px solid #38bdf8;' +
    'color:#38bdf8;font:700 11px/1.2 monospace;white-space:nowrap;';

  const btnClickMode = document.createElement('button');
  btnClickMode.type = 'button';
  btnClickMode.style.cssText =
    'border-radius:4px;padding:4px 9px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;';

  const btnTagSelected = document.createElement('button');
  btnTagSelected.type = 'button';
  btnTagSelected.style.cssText =
    'background:#1e293b;color:#e2e8f0;border:1px solid #475569;border-radius:4px;' +
    'padding:4px 9px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;';

  const btnUndo = document.createElement('button');
  btnUndo.type = 'button';
  btnUndo.textContent = 'Undo';
  btnUndo.style.cssText =
    'background:#1e293b;color:#cbd5e1;border:1px solid #334155;border-radius:4px;' +
    'padding:4px 8px;font-size:11px;cursor:pointer;';

  const btnExportExcel = document.createElement('button');
  btnExportExcel.type = 'button';
  btnExportExcel.textContent = 'Export Excel';
  btnExportExcel.title = 'Export TAG UNICO, ANCHO, LONGITUD to Excel (.xlsx)';
  btnExportExcel.style.cssText =
    'background:#0284c7;color:#f8fafc;border:none;border-radius:4px;' +
    'padding:4px 10px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;';

  const btnClose = document.createElement('button');
  btnClose.type = 'button';
  btnClose.textContent = '✕';
  btnClose.title = 'Close Tagging Bar';
  btnClose.style.cssText =
    'background:transparent;color:#94a3b8;border:none;font-size:13px;cursor:pointer;padding:2px 4px;';

  row.append(
    mkLabel('Fixed:'),
    prefixInput,
    mkLabel('Next #:'),
    startInput,
    digitsSelect,
    nextPreview,
    btnClickMode,
    btnTagSelected,
    btnUndo,
    btnExportExcel,
    btnClose,
  );

  const statusLine = document.createElement('div');
  statusLine.style.cssText = 'font-size:11px;color:#94a3b8;display:flex;justify-content:space-between;gap:12px;';

  host.append(row, statusLine);
  container.appendChild(host);

  function getAllExistingTagStrings() {
    const effective = api.getEffectiveTaggedElements?.() || [];
    return effective.map((e) => e.elementTag || e.componentId || '').filter(Boolean);
  }

  function getSelectedCount() {
    const map = api.getSelectedModelIdMap?.() || {};
    let total = 0;
    for (const ids of Object.values(map)) {
      total += ids instanceof Set ? ids.size : Array.isArray(ids) ? ids.length : 0;
    }
    return total;
  }

  function syncUi() {
    host.style.display = isOpen ? 'flex' : 'none';
    const nextSeq = getNextAvailableSequence({
      prefix,
      startSequence: currentSeq,
      digits,
      existingTags: getAllExistingTagStrings(),
    });
    nextPreview.textContent = prefix.trim()
      ? `Next: ${formatSequentialTag(prefix, nextSeq, digits)}`
      : 'Enter prefix';

    btnClickMode.textContent = clickToTagActive ? 'Click-to-Tag: ON' : 'Click-to-Tag: OFF';
    btnClickMode.style.background = clickToTagActive ? '#16a34a' : '#1e293b';
    btnClickMode.style.color = clickToTagActive ? '#052e16' : '#94a3b8';
    btnClickMode.style.border = clickToTagActive ? '1px solid #4ade80' : '1px solid #475569';

    const selCount = getSelectedCount();
    btnTagSelected.textContent = `Tag Selected (${selCount})`;
    btnTagSelected.disabled = selCount === 0 || !prefix.trim();
    btnTagSelected.style.opacity = btnTagSelected.disabled ? '0.5' : '1';

    btnUndo.disabled = undoStack.length === 0;
    btnUndo.style.opacity = btnUndo.disabled ? '0.45' : '1';

    const totalTagged = (api.getEffectiveTaggedElements?.() || []).length;
    btnExportExcel.disabled = totalTagged === 0;
    btnExportExcel.style.opacity = btnExportExcel.disabled ? '0.5' : '1';

    statusLine.textContent = `${statusText}  ·  Total tagged: ${totalTagged}`;
  }

  function commitElements(elements) {
    if (!elements || elements.length === 0) return false;
    const result = allocateSequentialTags({
      elements,
      prefix,
      startSequence: currentSeq,
      digits,
      existingTags: getAllExistingTagStrings(),
    });
    if (!result.valid) {
      statusText = result.error || 'Could not generate sequential tags.';
      syncUi();
      return false;
    }

    const snapshotEntries = [];
    for (const assignment of result.assignments) {
      const key = getAssignmentKey(assignment.modelId, assignment.localId);
      snapshotEntries.push({
        key,
        previous: ctx.tagAssignments.has(key) ? { ...ctx.tagAssignments.get(key) } : null,
      });
      ctx.tagAssignments.set(key, {
        ...assignment,
        excelRowIndex: ctx.selectedExcelRowIndex,
      });
    }
    undoStack.push({ prevSeq: currentSeq, entries: snapshotEntries });
    if (undoStack.length > 50) undoStack.shift();

    currentSeq = result.nextSequence;
    startInput.value = String(currentSeq);
    savePattern({ prefix, start: currentSeq, digits });

    const firstTag = result.assignments[0].elementTag;
    const lastTag = result.assignments[result.assignments.length - 1].elementTag;
    statusText = result.assignments.length === 1
      ? `Tagged #${result.assignments[0].localId} → ${firstTag}`
      : `Tagged ${result.assignments.length} elements (${firstTag} → ${lastTag})`;

    if (result.assignments[0]?.systemTag) {
      ctx.selectedTraySystemTag = result.assignments[0].systemTag;
      if (dom.systemTagInput) dom.systemTagInput.value = result.assignments[0].systemTag;
    }

    api.renderExcelTable?.();
    api.updateTagAssignmentUi?.(statusText, 'success');
    api.updateTaggedElementsHighlight?.();
    api.updateFloatingTagLabels?.();
    api.refreshRibbon?.();
    syncUi();
    return true;
  }

  function undoLast() {
    const batch = undoStack.pop();
    if (!batch) return false;
    for (const item of batch.entries) {
      if (item.previous) ctx.tagAssignments.set(item.key, item.previous);
      else ctx.tagAssignments.delete(item.key);
    }
    currentSeq = batch.prevSeq;
    startInput.value = String(currentSeq);
    savePattern({ prefix, start: currentSeq, digits });
    statusText = `Undid ${batch.entries.length} tag${batch.entries.length === 1 ? '' : 's'} (counter back to ${currentSeq}).`;
    api.renderExcelTable?.();
    api.updateTagAssignmentUi?.(statusText, 'success');
    api.updateTaggedElementsHighlight?.();
    api.updateFloatingTagLabels?.();
    api.refreshRibbon?.();
    syncUi();
    return true;
  }

  async function exportExcelSchedule() {
    const effective = (api.getEffectiveTaggedElements?.() || []).slice().sort((a, b) =>
      compareNaturalTags(a.elementTag || a.componentId, b.elementTag || b.componentId),
    );
    if (!effective.length) {
      statusText = 'No tagged elements to export yet.';
      syncUi();
      return false;
    }
    statusText = `Reading dimensions for ${effective.length} tagged elements...`;
    syncUi();

    const mainRows = [];
    const detailRows = [];
    for (const item of effective) {
      const dims = (await api.readElementDimensions?.(item)) || { Width: '', Length: '' };
      const tagUnico = item.elementTag || item.componentId || item.systemTag || '';
      mainRows.push({
        tagUnico,
        ancho: dims.Width ?? '',
        longitud: dims.Length ?? '',
      });
      detailRows.push({
        'TAG UNICO': tagUnico,
        'IFC_Type': item.type || '',
        'Element_Name': item.name || '',
        'IFC_GlobalId': item.globalId || '',
        'Local_ID': item.localId ?? '',
        'Model': item.modelName || '',
      });
    }

    const baseName = String(ctx.loadedModels?.[0]?.name || 'Bandejas').replace(/\.(ifc|frag)$/i, '');
    const fileName = `${baseName}_Tags.xlsx`;
    exportTrayScheduleExcel(mainRows, detailRows, fileName);
    statusText = `Exported ${mainRows.length} rows (TAG UNICO, ANCHO, LONGITUD) to ${fileName}.`;
    syncUi();
    return true;
  }

  // Input handlers
  prefixInput.addEventListener('input', () => {
    prefix = prefixInput.value;
    savePattern({ prefix, start: currentSeq, digits });
    syncUi();
  });
  startInput.addEventListener('input', () => {
    currentSeq = Math.max(1, Number.parseInt(startInput.value, 10) || 1);
    savePattern({ prefix, start: currentSeq, digits });
    syncUi();
  });
  digitsSelect.addEventListener('change', () => {
    digits = Math.max(1, Math.min(6, Number.parseInt(digitsSelect.value, 10) || 2));
    savePattern({ prefix, start: currentSeq, digits });
    syncUi();
  });
  btnClickMode.addEventListener('click', () => {
    clickToTagActive = !clickToTagActive;
    statusText = clickToTagActive
      ? 'Click-to-Tag ON — click elements in 3D one by one to tag sequentially.'
      : 'Click-to-Tag OFF — select elements and click Tag Selected.';
    syncUi();
  });
  btnTagSelected.addEventListener('click', async () => {
    const ordered = await api.getCurrentSelectionElements?.();
    if (!ordered?.length) {
      statusText = 'Select one or more elements in 3D first.';
      syncUi();
      return;
    }
    commitElements(ordered);
  });
  btnUndo.addEventListener('click', () => undoLast());
  btnExportExcel.addEventListener('click', () => { exportExcelSchedule(); });
  btnClose.addEventListener('click', () => {
    isOpen = false;
    syncUi();
  });

  // Hook called by selection.js whenever user clicks an element in 3D
  function onElementSelected(identity, multiList = []) {
    if (!isOpen) return;
    if (clickToTagActive && identity && (!multiList || multiList.length <= 1)) {
      const key = getAssignmentKey(identity.modelId, identity.localId);
      const already = ctx.tagAssignments.get(key);
      if (already && already.delete !== true) {
        statusText = `Element #${identity.localId} already has tag ${already.elementTag || already.componentId}.`;
        syncUi();
        return;
      }
      commitElements([identity]);
    } else {
      syncUi();
    }
  }

  const barApi = {
    open({ clickMode = true } = {}) {
      isOpen = true;
      clickToTagActive = clickMode;
      statusText = clickToTagActive
        ? 'Click-to-Tag ON — click elements in 3D one by one to tag sequentially.'
        : 'Select elements in 3D and click Tag Selected.';
      syncUi();
      prefixInput.focus();
      prefixInput.select();
    },
    close() {
      isOpen = false;
      syncUi();
    },
    toggle() {
      if (isOpen) this.close();
      else this.open();
    },
    isOpen: () => isOpen,
    isClickToTagActive: () => isOpen && clickToTagActive,
    onElementSelected,
    exportExcelSchedule,
    undoLast,
    syncUi,
  };

  api.taggingAuxBar = barApi;
  api.onElementSelectedForTagging = onElementSelected;
  api.exportTrayScheduleExcel = exportExcelSchedule;
  return barApi;
}
