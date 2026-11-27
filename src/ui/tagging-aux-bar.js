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
  let hideTaggedActive = false;
  let prefix = saved.prefix;
  let currentSeq = saved.start;
  let digits = saved.digits;
  let statusText = 'Click elements in 3D to tag sequentially.';
  const undoStack = []; // Array<{ prevSeq, nextSeq, entries: Array<{ key, modelId, localId, previous, applied }> }>
  const redoStack = [];

  const mountTarget = document.getElementById('app') || document.body || container;
  const host = document.createElement('div');
  host.id = 'tray-tagging-aux-bar';
  host.style.cssText =
    'position:fixed;top:154px;left:50%;transform:translateX(-50%);z-index:120;' +
    'display:none;flex-direction:column;gap:4px;max-width:calc(100vw - 16px);' +
    'background:rgba(15,23,42,0.96);color:#e2e8f0;border:1px solid #38bdf8;' +
    'border-radius:8px;padding:6px 10px;font:12px/1.3 system-ui,-apple-system,sans-serif;' +
    'box-shadow:0 12px 32px rgba(0,0,0,0.55);backdrop-filter:blur(8px);';

  function positionBelowRibbon() {
    const ribbonEl = document.getElementById('ribbon');
    const bottom = ribbonEl ? Math.ceil(ribbonEl.getBoundingClientRect().bottom) : 148;
    host.style.top = `${Math.max(12, bottom + 8)}px`;
  }

  // Stop clicks/wheel inside bar from leaking to Three.js canvas / highlighter
  for (const ev of ['pointerdown', 'pointerup', 'click', 'dblclick', 'wheel', 'contextmenu']) {
    host.addEventListener(ev, (e) => e.stopPropagation());
  }

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:center;flex-wrap:nowrap;gap:5px;overflow-x:auto;';

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
  prefixInput.title = 'Fixed prefix (e.g. CT01.01. or PT1.01.)';
  prefixInput.style.cssText =
    'width:92px;background:#1e293b;color:#f8fafc;border:1px solid #475569;border-radius:4px;' +
    'padding:3px 6px;font:600 12px/1.2 monospace;';

  const startInput = document.createElement('input');
  startInput.type = 'number';
  startInput.min = '1';
  startInput.value = String(currentSeq);
  startInput.title = 'Next sequence number';
  startInput.style.cssText =
    'width:44px;background:#1e293b;color:#f8fafc;border:1px solid #475569;border-radius:4px;' +
    'padding:3px 5px;font:600 12px/1.2 monospace;';

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
    'border-radius:4px;padding:3px 7px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;';

  const btnLabelsToggle = document.createElement('button');
  btnLabelsToggle.type = 'button';
  btnLabelsToggle.title = 'Toggle 3D floating tag labels visibility (keeps 3D elements visible)';
  btnLabelsToggle.style.cssText =
    'border-radius:4px;padding:3px 7px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;';

  const btnTagSelected = document.createElement('button');
  btnTagSelected.type = 'button';
  btnTagSelected.style.cssText =
    'background:#1e293b;color:#e2e8f0;border:1px solid #475569;border-radius:4px;' +
    'padding:3px 7px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;';

  const btnClearSelected = document.createElement('button');
  btnClearSelected.type = 'button';
  btnClearSelected.title = 'Remove tags from currently selected elements (Delete key; undoable with Ctrl+Z)';
  btnClearSelected.style.cssText =
    'background:#1e293b;color:#fca5a5;border:1px solid #7f1d1d;border-radius:4px;' +
    'padding:3px 7px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;';

  const btnUndo = document.createElement('button');
  btnUndo.type = 'button';
  btnUndo.textContent = 'Undo';
  btnUndo.title = 'Undo last tag change (Ctrl+Z)';
  btnUndo.style.cssText =
    'background:#1e293b;color:#cbd5e1;border:1px solid #334155;border-radius:4px;' +
    'padding:3px 7px;font-size:11px;cursor:pointer;white-space:nowrap;';

  const btnExportExcel = document.createElement('button');
  btnExportExcel.type = 'button';
  btnExportExcel.textContent = 'Export Excel';
  btnExportExcel.title = 'Export TAG UNICO, ANCHO, LONGITUD to Excel (.xlsx)';
  btnExportExcel.style.cssText =
    'background:#0284c7;color:#f8fafc;border:none;border-radius:4px;' +
    'padding:3px 9px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;';

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
    btnLabelsToggle,
    btnTagSelected,
    btnClearSelected,
    btnUndo,
    btnExportExcel,
    btnClose,
  );

  const statusLine = document.createElement('div');
  statusLine.style.cssText = 'font-size:11px;color:#94a3b8;display:flex;justify-content:space-between;gap:12px;';

  host.append(row, statusLine);
  mountTarget.appendChild(host);
  window.addEventListener('resize', () => {
    if (isOpen) positionBelowRibbon();
  });

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

  function getSelectedTaggedEntries() {
    const map = api.getSelectedModelIdMap?.() || {};
    const selectedKeys = new Set();
    for (const [modelId, ids] of Object.entries(map)) {
      const list = ids instanceof Set ? Array.from(ids) : Array.isArray(ids) ? ids : [];
      for (const localId of list) selectedKeys.add(getAssignmentKey(modelId, Number(localId)));
    }
    if (selectedKeys.size === 0) return [];
    const effective = api.getEffectiveTaggedElements?.() || [];
    return effective.filter((item) => selectedKeys.has(getAssignmentKey(item.modelId, item.localId)));
  }

  function syncUi() {
    if (isOpen) positionBelowRibbon();
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

    btnClickMode.textContent = clickToTagActive ? 'Click: ON' : 'Click: OFF';
    btnClickMode.style.background = clickToTagActive ? '#16a34a' : '#1e293b';
    btnClickMode.style.color = clickToTagActive ? '#052e16' : '#94a3b8';
    btnClickMode.style.border = clickToTagActive ? '1px solid #4ade80' : '1px solid #475569';

    const labelsOn = Boolean(ctx.isFloatingLabelsActive);
    btnLabelsToggle.textContent = labelsOn ? 'Labels: ON' : 'Labels: OFF';
    btnLabelsToggle.style.background = labelsOn ? '#0c4a6e' : '#1e293b';
    btnLabelsToggle.style.color = labelsOn ? '#bae6fd' : '#94a3b8';
    btnLabelsToggle.style.border = labelsOn ? '1px solid #38bdf8' : '1px solid #475569';

    const selCount = getSelectedCount();
    btnTagSelected.textContent = `Tag Sel (${selCount})`;
    btnTagSelected.disabled = selCount === 0 || !prefix.trim();
    btnTagSelected.style.opacity = btnTagSelected.disabled ? '0.5' : '1';

    const selTaggedCount = getSelectedTaggedEntries().length;
    btnClearSelected.textContent = `Clear (${selTaggedCount})`;
    btnClearSelected.disabled = selTaggedCount === 0;
    btnClearSelected.style.opacity = btnClearSelected.disabled ? '0.45' : '1';

    btnUndo.disabled = undoStack.length === 0;
    btnUndo.style.opacity = btnUndo.disabled ? '0.45' : '1';

    const totalTagged = (api.getEffectiveTaggedElements?.() || []).length;
    btnExportExcel.disabled = totalTagged === 0;
    btnExportExcel.style.opacity = btnExportExcel.disabled ? '0.5' : '1';

    statusLine.textContent = `${statusText}  ·  Total tagged: ${totalTagged}`;
  }

  async function syncHideTaggedFilterLayer() {
    if (!ctx.engine?.visibility?.setFilterLayer) return;
    if (!hideTaggedActive) {
      await ctx.engine.visibility.clearFilterLayer('tagged');
    } else {
      const effective = api.getEffectiveTaggedElements?.() || [];
      const taggedMap = {};
      for (const item of effective) {
        if (!item.modelId || item.localId === undefined) continue;
        if (!taggedMap[item.modelId]) taggedMap[item.modelId] = new Set();
        taggedMap[item.modelId].add(Number(item.localId));
      }
      await ctx.engine.visibility.setFilterLayer('tagged', taggedMap);
    }
    await api.refreshFloatingLabels?.();
    api.reviztoToolbar?.update?.();
  }

  async function toggleHideTagged() {
    hideTaggedActive = !hideTaggedActive;
    await syncHideTaggedFilterLayer();
    const count = (api.getEffectiveTaggedElements?.() || []).length;
    statusText = hideTaggedActive
      ? `Hidden ${count} tagged element${count === 1 ? '' : 's'} (untagged remain visible).`
      : 'Restored visibility of all tagged elements.';
    syncUi();
    return hideTaggedActive;
  }

  function commitElements(elements, { clearRedo = true } = {}) {
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

    if (clearRedo) redoStack.length = 0;

    const snapshotEntries = [];
    for (const assignment of result.assignments) {
      const key = getAssignmentKey(assignment.modelId, assignment.localId);
      const applied = {
        ...assignment,
        excelRowIndex: ctx.selectedExcelRowIndex,
      };
      snapshotEntries.push({
        key,
        modelId: assignment.modelId,
        localId: assignment.localId,
        previous: ctx.tagAssignments.has(key) ? { ...ctx.tagAssignments.get(key) } : null,
        applied,
      });
      ctx.tagAssignments.set(key, applied);
    }
    undoStack.push({ prevSeq: currentSeq, nextSeq: result.nextSequence, entries: snapshotEntries });
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
    api.refreshTaggedTrayHighlights?.();
    api.refreshFloatingLabels?.();
    api.refreshSelectedPropertiesTag?.();
    api.refreshRibbon?.();
    api.sessionAutosave?.scheduleSave?.();
    if (hideTaggedActive) {
      void syncHideTaggedFilterLayer().then(() => {
        try { ctx.highlighter?.clear?.('select'); } catch { /* noop */ }
      });
    } else {
      api.reviztoToolbar?.update?.();
    }
    syncUi();
    return true;
  }

  function undoLast() {
    const batch = undoStack.pop();
    if (!batch) return false;
    redoStack.push(batch);
    if (redoStack.length > 50) redoStack.shift();

    for (const item of batch.entries) {
      if (item.previous) ctx.tagAssignments.set(item.key, item.previous);
      else ctx.tagAssignments.delete(item.key);
    }
    currentSeq = batch.prevSeq;
    startInput.value = String(currentSeq);
    savePattern({ prefix, start: currentSeq, digits });
    statusText = `Undid ${batch.entries.length} tag change${batch.entries.length === 1 ? '' : 's'} (counter back to ${currentSeq}).`;
    const singleUndone = batch.entries.length === 1 ? batch.entries[0] : null;
    commitProjection({ tone: 'success', selectAfter: singleUndone });
    return true;
  }

  function commitProjection({ tone = 'success', clearSelectionWhenHidden = false, selectAfter = null } = {}) {
    api.renderExcelTable?.();
    api.updateTagAssignmentUi?.(statusText, tone);
    api.refreshTaggedTrayHighlights?.();
    api.refreshFloatingLabels?.();
    api.refreshSelectedPropertiesTag?.();
    api.refreshRibbon?.();
    api.sessionAutosave?.scheduleSave?.();

    if (hideTaggedActive) {
      void syncHideTaggedFilterLayer().then(() => {
        if (clearSelectionWhenHidden) {
          try { ctx.highlighter?.clear?.('select'); } catch { /* noop */ }
        } else if (selectAfter?.modelId && selectAfter?.localId !== undefined) {
          void api.selectElementFromUi?.(selectAfter.modelId, Number(selectAfter.localId), {
            source: 'undo',
            additive: false,
            zoom: false,
          });
        }
      });
    } else {
      api.reviztoToolbar?.update?.();
    }
    syncUi();
  }

  function unassignElements(elements) {
    if (!elements || elements.length === 0) return false;
    const snapshotEntries = [];
    for (const item of elements) {
      if (!item?.modelId || item.localId === undefined) continue;
      const key = getAssignmentKey(item.modelId, item.localId);
      const prev = ctx.tagAssignments.has(key) ? { ...ctx.tagAssignments.get(key) } : null;
      const existingSaved = api.findLoadedModelEntry?.(item.modelId)?.existingProjectTags?.get(Number(item.localId));
      const applied = existingSaved
        ? {
            modelId: item.modelId,
            localId: Number(item.localId),
            globalId: item.globalId || existingSaved.globalId || '',
            type: item.type || existingSaved.type || '',
            name: item.name || existingSaved.name || '',
            modelName: item.modelName || existingSaved.modelName || '',
            delete: true,
          }
        : null;
      snapshotEntries.push({
        key,
        modelId: item.modelId,
        localId: Number(item.localId),
        previous: prev,
        applied,
      });
      if (applied) ctx.tagAssignments.set(key, applied);
      else ctx.tagAssignments.delete(key);
    }
    if (!snapshotEntries.length) return false;

    redoStack.length = 0;
    undoStack.push({ type: 'unassign', prevSeq: currentSeq, nextSeq: currentSeq, entries: snapshotEntries });
    if (undoStack.length > 50) undoStack.shift();

    statusText = `Cleared tag${snapshotEntries.length === 1 ? '' : 's'} from ${snapshotEntries.length} element${snapshotEntries.length === 1 ? '' : 's'} (Ctrl+Z to undo).`;
    commitProjection({ tone: 'success' });
    return true;
  }

  function clearSelectedTags() {
    const tagged = getSelectedTaggedEntries();
    if (!tagged.length) {
      statusText = 'No tagged elements in current selection.';
      syncUi();
      return false;
    }
    return unassignElements(tagged);
  }

  function editElementTag(element, { elementTag = '', systemTag = '' } = {}) {
    if (!element?.modelId || element.localId === undefined) return false;
    const cleanTag = String(elementTag ?? '').trim();
    if (!cleanTag || cleanTag === '-') {
      return unassignElements([element]);
    }

    const key = getAssignmentKey(element.modelId, element.localId);
    const effective = api.getEffectiveTaggedElements?.() || [];
    const duplicate = effective.find((item) => {
      if (getAssignmentKey(item.modelId, item.localId) === key) return false;
      const existingTag = String(item.elementTag || item.componentId || '').trim().toLowerCase();
      return existingTag === cleanTag.toLowerCase();
    });
    if (duplicate) {
      statusText = `Tag "${cleanTag}" is already assigned to element #${duplicate.localId}.`;
      api.updateTagAssignmentUi?.(statusText, 'warning');
      syncUi();
      return false;
    }

    const prev = ctx.tagAssignments.has(key) ? { ...ctx.tagAssignments.get(key) } : null;
    const derivedSystem = String(systemTag ?? '').trim()
      || prev?.systemTag
      || cleanTag.replace(/[.\-_]?\d+$/, '').replace(/[.\-_]+$/, '')
      || cleanTag;
    const seqMatch = cleanTag.match(/(\d+)$/);
    const derivedSeq = seqMatch ? seqMatch[1] : (prev?.sequenceNumber || '01');

    const applied = {
      ...(prev || {}),
      modelId: element.modelId,
      localId: Number(element.localId),
      globalId: element.globalId || prev?.globalId || '',
      type: element.type || prev?.type || '',
      name: element.name || prev?.name || '',
      modelName: element.modelName || prev?.modelName || '',
      elementTag: cleanTag,
      componentId: cleanTag,
      systemTag: derivedSystem,
      sequenceNumber: derivedSeq,
      source: 'pending',
      delete: false,
      excelRowIndex: prev?.excelRowIndex ?? ctx.selectedExcelRowIndex,
    };

    redoStack.length = 0;
    undoStack.push({
      type: 'edit',
      prevSeq: currentSeq,
      nextSeq: currentSeq,
      entries: [{ key, modelId: element.modelId, localId: Number(element.localId), previous: prev, applied }],
    });
    if (undoStack.length > 50) undoStack.shift();

    ctx.tagAssignments.set(key, applied);
    statusText = `Updated tag on #${element.localId} → ${cleanTag}`;
    commitProjection({ tone: 'success' });
    return true;
  }

  function redoLast() {
    const batch = redoStack.pop();
    if (!batch) return false;
    undoStack.push(batch);
    if (undoStack.length > 50) undoStack.shift();

    for (const item of batch.entries) {
      if (item.applied) ctx.tagAssignments.set(item.key, { ...item.applied });
      else ctx.tagAssignments.delete(item.key);
    }
    currentSeq = batch.nextSeq ?? currentSeq;
    startInput.value = String(currentSeq);
    savePattern({ prefix, start: currentSeq, digits });
    statusText = `Redid ${batch.entries.length} tag change${batch.entries.length === 1 ? '' : 's'} (next #${currentSeq}).`;
    commitProjection({ tone: 'success', clearSelectionWhenHidden: batch.type !== 'unassign' });
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
    // Automatically start a new prefix at its first available sequence (e.g., 01)
    // so changing prefix never skips 01 due to a previous sequence's counter.
    currentSeq = getNextAvailableSequence({
      prefix,
      startSequence: 1,
      digits,
      existingTags: getAllExistingTagStrings(),
    });
    startInput.value = String(currentSeq);
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
  btnLabelsToggle.addEventListener('click', async () => {
    const next = !ctx.isFloatingLabelsActive;
    await api.setFloatingLabelsActive?.(next);
    statusText = next
      ? 'Floating 3D tag labels shown.'
      : 'Floating 3D tag labels hidden (elements remain visible).';
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
  btnClearSelected.addEventListener('click', () => clearSelectedTags());
  btnUndo.addEventListener('click', () => undoLast());
  btnExportExcel.addEventListener('click', () => { exportExcelSchedule(); });
  btnClose.addEventListener('click', () => {
    isOpen = false;
    syncUi();
  });

  // Hook called by selection.js whenever user selects an element
  function onElementSelected(identity, multiList = [], { source = 'viewport' } = {}) {
    if (!isOpen) return;
    if (source === 'viewport' && clickToTagActive && identity && (!multiList || multiList.length <= 1)) {
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
    redoLast,
    clearSelectedTags,
    unassignElements,
    editElementTag,
    toggleHideTagged,
    syncHideTaggedFilterLayer,
    isHideTaggedActive: () => hideTaggedActive,
    getTaggedCount: () => (api.getEffectiveTaggedElements?.() || []).length,
    getSelectedTaggedCount: () => getSelectedTaggedEntries().length,
    getPattern: () => ({ prefix, start: currentSeq, digits }),
    applyPattern(nextPattern) {
      if (!nextPattern) return;
      if (typeof nextPattern.prefix === 'string' && nextPattern.prefix.trim()) {
        prefix = nextPattern.prefix;
        prefixInput.value = prefix;
      }
      if (Number.isFinite(Number(nextPattern.start))) {
        currentSeq = Math.max(1, Number.parseInt(nextPattern.start, 10) || 1);
        startInput.value = String(currentSeq);
      }
      if (Number.isFinite(Number(nextPattern.digits))) {
        digits = Math.max(1, Math.min(6, Number.parseInt(nextPattern.digits, 10) || 2));
        digitsSelect.value = String(digits);
      }
      savePattern({ prefix, start: currentSeq, digits });
      syncUi();
    },
    syncUi,
  };

  api.taggingAuxBar = barApi;
  api.onElementSelectedForTagging = onElementSelected;
  api.exportTrayScheduleExcel = exportExcelSchedule;
  api.editElementTag = editElementTag;
  return barApi;
}
