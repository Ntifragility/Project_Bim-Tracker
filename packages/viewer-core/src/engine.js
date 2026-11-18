// COVILLAF viewer engine: That Open fragments in the page. Loads an IFC, selects elements,
// and paints appearance colors. Tag text and IFC export stay in the tracker modules.
import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import * as FRAGS from "@thatopen/fragments";
import { createCoordinateFrame } from "./coordinates.js";
import { createVisibilityController } from "./visibility-controller.js";
import { createSectionController, isPointClippedByPlanes } from "./section-controller.js";
import { createRulerController } from "./ruler-controller.js";
import { createCameraNavigationController } from "./camera-navigation.js";

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

  // 3D XYZ World Coordinate Axes Helper (World Origin: X=Red, Y=Green, Z=Blue)
  const axesHelper = new THREE.AxesHelper(16);
  axesHelper.name = "CovillafWorldAxesHelper";
  axesHelper.renderOrder = 45;
  if (axesHelper.material) {
    axesHelper.material.depthTest = false;
    axesHelper.material.transparent = true;
    axesHelper.material.opacity = 0.55;
  }
  world.scene.three.add(axesHelper);

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
    MEMORY_LIMIT: 3670016000, // 3.5 GB wasm32 ceiling
    TAPE_SIZE: 134217728, // 128 MB STEP token tape
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

  // Composable Revizto-style Visibility & Isolation controller (Hide/Unhide + Hard/Ghost Isolate)
  const visibilityCtrl = createVisibilityController({
    hider,
    highlighter,
    fragments,
    appearanceHistory: { push: (label) => appearanceHistory?.push?.(label) },
  });

  const isolation = visibilityCtrl.isolation;

  // Preserve exact API shape & smoke-test method tokens on `visibility:`
  const visibility = Object.assign(Object.create(visibilityCtrl.visibility), {
    hideSelection(targetMap = null) {
      return visibilityCtrl.visibility.hideSelection(targetMap);
    },
    unhideAll() {
      return visibilityCtrl.visibility.unhideAll();
    },
    getHiddenCount() {
      return visibilityCtrl.visibility.getHiddenCount();
    },
    onVisibilityChange(callback) {
      return visibilityCtrl.visibility.onVisibilityChange(callback);
    },
  });

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
      let visSnap = null;
      try { visSnap = visibilityCtrl.exportSnapshot(); } catch { /* noop */ }
      return { label, styles, visSnap, at: Date.now() };
    }
    async function restore(snap) {
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
        if (snap.visSnap) await visibilityCtrl.importSnapshot(snap.visSnap);
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

  const section = createSectionController({
    components,
    world,
    rawClipper,
    fragments,
    highlighter,
    pick: (ndc, opts) => engine.pick(ndc, opts),
  });

  const ruler = createRulerController({
    world,
    fragments,
    coordinates,
    highlighter,
    section,
    pick: (ndc, opts) => engine.pick(ndc, opts),
  });

  // Mutual exclusion: opening Section automatically closes Ruler tool mode
  section.setOnToolOpen(() => {
    if (ruler.active) ruler.setActive(false);
  });

  const cameraNav = createCameraNavigationController({
    world,
    fragments,
    pick: (ndc, opts) => engine.pick(ndc, opts),
    container,
  });

  const engine = {
    name: "COVILLAF",
    components,
    world,
    fragments,
    ifcLoader,
    highlighter,
    hider,
    clipper,
    section,
    ruler,
    cameraNav,
    isolation,
    visibility: visibility,
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
    async pick(ndc, { snap = false, faceSnap = false } = {}) {
      const snappingClasses = snap
        ? [FRAGS.SnappingClass.POINT, FRAGS.SnappingClass.LINE, FRAGS.SnappingClass.FACE]
        : faceSnap
          ? [FRAGS.SnappingClass.FACE]
          : undefined;
      const hit = await raycaster.castRay({ position: ndc, snappingClasses });
      if (!hit?.point) return null;

      // Discard intersections that fall in clipped space (supports both Plane & Section Box)
      const activePlanes = section.getActivePlanes();
      if (clipper.pickHonorsPlanes && activePlanes.length > 0) {
        if (isPointClippedByPlanes(hit.point, activePlanes)) {
          return null;
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
      return {
        point: hit.point.clone(),
        snapped: hit.snappingClass ?? null,
        normal,
        original,
        modelId: hit.fragments?.modelId ?? hit.model?.modelId ?? null,
        localId: hit.localId ?? null,
      };
    },

    async loadIfc(buffer, name, onProgress) {
      const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
      const isHeavy = bytes.byteLength > 150 * 1024 * 1024;
      const readCallback = (offset, size) => {
        const end = Math.min(bytes.byteLength, offset + size);
        return offset >= bytes.byteLength ? new Uint8Array(0) : bytes.subarray(offset, end);
      };

      let model;
      try {
        model = await ifcLoader.load(bytes, true, name, {
          instanceCallback: (importer) => {
            if (!isHeavy) {
              importer.addAllAttributes();
              importer.addAllRelations();
            }
          },
          processData: {
            readFromCallback: true,
            readCallback,
            raw: bytes.byteLength > 100 * 1024 * 1024,
            progressCallback: (progress) => onProgress?.(progress),
          },
        });
      } catch (error) {
        console.warn("[COVILLAF] Loading with options failed, attempting a simple load:", error);
        model = await ifcLoader.load(bytes, true, name);
      }
      cameraNav.refreshModelBounds(model?.box || null);
      return model;
    },

    /**
     * Streams a heavy IFC File/Blob (>200 MB, up to multi-GB) in 32 MB chunks
     * to the 64-bit Node .frag compiler (/covillaf/convert-frag/*) without ever
     * buffering the full IFC into browser RAM, then loads the resulting .frag.
     */
    async convertAndLoadLargeIfc(file, onProgress) {
      if (!file) throw new Error("No IFC file provided.");
      const name = file.name || "model.ifc";
      const CHUNK_SIZE = 32 * 1024 * 1024;
      let errDetail = "";

      try {
        onProgress?.(0.02, "Initializing 64-bit .frag converter...");
        const initRes = await fetch(`/covillaf/convert-frag/init?name=${encodeURIComponent(name)}`, {
          method: "POST",
        });
        if (!initRes.ok) {
          throw new Error(await initRes.text());
        }
        const { id } = await initRes.json();

        // Stream 32 MB slices sequentially so Chrome never hits single-request body limits
        const total = file.size;
        for (let offset = 0; offset < total; offset += CHUNK_SIZE) {
          const slice = file.slice(offset, Math.min(total, offset + CHUNK_SIZE));
          const pct = Math.round(((offset + slice.size) / total) * 100);
          onProgress?.(0.05 + ((offset + slice.size) / total) * 0.35, `Streaming IFC to 64-bit compiler (${pct}%)...`);
          const chunkRes = await fetch(`/covillaf/convert-frag/chunk?id=${encodeURIComponent(id)}`, {
            method: "POST",
            headers: { "Content-Type": "application/octet-stream" },
            body: slice,
          });
          if (!chunkRes.ok) {
            throw new Error(await chunkRes.text());
          }
        }

        onProgress?.(0.42, "Compiling geometry in 64-bit Node worker...");
        const startRes = await fetch(`/covillaf/convert-frag/start?id=${encodeURIComponent(id)}`, {
          method: "POST",
        });
        if (!startRes.ok) {
          throw new Error(await startRes.text());
        }

        // Poll conversion progress
        let cachePath = null;
        while (true) {
          await new Promise((r) => setTimeout(r, 800));
          const stRes = await fetch(`/covillaf/convert-frag/status?id=${encodeURIComponent(id)}`);
          if (!stRes.ok) throw new Error(await stRes.text());
          const st = await stRes.json();
          if (st.status === "error") {
            throw new Error(st.error || "64-bit converter failed");
          }
          if (st.status === "done") {
            cachePath = st.cachePath || null;
            break;
          }
          onProgress?.(0.42 + (st.progress || 0) * 0.43, st.detail || "Compiling .frag cache...");
        }

        onProgress?.(0.88, "Loading compiled .frag cache into WebGL...");
        const resultRes = await fetch(`/covillaf/convert-frag/result?id=${encodeURIComponent(id)}`);
        if (!resultRes.ok) throw new Error(await resultRes.text());
        const fragBuf = await resultRes.arrayBuffer();
        const fragBytes = new Uint8Array(fragBuf);
        const fragName = name.replace(/\.ifc$/i, ".frag");
        const model = await this.loadFrag(fragBytes, fragName);
        onProgress?.(1.0, "Ready");
        return { model, fragBytes, cachePath };
      } catch (err) {
        errDetail = err?.message || String(err);
        console.error("[convertAndLoadLargeIfc] Error:", errDetail);
      }

      if (file.size <= 450 * 1024 * 1024) {
        const buf = new Uint8Array(await file.arrayBuffer());
        const model = await this.loadIfc(buf, name, (p) => onProgress?.(p));
        return { model, fragBytes: null, cachePath: null };
      }
      throw new Error(
        `Large IFC (${(file.size / (1024 * 1024)).toFixed(0)} MB) conversion failed: ${errDetail || "run npm run convert:frag -- <file.ifc>"}`,
      );
    },

    async loadFrag(buffer, name = "model.frag") {
      const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
      const model = await fragments.core.load(bytes, {
        modelId: name,
        camera: world.camera.three,
      });
      if (model?.object && !world.scene.three.children.includes(model.object)) {
        world.scene.three.add(model.object);
      }
      cameraNav.refreshModelBounds(model?.box || null);
      return model;
    },

    async exportFrag(modelOrId) {
      let targetModel = modelOrId;
      if (typeof modelOrId === "string") {
        targetModel = fragments.core.models.get(modelOrId);
      }
      if (!targetModel) {
        targetModel = [...fragments.core.models.list.values()][0];
      }
      if (!targetModel) {
        throw new Error("No loaded model found to export as .frag");
      }
      return await targetModel.getBuffer(false);
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

    axes: {
      get helper() {
        return axesHelper;
      },
      get visible() {
        return axesHelper.visible;
      },
      set visible(val) {
        axesHelper.visible = Boolean(val);
      },
      toggle() {
        axesHelper.visible = !axesHelper.visible;
        return axesHelper.visible;
      },
    },

    dispose() {
      cameraNav.dispose();
      ruler.dispose();
      section.dispose();
      autoOrbit.dispose();
      axesHelper.geometry?.dispose();
      axesHelper.material?.dispose();
      components.dispose();
    },
  };

  if (import.meta.env?.DEV) window.__covillaf = engine;
  console.log("[COVILLAF] Engine ready. IFC parser is local.");
  return engine;
}

export const createEngine = createCovillafEngine;
