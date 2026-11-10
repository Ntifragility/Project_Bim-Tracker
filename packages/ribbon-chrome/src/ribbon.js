/**
 * Core Ribbon Chrome Renderer & RibbonApi
 * Authoritative reference: docs/specs/chrome/revit-chrome-design.md
 */

import { SPRITE_SVG } from './sprite-data.js';
import { KeytipManager } from './keytips.js';

export class AdapterError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AdapterError';
  }
}

/**
 * Creates and mounts a Revit-style ribbon inside host element.
 *
 * @param {HTMLElement} host
 * @param {import('../index').RibbonDef} def
 * @param {import('../index').Ctx} ctx
 * @returns {import('../index').RibbonApi}
 */
export function createRibbon(host, def, ctx) {
  if (!host) {
    throw new AdapterError('host element is required');
  }
  if (!def || typeof def !== 'object') {
    throw new AdapterError('RibbonDef is required');
  }
  if (!Array.isArray(def.tabs) || def.tabs.length === 0) {
    throw new AdapterError('def.tabs must be a non-empty array');
  }
  if (!ctx || typeof ctx !== 'object') {
    throw new AdapterError('Ctx must be a non-null object');
  }

  // Hook rAF detection per instance (§3.3)
  const winObj = (host.ownerDocument && host.ownerDocument.defaultView) || (typeof window !== 'undefined' ? window : null) || (typeof globalThis !== 'undefined' ? globalThis : null);
  let inRaf = false;
  let origInstanceRaf = null;

  if (winObj && typeof winObj.requestAnimationFrame === 'function') {
    origInstanceRaf = winObj.requestAnimationFrame;
    winObj.requestAnimationFrame = function (cb) {
      return origInstanceRaf.call(winObj, function (timestamp) {
        inRaf = true;
        try {
          return cb(timestamp);
        } finally {
          inRaf = false;
        }
      });
    };
  }

  // Validate and index commands
  const commandsMap = new Map();
  const tabKeytips = new Set();

  function indexGroupItems(group) {
    const companionMap = new Map();
    const groupItems = [];

    for (const row of group.items || []) {
      for (const item of row || []) {
        groupItems.push(item);
        if (item.kind === 'input') {
          if (!item.id) throw new AdapterError(`InputField missing id in group '${group.id}'`);
          commandsMap.set(item.id, item);
        } else {
          // command
          if (!item.id) throw new AdapterError(`Command missing id in group '${group.id}'`);
          if (!item.keytip || typeof item.keytip !== 'string') {
            throw new AdapterError(`Command '${item.id}' is missing a required keytip string`);
          }
          if (typeof item.run !== 'function') {
            throw new AdapterError(`Command '${item.id}' is missing a run() function`);
          }
          commandsMap.set(item.id, item);

          if (item.splitWith) {
            companionMap.set(item.id, item.splitWith);
          }
        }
      }
    }

    // Verify splitWith companions exist in the same group and don't declare splitWith
    for (const [primaryId, companionId] of companionMap.entries()) {
      const companion = groupItems.find(it => it.id === companionId);
      if (!companion) {
        throw new AdapterError(`Split button primary '${primaryId}' references companion '${companionId}' which does not exist in group '${group.id}'`);
      }
      if (companion.splitWith) {
        throw new AdapterError(`Split button companion '${companionId}' must not declare splitWith`);
      }
    }
  }

  // Validate tabs
  for (const tab of def.tabs) {
    if (!tab.id) throw new AdapterError('Tab missing id');
    if (!tab.keytip || typeof tab.keytip !== 'string') {
      throw new AdapterError(`Tab '${tab.id}' is missing a required keytip string`);
    }
    const upperKeytip = tab.keytip.toUpperCase();
    if (tabKeytips.has(upperKeytip)) {
      throw new AdapterError(`Duplicate tab keytip: '${tab.keytip}'`);
    }
    tabKeytips.add(upperKeytip);

    for (const group of tab.groups || []) {
      if (!group.id) throw new AdapterError(`Group missing id in tab '${tab.id}'`);
      indexGroupItems(group);
    }
  }

  // Validate contextual tabs
  for (const ctxTab of def.contextual || []) {
    if (!ctxTab.id) throw new AdapterError('Contextual tab missing id');
    if (!ctxTab.keytip || typeof ctxTab.keytip !== 'string') {
      throw new AdapterError(`Contextual tab '${ctxTab.id}' is missing a required keytip string`);
    }
    for (const group of ctxTab.groups || []) {
      if (!group.id) throw new AdapterError(`Group missing id in contextual tab '${ctxTab.id}'`);
      indexGroupItems(group);
    }
  }

  // Validate QAT references
  for (const cmdId of def.qat || []) {
    if (!commandsMap.has(cmdId)) {
      throw new AdapterError(`QAT references unknown command id: '${cmdId}'`);
    }
  }

  // Document and host setup
  const doc = host.ownerDocument || (typeof document !== 'undefined' ? document : null);
  host.setAttribute('data-rc-host', '');

  // Ensure SVG sprite is present in the document
  if (doc) {
    let spriteRoot = doc.getElementById('rc-sprite-root');
    if (!spriteRoot) {
      const temp = doc.createElement('div');
      temp.innerHTML = SPRITE_SVG;
      spriteRoot = temp.firstElementChild;
      if (spriteRoot) {
        spriteRoot.id = 'rc-sprite-root';
        if (doc.body) {
          doc.body.insertBefore(spriteRoot, doc.body.firstChild);
        } else {
          host.appendChild(spriteRoot);
        }
      }
    }
  }

  // Collapse state persistence (§2.10)
  let isCollapsed = false;
  try {
    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('rc-collapsed') === '1') {
      isCollapsed = true;
    }
  } catch (e) {
    // ignore
  }
  if (isCollapsed) {
    host.setAttribute('data-rc-collapsed', 'true');
  }

  // Render container
  const ribbonRoot = doc.createElement('div');
  ribbonRoot.className = 'rc-ribbon';
  ribbonRoot.setAttribute('role', 'region');
  ribbonRoot.setAttribute('aria-label', 'Ribbon');

  // 1. QAT Bar
  const qatBar = doc.createElement('div');
  qatBar.className = 'rc-qat';
  qatBar.setAttribute('role', 'toolbar');
  qatBar.setAttribute('aria-label', 'Quick Access Toolbar');

  const qatItemsContainer = doc.createElement('div');
  qatItemsContainer.className = 'rc-qat-items';

  for (const cmdId of def.qat || []) {
    const cmd = commandsMap.get(cmdId);
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'rc-qat-btn';
    btn.setAttribute('data-command-id', cmdId);
    btn.setAttribute('aria-label', cmd.label);
    btn.title = cmd.tooltip || cmd.label;

    btn.innerHTML = `<svg class="rc-icon rc-icon-16" aria-hidden="true"><use href="#icon-${cmd.icon}-16"></use></svg>`;
    btn.addEventListener('click', () => {
      if (!btn.disabled) cmd.run(ctx);
    });

    qatItemsContainer.appendChild(btn);
  }
  qatBar.appendChild(qatItemsContainer);

  const qatCustomise = doc.createElement('button');
  qatCustomise.type = 'button';
  qatCustomise.className = 'rc-qat-customise';
  qatCustomise.title = 'Customise Quick Access Toolbar (coming soon)';
  qatCustomise.setAttribute('aria-label', 'Customise Quick Access Toolbar (coming soon)');
  qatCustomise.innerHTML = `<svg class="rc-icon rc-icon-16" aria-hidden="true"><use href="#icon-chevron-down-16"></use></svg>`;
  qatBar.appendChild(qatCustomise);

  ribbonRoot.appendChild(qatBar);

  // 2. Tab strip
  let activeTabId = def.tabs[0].id;
  let activeContextualId = null;

  const tabStrip = doc.createElement('nav');
  tabStrip.className = 'rc-tab-strip';
  tabStrip.setAttribute('aria-label', 'Ribbon Tabs');

  const tabList = doc.createElement('div');
  tabList.className = 'rc-tablist';
  tabList.setAttribute('role', 'tablist');

  const tabButtons = new Map();
  for (const tab of def.tabs) {
    const tabBtn = doc.createElement('button');
    tabBtn.type = 'button';
    tabBtn.role = 'tab';
    tabBtn.className = 'rc-tab';
    tabBtn.id = `rc-tab-${tab.id}`;
    tabBtn.setAttribute('aria-controls', `rc-panel-${tab.id}`);
    tabBtn.setAttribute('aria-selected', String(tab.id === activeTabId));

    const labelSpan = doc.createElement('span');
    labelSpan.className = 'rc-tab-label';
    labelSpan.textContent = tab.label;
    tabBtn.appendChild(labelSpan);

    tabBtn.addEventListener('click', () => {
      api.setTab(tab.id);
    });

    tabBtn.addEventListener('dblclick', () => {
      if (tab.id === activeTabId) {
        api.toggle();
      }
    });

    tabButtons.set(tab.id, tabBtn);
    tabList.appendChild(tabBtn);
  }
  tabStrip.appendChild(tabList);

  // Collapse button ^
  const collapseBtn = doc.createElement('button');
  collapseBtn.type = 'button';
  collapseBtn.className = 'rc-collapse-btn';
  collapseBtn.setAttribute('aria-label', 'Collapse Ribbon (Ctrl+F1)');
  collapseBtn.title = 'Collapse Ribbon (Ctrl+F1)';
  collapseBtn.setAttribute('aria-expanded', String(!isCollapsed));
  collapseBtn.innerHTML = `<svg class="rc-icon rc-icon-16" aria-hidden="true"><use href="#icon-${isCollapsed ? 'chevron-down' : 'chevron-up'}-16"></use></svg>`;
  collapseBtn.addEventListener('click', () => {
    api.toggle();
  });
  tabStrip.appendChild(collapseBtn);

  ribbonRoot.appendChild(tabStrip);

  // 3. Contextual strip (hidden by default)
  const ctxStrip = doc.createElement('div');
  ctxStrip.className = 'rc-ctx-strip';
  ctxStrip.setAttribute('role', 'status');
  ctxStrip.setAttribute('aria-live', 'polite');
  ctxStrip.style.display = 'none';

  const ctxStripText = doc.createElement('span');
  ctxStripText.className = 'rc-ctx-title';
  ctxStrip.appendChild(ctxStripText);
  ribbonRoot.appendChild(ctxStrip);

  // 4. Panels container
  const panelContainer = doc.createElement('div');
  panelContainer.className = 'rc-panel-container';

  const fixedPanels = new Map();
  const contextualPanels = new Map();

  function renderGroup(group) {
    const groupEl = doc.createElement('div');
    groupEl.className = 'rc-group';
    groupEl.setAttribute('role', 'group');
    groupEl.setAttribute('aria-label', group.label);

    const groupContent = doc.createElement('div');
    groupContent.className = 'rc-group-content';

    const groupRows = doc.createElement('div');
    groupRows.className = 'rc-group-rows';

    // Find all companion command ids in this group
    const companionsInGroup = new Set();
    for (const row of group.items || []) {
      for (const item of row || []) {
        if (item.splitWith) {
          companionsInGroup.add(item.splitWith);
        }
      }
    }

    for (const row of group.items || []) {
      const rowEl = doc.createElement('div');
      rowEl.className = 'rc-group-row';

      for (const item of row || []) {
        if (companionsInGroup.has(item.id)) {
          // Rendered as companion part of a split button; do not render alone
          continue;
        }

        if (item.kind === 'input') {
          const inputWrap = doc.createElement('div');
          inputWrap.className = 'rc-input-field';
          inputWrap.setAttribute('data-input-id', item.id);

          const lbl = doc.createElement('label');
          lbl.htmlFor = item.id;
          lbl.textContent = item.label;
          inputWrap.appendChild(lbl);

          if (item.inputType === 'select') {
            const select = doc.createElement('select');
            select.id = item.id;
            for (const opt of item.options || []) {
              const optEl = doc.createElement('option');
              optEl.value = opt.value;
              optEl.textContent = opt.label;
              select.appendChild(optEl);
            }
            if (typeof item.value === 'function') {
              select.value = item.value(ctx);
            }
            select.addEventListener('change', (e) => {
              item.onChange(e.target.value, ctx);
            });
            inputWrap.appendChild(select);
          } else {
            const input = doc.createElement('input');
            input.type = item.inputType === 'number' ? 'number' : 'text';
            input.id = item.id;
            if (item.min !== undefined) input.min = item.min;
            if (item.max !== undefined) input.max = item.max;
            if (item.step !== undefined) input.step = item.step;
            if (typeof item.value === 'function') {
              input.value = item.value(ctx);
            }
            input.addEventListener('change', (e) => {
              item.onChange(item.inputType === 'number' ? Number(e.target.value) : e.target.value, ctx);
            });
            inputWrap.appendChild(input);
          }
          rowEl.appendChild(inputWrap);
        } else if (item.splitWith) {
          // Split button compound control (§2.7)
          const companion = commandsMap.get(item.splitWith);
          const splitWrap = doc.createElement('div');
          splitWrap.className = 'rc-split-btn';

          // Primary
          const primaryBtn = doc.createElement('button');
          primaryBtn.type = 'button';
          primaryBtn.className = 'rc-btn rc-btn-big rc-split-primary';
          primaryBtn.setAttribute('data-command-id', item.id);
          primaryBtn.setAttribute('aria-label', `${item.label} (primary)`);
          primaryBtn.title = item.tooltip || item.label;
          primaryBtn.innerHTML = `
            <svg class="rc-icon rc-icon-32" aria-hidden="true"><use href="#icon-${item.icon}-32"></use></svg>
            <span class="rc-btn-label">${item.label}</span>
          `;
          primaryBtn.addEventListener('click', () => {
            if (!primaryBtn.disabled) item.run(ctx);
          });
          splitWrap.appendChild(primaryBtn);

          // Divider
          const divider = doc.createElement('span');
          divider.className = 'rc-split-divider';
          divider.setAttribute('aria-hidden', 'true');
          splitWrap.appendChild(divider);

          // Companion
          const compBtn = doc.createElement('button');
          compBtn.type = 'button';
          compBtn.className = 'rc-btn rc-split-companion';
          compBtn.setAttribute('data-command-id', companion.id);
          compBtn.setAttribute('aria-label', companion.label);
          compBtn.title = companion.tooltip || companion.label;
          compBtn.innerHTML = `
            <svg class="rc-icon rc-icon-16" aria-hidden="true"><use href="#icon-${companion.icon}-16"></use></svg>
          `;
          compBtn.addEventListener('click', () => {
            if (!compBtn.disabled) companion.run(ctx);
          });
          splitWrap.appendChild(compBtn);

          rowEl.appendChild(splitWrap);
        } else {
          // Normal Command
          const btn = doc.createElement('button');
          btn.type = 'button';
          btn.className = `rc-btn ${item.size === 'big' ? 'rc-btn-big' : 'rc-btn-small'}`;
          btn.setAttribute('data-command-id', item.id);
          btn.setAttribute('aria-label', item.label);
          btn.title = item.tooltip || item.label;

          if (item.size === 'big') {
            btn.innerHTML = `
              <svg class="rc-icon rc-icon-32" aria-hidden="true"><use href="#icon-${item.icon}-32"></use></svg>
              <span class="rc-btn-label">${item.label}</span>
            `;
          } else {
            btn.innerHTML = `
              <svg class="rc-icon rc-icon-16" aria-hidden="true"><use href="#icon-${item.icon}-16"></use></svg>
              <span class="rc-btn-label">${item.label}</span>
            `;
          }

          btn.addEventListener('click', () => {
            if (!btn.disabled) item.run(ctx);
          });
          rowEl.appendChild(btn);
        }
      }
      groupRows.appendChild(rowEl);
    }
    groupContent.appendChild(groupRows);
    groupEl.appendChild(groupContent);

    // Caption bar
    const captionBar = doc.createElement('div');
    captionBar.className = 'rc-group-caption';
    const captionText = doc.createElement('span');
    captionText.className = 'rc-caption-text';
    captionText.textContent = group.label;
    captionBar.appendChild(captionText);

    if (group.launcher) {
      const launcherBtn = doc.createElement('button');
      launcherBtn.type = 'button';
      launcherBtn.className = 'rc-group-launcher';
      launcherBtn.setAttribute('aria-haspopup', 'dialog');
      launcherBtn.setAttribute('aria-label', group.launcher.ariaLabel);
      launcherBtn.title = group.launcher.tooltip;
      launcherBtn.innerHTML = `<svg class="rc-icon rc-icon-12" aria-hidden="true"><use href="#icon-launcher-16"></use></svg>`;
      launcherBtn.addEventListener('click', () => {
        group.launcher.run(ctx);
      });
      captionBar.appendChild(launcherBtn);
    }

    groupEl.appendChild(captionBar);
    return groupEl;
  }

  // Render Fixed Panels
  for (const tab of def.tabs) {
    const panel = doc.createElement('section');
    panel.className = 'rc-panel';
    panel.setAttribute('role', 'tabpanel');
    panel.id = `rc-panel-${tab.id}`;
    panel.setAttribute('aria-labelledby', `rc-tab-${tab.id}`);
    if (tab.id !== activeTabId) {
      panel.hidden = true;
    }

    for (const group of tab.groups || []) {
      panel.appendChild(renderGroup(group));
    }

    fixedPanels.set(tab.id, panel);
    panelContainer.appendChild(panel);
  }

  // Render Contextual Panels
  for (const ctxTab of def.contextual || []) {
    const panel = doc.createElement('section');
    panel.className = 'rc-panel rc-panel-ctx';
    panel.setAttribute('role', 'tabpanel');
    panel.id = `rc-ctx-panel-${ctxTab.id}`;
    panel.setAttribute('aria-label', ctxTab.label);
    panel.hidden = true;

    for (const group of ctxTab.groups || []) {
      panel.appendChild(renderGroup(group));
    }

    contextualPanels.set(ctxTab.id, panel);
    panelContainer.appendChild(panel);
  }

  ribbonRoot.appendChild(panelContainer);
  host.appendChild(ribbonRoot);

  // 5. Status Bar
  let statusBar = null;
  if (Array.isArray(def.statusSegments) && def.statusSegments.length > 0) {
    statusBar = doc.createElement('footer');
    statusBar.className = 'rc-status-bar';
    statusBar.id = 'rc-status-bar';
    statusBar.setAttribute('role', 'status');
    statusBar.setAttribute('aria-live', 'polite');

    for (let i = 0; i < def.statusSegments.length; i++) {
      const seg = def.statusSegments[i];
      const segSpan = doc.createElement('span');
      segSpan.className = 'rc-status-segment';
      segSpan.setAttribute('data-segment-id', seg.id);
      segSpan.textContent = typeof seg.value === 'function' ? seg.value(ctx) : '';
      statusBar.appendChild(segSpan);

      if (i < def.statusSegments.length - 1) {
        const sep = doc.createElement('span');
        sep.className = 'rc-status-sep';
        sep.setAttribute('aria-hidden', 'true');
        sep.textContent = '│';
        statusBar.appendChild(sep);
      }
    }
    host.appendChild(statusBar);
  }

  function updateCollapseButton() {
    collapseBtn.setAttribute('aria-expanded', String(!isCollapsed));
    collapseBtn.innerHTML = `<svg class="rc-icon rc-icon-16" aria-hidden="true"><use href="#icon-${isCollapsed ? 'chevron-down' : 'chevron-up'}-16"></use></svg>`;
  }

  // Define API object
  const api = {
    setTab(id) {
      if (!tabButtons.has(id)) return;
      activeTabId = id;

      for (const [tId, btn] of tabButtons.entries()) {
        btn.setAttribute('aria-selected', String(tId === id));
      }

      if (!activeContextualId) {
        for (const [pId, panel] of fixedPanels.entries()) {
          panel.hidden = (pId !== id);
        }
      }
    },

    showContextual(id) {
      const ctxTab = (def.contextual || []).find(t => t.id === id);
      if (!ctxTab) return;

      activeContextualId = id;
      ctxStripText.textContent = ctxTab.label;
      ctxStrip.style.display = 'flex';

      // Hide all fixed panels
      for (const panel of fixedPanels.values()) {
        panel.hidden = true;
      }
      // Hide other contextual panels, show this one
      for (const [cId, panel] of contextualPanels.entries()) {
        panel.hidden = (cId !== id);
      }

      // Focus first button in contextual panel
      const firstBtn = contextualPanels.get(id)?.querySelector('button:not(:disabled)');
      if (firstBtn && typeof firstBtn.focus === 'function') {
        firstBtn.focus();
      }
    },

    hideContextual() {
      if (!activeContextualId) return;
      activeContextualId = null;
      ctxStrip.style.display = 'none';

      for (const panel of contextualPanels.values()) {
        panel.hidden = true;
      }

      const activePanel = fixedPanels.get(activeTabId);
      if (activePanel) {
        activePanel.hidden = false;
      }
    },

    refresh() {
      if (inRaf) {
        console.warn('[ribbon-chrome] api.refresh() called inside requestAnimationFrame / render loop; refresh() should only be called in state-mutating event handlers');
      }

      // Re-evaluate command states
      for (const [cmdId, cmd] of commandsMap.entries()) {
        if (cmd.kind === 'input') {
          if (typeof cmd.value === 'function') {
            const val = cmd.value(ctx);
            const inputs = host.querySelectorAll(`.rc-input-field[data-input-id="${cmdId}"] input, .rc-input-field[data-input-id="${cmdId}"] select`);
            for (const input of inputs) {
              if (input.value !== String(val)) {
                input.value = val;
              }
            }
          }
          continue;
        }

        const isEnabled = cmd.enabled ? Boolean(cmd.enabled(ctx)) : true;
        const isVisible = cmd.visible ? Boolean(cmd.visible(ctx)) : true;

        const buttons = host.querySelectorAll(`[data-command-id="${cmdId}"]`);
        for (const btn of buttons) {
          const splitParent = btn.closest('.rc-split-btn');
          if (splitParent) {
            if (btn.classList.contains('rc-split-companion')) {
              const primaryBtn = splitParent.querySelector('.rc-split-primary');
              const primaryId = primaryBtn?.getAttribute('data-command-id');
              const primaryCmd = primaryId ? commandsMap.get(primaryId) : null;
              const primaryEnabled = primaryCmd?.enabled ? Boolean(primaryCmd.enabled(ctx)) : true;

              const effectiveEnabled = primaryEnabled && isEnabled;
              btn.disabled = !effectiveEnabled;
              btn.setAttribute('aria-disabled', String(!effectiveEnabled));
            } else {
              btn.disabled = !isEnabled;
              btn.setAttribute('aria-disabled', String(!isEnabled));
            }
          } else {
            btn.disabled = !isEnabled;
            btn.setAttribute('aria-disabled', String(!isEnabled));
          }

          btn.hidden = !isVisible;
          if (!isVisible) {
            btn.style.display = 'none';
          } else {
            btn.style.display = '';
          }
        }
      }

      // Status segments
      if (def.statusSegments) {
        for (const seg of def.statusSegments) {
          if (typeof seg.value === 'function') {
            api.setStatus(seg.id, seg.value(ctx));
          }
        }
      }
    },

    setKeytipsVisible(visible) {
      if (visible) {
        keytipManager.showTabs();
      } else {
        keytipManager.hide();
      }
    },

    collapse() {
      isCollapsed = true;
      host.setAttribute('data-rc-collapsed', 'true');
      updateCollapseButton();
      try {
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.setItem('rc-collapsed', '1');
        }
      } catch (e) {}
    },

    expand() {
      isCollapsed = false;
      host.removeAttribute('data-rc-collapsed');
      updateCollapseButton();
      try {
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.removeItem('rc-collapsed');
        }
      } catch (e) {}
    },

    toggle() {
      if (isCollapsed) {
        api.expand();
      } else {
        api.collapse();
      }
    },

    setStatus(segmentId, value) {
      const segSpan = host.querySelector(`.rc-status-segment[data-segment-id="${segmentId}"]`);
      if (segSpan) {
        segSpan.textContent = value;
      }
    },

    destroy() {
      keytipManager.destroy();
      if (winObj && origInstanceRaf) {
        winObj.requestAnimationFrame = origInstanceRaf;
        origInstanceRaf = null;
        inRaf = false;
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('keydown', onGlobalKeyDown, true);
      }
      try {
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.removeItem('rc-collapsed');
        }
      } catch (e) {}

      host.innerHTML = '';
      host.removeAttribute('data-rc-host');
      host.removeAttribute('data-rc-collapsed');
      host.removeAttribute('data-keytips');
      if (typeof document !== 'undefined' && document.body) {
        document.body.removeAttribute('data-keytips');
      }
    }
  };

  // Setup KeyTip Manager
  const keytipManager = new KeytipManager({
    host,
    def,
    api,
    getActiveTab: () => def.tabs.find(t => t.id === activeTabId),
    getActiveContextual: () => (def.contextual || []).find(t => t.id === activeContextualId),
    getCommandsMap: () => commandsMap,
    getCtx: () => ctx,
  });

  // Global key navigation listener for Ctrl+F1 and Arrow navigation
  function onGlobalKeyDown(e) {
    if (e.ctrlKey && e.key === 'F1') {
      e.preventDefault();
      e.stopPropagation();
      api.toggle();
      return;
    }

    // Arrow navigation on tab buttons
    if (['ArrowLeft', 'ArrowRight'].includes(e.key)) {
      const activeElement = doc.activeElement;
      if (activeElement && activeElement.classList.contains('rc-tab')) {
        const tabsArr = Array.from(tabButtons.values());
        const currIndex = tabsArr.indexOf(activeElement);
        if (currIndex !== -1) {
          e.preventDefault();
          let nextIndex;
          if (e.key === 'ArrowRight') {
            nextIndex = (currIndex + 1) % tabsArr.length;
          } else {
            nextIndex = (currIndex - 1 + tabsArr.length) % tabsArr.length;
          }
          tabsArr[nextIndex].focus();
        }
      }
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', onGlobalKeyDown, true);
  }

  // Initial refresh pass
  api.refresh();

  return api;
}
