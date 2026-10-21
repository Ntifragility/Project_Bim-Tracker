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

  const engine = {
    name: "COVILLAF",
    components,
    world,
    fragments,
    ifcLoader,
    highlighter,
    hider,
    raycaster,
    coordinates: createCoordinateFrame(fragments),

    /**
     * Model surface under a screen position (NDC, -1..1). Snapping to model
     * vertices and edges is optional. Returns the scene point or null.
     */
    async pick(ndc, { snap = false } = {}) {
      const snappingClasses = snap ? [FRAGS.SnappingClass.POINT, FRAGS.SnappingClass.LINE, FRAGS.SnappingClass.FACE] : undefined;
      const hit = await raycaster.castRay({ position: ndc, snappingClasses });
      if (!hit?.point) return null;
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
  };

  if (import.meta.env?.DEV) window.__covillaf = engine;
  console.log("[COVILLAF] Engine ready. IFC parser is local.");
  return engine;
}

export const createEngine = createCovillafEngine;
