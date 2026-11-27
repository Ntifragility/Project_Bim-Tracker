// src/ui/tag-finder-panel.js
// Revizto / Navisworks-style Buscador de TAGs (Tag & Property Finder) for Cable Tray Viewer.
// Supports instant multi-term search across TAG UNICO, PLANO, SUB_TIPO, System, IFC Type,
// Name, GlobalId, dropdown filters, 1-click select, Ctrl+Click multi-select, double-click zoom,
// and batch Select All / Isolate / Hide / Focus All actions.

import {
  UNASSIGNED_FILTER,
  getDistinctPropertyValues,
  filterTaggedItems,
  buildModelIdMapFromItems,
} from '../tagging/tag-search.js';

export function initTagFinderPanel(ctx, dom, api) {
  if (typeof document === 'undefined') return null;

  let isOpen = false;
  let query = '';
  let planoFilter = '';
  let subTipoFilter = '';
  let currentMatches = [];

  const panel = document.createElement('div');
  panel.id = 'tray-tag-finder-panel';
  panel.style.cssText =
    'position:fixed;top:160px;right:14px;width:360px;max-height:calc(100vh - 200px);z-index:118;' +
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

  // Header
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

  const btnClose = document.createElement('button');
  btnClose.type = 'button';
  btnClose.textContent = '✕';
  btnClose.title = 'Close Tag Finder (Esc)';
  btnClose.style.cssText =
    'background:transparent;color:#94a3b8;border:none;font-size:13px;cursor:pointer;padding:2px 4px;';
  header.append(titleWrap, btnClose);

  // Search Input
  const searchWrap = document.createElement('div');
  searchWrap.style.cssText = 'display:flex;gap:5px;';
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search TAG, PLANO, SUB_TIPO, Type...';
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

  // PLANO & SUB_TIPO Dropdown Filters (Navisworks Search Sets style)
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
  const btnIsolate = mkActionBtn('Isolate', 'Isolate all matching elements in 3D');
  const btnHide = mkActionBtn('Hide', 'Hide all matching elements in 3D');
  const btnFocus = mkActionBtn('Focus', 'Zoom camera to fit all matching elements');
  actionRow.append(btnSelectAll, btnIsolate, btnHide, btnFocus);

  // Results Table Header
  const listHeader = document.createElement('div');
  listHeader.style.cssText =
    'display:grid;grid-template-columns:1.25fr 0.9fr 1fr;gap:6px;padding:4px 6px;' +
    'font-size:10px;font-weight:700;color:#94a3b8;border-bottom:1px solid #334155;text-transform:uppercase;';
  listHeader.innerHTML = '<span>TAG UNICO</span><span>PLANO</span><span>SUB_TIPO</span>';

  // Results Scrollable Container
  const listEl = document.createElement('div');
  listEl.style.cssText = 'flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:2px;min-height:120px;';

  const footerHint = document.createElement('div');
  footerHint.textContent = 'Click: Select  ·  Ctrl+Click: Multi-select  ·  Double-click: Zoom';
  footerHint.style.cssText = 'font-size:10px;color:#64748b;text-align:center;padding-top:2px;';

  panel.append(header, searchWrap, filterRow, actionRow, listHeader, listEl, footerHint);
  (document.getElementById('app') || document.body).appendChild(panel);

  window.addEventListener('resize', () => {
    if (isOpen) positionBelowRibbon();
  });

  function getAllSearchableItems() {
    const byKey = new Map();
    const effective = api.getEffectiveTaggedElements?.() || [];
    for (const item of effective) {
      if (!item?.modelId || item.localId === undefined) continue;
      byKey.set(`${item.modelId}:${Number(item.localId)}`, item);
    }
    // Also include elements that only have PLANO or SUB_TIPO assigned (not yet tagged)
    if (ctx.tagAssignments instanceof Map) {
      for (const [key, item] of ctx.tagAssignments.entries()) {
        if (!item || item.delete === true) continue;
        if (!byKey.has(key) && (item.plano || item.subTipo)) {
          byKey.set(key, item);
        }
      }
    }
    return Array.from(byKey.values());
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

  function render() {
    panel.style.display = isOpen ? 'flex' : 'none';
    if (!isOpen) return;
    positionBelowRibbon();

    const allItems = getAllSearchableItems();
    syncFilterOptions(allItems);

    currentMatches = filterTaggedItems(allItems, {
      query,
      planoFilter,
      subTipoFilter,
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
        : 'No elements match the current search/filter.';
      empty.style.cssText = 'padding:18px 8px;text-align:center;color:#64748b;font-size:11px;';
      listEl.appendChild(empty);
      return;
    }

    const cap = Math.min(currentMatches.length, 300);
    for (let i = 0; i < cap; i++) {
      const item = currentMatches[i];
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

    if (currentMatches.length > cap) {
      const more = document.createElement('div');
      more.textContent = `Showing first ${cap} of ${currentMatches.length} matches. Refine search to narrow results.`;
      more.style.cssText = 'padding:6px;text-align:center;color:#94a3b8;font-size:10px;';
      listEl.appendChild(more);
    }
  }

  // Event wiring
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
    ctx.pendingSelectionSource = 'tag-finder';
    try {
      await ctx.highlighter?.highlightByID?.('select', map, true, false);
    } finally {
      ctx.pendingSelectionSource = null;
    }
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
    open() {
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
