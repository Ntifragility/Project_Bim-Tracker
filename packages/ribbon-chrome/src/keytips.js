/**
 * KeyTips: Revit Alt-mode keyboard navigation system
 * Authoritative reference: docs/specs/chrome/revit-chrome-design.md §2.9 & R5
 */

export class KeytipManager {
  constructor({ host, def, api, getActiveTab, getActiveContextual, getCommandsMap, getCtx }) {
    this.host = host;
    this.def = def;
    this.api = api;
    this.getActiveTab = getActiveTab;
    this.getActiveContextual = getActiveContextual;
    this.getCommandsMap = getCommandsMap;
    this.getCtx = getCtx;
    this.mode = null; // null | 'tabs' | 'commands'
    this.buffer = '';
    this.badges = [];
    this._boundKeyDown = this._onKeyDown.bind(this);

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this._boundKeyDown, true);
    }
  }

  get isVisible() {
    return this.mode !== null;
  }

  showTabs() {
    this.hideBadges();
    this.mode = 'tabs';
    this.buffer = '';
    this._setHostAttribute('tabs');

    // 1. QAT items
    for (const cmdId of this.def.qat || []) {
      const cmd = this.getCommandsMap().get(cmdId);
      if (cmd && cmd.keytip) {
        const btn = this.host.querySelector(`.rc-qat-btn[data-command-id="${cmdId}"]`);
        if (btn) this._addBadge(btn, cmd.keytip);
      }
    }

    // 2. Tab items
    for (const tab of this.def.tabs || []) {
      if (tab.keytip) {
        const tabBtn = this.host.querySelector(`.rc-tab#rc-tab-${tab.id}`);
        if (tabBtn) this._addBadge(tabBtn, tab.keytip);
      }
    }

    // 3. Contextual tab if active
    const activeCtx = this.getActiveContextual();
    if (activeCtx && activeCtx.keytip) {
      const ctxStrip = this.host.querySelector('.rc-ctx-strip');
      if (ctxStrip) this._addBadge(ctxStrip, activeCtx.keytip);
    }
  }

  showCommands() {
    this.hideBadges();
    this.mode = 'commands';
    this.buffer = '';
    this._setHostAttribute('commands');

    const activeCtx = this.getActiveContextual();
    let panel;
    if (activeCtx) {
      panel = this.host.querySelector(`#rc-ctx-panel-${activeCtx.id}`);
    } else {
      const activeTab = this.getActiveTab();
      if (activeTab) {
        panel = this.host.querySelector(`#rc-panel-${activeTab.id}`);
      }
    }

    if (!panel) return;

    // Attach badges to command buttons in this panel
    const buttons = panel.querySelectorAll('[data-command-id]');
    for (const btn of buttons) {
      const cmdId = btn.getAttribute('data-command-id');
      const cmd = this.getCommandsMap().get(cmdId);
      if (cmd && cmd.keytip) {
        this._addBadge(btn, cmd.keytip);
      }
    }

    // Input fields with keytips
    const inputs = panel.querySelectorAll('.rc-input-field[data-input-id]');
    for (const el of inputs) {
      const id = el.getAttribute('data-input-id');
      const item = this.getCommandsMap().get(id);
      if (item && item.keytip) {
        this._addBadge(el, item.keytip);
      }
    }
  }

  hide() {
    this.hideBadges();
    this.mode = null;
    this.buffer = '';
    this._setHostAttribute(null);
  }

  hideBadges() {
    for (const badge of this.badges) {
      if (badge.parentNode) {
        badge.parentNode.removeChild(badge);
      }
    }
    this.badges = [];
  }

  _addBadge(container, text) {
    const doc = container.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (!doc) return;
    const span = doc.createElement('span');
    span.className = 'rc-keytip';
    span.setAttribute('role', 'tooltip');
    span.textContent = text;
    container.appendChild(span);
    this.badges.push(span);
  }

  _setHostAttribute(val) {
    if (val) {
      this.host.setAttribute('data-keytips', val);
      if (typeof document !== 'undefined' && document.body) {
        document.body.setAttribute('data-keytips', val);
      }
    } else {
      this.host.removeAttribute('data-keytips');
      if (typeof document !== 'undefined' && document.body) {
        document.body.removeAttribute('data-keytips');
      }
    }
  }

  _onKeyDown(e) {
    // 1. Escape key handling (R5 first ESC layer)
    if (e.key === 'Escape' && this.isVisible) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') {
        e.stopImmediatePropagation();
      }
      this.hide();
      return;
    }

    // 2. Alt key handling
    if (e.key === 'Alt') {
      if (this.isVisible) {
        e.preventDefault();
        e.stopPropagation();
        this.hide();
      } else {
        e.preventDefault();
        e.stopPropagation();
        this.showTabs();
      }
      return;
    }

    // If keytips are not active, ignore other keys
    if (!this.isVisible) return;

    // Ignore modifier keys
    if (['Shift', 'Control', 'Meta', 'CapsLock', 'Tab'].includes(e.key)) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const char = e.key.toUpperCase();
    this.buffer += char;

    if (this.mode === 'tabs') {
      this._handleTabsKey();
    } else if (this.mode === 'commands') {
      this._handleCommandsKey();
    }
  }

  _handleTabsKey() {
    const buf = this.buffer;
    const ctx = this.getCtx();

    // Check tabs
    for (const tab of this.def.tabs || []) {
      const kt = (tab.keytip || '').toUpperCase();
      if (kt === buf) {
        this.api.setTab(tab.id);
        this.showCommands();
        return;
      }
    }

    // Check QAT
    for (const cmdId of this.def.qat || []) {
      const cmd = this.getCommandsMap().get(cmdId);
      if (cmd && (cmd.keytip || '').toUpperCase() === buf) {
        if (!cmd.enabled || cmd.enabled(ctx) !== false) {
          cmd.run(ctx);
        }
        this.hide();
        return;
      }
    }

    // Check contextual tab
    const activeCtx = this.getActiveContextual();
    if (activeCtx && (activeCtx.keytip || '').toUpperCase() === buf) {
      this.showCommands();
      return;
    }

    // Check prefix
    let isPrefix = false;
    for (const tab of this.def.tabs || []) {
      if ((tab.keytip || '').toUpperCase().startsWith(buf)) {
        isPrefix = true;
        break;
      }
    }
    if (!isPrefix) {
      for (const cmdId of this.def.qat || []) {
        const cmd = this.getCommandsMap().get(cmdId);
        if (cmd && (cmd.keytip || '').toUpperCase().startsWith(buf)) {
          isPrefix = true;
          break;
        }
      }
    }

    if (!isPrefix) {
      this.buffer = '';
    }
  }

  _handleCommandsKey() {
    const buf = this.buffer;
    const ctx = this.getCtx();
    const activeCtx = this.getActiveContextual();
    let panel;
    if (activeCtx) {
      panel = this.host.querySelector(`#rc-ctx-panel-${activeCtx.id}`);
    } else {
      const activeTab = this.getActiveTab();
      if (activeTab) {
        panel = this.host.querySelector(`#rc-panel-${activeTab.id}`);
      }
    }

    if (!panel) {
      this.hide();
      return;
    }

    const candidates = [];
    const elements = panel.querySelectorAll('[data-command-id], .rc-input-field[data-input-id]');
    for (const el of elements) {
      const id = el.getAttribute('data-command-id') || el.getAttribute('data-input-id');
      const item = this.getCommandsMap().get(id);
      if (item && item.keytip) {
        candidates.push({ item, element: el });
      }
    }

    // Exact match
    const exact = candidates.filter(c => (c.item.keytip || '').toUpperCase() === buf);
    if (exact.length > 0) {
      const matched = exact[0];
      if (matched.item.kind === 'input') {
        const input = matched.element.querySelector('input, select');
        if (input) input.focus();
      } else {
        if (!matched.item.enabled || matched.item.enabled(ctx) !== false) {
          matched.item.run(ctx);
        }
      }
      this.hide();
      return;
    }

    // Prefix match
    const prefix = candidates.filter(c => (c.item.keytip || '').toUpperCase().startsWith(buf));
    if (prefix.length === 0) {
      this.buffer = '';
    }
  }

  destroy() {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this._boundKeyDown, true);
    }
    this.hide();
  }
}
