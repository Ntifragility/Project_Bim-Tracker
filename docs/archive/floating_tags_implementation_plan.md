# 3D Floating Tag Labels — Implementation Plan & Developer Prompt

> **Instructions for AI / Developer:**  
> Implement 3D floating HTML tag badges over tagged IFC elements in this ThatOpen / Three.js web application. Everything needed (exact files, line numbers, CSS, and code) is provided below.

---

## 1. Context & Architecture

- **Project:** BIM Tracker / IFC Viewer (`vite`, Three.js `^0.184.0`, `@thatopen/components ^3.4.6`, `@thatopen/components-front ^3.4.3`).
- **Goal:** When elements are tagged via the Tray Systems tool (stored in `tagAssignments` Map and `modelEntry.existingProjectTags`), display 3D floating badges anchored above each element's 3D bounding box.
- **Engine Feature:** `@thatopen/components-front` provides `OBF.RendererWith2D` (a drop-in replacement for `OBC.SimpleRenderer` with built-in `CSS2DRenderer`) and `OBF.Marker` (handles 3D-to-2D screen projection and auto-clustering).

---

## 2. File Checklist

| File | Action | Description |
|---|---|---|
| `src/tag-label-manager.js` | **NEW** | Manager class for calculating bounding boxes, creating HTML badges, registering markers with `OBF.Marker`. |
| `src/style.css` | **MODIFY** | Styles for `.tag-3d-label`, hover states, and `.tag-3d-cluster` badge. |
| `index.html` | **MODIFY** | Checkbox toggles in Controls sidebar and Tray Systems panel. |
| `src/main.js` | **MODIFY** | Upgrade renderer to `OBF.RendererWith2D`, wire `TagLabelManager`, hook toggles and tag change events. |

---

## 3. Step-by-Step Implementation

### Step 1: Create `src/tag-label-manager.js`

Create `src/tag-label-manager.js` with the following content:

```javascript
import * as THREE from 'three';
import * as OBC from '@thatopen/components';
import * as OBF from '@thatopen/components-front';

const SYSTEM_PALETTE = [
  '#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ec4899',
  '#06b6d4', '#14b8a6', '#f97316', '#a855f7', '#6366f1',
];

function getSystemColor(systemTag, fallbackColor = '#10b981') {
  if (!systemTag) return fallbackColor;
  let hash = 0;
  for (let i = 0; i < systemTag.length; i++) {
    hash = (hash << 5) - hash + systemTag.charCodeAt(i);
    hash |= 0;
  }
  return SYSTEM_PALETTE[Math.abs(hash) % SYSTEM_PALETTE.length];
}

export class TagLabelManager {
  constructor(components, world, options = {}) {
    this.components = components;
    this.world = world;
    this.options = {
      yOffset: 0.25,
      clusterThreshold: 45,
      onClick: null,
      getHighlightColor: null,
      ...options,
    };

    this.markers = components.get(OBF.Marker);
    this.markers.threshold = this.options.clusterThreshold;
    this.markers.autoCluster = true;

    this.markers.clusterElementFactory = () => {
      const el = document.createElement('div');
      el.className = 'tag-3d-cluster';
      return el;
    };

    this.activeMarkers = new Map(); // key: `${modelId}:${localId}` -> markerKey
    this.cachedElements = [];
    this.isVisible = false;
  }

  isActive() {
    return this.isVisible;
  }

  async setVisible(visible, loadedModels = []) {
    this.isVisible = Boolean(visible);
    if (!this.isVisible) {
      this.clearAll();
    } else {
      await this.refreshLabels(this.cachedElements, loadedModels);
    }
  }

  async refreshLabels(taggedElements = [], loadedModels = []) {
    this.cachedElements = Array.isArray(taggedElements) ? taggedElements : [];
    if (!this.isVisible) {
      this.clearAll();
      return;
    }

    const neededKeys = new Set();
    const elementsToCreate = [];

    for (const elem of this.cachedElements) {
      if (!elem.modelId || elem.localId === undefined || elem.localId === null) continue;
      const key = `${elem.modelId}:${Number(elem.localId)}`;
      neededKeys.add(key);

      if (!this.activeMarkers.has(key)) {
        elementsToCreate.push({ key, elem });
      }
    }

    for (const [key, markerKey] of this.activeMarkers.entries()) {
      if (!neededKeys.has(key)) {
        try {
          this.markers.delete(markerKey);
        } catch (err) {
          console.warn('[TagLabelManager] Marker deletion failed:', err);
        }
        this.activeMarkers.delete(key);
      }
    }

    if (elementsToCreate.length === 0) return;

    for (const { key, elem } of elementsToCreate) {
      const modelEntry = loadedModels.find(
        (m) => m.model?.modelId === elem.modelId || m.model?.uuid === elem.modelId || m.uuid === elem.modelId
      );
      if (!modelEntry || !modelEntry.model) continue;

      try {
        const position = await this.getElementPosition(modelEntry.model, elem.localId);
        if (!position) continue;

        const labelDiv = this.createLabelElement(elem);
        const markerKey = this.markers.create(this.world, labelDiv, position);
        if (markerKey !== null && markerKey !== undefined) {
          this.activeMarkers.set(key, markerKey);
        }
      } catch (err) {
        console.warn('[TagLabelManager] Failed to create label for', key, err);
      }
    }
  }

  async getElementPosition(model, localId) {
    const numericId = Number(localId);

    if (typeof model.getBoxes === 'function') {
      try {
        const boxes = await model.getBoxes([numericId]);
        if (boxes && boxes.length > 0 && boxes[0] && !boxes[0].isEmpty()) {
          const box = boxes[0];
          const center = new THREE.Vector3();
          box.getCenter(center);
          center.y = box.max.y + this.options.yOffset;
          return center;
        }
      } catch {}
    }

    const bboxer = this.components.get(OBC.BoundingBoxer);
    try {
      bboxer.list.clear();
      const modelId = model.modelId || model.uuid;
      await bboxer.addFromModelIdMap({ [modelId]: new Set([numericId]) });
      const box = bboxer.get();
      if (box && !box.isEmpty()) {
        const center = new THREE.Vector3();
        box.getCenter(center);
        center.y = box.max.y + this.options.yOffset;
        return center;
      }
    } catch (error) {
      console.warn('[TagLabelManager] BoundingBoxer fallback error:', error);
    } finally {
      bboxer.list.clear();
    }

    return null;
  }

  createLabelElement(elem) {
    const fallbackColor = typeof this.options.getHighlightColor === 'function'
      ? this.options.getHighlightColor()
      : '#10b981';
    const accentColor = getSystemColor(elem.systemTag, fallbackColor);

    const container = document.createElement('div');
    container.className = 'tag-3d-label';
    container.style.setProperty('--label-accent', accentColor);
    container.setAttribute('data-model-id', elem.modelId);
    container.setAttribute('data-local-id', String(elem.localId));
    container.title = `Click to inspect: ${elem.elementTag || elem.componentId || elem.localId}`;

    const title = document.createElement('div');
    title.className = 'tag-3d-label-title';
    title.innerHTML = `<span class="tag-icon">🏷️</span> <span class="tag-text">${elem.elementTag || elem.componentId || `Tag #${elem.localId}`}</span>`;
    container.appendChild(title);

    const subtitleParts = [];
    if (elem.systemTag && elem.systemTag !== elem.elementTag) subtitleParts.push(elem.systemTag);
    if (elem.elementKind) subtitleParts.push(elem.elementKind);
    if (subtitleParts.length > 0) {
      const sub = document.createElement('div');
      sub.className = 'tag-3d-label-sub';
      sub.textContent = subtitleParts.join(' · ');
      container.appendChild(sub);
    }

    container.addEventListener('pointerdown', (e) => e.stopPropagation());
    container.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof this.options.onClick === 'function') {
        this.options.onClick(elem.modelId, elem.localId, elem);
      }
    });

    return container;
  }

  clearAll() {
    for (const markerKey of this.activeMarkers.values()) {
      try {
        this.markers.delete(markerKey);
      } catch (err) {
        console.warn('[TagLabelManager] Error clearing marker:', err);
      }
    }
    this.activeMarkers.clear();
  }

  dispose() {
    this.clearAll();
    this.cachedElements = [];
  }
}
```

---

### Step 2: Add CSS in `src/style.css`

Add to `src/style.css`:

```css
/* ── 3D Floating Tag Labels & Clusters ── */
.tag-3d-label {
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: rgba(12, 15, 24, 0.92);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  color: #f3f4f6;
  font-family: var(--font-sans);
  font-size: 11px;
  line-height: 1.25;
  padding: 5px 10px 5px 12px;
  border-radius: 7px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-left: 3.5px solid var(--label-accent, #10b981);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.6), 0 0 10px rgba(0, 0, 0, 0.3);
  pointer-events: auto !important;
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
  transform: translate(-50%, -100%);
  margin-top: -8px;
  transition: transform 0.15s cubic-bezier(0.2, 0, 0, 1), box-shadow 0.15s ease, border-color 0.15s ease;
  z-index: 10;
}

.tag-3d-label:hover {
  transform: translate(-50%, -105%) scale(1.06);
  border-color: rgba(255, 255, 255, 0.3);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.8), 0 0 16px var(--label-accent, #10b981);
  z-index: 9999 !important;
}

.tag-3d-label-title {
  display: flex;
  align-items: center;
  gap: 5px;
  font-weight: 600;
  font-size: 0.78rem;
  color: #ffffff;
  letter-spacing: 0.2px;
}

.tag-3d-label-title .tag-icon {
  font-size: 0.75rem;
  line-height: 1;
}

.tag-3d-label-title .tag-text {
  font-family: var(--font-mono);
  font-weight: 700;
  color: #a7f3d0;
}

.tag-3d-label-sub {
  font-size: 0.66rem;
  color: #94a3b8;
  font-family: var(--font-sans);
  font-weight: 500;
  padding-left: 17px;
}

.tag-3d-cluster {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  height: 28px;
  padding: 0 8px;
  background: linear-gradient(135deg, #3b82f6, #1d4ed8);
  border: 2px solid rgba(255, 255, 255, 0.85);
  border-radius: 999px;
  color: #ffffff;
  font-family: var(--font-mono);
  font-size: 0.72rem;
  font-weight: 800;
  box-shadow: 0 4px 14px rgba(29, 78, 216, 0.5), 0 2px 6px rgba(0, 0, 0, 0.4);
  pointer-events: auto !important;
  cursor: pointer;
  user-select: none;
  transform: translate(-50%, -50%);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

.tag-3d-cluster:hover {
  transform: translate(-50%, -50%) scale(1.15);
  box-shadow: 0 6px 20px rgba(59, 130, 246, 0.7);
}
```

---

### Step 3: Add Toggles in `index.html`

1. **In the Controls tab** (`#controls-group`), add:
```html
<div class="toggle-option">
  <label for="toggle-floating-labels-sidebar">
    <input type="checkbox" id="toggle-floating-labels-sidebar" />
    <span class="custom-checkbox"></span>
    🏷️ 3D Floating Tags
  </label>
</div>
```

2. **In the Tray Systems panel** (`#excel-panel`), below the `.tagged-highlight-toolbar`, add:
```html
<div class="tagged-highlight-toolbar" style="margin-top: 6px;">
  <div class="tagged-highlight-main">
    <label class="tagged-highlight-label" for="toggle-floating-labels">
      <input type="checkbox" id="toggle-floating-labels" />
      <span class="custom-checkbox"></span>
      <span class="tagged-highlight-title">🏷️ Show 3D Floating Tags</span>
    </label>
  </div>
</div>
```

---

### Step 4: Wire in `src/main.js`

1. **Import:**
```javascript
import { TagLabelManager } from './tag-label-manager.js';
```

2. **State & DOM variables:**
```javascript
const toggleFloatingLabels = document.getElementById('toggle-floating-labels');
const toggleFloatingLabelsSidebar = document.getElementById('toggle-floating-labels-sidebar');
let isFloatingLabelsActive = localStorage.getItem('bim-floating-labels-active') === 'true';
let tagLabelManager = null;
```

3. **In `initApp()`:**
Change:
```javascript
// BEFORE:
world.renderer = new OBC.SimpleRenderer(components, container);

// AFTER:
world.renderer = new OBF.RendererWith2D(components, container);
```

Initialize manager (after highlighter setup):
```javascript
tagLabelManager = new TagLabelManager(components, world, {
  clusterThreshold: 45,
  yOffset: 0.25,
  getHighlightColor: () => taggedHighlightColor,
  onClick: async (modelId, localId, elem) => {
    const modelEntry = loadedModels.find(
      (m) => m.model?.modelId === modelId || m.model?.uuid === modelId || m.uuid === modelId
    );
    if (!modelEntry || !modelEntry.model) return;
    const expressIdNum = Number(localId);

    try {
      await zoomToElementInModel(modelEntry.model, expressIdNum);
    } catch (err) {
      console.warn('[Floating Label Click] zoom failed:', err);
    }

    try {
      highlighter.isProgrammaticSelect = true;
      await highlighter.highlightByID('select', { [modelId]: new Set([expressIdNum]) });
    } catch (err) {
      console.warn('[Floating Label Click] highlight failed:', err);
    } finally {
      highlighter.isProgrammaticSelect = false;
    }

    await displayElementProperties(modelEntry.model, expressIdNum, modelEntry.name);
    selectedIfcElement = await readElementIdentity(modelEntry.model, expressIdNum, modelEntry.name);
    updateTagAssignmentUi();
    refreshLoadedModelsList();
  },
});
```

4. **Toggle Handlers & Refresh Function:**
```javascript
function refreshFloatingLabels() {
  if (!tagLabelManager) return;
  const taggedElements = typeof getEffectiveTaggedElements === 'function' ? getEffectiveTaggedElements() : [];
  tagLabelManager.refreshLabels(taggedElements, loadedModels);
}

function setFloatingLabelsActive(active) {
  isFloatingLabelsActive = Boolean(active);
  localStorage.setItem('bim-floating-labels-active', isFloatingLabelsActive);
  if (toggleFloatingLabels) toggleFloatingLabels.checked = isFloatingLabelsActive;
  if (toggleFloatingLabelsSidebar) toggleFloatingLabelsSidebar.checked = isFloatingLabelsActive;
  if (tagLabelManager) {
    tagLabelManager.setVisible(isFloatingLabelsActive, loadedModels);
    if (isFloatingLabelsActive) {
      refreshFloatingLabels();
    }
  }
}

if (toggleFloatingLabels) {
  toggleFloatingLabels.checked = isFloatingLabelsActive;
  toggleFloatingLabels.addEventListener('change', (e) => setFloatingLabelsActive(e.target.checked));
}
if (toggleFloatingLabelsSidebar) {
  toggleFloatingLabelsSidebar.checked = isFloatingLabelsActive;
  toggleFloatingLabelsSidebar.addEventListener('change', (e) => setFloatingLabelsActive(e.target.checked));
}
```

5. **Hook `refreshFloatingLabels()` into:**
- `refreshTaggedTrayHighlights()` (when tagged elements change)
- `renderTraySystemManager()` (when tag list updates)
- At end of `initApp()`: `setFloatingLabelsActive(isFloatingLabelsActive);`

---

## 4. Verification

Run:
```bash
npm test
npm run build
npm run dev
```

Check:
1. Open viewer, toggle **"🏷️ Show 3D Floating Tags"**.
2. Assign tags to elements → Badges appear floating in 3D above elements.
3. Orbit/pan/zoom → Badges stay anchored smoothly.
4. Zoom out → Nearby badges cluster with count.
5. Click a badge → Camera focuses and element properties display.

