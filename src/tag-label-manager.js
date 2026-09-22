import * as THREE from 'three';
import * as OBC from '@thatopen/components';
import * as OBF from '@thatopen/components-front';

/**
 * Palette of colors for distinct Tray Systems
 */
const SYSTEM_PALETTE = [
  '#10b981', // Emerald green
  '#3b82f6', // Bright blue
  '#f59e0b', // Amber / Orange
  '#8b5cf6', // Violet
  '#ec4899', // Pink
  '#06b6d4', // Cyan
  '#14b8a6', // Teal
  '#f97316', // Orange red
  '#a855f7', // Purple
  '#6366f1', // Indigo
];

function getSystemColor(systemTag, fallbackColor = '#10b981') {
  if (!systemTag) return fallbackColor;
  let hash = 0;
  for (let i = 0; i < systemTag.length; i++) {
    hash = (hash << 5) - hash + systemTag.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % SYSTEM_PALETTE.length;
  return SYSTEM_PALETTE[index];
}

/**
 * TagLabelManager
 * Manages 3D floating tag badges over tagged elements using OBF.Marker & CSS2D
 */
export class TagLabelManager {
  /**
   * @param {OBC.Components} components
   * @param {OBC.World} world
   * @param {Object} options
   */
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

    // Customize cluster badge
    this.markers.clusterElementFactory = () => {
      const el = document.createElement('div');
      el.className = 'tag-3d-cluster';
      return el;
    };

    // key: `${modelId}:${localId}` => markerKey (string)
    this.activeMarkers = new Map();
    this.markerSignatures = new Map();
    this.cachedElements = [];
    this.isVisible = false;
  }

  /**
   * Check if floating labels are currently active/visible
   */
  isActive() {
    return this.isVisible;
  }

  /**
   * Set visibility of all floating tag labels
   * @param {boolean} visible
   * @param {Array} [loadedModels]
   */
  async setVisible(visible, loadedModels = []) {
    this.isVisible = Boolean(visible);
    if (!this.isVisible) {
      this.clearAll();
    } else {
      await this.refreshLabels(this.cachedElements, loadedModels);
    }
  }

  /**
   * Re-render / update labels for current tagged elements
   * @param {Array} taggedElements
   * @param {Array} loadedModels
   */
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

      const signature = this.getMarkerSignature(elem);
      if (this.activeMarkers.has(key) && this.markerSignatures.get(key) !== signature) {
        try {
          this.markers.delete(this.activeMarkers.get(key));
        } catch (err) {
          console.warn('[TagLabelManager] Marker replacement failed:', err);
        }
        this.activeMarkers.delete(key);
        this.markerSignatures.delete(key);
      }

      if (!this.activeMarkers.has(key)) {
        elementsToCreate.push({ key, elem });
      }
    }

    // Remove any markers that are no longer tagged
    for (const [key, markerKey] of this.activeMarkers.entries()) {
      if (!neededKeys.has(key)) {
        try {
          this.markers.delete(markerKey);
        } catch (err) {
          console.warn('[TagLabelManager] Marker deletion failed:', err);
        }
        this.activeMarkers.delete(key);
        this.markerSignatures.delete(key);
      }
    }

    if (elementsToCreate.length === 0) return;

    // Create new markers
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
          this.markerSignatures.set(key, this.getMarkerSignature(elem));
        }
      } catch (err) {
        console.warn('[TagLabelManager] Failed to create label for', key, err);
      }
    }
  }

  /**
   * Calculate 3D anchor position directly above the element's bounding box
   * @param {Object} model
   * @param {number} localId
   * @returns {Promise<THREE.Vector3|null>}
   */
  async getElementPosition(model, localId) {
    const numericId = Number(localId);

    // Fast path: model.getBoxes
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
      } catch {
        // Fall back to BoundingBoxer
      }
    }

    // Fallback: OBC.BoundingBoxer
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

  /**
   * Create the HTML DOM badge for the floating label
   * @param {Object} elem
   * @returns {HTMLDivElement}
   */
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

    // Tag Title / Code
    const title = document.createElement('div');
    title.className = 'tag-3d-label-title';
    const icon = document.createElement('span');
    icon.className = 'tag-icon';
    icon.textContent = '🏷️';
    const text = document.createElement('span');
    text.className = 'tag-text';
    text.textContent = elem.elementTag || elem.componentId || `Tag #${elem.localId}`;
    title.append(icon, text);
    container.appendChild(title);

    // Subtitle (systemTag or elementKind)
    const subtitleParts = [];
    if (elem.systemTag && elem.systemTag !== elem.elementTag) {
      subtitleParts.push(elem.systemTag);
    }
    if (elem.elementKind) {
      subtitleParts.push(elem.elementKind);
    }
    if (subtitleParts.length > 0) {
      const sub = document.createElement('div');
      sub.className = 'tag-3d-label-sub';
      sub.textContent = subtitleParts.join(' · ');
      container.appendChild(sub);
    }

    // Interactive pointer handling
    container.addEventListener('pointerdown', (e) => {
      e.stopPropagation(); // Avoid triggering OrbitControls / drag
    });

    container.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof this.options.onClick === 'function') {
        this.options.onClick(elem.modelId, elem.localId, elem);
      }
    });

    return container;
  }

  getMarkerSignature(elem) {
    return [
      elem.elementTag,
      elem.componentId,
      elem.systemTag,
      elem.elementKind,
    ].map((value) => String(value || '')).join('|');
  }

  /**
   * Clear all active markers
   */
  clearAll() {
    for (const markerKey of this.activeMarkers.values()) {
      try {
        this.markers.delete(markerKey);
      } catch (err) {
        console.warn('[TagLabelManager] Error clearing marker:', err);
      }
    }
    this.activeMarkers.clear();
    this.markerSignatures.clear();
  }

  /**
   * Dispose resources
   */
  dispose() {
    this.clearAll();
    this.cachedElements = [];
  }
}
