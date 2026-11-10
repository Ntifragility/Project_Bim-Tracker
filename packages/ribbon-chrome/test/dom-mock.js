/**
 * Lightweight mock DOM environment for ribbon-chrome unit tests in Node.js
 */

export class MockClassList {
  constructor(el) {
    this.el = el;
  }
  get _classes() {
    return (this.el.className || '').split(/\s+/).filter(Boolean);
  }
  contains(cls) {
    return this._classes.includes(cls);
  }
  add(cls) {
    const classes = this._classes;
    if (!classes.includes(cls)) {
      classes.push(cls);
      this.el.className = classes.join(' ');
    }
  }
  remove(cls) {
    const classes = this._classes.filter(c => c !== cls);
    this.el.className = classes.join(' ');
  }
}

export class MockElement {
  constructor(tagName = 'div', doc = null) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = doc;
    this.attributes = new Map();
    this.childNodes = [];
    this.listeners = new Map();
    this.style = {};
    this.classList = new MockClassList(this);
    this._value = '';
    this._textContent = '';
    this._innerHTML = '';
  }

  get id() {
    return this.getAttribute('id') || '';
  }
  set id(val) {
    this.setAttribute('id', val);
  }

  get className() {
    return this.getAttribute('class') || '';
  }
  set className(val) {
    this.setAttribute('class', val);
  }

  get type() {
    return this.getAttribute('type') || '';
  }
  set type(val) {
    this.setAttribute('type', val);
  }

  get role() {
    return this.getAttribute('role') || '';
  }
  set role(val) {
    this.setAttribute('role', val);
  }

  get title() {
    return this.getAttribute('title') || '';
  }
  set title(val) {
    this.setAttribute('title', val);
  }

  get disabled() {
    return this.hasAttribute('disabled');
  }
  set disabled(val) {
    if (val) this.setAttribute('disabled', '');
    else this.removeAttribute('disabled');
  }

  get hidden() {
    return this.hasAttribute('hidden');
  }
  set hidden(val) {
    if (val) this.setAttribute('hidden', '');
    else this.removeAttribute('hidden');
  }

  get value() {
    return this._value;
  }
  set value(val) {
    this._value = String(val);
  }

  get textContent() {
    if (this.childNodes.length > 0) {
      return this.childNodes.map(c => c.textContent).join('');
    }
    return this._textContent;
  }
  set textContent(val) {
    this._textContent = String(val);
    this.childNodes = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }
  set innerHTML(html) {
    this._innerHTML = html;
    this.childNodes = [];
  }

  get children() {
    return this.childNodes.filter(n => n instanceof MockElement);
  }

  get parentNode() {
    return this._parent || null;
  }
  get parentElement() {
    return this._parent || null;
  }

  get firstElementChild() {
    const ch = this.children;
    return ch.length > 0 ? ch[0] : null;
  }

  setAttribute(name, val) {
    this.attributes.set(name, String(val));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  appendChild(child) {
    child._parent = this;
    child.ownerDocument = this.ownerDocument;
    this.childNodes.push(child);
    return child;
  }

  insertBefore(newChild, refChild) {
    newChild._parent = this;
    newChild.ownerDocument = this.ownerDocument;
    const idx = this.childNodes.indexOf(refChild);
    if (idx === -1) {
      this.childNodes.push(newChild);
    } else {
      this.childNodes.splice(idx, 0, newChild);
    }
    return newChild;
  }

  removeChild(child) {
    const idx = this.childNodes.indexOf(child);
    if (idx !== -1) {
      this.childNodes.splice(idx, 1);
      child._parent = null;
    }
    return child;
  }

  addEventListener(type, listener, useCapture = false) {
    const key = `${type}:${Boolean(useCapture)}`;
    if (!this.listeners.has(key)) {
      this.listeners.set(key, []);
    }
    this.listeners.get(key).push(listener);
  }

  removeEventListener(type, listener, useCapture = false) {
    const key = `${type}:${Boolean(useCapture)}`;
    if (!this.listeners.has(key)) return;
    const list = this.listeners.get(key).filter(l => l !== listener);
    this.listeners.set(key, list);
  }

  dispatchEvent(event) {
    event.target = this;
    event.currentTarget = this;
    const keyCapture = `${event.type}:true`;
    const keyBubble = `${event.type}:false`;

    for (const l of this.listeners.get(keyCapture) || []) {
      l.call(this, event);
    }
    for (const l of this.listeners.get(keyBubble) || []) {
      l.call(this, event);
    }
    return !event.defaultPrevented;
  }

  click() {
    const event = {
      type: 'click',
      defaultPrevented: false,
      stopPropagation: () => {},
      preventDefault() { this.defaultPrevented = true; }
    };
    this.dispatchEvent(event);
  }

  focus() {
    if (this.ownerDocument) {
      this.ownerDocument.activeElement = this;
    }
  }

  _matchesSingle(simple) {
    if (simple === '*') return true;
    if (simple === ':not(:disabled)') return !this.disabled;

    let s = simple;

    // 1. Tag
    const tagMatch = s.match(/^[a-zA-Z0-9_-]+/);
    if (tagMatch) {
      if (this.tagName.toLowerCase() !== tagMatch[0].toLowerCase()) return false;
      s = s.slice(tagMatch[0].length);
    }

    // 2. Attributes: [attr="val"] or [attr] (extract first so dots in values don't conflict with class names)
    const attrRegex = /\[([a-zA-Z0-9_-]+)(?:=([^[\]]+))?\]/;
    let attrMatch;
    while ((attrMatch = s.match(attrRegex)) !== null) {
      const attrName = attrMatch[1];
      let attrVal = attrMatch[2];
      if (attrVal !== undefined) {
        attrVal = attrVal.replace(/^["']|["']$/g, '');
        if (this.getAttribute(attrName) !== attrVal) return false;
      } else {
        if (!this.hasAttribute(attrName)) return false;
      }
      s = s.replace(attrMatch[0], '');
    }

    // 3. ID
    const idRegex = /#([a-zA-Z0-9_-]+)/;
    let idMatch;
    while ((idMatch = s.match(idRegex)) !== null) {
      if (this.id !== idMatch[1]) return false;
      s = s.replace(idMatch[0], '');
    }

    // 4. Classes
    const classRegex = /\.([a-zA-Z0-9_-]+)/;
    let classMatch;
    while ((classMatch = s.match(classRegex)) !== null) {
      if (!this.classList.contains(classMatch[1])) return false;
      s = s.replace(classMatch[0], '');
    }

    // 5. Pseudo-classes
    if (s.includes(':not(:disabled)')) {
      if (this.disabled) return false;
      s = s.replace(':not(:disabled)', '');
    }

    return true;
  }

  matches(selector) {
    const parts = selector.split(',').map(p => p.trim());
    return parts.some(part => {
      const subParts = part.split(/\s+/).filter(Boolean);
      return this._matchesSingle(subParts[subParts.length - 1]);
    });
  }

  closest(selector) {
    let curr = this;
    while (curr) {
      if (curr instanceof MockElement && curr._matchesSingle(selector)) {
        return curr;
      }
      curr = curr.parentElement;
    }
    return null;
  }

  querySelector(selector) {
    const all = this.querySelectorAll(selector);
    return all.length > 0 ? all[0] : null;
  }

  querySelectorAll(selector) {
    const results = [];
    const selectors = selector.split(',').map(s => s.trim());

    function search(node) {
      for (const child of node.children) {
        for (const sel of selectors) {
          const tokens = sel.split(/\s+/).filter(Boolean);
          if (tokens.length === 1) {
            if (child._matchesSingle(tokens[0])) {
              if (!results.includes(child)) results.push(child);
            }
          } else if (tokens.length === 2) {
            if (child._matchesSingle(tokens[1]) && child.closest(tokens[0])) {
              if (!results.includes(child)) results.push(child);
            }
          } else {
            if (child._matchesSingle(tokens[tokens.length - 1])) {
              if (!results.includes(child)) results.push(child);
            }
          }
        }
        search(child);
      }
    }

    search(this);
    return results;
  }
}

export class MockDocument {
  constructor() {
    this.body = new MockElement('body', this);
    this.activeElement = null;
    this.defaultView = null;
  }

  createElement(tagName) {
    return new MockElement(tagName, this);
  }

  getElementById(id) {
    return this.body.querySelector(`#${id}`);
  }

  querySelector(sel) {
    return this.body.querySelector(sel);
  }

  querySelectorAll(sel) {
    return this.body.querySelectorAll(sel);
  }
}

export class MockSessionStorage {
  constructor() {
    this.store = new Map();
  }
  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }
  setItem(key, val) {
    this.store.set(key, String(val));
  }
  removeItem(key) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
}

export function setupMockDom() {
  const doc = new MockDocument();
  const sessionStorage = new MockSessionStorage();
  const listeners = new Map();

  const win = {
    addEventListener(type, listener, useCapture = false) {
      const key = `${type}:${Boolean(useCapture)}`;
      if (!listeners.has(key)) listeners.set(key, []);
      listeners.get(key).push(listener);
    },
    removeEventListener(type, listener, useCapture = false) {
      const key = `${type}:${Boolean(useCapture)}`;
      if (!listeners.has(key)) return;
      listeners.set(key, listeners.get(key).filter(l => l !== listener));
    },
    dispatchEvent(event) {
      const keyCapture = `${event.type}:true`;
      const keyBubble = `${event.type}:false`;
      for (const l of listeners.get(keyCapture) || []) {
        l.call(win, event);
      }
      for (const l of listeners.get(keyBubble) || []) {
        l.call(win, event);
      }
      return !event.defaultPrevented;
    },
    requestAnimationFrame(cb) {
      return setTimeout(() => cb(Date.now()), 0);
    },
    cancelAnimationFrame(id) {
      clearTimeout(id);
    },
    document: doc,
    sessionStorage
  };

  doc.defaultView = win;

  globalThis.document = doc;
  globalThis.window = win;
  globalThis.sessionStorage = sessionStorage;
  globalThis.HTMLElement = MockElement;

  return { doc, win, sessionStorage };
}
