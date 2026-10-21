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
  let ghostActive = false;
  const GHOST_STYLE_NAME = "ghost-isolation";
  highlighter.styles.set(GHOST_STYLE_NAME, {
    color: new THREE.Color("#64748b"),
    opacity: 0.15,
    transparent: true,
  });

  const isolation = {
    async ghostIsolate(modelIdMap = {}) {
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
      ghostActive = false;
      await highlighter.clear(GHOST_STYLE_NAME);
      await hider.isolate(modelIdMap);
    },

    async resetIsolation() {
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
    coordinates: createCoordinateFrame(fragments),
    autoOrbit,

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
      return { point: hit.point.clone(), snapped: hit.snappingClass ?? null, normal };
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
