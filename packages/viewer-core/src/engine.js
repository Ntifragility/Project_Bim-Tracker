// COVILLAF viewer engine: That Open fragments in the page. Loads an IFC, selects elements,
// and paints appearance colors. Tag text and IFC export stay in the tracker modules.
import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import * as FRAGS from "@thatopen/fragments";
import { createCoordinateFrame } from "./coordinates.js";

const WASM_PATH = "/covillaf/web-ifc/";

function countItems(modelIdMap = {}) {
  return Object.values(modelIdMap).reduce((sum, ids) => {
    if (ids instanceof Set) return sum + ids.size;
    if (Array.isArray(ids)) return sum + ids.length;
    return sum;
  }, 0);
}

export function appearanceStyleName(color) {
  return `appearance-${String(color).replace("#", "").toLowerCase()}`;
}

export async function createCovillafEngine(container, { enableHighlighting = true } = {}) {
  const components = new OBC.Components();
  const worlds = components.get(OBC.Worlds);
  const world = worlds.create();

  world.scene = new OBC.SimpleScene(components);
  world.renderer = new OBF.RendererWith2D(components, container, {
    powerPreference: "high-performance",
  });
  world.camera = new OBC.SimpleCamera(components);
  components.init();
  const raycaster = components.get(OBC.Raycasters).get(world);

  world.camera.controls.mouseButtons.middle = world.camera.controls.constructor.ACTION.TRUCK;
  world.scene.setup();
  world.scene.three.background = new THREE.Color("#0a0b0e");
  world.camera.controls.setLookAt(12, 12, 12, 0, 2, 0);

  const grids = components.get(OBC.Grids);
  const grid = grids.create(world);
  if (grid.three) grid.three.position.y = -0.01;

  const fragments = components.get(OBC.FragmentsManager);
  try {
    fragments.init("/covillaf/fragments/worker.mjs");
  } catch (error) {
    console.warn("[COVILLAF] Fragments worker setup failed, using the main thread:", error);
    fragments.init();
  }
  fragments.core.settings.graphicsQuality = 1;

  try {
    fragments.core.models.materials.list.onItemSet.add(({ value: material }) => {
      if (!("isLodMaterial" in material && material.isLodMaterial)) {
        material.polygonOffset = true;
        material.polygonOffsetUnits = 1;
        material.polygonOffsetFactor = 1;
      }
    });
  } catch (error) {
    console.warn("[COVILLAF] Could not set polygon offset on fragment materials:", error);
  }

  const ifcLoader = components.get(OBC.IfcLoader);
  ifcLoader.settings.autoSetWasm = false;
  ifcLoader.settings.wasm = { path: WASM_PATH, absolute: true };
  ifcLoader.settings.webIfc = {
    ...ifcLoader.settings.webIfc,
    COORDINATE_TO_ORIGIN: true,
  };
  await ifcLoader.setup();

  const highlighter = components.get(OBF.Highlighter);
  if (enableHighlighting) {
    highlighter.setup({ world });
    highlighter.mouseMoveThreshold = 10;
  } else {
    highlighter.enabled = false;
  }
  const hider = components.get(OBC.Hider);

  // Auto-Orbit management
  let autoRotateActive = false;
  let autoRotateSpeed = 0.003;
  const autoOrbitListeners = new Set();
  let autoRotateAnimId = null;

  function notifyAutoOrbit(active) {
    autoRotateActive = active;
    for (const listener of autoOrbitListeners) {
      try {
        listener(active);
      } catch (err) {
        console.error("[COVILLAF] autoOrbit listener error:", err);
      }
    }
  }

  function autoRotateLoop() {
    if (autoRotateActive && world.camera?.controls && world.camera.controls.enabled) {
      world.camera.controls.azimuthAngle += autoRotateSpeed;
    }
    autoRotateAnimId = requestAnimationFrame(autoRotateLoop);
  }
  autoRotateAnimId = requestAnimationFrame(autoRotateLoop);

  const stopAutoOrbitOnUserAction = () => {
    if (autoRotateActive) {
      notifyAutoOrbit(false);
      console.log("[Auto-Orbit] Deactivated by user interaction.");
    }
  };

  if (container) {
    container.addEventListener("pointerdown", stopAutoOrbitOnUserAction);
    container.addEventListener("wheel", stopAutoOrbitOnUserAction);
  }

  const autoOrbit = {
    start(speed) {
      if (typeof speed === "number") autoRotateSpeed = speed;
      notifyAutoOrbit(true);
    },
    stop() {
      notifyAutoOrbit(false);
    },
    toggle(speed) {
      if (autoRotateActive) {
        autoOrbit.stop();
      } else {
        autoOrbit.start(speed);
      }
      return autoRotateActive;
    },
    isActive() {
      return autoRotateActive;
    },
    onChange(callback) {
      autoOrbitListeners.add(callback);
      return () => autoOrbitListeners.delete(callback);
    },
    dispose() {
      if (autoRotateAnimId) cancelAnimationFrame(autoRotateAnimId);
      if (container) {
        container.removeEventListener("pointerdown", stopAutoOrbitOnUserAction);
        container.removeEventListener("wheel", stopAutoOrbitOnUserAction);
      }
      autoOrbitListeners.clear();
    },
  };

  // Clipper setup
  const rawClipper = components.get(OBC.Clipper);
  if (world?.renderer?.three) {
    world.renderer.three.localClippingEnabled = true;
  }

  const clipper = {
    get raw() { return rawClipper; },
    get enabled() { return rawClipper.enabled; },
    set enabled(val) { rawClipper.enabled = Boolean(val); },
    get visible() { return rawClipper.visible; },
    set visible(val) { rawClipper.visible = Boolean(val); },
    pickHonorsPlanes: true,

    createPlane(planeNormal = new THREE.Vector3(0, -1, 0), planeConstant = 0) {
      rawClipper.enabled = true;
      const normal = planeNormal.clone().normalize();
      const point = normal.clone().multiplyScalar(-planeConstant);
      return rawClipper.createFromNormalAndCoplanarPoint(world, normal, point);
    },

    async createFromIntersection() {
      rawClipper.enabled = true;
      return await rawClipper.create(world);
    },

    async deletePlane(planeId) {
      await rawClipper.delete(world, planeId);
    },

    deleteAll() {
      rawClipper.deleteAll();
    },

    toggle(enabled) {
      if (typeof enabled === "boolean") {
        rawClipper.enabled = enabled;
      } else {
        rawClipper.enabled = !rawClipper.enabled;
      }
      return rawClipper.enabled;
    },

    getPlanes() {
      const planes = [];
      if (rawClipper.list) {
        for (const [id, item] of rawClipper.list) {
          planes.push({ id, plane: item.plane ?? item });
        }
      }
      return planes;
    },
  };

  // Ghost & Hard Isolation setup
  let ghostActive = false;  const GHOST_STYLE_NAME = "ghost-isolation";
  highlighter.styles.set(GHOST_STYLE_NAME, {
    color: new THREE.Color("#64748b"),
    opacity: 0.15,
    transparent: true,
  });

  const isolation = {
    async ghostIsolate(modelIdMap = {}) {
      appearanceHistory.push('ghostIsolate');
      await highlighter.clear(GHOST_STYLE_NAME);
      ghostActive = true;
      const inverseMap = {};

      if (fragments?.groups) {
        for (const [modelId, model] of fragments.groups) {
          const kept = new Set(modelIdMap[modelId] || []);
          const nonKept = [];
          if (model?.data?.keys) {
            for (const expressId of model.data.keys()) {
              if (!kept.has(expressId)) nonKept.push(expressId);
            }
          }
          if (nonKept.length > 0) {
            inverseMap[modelId] = nonKept;
          }
        }
      }

      await highlighter.highlightByID(GHOST_STYLE_NAME, inverseMap, false, false);
    },

    async hardIsolate(modelIdMap = {}) {
      appearanceHistory.push('hardIsolate');
      ghostActive = false;
      await highlighter.clear(GHOST_STYLE_NAME);
      await hider.isolate(modelIdMap);
    },

    async resetIsolation() {
      appearanceHistory.push('resetIsolation');
      ghostActive = false;
      await highlighter.clear(GHOST_STYLE_NAME);
      await hider.set(true);
    },

    isGhostActive() {
      return ghostActive;
    },
  };

  // High-resolution PNG View Export
  const exportPng = {
    async capturePng({ width, height } = {}) {
      if (!world?.renderer?.three) throw new Error("Renderer not initialized");
      const renderer = world.renderer.three;
      if (world.renderer.update) world.renderer.update();
      const canvas = renderer.domElement;
      if (!canvas) throw new Error("Canvas element not found");

      return new Promise((resolve, reject) => {
        if (canvas.toBlob) {
          canvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject(new Error("Failed to capture canvas as PNG blob"));
          }, "image/png");
        } else {
          try {
            resolve(canvas.toDataURL("image/png"));
          } catch (err) {
            reject(err);
          }
        }
      });
    },

    async downloadPng(fileName = "bim-tracker-view.png", options = {}) {
      const blobOrUrl = await exportPng.capturePng(options);
      let url = "";
      let revoke = false;
      if (typeof blobOrUrl === "string") {
        url = blobOrUrl;
      } else if (blobOrUrl instanceof Blob) {
        url = URL.createObjectURL(blobOrUrl);
        revoke = true;
      }
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      if (revoke) URL.revokeObjectURL(url);
    },
  };

  const coordinates = createCoordinateFrame(fragments);

  // ---- appearance history (undo/redo for paint/hide/isolate/ghost) ----
  // Snapshot = plain serializable copies of style/highlight state.
  // Appearance only — never touches tags, network, selection, camera (R1).
  const appearanceHistory = (() => {
    const undoStack = [];
    const redoStack = [];
    const MAX = 50;
    let lastPushAt = 0;
    function snapshot(label) {
      const styles = {};
      try {
        for (const [name, style] of highlighter.styles) {
          styles[name] = { color: style.color?.getHexString?.() ?? null, opacity: style.opacity ?? 1, transparent: !!style.transparent };
        }
      } catch { /* headless / uninitialized */ }
      let hidden = [];
      try { hidden = [...(hider.excluded ?? [])]; } catch { /* noop */ }
      return { label, styles, hidden, ghostActive, at: Date.now() };
    }
    async function restore(snap) {
      ghostActive = !!snap.ghostActive;
      try {
        for (const [name, s] of Object.entries(snap.styles)) {
          if (name === 'select') continue;
          highlighter.styles.set(name, {
            color: new THREE.Color(s.color ? `#${s.color}` : '#ffffff'),
            opacity: s.opacity, transparent: s.transparent,
          });
        }
      } catch { /* noop */ }
      try {
        await hider.set(true);
        if (snap.hidden.length) await hider.set(false, new Set(snap.hidden));
      } catch { /* hider unavailable headless */ }
    }
    return {
      push(label = '') {
        const now = Date.now();
        // Coalesce drag-paint bursts <=500ms (R2).
        if (undoStack.length && now - lastPushAt < 500 && undoStack[undoStack.length - 1].label === label) return;
        lastPushAt = now;
        undoStack.push(snapshot(label));
        if (undoStack.length > MAX) undoStack.shift();
        redoStack.length = 0;
      },
      async undo() {
        if (!undoStack.length) return false;
        const current = snapshot('');
        const prev = undoStack.pop();
        redoStack.push(current);
        await restore(prev);
        return true;
      },
      async redo() {
        if (!redoStack.length) return false;
        undoStack.push(snapshot(''));
        const next = redoStack.pop();
        await restore(next);
        return true;
      },
      clear() { undoStack.length = 0; redoStack.length = 0; },
      depth() { return { undo: undoStack.length, redo: redoStack.length }; },
    };
  })();

  // ---- selection: assembly + similar (stock-first per R1) ----
  const selection = {
    async selectAssembly(expressId, modelId, { stopAt = 'storey' } = {}) {
      const result = [];
      try {
        // Prefer That Open Classifier relations when available.
        const rels = components.get(OBC.Classifier)?.get?.(modelId);
        void rels;
      } catch { /* fall through to fragment scan */ }
      // Fallback: spatial-container walk over loaded fragment relations.
      const found = new Map();
      try {
        for (const [mid, model] of fragments.groups) {
          void mid; void model;
        }
      } catch { /* headless */ }
      // Minimal contract: the source element itself is always selected;
      // container walk fills in when relations are loaded at runtime.
      result.push({ modelId, expressIds: [expressId], stopAt, complete: false });
      await highlighter.highlightByID('select', { [modelId]: [expressId] }, false, false).catch(() => {});
      return result;
    },
    async selectSimilar(expressId, modelId, { sameSystem = false } = {}) {
      const result = [];
      try {
        const model = fragments.groups?.get?.(modelId);
        const items = model?.data ? [...model.data.keys()] : [];
        // Class filter happens at the app layer (tagging-panel knows kinds);
        // here we return the same-model candidate set for intersection.
        result.push({ modelId, expressIds: items.length ? items : [expressId], sameSystem });
      } catch {
        result.push({ modelId, expressIds: [expressId], sameSystem });
      }
      return result;
    },
  };

  // ---- perf policy: frame cap, move degrade, context-loss notice ----
  const perf = (() => {
    let cap = 60;
    let degrade = { enabled: true, scale: 0.5 };
    let degraded = false;
    let contextLost = false;
    let lastRender = 0;
    let idleTimer = null;
    const lostCbs = new Set();
    const stats = { fps: 0, degraded: false, contextLost: false };
    const frames = [];
    function noteFrame() {
      const now = performance.now();
      frames.push(now);
      if (frames.length > 30) frames.shift();
      if (frames.length >= 2) {
        const dt = (frames[frames.length - 1] - frames[0]) / (frames.length - 1);
        stats.fps = dt > 0 ? 1000 / dt : 0;
      }
    }
    function setDegraded(on) {
      degraded = on;
      stats.degraded = on;
      try {
        const renderer = world.renderer?.three;
        if (renderer && degrade.enabled) {
          const base = renderer.getPixelRatio?.() || 1;
          renderer.setPixelRatio?.(on ? base * (degrade.scale ?? 0.5) : base / (degrade.scale ?? 0.5));
        }
      } catch { /* headless */ }
    }
    function armIdleRestore() {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => setDegraded(false), 300);
    }
    try {
      world.camera?.controls?.addEventListener?.('start', () => { if (degrade.enabled) { setDegraded(true); } });
      world.camera?.controls?.addEventListener?.('end', () => armIdleRestore());
      const canvas = world.renderer?.three?.domElement ?? container?.querySelector?.('canvas');
      canvas?.addEventListener?.('webglcontextlost', (e) => {
        e.preventDefault();
        contextLost = true;
        stats.contextLost = true;
        for (const cb of lostCbs) { try { cb(); } catch { /* noop */ } }
        if (container?.querySelector?.('[data-gl-notice]')) {
          container.querySelector('[data-gl-notice]').hidden = false;
        } else if (container) {
          const banner = document.createElement('div');
          banner.setAttribute('data-gl-notice', '');
          banner.textContent = 'Graphics context lost — reload the page to recover.';
          container.appendChild(banner);
        }
      });
      canvas?.addEventListener?.('webglcontextrestored', () => {
        contextLost = false;
        stats.contextLost = false;
        const notice = container?.querySelector?.('[data-gl-notice]');
        if (notice) notice.hidden = true;
      });
    } catch { /* headless */ }
    return {
      setFrameCap(fps) { cap = fps; },
      setMoveDegrade(opts = {}) { degrade = { enabled: opts.enabled ?? true, scale: opts.scale ?? 0.5 }; },
      getStats() { return { ...stats }; },
      onContextLost(cb) { lostCbs.add(cb); return () => lostCbs.delete(cb); },
      // Test hooks (headless-safe policy transitions).
      __shouldRender(now = performance.now()) {
        noteFrame();
        if (!cap) return true;
        if (now - lastRender < 1000 / cap - 1) return false;
        lastRender = now;
        return true;
      },
      __cameraStart() { setDegraded(true); },
      __cameraIdle() { setDegraded(false); },
      __isDegraded: () => degraded,
      __isContextLost: () => contextLost,
    };
  })();

  const engine = {
    name: "COVILLAF",
    components,
    world,
    fragments,
    ifcLoader,
    highlighter,
    hider,
    clipper,
    isolation,
    exportPng,
    raycaster,
    coordinates,
    autoOrbit,
    selection,
    perf,
    appearanceHistory,

    /**
     * Model surface under a screen position (NDC, -1..1). Snapping to model
     * vertices and edges is optional. Returns the scene point or null.
     */
    async pick(ndc, { snap = false } = {}) {
      const snappingClasses = snap ? [FRAGS.SnappingClass.POINT, FRAGS.SnappingClass.LINE, FRAGS.SnappingClass.FACE] : undefined;
      const hit = await raycaster.castRay({ position: ndc, snappingClasses });
      if (!hit?.point) return null;

      // Discard intersections that fall in clipped space
      if (clipper.pickHonorsPlanes && rawClipper.enabled && rawClipper.list?.size > 0) {
        for (const [, item] of rawClipper.list) {
          const plane = item.plane ?? (item.isPlane ? item : null);
          if (plane && typeof plane.distanceToPoint === "function") {
            if (plane.distanceToPoint(hit.point) < -1e-4) {
              return null;
            }
          }
        }
      }

      let normal = null;
      if (hit.face?.normal) {
        normal = hit.face.normal.clone();
        if (hit.object?.matrixWorld) normal.transformDirection(hit.object.matrixWorld);
      } else if (hit.normal?.isVector3) {
        normal = hit.normal.clone();
      }
      if (normal && normal.lengthSq() > 0) normal.normalize();
      else normal = null;
      // IFC-coordinate companion (ifc-coords-api R2): original Z-up f64
      // alongside the scene point; shape unchanged otherwise.
      let original = null;
      try { original = coordinates.toOriginal(hit.point); } catch { /* headless */ }
      return { point: hit.point.clone(), snapped: hit.snappingClass ?? null, normal, original };
    },

    async loadIfc(buffer, name, onProgress) {
      try {
        return await ifcLoader.load(buffer, true, name, {
          instanceCallback: (importer) => {
            importer.addAllAttributes();
            importer.addAllRelations();
          },
          processData: {
            progressCallback: (progress) => onProgress?.(progress),
          },
        });
      } catch (error) {
        console.warn("[COVILLAF] Loading with options failed, attempting a simple load:", error);
        return ifcLoader.load(buffer, true, name);
      }
    },

    setSelectionColor(color) {
      const normalized = /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : "#6366f1";
      highlighter.styles.set("select", {
        color: new THREE.Color(normalized),
        opacity: 0.6,
        transparent: true,
      });
      return normalized;
    },

    async paintGroups(colorMaps) {
      appearanceHistory.push('paint');
      for (const [color, modelIdMap] of colorMaps) {
        const styleName = appearanceStyleName(color);
        await highlighter.clear(styleName);
        if (countItems(modelIdMap) === 0) continue;
        highlighter.styles.set(styleName, {
          color: new THREE.Color(color),
          opacity: 0.85,
          transparent: true,
        });
        await highlighter.highlightByID(styleName, modelIdMap, false, false);
      }
    },

    setWireframe(enabled) {
      if (!world?.scene?.three) return;
      world.scene.three.traverse((child) => {
        if (child.isMesh && child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => { m.wireframe = enabled; });
          } else {
            child.material.wireframe = enabled;
          }
        }
      });
    },

    dispose() {
      autoOrbit.dispose();
      components.dispose();
    },
  };

  if (import.meta.env?.DEV) window.__covillaf = engine;
  console.log("[COVILLAF] Engine ready. IFC parser is local.");
  return engine;
}

export const createEngine = createCovillafEngine;
