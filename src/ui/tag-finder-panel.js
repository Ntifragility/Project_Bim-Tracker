// src/ui/tag-finder-panel.js
// Revizto / Navisworks-style Buscador de TAGs + Classification Tree Map for Cable Tray Viewer.
//
// Two synced views inside one CAD-native floating panel:
//   1. Search (Flat List): instant multi-term search across TAG UNICO, PLANO, SUB_TIPO,
//      System, IFC Type, Name, GlobalId + dropdown filters + batch Select/Isolate/Hide/Focus.
//   2. Tree (Classification Tree Map): hierarchical grouping by PLANO, SYSTEM TAG, or SUB_TIPO
//      with bidirectional 3D selection checkboxes (select/unselect entire groups or individual
//      elements), indeterminate partial state, and per-group Isolate / Hide actions.

import {
  UNASSIGNED_FILTER,
  getDistinctPropertyValues,
  filterTaggedItems,
  buildModelIdMapFromItems,
  groupItemsByField,
  toggleItemsInSelectionMap,
} from '../tagging/tag-search.js';

export function initTagFinderPanel(ctx, dom, api) {
  if (typeof document === 'undefined') return null;

  let isOpen = false;
  let viewMode = 'tree'; // 'search' | 'tree'
  let groupBy = 'plano'; // 'plano' | 'systemTag' | 'subTipo'
  let query = '';
  let planoFilter = '';
  let subTipoFilter = '';
  let currentMatches = [];
  const expandedGroups = new Set(); // group keys expanded in Tree view

  const panel = document.createElement('div');
  panel.id = 'tray-tag-finder-panel';
  panel.style.cssText =
    'position:fixed;top:160px;right:14px;width:370px;max-height:calc(100vh - 200px);z-index:118;' +
    'display:none;flex-direction:column;gap:8px;background:rgba(15,23,42,0.96);color:#e2e8f0;' +
    'border:1px solid #334155;border-radius:8px;padding:10px;font:12px/1.35 system-ui,-apple-system,sans-serif;' +
    'box-shadow:0 14px 36px rgba(0,0,0,0.55);backdrop-filter:blur(8px);';

  for (const ev of ['pointerdown', 'pointerup', 'click', 'dblclick', 'wheel', 'contextmenu']) {
    panel.addEventListener(ev, (e) => e.stopPropagation());
  }

  function positionBelowRibbon() {
    const ribbon = document.getElementById('ribbon');
    const bottom = ribbon ? Math.ceil(ribbon.getBoundingClientRect().bottom) : 148;
    panel.style.top = `${Math.max(16, bottom + 10)}px`;
    panel.style.maxHeight = `calc(100vh - ${Math.max(60, bottom + 28)}px)`;
  }

  // Header + Mode Tabs ([ Tree ] [ Search ])
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;';
  const titleWrap = document.createElement('div');
  titleWrap.style.cssText = 'display:flex;align-items:center;gap:6px;';
  const titleEl = document.createElement('strong');
  titleEl.textContent = 'Buscador de TAGs';
  titleEl.style.cssText = 'font-size:12px;color:#f8fafc;letter-spacing:0.2px;';
  const countBadge = document.createElement('span');
  countBadge.style.cssText =
    'font-size:10px;padding:1px 6px;border-radius:10px;background:#1e293b;color:#38bdf8;' +
    'border:1px solid #334155;font-family:monospace;';
  titleWrap.append(titleEl, countBadge);

  const rightHeader = document.createElement('div');
  rightHeader.style.cssText = 'display:flex;align-items:center;gap:4px;';

  const modeSeg = document.createElement('div');
  modeSeg.style.cssText =
    'display:inline-flex;background:#0f172a;border:1px solid #334155;border-radius:5px;padding:1px;';
  const mkModeBtn = (label) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText =
      'border:none;border-radius:4px;padding:2px 8px;font-size:10px;font-weight:600;cursor:pointer;';
    return b;
  };
  const btnModeTree = mkModeBtn('Tree');
  const btnModeSearch = mkModeBtn('Search');
  modeSeg.append(btnModeTree, btnModeSearch);

  const btnClose = document.createElement('button');
  btnClose.type = 'button';
  btnClose.textContent = '✕';
  btnClose.title = 'Close Tag Finder (Esc)';
  btnClose.style.cssText =
    'background:transparent;color:#94a3b8;border:none;font-size:13px;cursor:pointer;padding:2px 4px;';
  rightHeader.append(modeSeg, btnClose);
  header.append(titleWrap, rightHeader);

  // Search Input
  const searchWrap = document.createElement('div');
  searchWrap.style.cssText = 'display:flex;gap:5px;';
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Filter TAG, PLANO, SYSTEM, SUB_TIPO...';
  searchInput.style.cssText =
    'flex:1;background:#1e293b;color:#f8fafc;border:1px solid #475569;border-radius:5px;' +
    'padding:5px 8px;font:12px/1.2 system-ui,sans-serif;outline:none;';
  const btnReset = document.createElement('button');
  btnReset.type = 'button';
  btnReset.textContent = 'Reset';
  btnReset.title = 'Clear search and filters';
  btnReset.style.cssText =
    'background:#1e293b;color:#94a3b8;border:1px solid #334155;border-radius:5px;' +
    'padding:4px 8px;font-size:11px;cursor:pointer;';
  searchWrap.append(searchInput, btnReset);

  // Tree Group-By Strip ([ PLANO ] [ SYSTEM TAG ] [ SUB_TIPO ])
  const groupByRow = document.createElement('div');
  groupByRow.style.cssText = 'display:flex;align-items:center;gap:4px;';
  const groupLabel = document.createElement('span');
  groupLabel.textContent = 'Group by:';
  groupLabel.style.cssText = 'font-size:10px;color:#94a3b8;margin-right:2px;';
  const mkGroupBtn = (id, label) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.groupBy = id;
    b.textContent = label;
    b.style.cssText =
      'flex:1;border-radius:4px;padding:3px 6px;font-size:10px;font-weight:700;cursor:pointer;white-space:nowrap;';
    return b;
  };
  const btnGroupPlano = mkGroupBtn('plano', 'PLANO');
  const btnGroupSystem = mkGroupBtn('systemTag', 'SYSTEM TAG');
  const btnGroupSubTipo = mkGroupBtn('subTipo', 'SUB_TIPO');
  groupByRow.append(groupLabel, btnGroupPlano, btnGroupSystem, btnGroupSubTipo);

  // PLANO & SUB_TIPO Dropdown Filters (Search mode)
  const filterRow = document.createElement('div');
  filterRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:6px;';
  const mkSelect = (labelText) => {
    const wrap = document.createElement('label');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:2px;font-size:10px;color:#94a3b8;';
    wrap.textContent = labelText;
    const sel = document.createElement('select');
    sel.style.cssText =
      'background:#1e293b;color:#f8fafc;border:1px solid #475569;border-radius:4px;' +
      'padding:4px 6px;font-size:11px;';
    wrap.appendChild(sel);
    return { wrap, sel };
  };
  const { wrap: planoWrap, sel: planoSelect } = mkSelect('PLANO');
  const { wrap: subTipoWrap, sel: subTipoSelect } = mkSelect('SUB_TIPO');
  filterRow.append(planoWrap, subTipoWrap);

  // Batch Action Bar (Revizto / Navisworks)
  const actionRow = document.createElement('div');
  actionRow.style.cssText = 'display:flex;align-items:center;gap:5px;flex-wrap:wrap;';
  const mkActionBtn = (label, title, accent = false) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.title = title;
    b.style.cssText = accent
      ? 'flex:1;background:#0284c7;color:#f8fafc;border:none;border-radius:4px;padding:4px 6px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;'
      : 'flex:1;background:#1e293b;color:#e2e8f0;border:1px solid #475569;border-radius:4px;padding:4px 6px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;';
    return b;
  };
  const btnSelectAll = mkActionBtn('Select All', 'Select all matching elements in 3D', true);
  const btnClearSel = mkActionBtn('Clear Sel', 'Unselect all elements in 3D');
  const btnIsolate = mkActionBtn('Isolate', 'Isolate all matching elements in 3D');
  const btnHide = mkActionBtn('Hide', 'Hide all matching elements in 3D');
  const btnFocus = mkActionBtn('Focus', 'Zoom camera to fit all matching elements');
  actionRow.append(btnSelectAll, btnClearSel, btnIsolate, btnHide, btnFocus);

  // Flat Search Table Header
  const listHeader = document.createElement('div');
  listHeader.style.cssText =
    'display:grid;grid-template-columns:1.25fr 0.9fr 1fr;gap:6px;padding:4px 6px;' +
    'font-size:10px;font-weight:700;color:#94a3b8;border-bottom:1px solid #334155;text-transform:uppercase;';
  listHeader.innerHTML = '<span>TAG UNICO</span><span>PLANO</span><span>SUB_TIPO</span>';

  // Scrollable Results / Tree Container
  const listEl = document.createElement('div');
  listEl.style.cssText = 'flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:3px;min-height:140px;';

  const footerHint = document.createElement('div');
  footerHint.style.cssText = 'font-size:10px;color:#64748b;text-align:center;padding-top:2px;';

  panel.append(header, searchWrap, groupByRow, filterRow, actionRow, listHeader, listEl, footerHint);
  (document.getElementById('app') || document.body).appendChild(panel);

  window.addEventListener('resize', () => {
    if (isOpen) positionBelowRibbon();
  });
  window.addEventListener('rc:ribbon-collapse-changed', () => {
    if (isOpen) positionBelowRibbon();
  });

  function getAllSearchableItems() {
    if (typeof api.getAllAnnotatedElements === 'function') {
      return api.getAllAnnotatedElements();
    }
    const byKey = new Map();
    const effective = api.getEffectiveTaggedElements?.() || [];
    for (const item of effective) {
      if (!item?.modelId || item.localId === undefined) continue;
      byKey.set(`${item.modelId}:${Number(item.localId)}`, item);
    }
    if (ctx.tagAssignments instanceof Map) {
      for (const [key, item] of ctx.tagAssignments.entries()) {
        if (!item || item.delete === true) continue;
        if (!byKey.has(key) && (item.plano || item.subTipo || item.systemTag)) {
          byKey.set(key, item);
        }
      }
    }
    return Array.from(byKey.values());
  }

  function isItemSelected(selMap, item) {
    const ids = selMap?.[item?.modelId];
    if (!ids) return false;
    const id = Number(item.localId);
    return ids instanceof Set ? ids.has(id) : Array.isArray(ids) ? ids.includes(id) : false;
  }

  async function applyNextSelectionMap(nextMap) {
    if (typeof api.applySelectionMap === 'function') {
      await api.applySelectionMap(nextMap, { source: 'tag-finder' });
      return;
    }
    const hasAny = Object.values(nextMap).some((s) => (s instanceof Set ? s.size : s?.length) > 0);
    ctx.pendingSelectionSource = 'tag-finder';
    try {
      if (!hasAny) {
        await ctx.highlighter?.clear?.('select');
      } else {
        await ctx.highlighter?.highlightByID?.('select', nextMap, true, false);
      }
    } finally {
      ctx.pendingSelectionSource = null;
    }
  }

  function syncFilterOptions(allItems) {
    const populate = (sel, values, currentVal) => {
      sel.innerHTML = '';
      const optAll = document.createElement('option');
      optAll.value = '';
      optAll.textContent = 'All';
      sel.appendChild(optAll);

      const optUn = document.createElement('option');
      optUn.value = UNASSIGNED_FILTER;
      optUn.textContent = '(Unassigned)';
      sel.appendChild(optUn);

      for (const val of values) {
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = val;
        sel.appendChild(opt);
      }
      sel.value = currentVal;
    };

    populate(planoSelect, getDistinctPropertyValues(allItems, 'plano'), planoFilter);
    populate(subTipoSelect, getDistinctPropertyValues(allItems, 'subTipo'), subTipoFilter);
  }

  function renderTreeView(matches) {
    const groups = groupItemsByField(matches, groupBy);
    const selMap = api.getSelectedModelIdMap?.() || {};

    for (const grp of groups) {
      const grpWrap = document.createElement('div');
      grpWrap.style.cssText =
        'border:1px solid #334155;border-radius:5px;background:rgba(30,41,59,0.45);overflow:hidden;';

      const selectedInGroup = grp.items.filter((it) => isItemSelected(selMap, it)).length;
      const allSelected = selectedInGroup === grp.items.length && grp.items.length > 0;
      const someSelected = selectedInGroup > 0 && selectedInGroup < grp.items.length;
      const isExpanded = expandedGroups.has(grp.key);

      const grpHeader = document.createElement('div');
      grpHeader.style.cssText =
        'display:flex;align-items:center;gap:6px;padding:5px 7px;cursor:pointer;' +
        'background:rgba(30,41,59,0.85);user-select:none;';

      const arrow = document.createElement('span');
      arrow.textContent = isExpanded ? '▼' : '▶';
      arrow.style.cssText = 'font-size:9px;color:#94a3b8;width:10px;text-align:center;';

      const grpCheck = document.createElement('input');
      grpCheck.type = 'checkbox';
      grpCheck.checked = allSelected;
      grpCheck.indeterminate = someSelected;
      grpCheck.title = allSelected ? 'Unselect all in this group' : 'Select all in this group';
      grpCheck.style.cssText = 'cursor:pointer;accent-color:#38bdf8;';
      grpCheck.addEventListener('click', (e) => e.stopPropagation());
      grpCheck.addEventListener('change', async () => {
        const current = api.getSelectedModelIdMap?.() || {};
        const nextMap = toggleItemsInSelectionMap(current, grp.items, grpCheck.checked);
        await applyNextSelectionMap(nextMap);
        render();
      });

      const grpTitle = document.createElement('span');
      grpTitle.textContent = grp.label;
      grpTitle.title = `${grp.label} (${grp.items.length} elements)`;
      grpTitle.style.cssText =
        `flex:1;font-weight:700;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;` +
        `color:${grp.isUnassigned ? '#94a3b8' : '#f8fafc'};`;

      const grpCount = document.createElement('span');
      grpCount.textContent = selectedInGroup > 0 ? `${selectedInGroup}/${grp.items.length}` : String(grp.items.length);
      grpCount.style.cssText =
        'font:600 10px/1 monospace;padding:2px 5px;border-radius:8px;background:#0f172a;' +
        `color:${selectedInGroup > 0 ? '#38bdf8' : '#94a3b8'};`;

      const mkTinyBtn = (txt, title, onClick) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = txt;
        b.title = title;
        b.style.cssText =
          'background:#0f172a;color:#cbd5e1;border:1px solid #475569;border-radius:3px;' +
          'padding:1px 5px;font-size:9px;font-weight:600;cursor:pointer;';
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          onClick();
        });
        return b;
      };

      const btnGrpIso = mkTinyBtn('Iso', `Isolate ${grp.label}`, async () => {
        await ctx.engine?.isolation?.isolate?.(buildModelIdMapFromItems(grp.items), { mode: 'ghost' });
      });
      const btnGrpHide = mkTinyBtn('Hide', `Hide ${grp.label}`, async () => {
        await ctx.engine?.visibility?.hideSelection?.(buildModelIdMapFromItems(grp.items));
      });

      grpHeader.addEventListener('click', () => {
        if (expandedGroups.has(grp.key)) expandedGroups.delete(grp.key);
        else expandedGroups.add(grp.key);
        render();
      });

      grpHeader.append(arrow, grpCheck, grpTitle, grpCount, btnGrpIso, btnGrpHide);
      grpWrap.appendChild(grpHeader);

      if (isExpanded) {
        const childrenBox = document.createElement('div');
        childrenBox.style.cssText = 'display:flex;flex-direction:column;gap:1px;padding:3px 6px 5px 18px;';

        const cap = Math.min(grp.items.length, 200);
        for (let i = 0; i < cap; i++) {
          const item = grp.items[i];
          const checked = isItemSelected(selMap, item);
          const childRow = document.createElement('div');
          childRow.style.cssText =
            `display:flex;align-items:center;gap:6px;padding:3px 5px;border-radius:3px;cursor:pointer;` +
            `background:${checked ? 'rgba(56,189,248,0.18)' : 'transparent'};`;

          const itemCheck = document.createElement('input');
          itemCheck.type = 'checkbox';
          itemCheck.checked = checked;
          itemCheck.style.cssText = 'cursor:pointer;accent-color:#38bdf8;';
          itemCheck.addEventListener('click', (e) => e.stopPropagation());
          itemCheck.addEventListener('change', async () => {
            const current = api.getSelectedModelIdMap?.() || {};
            const nextMap = toggleItemsInSelectionMap(current, [item], itemCheck.checked);
            await applyNextSelectionMap(nextMap);
            render();
          });

          const tagSpan = document.createElement('span');
          tagSpan.textContent = item.elementTag || item.componentId || `#${item.localId}`;
          tagSpan.style.cssText =
            'font:700 11px/1.2 monospace;color:#7dd3fc;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

          const metaSpan = document.createElement('span');
          const secondary = groupBy === 'plano'
            ? (item.subTipo || item.systemTag || '')
            : (item.plano || item.subTipo || '');
          metaSpan.textContent = secondary;
          metaSpan.style.cssText =
            'margin-left:auto;font-size:10px;color:#94a3b8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:130px;';

          childRow.addEventListener('click', async () => {
            const current = api.getSelectedModelIdMap?.() || {};
            const nextMap = toggleItemsInSelectionMap(current, [item], !checked);
            await applyNextSelectionMap(nextMap);
            render();
          });
          childRow.addEventListener('dblclick', async () => {
            await api.selectElementFromUi?.(item.modelId, Number(item.localId), {
              source: 'tag-finder',
              additive: false,
              zoom: true,
            });
          });

          childRow.append(itemCheck, tagSpan, metaSpan);
          childrenBox.appendChild(childRow);
        }

        if (grp.items.length > cap) {
          const more = document.createElement('div');
          more.textContent = `Showing ${cap} of ${grp.items.length} elements in group.`;
          more.style.cssText = 'font-size:10px;color:#64748b;padding:3px 4px;';
          childrenBox.appendChild(more);
        }

        grpWrap.appendChild(childrenBox);
      }

      listEl.appendChild(grpWrap);
    }
  }

  function renderFlatSearchView(matches) {
    const cap = Math.min(matches.length, 300);
    for (let i = 0; i < cap; i++) {
      const item = matches[i];
      const row = document.createElement('div');
      row.style.cssText =
        'display:grid;grid-template-columns:1.25fr 0.9fr 1fr;gap:6px;padding:5px 6px;border-radius:4px;' +
        'cursor:pointer;background:rgba(30,41,59,0.55);border:1px solid transparent;align-items:center;';
      row.addEventListener('mouseenter', () => {
        row.style.background = 'rgba(56,189,248,0.16)';
        row.style.borderColor = 'rgba(56,189,248,0.45)';
      });
      row.addEventListener('mouseleave', () => {
        row.style.background = 'rgba(30,41,59,0.55)';
        row.style.borderColor = 'transparent';
      });

      const tagCell = document.createElement('span');
      const tagText = item.elementTag || item.componentId || `#${item.localId}`;
      tagCell.textContent = tagText;
      tagCell.title = `${tagText} (${item.type || 'IFC'})`;
      tagCell.style.cssText =
        'font:700 11px/1.2 monospace;color:#7dd3fc;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

      const planoCell = document.createElement('span');
      planoCell.textContent = item.plano || '-';
      planoCell.title = item.plano || '';
      planoCell.style.cssText =
        'font-size:11px;color:#e2e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

      const subCell = document.createElement('span');
      subCell.textContent = item.subTipo || '-';
      subCell.title = item.subTipo || '';
      subCell.style.cssText =
        'font-size:11px;color:#cbd5e1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

      row.append(tagCell, planoCell, subCell);

      row.addEventListener('click', (e) => {
        const additive = Boolean(e.ctrlKey || e.metaKey || e.shiftKey);
        void api.selectElementFromUi?.(item.modelId, Number(item.localId), {
          source: 'tag-finder',
          additive,
          zoom: false,
        });
      });

      row.addEventListener('dblclick', () => {
        void api.selectElementFromUi?.(item.modelId, Number(item.localId), {
          source: 'tag-finder',
          additive: false,
          zoom: true,
        });
      });

      listEl.appendChild(row);
    }

    if (matches.length > cap) {
      const more = document.createElement('div');
      more.textContent = `Showing first ${cap} of ${matches.length} matches. Refine search to narrow results.`;
      more.style.cssText = 'padding:6px;text-align:center;color:#94a3b8;font-size:10px;';
      listEl.appendChild(more);
    }
  }

  function render() {
    panel.style.display = isOpen ? 'flex' : 'none';
    if (!isOpen) return;
    positionBelowRibbon();

    // Update mode toggle pills
    const isTree = viewMode === 'tree';
    btnModeTree.style.background = isTree ? '#0284c7' : 'transparent';
    btnModeTree.style.color = isTree ? '#f8fafc' : '#94a3b8';
    btnModeSearch.style.background = !isTree ? '#0284c7' : 'transparent';
    btnModeSearch.style.color = !isTree ? '#f8fafc' : '#94a3b8';

    groupByRow.style.display = isTree ? 'flex' : 'none';
    filterRow.style.display = isTree ? 'none' : 'grid';
    listHeader.style.display = isTree ? 'none' : 'grid';
    footerHint.textContent = isTree
      ? 'Check groups or items to select/unselect in 3D  ·  Double-click item: Zoom'
      : 'Click: Select  ·  Ctrl+Click: Multi-select  ·  Double-click: Zoom';

    for (const b of [btnGroupPlano, btnGroupSystem, btnGroupSubTipo]) {
      const active = b.dataset.groupBy === groupBy;
      b.style.background = active ? '#0f766e' : '#1e293b';
      b.style.color = active ? '#f0fdfa' : '#94a3b8';
      b.style.border = active ? '1px solid #2dd4bf' : '1px solid #334155';
    }

    const allItems = getAllSearchableItems();
    if (!isTree) syncFilterOptions(allItems);

    currentMatches = filterTaggedItems(allItems, {
      query,
      planoFilter: isTree ? '' : planoFilter,
      subTipoFilter: isTree ? '' : subTipoFilter,
    });

    countBadge.textContent = `${currentMatches.length} / ${allItems.length}`;

    const hasMatches = currentMatches.length > 0;
    btnSelectAll.textContent = `Select (${currentMatches.length})`;
    for (const b of [btnSelectAll, btnIsolate, btnHide, btnFocus]) {
      b.disabled = !hasMatches;
      b.style.opacity = hasMatches ? '1' : '0.45';
    }

    listEl.innerHTML = '';
    if (!hasMatches) {
      const empty = document.createElement('div');
      empty.textContent = allItems.length === 0
        ? 'No tagged or classified elements yet.'
        : 'No elements match the current filter.';
      empty.style.cssText = 'padding:18px 8px;text-align:center;color:#64748b;font-size:11px;';
      listEl.appendChild(empty);
      return;
    }

    if (isTree) renderTreeView(currentMatches);
    else renderFlatSearchView(currentMatches);
  }

  // Event wiring
  btnModeTree.addEventListener('click', () => { viewMode = 'tree'; render(); });
  btnModeSearch.addEventListener('click', () => { viewMode = 'search'; render(); });
  for (const b of [btnGroupPlano, btnGroupSystem, btnGroupSubTipo]) {
    b.addEventListener('click', () => {
      groupBy = b.dataset.groupBy;
      render();
    });
  }

  searchInput.addEventListener('input', () => {
    query = searchInput.value;
    render();
  });
  planoSelect.addEventListener('change', () => {
    planoFilter = planoSelect.value;
    render();
  });
  subTipoSelect.addEventListener('change', () => {
    subTipoFilter = subTipoSelect.value;
    render();
  });
  btnReset.addEventListener('click', () => {
    query = '';
    planoFilter = '';
    subTipoFilter = '';
    searchInput.value = '';
    render();
    searchInput.focus();
  });
  btnClose.addEventListener('click', () => {
    isOpen = false;
    render();
  });

  btnSelectAll.addEventListener('click', async () => {
    const map = buildModelIdMapFromItems(currentMatches);
    if (Object.keys(map).length === 0) return;
    await applyNextSelectionMap(map);
    render();
  });

  btnClearSel.addEventListener('click', async () => {
    await applyNextSelectionMap({});
    render();
  });

  btnIsolate.addEventListener('click', async () => {
    const map = buildModelIdMapFromItems(currentMatches);
    if (Object.keys(map).length === 0) return;
    await ctx.engine?.isolation?.isolate?.(map, { mode: 'ghost' });
  });

  btnHide.addEventListener('click', async () => {
    const map = buildModelIdMapFromItems(currentMatches);
    if (Object.keys(map).length === 0) return;
    await ctx.engine?.visibility?.hideSelection?.(map);
  });

  btnFocus.addEventListener('click', async () => {
    const map = buildModelIdMapFromItems(currentMatches);
    if (Object.keys(map).length === 0) return;
    if (typeof ctx.engine?.focusOnSelection === 'function') {
      await ctx.engine.focusOnSelection(map);
    } else if (currentMatches[0]) {
      const entry = api.findLoadedModelEntry?.(currentMatches[0].modelId);
      if (entry?.model) await api.zoomToElementInModel?.(entry.model, Number(currentMatches[0].localId));
    }
  });

  const finderApi = {
    open(mode = null) {
      if (mode === 'tree' || mode === 'search') viewMode = mode;
      isOpen = true;
      render();
      searchInput.focus();
      searchInput.select();
    },
    close() {
      isOpen = false;
      render();
    },
    toggle() {
      if (isOpen) this.close();
      else this.open();
    },
    isOpen: () => isOpen,
    refresh: () => {
      if (isOpen) render();
    },
  };

  api.tagFinder = finderApi;
  return finderApi;
}
