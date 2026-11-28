// src/ui/tagging-aux-bar.js
// Docked Auxiliary Sequential Tagging Bar for Cable Tray Viewer (Revit Options Bar style).
// Zero browser prompts — define Fixed prefix + Variable counter, click elements in sequence
// (Click-to-Tag mode) or tag multi-selection in one click, and export Excel (TAG UNICO | ANCHO | LONGITUD).

import { exportTrayScheduleExcel, readWorkbook } from 'excel-io';
import {
  formatSequentialTag,
  getNextAvailableSequence,
  allocateSequentialTags,
  compareNaturalTags,
} from '../tagging/sequential-tagger.js';
import {
  deriveEscAccFromSubTipo,
  parseMaterialDictionaryRows,
  resolveMaterialDescription,
} from '../tagging/material-dictionary.js';
import { getAssignmentKey } from './helpers.js';

const STORAGE_KEY = 'covillaf:trayAuxTagPattern';
const DICT_STORAGE_KEY = 'covillaf:trayMaterialDictRules';

function loadSavedDictRules() {
  try {
    const parsed = JSON.parse(localStorage.getItem(DICT_STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveDictRules(rules) {
  try {
    localStorage.setItem(DICT_STORAGE_KEY, JSON.stringify(rules || []));
  } catch { /* noop */ }
}

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

  const btnPropsToggle = document.createElement('button');
  btnPropsToggle.type = 'button';
  btnPropsToggle.textContent = 'Props';
  btnPropsToggle.title = 'Assign PLANO and SUB_TIPO properties to selected elements';
  btnPropsToggle.style.cssText =
    'background:#1e293b;color:#cbd5e1;border:1px solid #475569;border-radius:4px;' +
    'padding:3px 7px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;';

  const btnFindTags = document.createElement('button');
  btnFindTags.type = 'button';
  btnFindTags.textContent = 'Find';
  btnFindTags.title = 'Open Buscador de TAGs (Ctrl+F)';
  btnFindTags.style.cssText =
    'background:#1e293b;color:#7dd3fc;border:1px solid #0369a1;border-radius:4px;' +
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
    btnPropsToggle,
    btnFindTags,
    btnUndo,
    btnExportExcel,
    btnClose,
  );

  // Collapsible PLANO, SUB_TIPO, ESC/ACC, TENSION & TIPO DE MATERIAL bulk property assignment drawer
  let propsDrawerOpen = false;
  let customDictRules = loadSavedDictRules();
  const propsRow = document.createElement('div');
  propsRow.style.cssText =
    'display:none;align-items:center;gap:6px;flex-wrap:wrap;padding-top:5px;border-top:1px solid #334155;';

  const planoListId = 'tray-plano-datalist';
  const subTipoListId = 'tray-subtipo-datalist';
  const tensionListId = 'tray-tension-datalist';
  const tipoMatListId = 'tray-tipomat-datalist';
  const planoDatalist = document.createElement('datalist');
  planoDatalist.id = planoListId;
  const subTipoDatalist = document.createElement('datalist');
  subTipoDatalist.id = subTipoListId;
  const tensionDatalist = document.createElement('datalist');
  tensionDatalist.id = tensionListId;
  const tipoMatDatalist = document.createElement('datalist');
  tipoMatDatalist.id = tipoMatListId;

  const planoInput = document.createElement('input');
  planoInput.type = 'text';
  planoInput.setAttribute('list', planoListId);
  planoInput.placeholder = 'e.g. E-301';
  planoInput.title = 'PLANO (IFC Property)';
  planoInput.style.cssText =
    'width:90px;background:#1e293b;color:#f8fafc;border:1px solid #475569;border-radius:4px;' +
    'padding:3px 6px;font:600 11px/1.2 monospace;';

  const btnApplyPlano = document.createElement('button');
  btnApplyPlano.type = 'button';
  btnApplyPlano.textContent = 'Set PLANO';
  btnApplyPlano.style.cssText =
    'background:#0f766e;color:#f0fdfa;border:none;border-radius:4px;padding:3px 7px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;';

  const subTipoInput = document.createElement('input');
  subTipoInput.type = 'text';
  subTipoInput.setAttribute('list', subTipoListId);
  subTipoInput.placeholder = 'e.g. CURVA 90';
  subTipoInput.title = 'SUB_TIPO (IFC Property) — auto-derives ESC/ACC (ES/EN)';
  subTipoInput.style.cssText =
    'width:110px;background:#1e293b;color:#f8fafc;border:1px solid #475569;border-radius:4px;' +
    'padding:3px 6px;font:600 11px/1.2 monospace;';

  const btnApplySubTipo = document.createElement('button');
  btnApplySubTipo.type = 'button';
  btnApplySubTipo.textContent = 'Set SUB_TIPO';
  btnApplySubTipo.style.cssText =
    'background:#0f766e;color:#f0fdfa;border:none;border-radius:4px;padding:3px 7px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;';

  const escAccInput = document.createElement('input');
  escAccInput.type = 'text';
  escAccInput.placeholder = 'ESC/ACC';
  escAccInput.title = 'ESC/ACC (IFC Property) — auto-detected from SUB_TIPO, editable';
  escAccInput.style.cssText =
    'width:60px;background:#1e293b;color:#f8fafc;border:1px solid #475569;border-radius:4px;' +
    'padding:3px 6px;font:600 11px/1.2 monospace;';

  const tensionInput = document.createElement('input');
  tensionInput.type = 'text';
  tensionInput.setAttribute('list', tensionListId);
  tensionInput.placeholder = 'e.g. 22.9kV';
  tensionInput.title = 'TENSION (IFC Property)';
  tensionInput.style.cssText =
    'width:85px;background:#1e293b;color:#f8fafc;border:1px solid #475569;border-radius:4px;' +
    'padding:3px 6px;font:600 11px/1.2 monospace;';

  const tipoMaterialInput = document.createElement('input');
  tipoMaterialInput.type = 'text';
  tipoMaterialInput.setAttribute('list', tipoMatListId);
  tipoMaterialInput.placeholder = 'e.g. F°G°';
  tipoMaterialInput.title = 'TIPO DE MATERIAL (IFC Property)';
  tipoMaterialInput.style.cssText =
    'width:85px;background:#1e293b;color:#f8fafc;border:1px solid #475569;border-radius:4px;' +
    'padding:3px 6px;font:600 11px/1.2 monospace;';

  const btnApplyBothProps = document.createElement('button');
  btnApplyBothProps.type = 'button';
  btnApplyBothProps.textContent = 'Apply Props';
  btnApplyBothProps.title = 'Apply filled IFC properties (PLANO, SUB_TIPO, ESC/ACC, TENSION, TIPO DE MATERIAL) to selected elements';
  btnApplyBothProps.style.cssText =
    'background:#0284c7;color:#f8fafc;border:none;border-radius:4px;padding:3px 8px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;';

  const dictFileInput = document.createElement('input');
  dictFileInput.type = 'file';
  dictFileInput.accept = '.xlsx,.xls';
  dictFileInput.style.display = 'none';

  const btnDictUpload = document.createElement('button');
  btnDictUpload.type = 'button';
  btnDictUpload.title = 'Upload local Excel dictionary (SUB_TIPO -> DESCRIPCION DE MATERIAL) used when exporting Excel schedule';
  btnDictUpload.style.cssText =
    'background:#1e293b;color:#fcd34d;border:1px solid #b45309;border-radius:4px;padding:3px 7px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;';

  subTipoInput.addEventListener('input', () => {
    const auto = deriveEscAccFromSubTipo(subTipoInput.value);
    if (auto) escAccInput.value = auto;
  });

  btnDictUpload.addEventListener('click', () => dictFileInput.click());
  dictFileInput.addEventListener('change', async (e) => {
    const file = e.target?.files?.[0];
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = readWorkbook(new Uint8Array(buf));
      const rows = wb.readSheet();
      const parsed = parseMaterialDictionaryRows(rows);
      if (!parsed.length) {
        statusText = `No valid SUB_TIPO -> DESCRIPCION DE MATERIAL rows found in ${file.name}.`;
        syncUi();
        return;
      }
      customDictRules = parsed;
      saveDictRules(customDictRules);
      statusText = `Loaded ${parsed.length} material description rules from ${file.name} (applied on Excel export).`;
      syncUi();
    } catch (err) {
      statusText = `Could not parse dictionary Excel: ${err?.message || err}`;
      syncUi();
    } finally {
      dictFileInput.value = '';
    }
  });

  propsRow.append(
    mkLabel('PLANO:'),
    planoInput,
    btnApplyPlano,
    mkLabel('SUB_TIPO:'),
    subTipoInput,
    btnApplySubTipo,
    mkLabel('ESC/ACC:'),
    escAccInput,
    mkLabel('TENSION:'),
    tensionInput,
    mkLabel('MATERIAL:'),
    tipoMaterialInput,
    btnApplyBothProps,
    btnDictUpload,
    dictFileInput,
    planoDatalist,
    subTipoDatalist,
    tensionDatalist,
    tipoMatDatalist,
  );

  const statusLine = document.createElement('div');
  statusLine.style.cssText = 'font-size:11px;color:#94a3b8;display:flex;justify-content:space-between;gap:12px;';

  host.append(row, propsRow, statusLine);
  mountTarget.appendChild(host);
  window.addEventListener('resize', () => {
    if (isOpen) positionBelowRibbon();
  });
  window.addEventListener('rc:ribbon-collapse-changed', () => {
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

    btnPropsToggle.style.background = propsDrawerOpen ? '#0f766e' : '#1e293b';
    btnPropsToggle.style.color = propsDrawerOpen ? '#f0fdfa' : '#cbd5e1';
    propsRow.style.display = propsDrawerOpen ? 'flex' : 'none';

    btnApplyPlano.textContent = `Set PLANO (${selCount})`;
    btnApplySubTipo.textContent = `Set SUB_TIPO (${selCount})`;
    btnApplyBothProps.textContent = `Apply Props (${selCount})`;
    btnDictUpload.textContent = customDictRules.length > 0
      ? `Dict: ${customDictRules.length} (.xlsx)`
      : 'Dict (.xlsx)';
    for (const b of [btnApplyPlano, btnApplySubTipo, btnApplyBothProps]) {
      b.disabled = selCount === 0;
      b.style.opacity = selCount === 0 ? '0.45' : '1';
    }

    // Refresh autocomplete datalists from current assignments
    if (propsDrawerOpen) {
      const planos = new Set();
      const subTipos = new Set(['ESCALERILLA', 'BANDEJA', 'CURVA 90', 'CURVA 45', 'TEE', 'CRUZ', 'REDUCCION']);
      const tensiones = new Set(['MT', 'BT', 'CONTROL', 'COMUNICACIONES', '22.9kV', '10kV', '480V', '220V']);
      const tiposMat = new Set(['F°G°', 'HDG', 'INOX 304', 'INOX 316', 'ALUMINIO', 'FRP']);
      const allAnnotated = api.getAllAnnotatedElements?.() || Array.from(ctx.tagAssignments.values());
      for (const a of allAnnotated) {
        if (!a || a.delete === true) continue;
        if (a.plano) planos.add(a.plano);
        if (a.subTipo) subTipos.add(a.subTipo);
        if (a.tension) tensiones.add(a.tension);
        if (a.tipoMaterial) tiposMat.add(a.tipoMaterial);
      }
      const fillDatalist = (dl, values) => {
        dl.innerHTML = '';
        for (const v of Array.from(values).sort()) {
          const o = document.createElement('option');
          o.value = v;
          dl.appendChild(o);
        }
      };
      fillDatalist(planoDatalist, planos);
      fillDatalist(subTipoDatalist, subTipos);
      fillDatalist(tensionDatalist, tensiones);
      fillDatalist(tipoMatDatalist, tiposMat);
    }

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
      const prev = ctx.tagAssignments.has(key) ? { ...ctx.tagAssignments.get(key) } : null;
      const base = api.getEffectiveElementRecord?.(assignment.modelId, assignment.localId) || prev;
      const applied = {
        ...assignment,
        plano: base?.plano || '',
        subTipo: base?.subTipo || '',
        escAcc: base?.escAcc || deriveEscAccFromSubTipo(base?.subTipo || '', assignment.type || base?.type || ''),
        tension: base?.tension || '',
        tipoMaterial: base?.tipoMaterial || '',
        excelRowIndex: ctx.selectedExcelRowIndex,
      };
      snapshotEntries.push({
        key,
        modelId: assignment.modelId,
        localId: assignment.localId,
        previous: prev,
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
    api.tagFinder?.refresh?.();
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
    api.tagFinder?.refresh?.();
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
      const hasCustomProps = Boolean(
        prev?.plano || prev?.subTipo || prev?.escAcc || prev?.tension || prev?.tipoMaterial,
      );
      const applied = existingSaved
        ? {
            modelId: item.modelId,
            localId: Number(item.localId),
            globalId: item.globalId || existingSaved.globalId || '',
            type: item.type || existingSaved.type || '',
            name: item.name || existingSaved.name || '',
            modelName: item.modelName || existingSaved.modelName || '',
            plano: prev?.plano || '',
            subTipo: prev?.subTipo || '',
            escAcc: prev?.escAcc || '',
            tension: prev?.tension || '',
            tipoMaterial: prev?.tipoMaterial || '',
            delete: true,
          }
        : hasCustomProps
          ? {
              ...prev,
              elementTag: '',
              componentId: '',
              systemTag: '',
              sequenceNumber: '',
              delete: false,
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
    const base = api.getEffectiveElementRecord?.(element.modelId, element.localId) || prev;
    const derivedSystem = String(systemTag ?? '').trim()
      || base?.systemTag
      || cleanTag.replace(/[.\-_]?\d+$/, '').replace(/[.\-_]+$/, '')
      || cleanTag;
    const seqMatch = cleanTag.match(/(\d+)$/);
    const derivedSeq = seqMatch ? seqMatch[1] : (base?.sequenceNumber || '01');

    const applied = {
      ...(base || {}),
      modelId: element.modelId,
      localId: Number(element.localId),
      globalId: element.globalId || base?.globalId || '',
      type: element.type || base?.type || '',
      name: element.name || base?.name || '',
      modelName: element.modelName || base?.modelName || '',
      elementTag: cleanTag,
      componentId: cleanTag,
      systemTag: derivedSystem,
      sequenceNumber: derivedSeq,
      plano: base?.plano || '',
      subTipo: base?.subTipo || '',
      escAcc: base?.escAcc || deriveEscAccFromSubTipo(base?.subTipo || '', element.type || base?.type || ''),
      tension: base?.tension || '',
      tipoMaterial: base?.tipoMaterial || '',
      source: 'pending',
      delete: false,
      excelRowIndex: base?.excelRowIndex ?? ctx.selectedExcelRowIndex,
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

  function setElementsProperties(elements, { plano, subTipo, escAcc, tension, tipoMaterial } = {}) {
    if (!elements || elements.length === 0) return false;
    const hasPlano = plano !== undefined;
    const hasSubTipo = subTipo !== undefined;
    const hasEscAcc = escAcc !== undefined;
    const hasTension = tension !== undefined;
    const hasTipoMaterial = tipoMaterial !== undefined;
    if (!hasPlano && !hasSubTipo && !hasEscAcc && !hasTension && !hasTipoMaterial) return false;

    const cleanPlano = hasPlano ? String(plano ?? '').trim() : undefined;
    const cleanSubTipo = hasSubTipo ? String(subTipo ?? '').trim() : undefined;
    const cleanEscAcc = hasEscAcc ? String(escAcc ?? '').trim() : undefined;
    const cleanTension = hasTension ? String(tension ?? '').trim() : undefined;
    const cleanTipoMaterial = hasTipoMaterial ? String(tipoMaterial ?? '').trim() : undefined;
    const snapshotEntries = [];

    for (const el of elements) {
      if (!el?.modelId || el.localId === undefined) continue;
      const key = getAssignmentKey(el.modelId, el.localId);
      const prev = ctx.tagAssignments.has(key) ? { ...ctx.tagAssignments.get(key) } : null;
      const base = api.getEffectiveElementRecord?.(el.modelId, el.localId) || prev;
      const nextSubTipo = hasSubTipo ? cleanSubTipo : (base?.subTipo || '');
      const nextEscAcc = hasEscAcc
        ? cleanEscAcc
        : hasSubTipo
          ? deriveEscAccFromSubTipo(cleanSubTipo, el.type || base?.type || '')
          : (base?.escAcc || deriveEscAccFromSubTipo(nextSubTipo, el.type || base?.type || ''));
      const applied = {
        ...(base || {}),
        modelId: el.modelId,
        localId: Number(el.localId),
        globalId: el.globalId || base?.globalId || '',
        type: el.type || base?.type || '',
        name: el.name || base?.name || '',
        modelName: el.modelName || base?.modelName || '',
        elementTag: base?.elementTag || base?.componentId || '',
        componentId: base?.componentId || base?.elementTag || '',
        systemTag: base?.systemTag || '',
        sequenceNumber: base?.sequenceNumber || '',
        plano: hasPlano ? cleanPlano : (base?.plano || ''),
        subTipo: nextSubTipo,
        escAcc: nextEscAcc,
        tension: hasTension ? cleanTension : (base?.tension || ''),
        tipoMaterial: hasTipoMaterial ? cleanTipoMaterial : (base?.tipoMaterial || ''),
        source: 'pending',
        delete: false,
      };
      snapshotEntries.push({
        key,
        modelId: el.modelId,
        localId: Number(el.localId),
        previous: prev,
        applied,
      });
      ctx.tagAssignments.set(key, applied);
    }

    if (!snapshotEntries.length) return false;
    redoStack.length = 0;
    undoStack.push({
      type: 'props',
      prevSeq: currentSeq,
      nextSeq: currentSeq,
      entries: snapshotEntries,
    });
    if (undoStack.length > 50) undoStack.shift();

    const parts = [];
    if (hasPlano) parts.push(`PLANO="${cleanPlano || '(cleared)'}"`);
    if (hasSubTipo) parts.push(`SUB_TIPO="${cleanSubTipo || '(cleared)'}"`);
    if (hasEscAcc) parts.push(`ESC/ACC="${cleanEscAcc || '(cleared)'}"`);
    if (hasTension) parts.push(`TENSION="${cleanTension || '(cleared)'}"`);
    if (hasTipoMaterial) parts.push(`MATERIAL="${cleanTipoMaterial || '(cleared)'}"`);
    statusText = `Assigned ${parts.join(', ')} to ${snapshotEntries.length} element${snapshotEntries.length === 1 ? '' : 's'} (Ctrl+Z to undo).`;
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
      const uniqueTag = item.elementTag || item.componentId || item.systemTag || '';
      const systemTag =
        item.systemTag ||
        uniqueTag.replace(/[.\-_]?\d+$/, '').replace(/[.\-_]+$/, '') ||
        '';
      const escAcc = item.escAcc || deriveEscAccFromSubTipo(item.subTipo || '', item.type || '');
      const tension = item.tension || '';
      const tipoMaterial = item.tipoMaterial || '';
      const descripcionMaterial = resolveMaterialDescription(item, customDictRules);
      const metrado = dims.Length ?? '';
      mainRows.push({
        plano: item.plano || '',
        uniqueTag,
        tension,
        escAcc,
        systemTag,
        ancho: dims.Width ?? '',
        subTipo: item.subTipo || '',
        tipoMaterial,
        descripcionMaterial,
        metrado,
      });
      detailRows.push({
        'PLANO': item.plano || '',
        'UNIQUE TAG': uniqueTag,
        'TENSION': tension,
        'ESC/ACC': escAcc,
        'SYSTEM TAG': systemTag,
        'ANCHO': dims.Width ?? '',
        'SUB_TIPO': item.subTipo || '',
        'TIPO DE MATERIAL': tipoMaterial,
        'DESCRIPCION DE MATERIAL': descripcionMaterial,
        'METRADO': metrado,
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
    statusText = `Exported ${mainRows.length} rows (PLANO, UNIQUE TAG, TENSION, ESC/ACC, SYSTEM TAG, ANCHO, SUB_TIPO, TIPO DE MATERIAL, DESCRIPCION DE MATERIAL, METRADO) to ${fileName}.`;
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
  btnPropsToggle.addEventListener('click', () => {
    propsDrawerOpen = !propsDrawerOpen;
    syncUi();
    if (propsDrawerOpen) planoInput.focus();
  });
  btnFindTags.addEventListener('click', () => {
    api.tagFinder?.toggle?.();
  });
  btnApplyPlano.addEventListener('click', async () => {
    const selected = await api.getCurrentSelectionElements?.();
    if (!selected?.length) return;
    setElementsProperties(selected, { plano: planoInput.value });
  });
  btnApplySubTipo.addEventListener('click', async () => {
    const selected = await api.getCurrentSelectionElements?.();
    if (!selected?.length) return;
    setElementsProperties(selected, { subTipo: subTipoInput.value });
  });
  btnApplyBothProps.addEventListener('click', async () => {
    const selected = await api.getCurrentSelectionElements?.();
    if (!selected?.length) return;
    const patch = {};
    if (planoInput.value.trim()) patch.plano = planoInput.value;
    if (subTipoInput.value.trim()) patch.subTipo = subTipoInput.value;
    if (escAccInput.value.trim()) patch.escAcc = escAccInput.value;
    if (tensionInput.value.trim()) patch.tension = tensionInput.value;
    if (tipoMaterialInput.value.trim()) patch.tipoMaterial = tipoMaterialInput.value;
    if (Object.keys(patch).length === 0) {
      patch.plano = planoInput.value;
      patch.subTipo = subTipoInput.value;
    }
    setElementsProperties(selected, patch);
  });
  planoInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); btnApplyPlano.click(); }
  });
  subTipoInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); btnApplySubTipo.click(); }
  });
  for (const inp of [escAccInput, tensionInput, tipoMaterialInput]) {
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); btnApplyBothProps.click(); }
    });
  }
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
      const already = api.getEffectiveElementRecord?.(identity.modelId, identity.localId) || ctx.tagAssignments.get(key);
      const existingUniqueTag = already && already.delete !== true
        ? String(already.elementTag || already.componentId || '').trim()
        : '';
      if (existingUniqueTag) {
        statusText = `Element #${identity.localId} already has tag ${existingUniqueTag}.`;
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
    setElementsProperties,
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
  api.setElementsProperties = setElementsProperties;
  return barApi;
}
