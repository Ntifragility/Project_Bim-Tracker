import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";

import {
  createVisibilityController,
  createSectionController,
  createRulerController,
  computeBoxPlaneSpecs,
  isPointClippedByPlanes,
  computeIfcDelta,
  computeAngleDegrees,
  formatMeasurementLength,
  computeMinDistance,
  collectWorldTrianglesFromObject,
} from "../src/index.js";
import { computeToolbarPresentationState } from "ribbon-chrome";

function createFakeVisibilityRig() {
  const hiddenSet = new Set(); // tracked via hider mock: `${modelId}:${id}`
  const ghostMap = new Map();
  const styles = new Map();
  let lastHiderCall = null;

  const modelKeys = {
    m1: [1, 2, 3, 4],
  };

  const fragments = {
    list: new Map([
      ["m1", { getItemsIdsWithGeometry: async () => [...modelKeys.m1] }],
    ]),
    groups: new Map(),
  };

  const hider = {
    async set(visible, modelIdMap) {
      lastHiderCall = { visible, modelIdMap };
      if (!modelIdMap) {
        if (visible) hiddenSet.clear();
        else {
          for (const id of modelKeys.m1) hiddenSet.add(`m1:${id}`);
        }
        return;
      }
      for (const [mId, ids] of Object.entries(modelIdMap)) {
        for (const id of ids) {
          if (visible) hiddenSet.delete(`${mId}:${id}`);
          else hiddenSet.add(`${mId}:${id}`);
        }
      }
    },
    async isolate(modelIdMap) {
      lastHiderCall = { isolate: true, modelIdMap };
      hiddenSet.clear();
      const kept = new Set(modelIdMap.m1 || []);
      for (const id of modelKeys.m1) {
        if (!kept.has(id)) hiddenSet.add(`m1:${id}`);
      }
    },
  };

  const highlighter = {
    styles,
    selection: { select: {}, "ghost-isolation": ghostMap },
    events: { select: { onHighlight: { add: () => {} }, onClear: { add: () => {} } } },
    async clear(style) {
      if (style === "select") this.selection.select = {};
      if (style === "ghost-isolation") ghostMap.clear();
    },
    async highlightByID(style, map) {
      if (style === "ghost-isolation") {
        ghostMap.clear();
        for (const [mId, ids] of Object.entries(map)) {
          ghostMap.set(mId, new Set(ids));
        }
      }
    },
  };

  const history = [];
  const ctrl = createVisibilityController({
    hider,
    highlighter,
    fragments,
    appearanceHistory: { push: (label) => history.push(label) },
  });

  return { ctrl, hiddenSet, ghostMap, highlighter, history, getLastHider: () => lastHiderCall };
}

describe("Revizto Visibility & Isolation Composer", () => {
  it("supports Hide -> Unhide and Unhides count + toggle morph cleanly", async () => {
    const rig = createFakeVisibilityRig();
    assert.equal(rig.ctrl.visibility.getHiddenCount(), 0);

    const hiddenCount = await rig.ctrl.visibility.hideSelection({ m1: new Set([1, 2]) });
    assert.equal(hiddenCount, 2);
    assert.equal(rig.ctrl.visibility.getHiddenCount(), 2);
    assert.ok(rig.hiddenSet.has("m1:1"));
    assert.ok(rig.hiddenSet.has("m1:2"));
    assert.ok(!rig.hiddenSet.has("m1:3"));

    // Toggle without selection when hidden > 0 unhides all (Revizto morph behavior)
    const outcome = await rig.ctrl.visibility.toggleHideOrUnhide();
    assert.equal(outcome, "unhidden");
    assert.equal(rig.ctrl.visibility.getHiddenCount(), 0);
    assert.equal(rig.hiddenSet.size, 0);
  });

  it("composes Hidden Elements with Hard Isolate & Ghost Isolate without un-hiding hidden elements", async () => {
    const rig = createFakeVisibilityRig();

    // Hide element #4 first
    await rig.ctrl.visibility.hideSelection({ m1: new Set([4]) });
    assert.ok(rig.hiddenSet.has("m1:4"));

    // Hard Isolate elements [1, 2] -> only 1, 2 should be visible; 3 & 4 remain hidden
    await rig.ctrl.isolation.hardIsolate({ m1: new Set([1, 2]) });
    assert.equal(rig.ctrl.isolation.mode, "hard");
    assert.equal(rig.ctrl.isolation.isIsolated(), true);
    assert.ok(!rig.hiddenSet.has("m1:1"));
    assert.ok(!rig.hiddenSet.has("m1:2"));
    assert.ok(rig.hiddenSet.has("m1:3"));
    assert.ok(rig.hiddenSet.has("m1:4"));

    // Reset isolation -> #3 comes back, while explicitly hidden #4 stays hidden!
    await rig.ctrl.isolation.resetIsolation();
    assert.equal(rig.ctrl.isolation.mode, "none");
    assert.ok(!rig.hiddenSet.has("m1:3"));
    assert.ok(rig.hiddenSet.has("m1:4"));

    // Ghost Isolate [1] -> #2 and #3 should be ghosted, #4 remains hidden
    await rig.ctrl.isolation.ghostIsolate({ m1: new Set([1]) });
    assert.equal(rig.ctrl.isolation.mode, "ghost");
    assert.equal(rig.ctrl.isolation.isGhostActive(), true);
    assert.ok(rig.hiddenSet.has("m1:4"));
    const ghostIds = rig.ghostMap.get("m1");
    assert.ok(ghostIds?.has(2));
    assert.ok(ghostIds?.has(3));
    assert.ok(!ghostIds?.has(1));
  });

  it("integrates external adapters (e.g., conduit runs) into Hide & Isolate truth table", async () => {
    const rig = createFakeVisibilityRig();
    let applied = { hiddenIds: [], ghostIds: [] };
    let selectedRuns = new Set(["run-a"]);
    const unregister = rig.ctrl.visibility.registerExternalAdapter("conduits", {
      getAllIds: () => ["run-a", "run-b"],
      getSelectedIds: () => Array.from(selectedRuns),
      clearSelection: () => selectedRuns.clear(),
      applyVisibility: (state) => {
        applied = state;
      },
    });

    assert.equal(rig.ctrl.visibility.hasSelection, true);
    const newly = await rig.ctrl.visibility.hideSelection();
    assert.equal(newly, 1);
    assert.deepEqual(Array.from(applied.hiddenIds), ["run-a"]);

    selectedRuns = new Set(["run-b"]);
    rig.ctrl.visibility.notifySelectionChange();
    await rig.ctrl.isolation.isolate(null, { mode: "ghost" });
    assert.deepEqual(Array.from(applied.hiddenIds), ["run-a"]);
    assert.deepEqual(Array.from(applied.ghostIds), []);

    await rig.ctrl.isolation.resetIsolation();
    await rig.ctrl.visibility.unhideAll();
    assert.deepEqual(Array.from(applied.hiddenIds), []);
    unregister();
  });

  it("round-trips exportSnapshot / importSnapshot for appearanceHistory", async () => {
    const rig = createFakeVisibilityRig();
    await rig.ctrl.visibility.hideSelection({ m1: new Set([2]) });
    await rig.ctrl.isolation.ghostIsolate({ m1: new Set([1]) });
    const snap = rig.ctrl.exportSnapshot();

    await rig.ctrl.isolation.resetIsolation();
    await rig.ctrl.visibility.unhideAll();
    assert.equal(rig.ctrl.visibility.getHiddenCount(), 0);
    assert.equal(rig.ctrl.isolation.mode, "none");

    await rig.ctrl.importSnapshot(snap);
    assert.equal(rig.ctrl.visibility.getHiddenCount(), 1);
    assert.equal(rig.ctrl.isolation.mode, "ghost");
    assert.ok(rig.hiddenSet.has("m1:2"));
  });
});

describe("Revizto Section Box Math", () => {
  it("computes inward-facing 6 box planes and accurately classifies inside vs clipped points", () => {
    const box = new THREE.Box3(new THREE.Vector3(-2, 0, -3), new THREE.Vector3(2, 5, 3));
    const planes = computeBoxPlaneSpecs(box).map((s) =>
      new THREE.Plane().setFromNormalAndCoplanarPoint(s.normal, s.point),
    );
    assert.equal(planes.length, 6);
    assert.equal(isPointClippedByPlanes(new THREE.Vector3(0, 2, 0), planes), false);
    assert.equal(isPointClippedByPlanes(new THREE.Vector3(3, 2, 0), planes), true);
    assert.equal(isPointClippedByPlanes(new THREE.Vector3(0, 6, 0), planes), true);
    assert.equal(isPointClippedByPlanes(new THREE.Vector3(0, 2, -4), planes), true);
  });
});

describe("Revizto Ruler Unit Formatting & Geometry Solvers", () => {
  it("formats meters into m, cm, mm, ft, in, and ft-in fractions", () => {
    assert.equal(formatMeasurementLength(1.25, "m"), "1.250 m");
    assert.equal(formatMeasurementLength(1.25, "cm"), "125.0 cm");
    assert.equal(formatMeasurementLength(1.25, "mm"), "1250 mm");
    assert.equal(formatMeasurementLength(0.3048, "ft"), "1.000 ft");
    assert.equal(formatMeasurementLength(0.0254 * 6, "in"), "6.00 in");
    assert.equal(formatMeasurementLength(0.3048 * 2 + 0.0254 * 3.5, "ft-in"), `2'-3 1/2"`);
    assert.equal(formatMeasurementLength(-0.5, "m"), "-0.500 m");
    assert.equal(formatMeasurementLength(0.5, "m", { showPlus: true }), "+0.500 m");
  });

  it("computes IFC Z-up delta vectors and 3-point angles", () => {
    const mockCoords = {
      toOriginal: (p) => new THREE.Vector3(p.x, -p.z, p.y),
    };
    const delta = computeIfcDelta(mockCoords, new THREE.Vector3(0, 0, 0), new THREE.Vector3(3, 4, 0));
    assert.ok(Math.abs(delta.dx - 3) < 1e-6);
    assert.ok(Math.abs(delta.dy - 0) < 1e-6);
    assert.ok(Math.abs(delta.dz - 4) < 1e-6);
    assert.ok(Math.abs(delta.totalDist - 5) < 1e-6);

    const angle = computeAngleDegrees(
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 1, 0),
    );
    assert.ok(Math.abs(angle - 90) < 1e-6);
  });

  it("computes exact closest distance between separated and clashing meshes", () => {
    const meshA = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    meshA.position.set(0, 0, 0);
    const meshB = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    meshB.position.set(3, 0, 0); // Gap between X=0.5 and X=2.5 is 2.0m

    const trisA = collectWorldTrianglesFromObject(meshA);
    const trisB = collectWorldTrianglesFromObject(meshB);
    const res = computeMinDistance(trisA, trisB);
    assert.ok(res);
    assert.equal(res.clashing, false);
    assert.ok(Math.abs(res.distance - 2.0) < 1e-5);
    assert.ok(Math.abs(res.pointA.x - 0.5) < 1e-5);
    assert.ok(Math.abs(res.pointB.x - 2.5) < 1e-5);

    // Overlapping meshes -> clash = 0.000
    const meshC = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    meshC.position.set(0.4, 0.2, 0);
    const trisC = collectWorldTrianglesFromObject(meshC);
    const clashRes = computeMinDistance(trisA, trisC);
    assert.ok(clashRes);
    assert.equal(clashRes.clashing, true);
    assert.equal(clashRes.distance, 0);
  });
});

describe("Revizto Section & Ruler Mutual Exclusion & 3-Zone UI Architecture", () => {
  it("enforces mutual exclusion between Section and Ruler while keeping scene cuts active", async () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    camera.position.set(10, 10, 10);
    const world = { scene: { three: scene }, camera: { three: camera } };

    let nextPlaneId = 1;
    const planeList = new Map();
    const rawClipper = {
      enabled: false,
      visible: false,
      list: planeList,
      createFromNormalAndCoplanarPoint(_w, normal, point) {
        const id = `pl-${nextPlaneId++}`;
        planeList.set(id, {
          normal: normal.clone(),
          origin: point.clone(),
          three: new THREE.Plane().setFromNormalAndCoplanarPoint(normal, point),
          visible: false,
          enabled: true,
          setFromNormalAndCoplanarPoint(n, p) {
            this.normal.copy(n);
            this.origin.copy(p);
            this.three.setFromNormalAndCoplanarPoint(n, p);
          },
        });
        return id;
      },
      delete(_w, id) {
        planeList.delete(id);
      },
      deleteAll() {
        planeList.clear();
      },
    };

    const section = createSectionController({ world, rawClipper });
    const ruler = createRulerController({ world, section });
    section.setOnToolOpen(() => {
      if (ruler.active) ruler.setActive(false);
    });

    // 1. Open Section -> Plane gizmo becomes visible, cut is active
    await section.setActive(true);
    assert.equal(section.getState().open, true);
    assert.equal(section.getState().hasCuts, true);
    const planeGizmo = scene.getObjectByName("ReviztoSectionPlaneGizmo");
    assert.ok(planeGizmo);
    assert.equal(planeGizmo.visible, true);

    // 2. Open Ruler -> automatically closes Section tool & hides Section 3D gizmo, while keeping cut active!
    ruler.setActive(true);
    assert.equal(ruler.active, true);
    assert.equal(section.getState().open, false);
    assert.equal(section.getState().hasCuts, true);
    assert.equal(planeGizmo.visible, false);

    // 3. Re-open Section (in Box mode) -> automatically closes Ruler and shows Box gizmo
    await section.setMode("box");
    assert.equal(ruler.active, false);
    assert.equal(section.getState().open, true);
    const boxGizmo = scene.getObjectByName("ReviztoSectionBoxGizmo");
    assert.ok(boxGizmo);
    assert.equal(boxGizmo.visible, true);

    section.dispose();
    ruler.dispose();
  });

  it("places Unhide and Unisolate in the bottom bar while keeping top bar fixed as Hide | Isolate | Section | Ruler", () => {
    const idle = computeToolbarPresentationState({
      hiddenCount: 0,
      hasSelection: false,
      isolateMode: "none",
    });
    assert.equal(idle.hideBtn.label, "Hide");
    assert.equal(idle.isolateBtn.label, "Isolate");
    assert.equal(idle.bottomBar.visible, false);

    const hiddenAndIsolated = computeToolbarPresentationState({
      hiddenCount: 4,
      hasSelection: false,
      isolateMode: "ghost",
      openDrawer: "section",
      sectionState: { open: true, hasCuts: true, mode: "box", boxActive: true },
    });
    // Top bar buttons never morph into Unhide/Unisolate
    assert.equal(hiddenAndIsolated.hideBtn.label, "Hide");
    assert.equal(hiddenAndIsolated.isolateBtn.label, "Isolate");
    // Bottom bar surfaces Unhide (4), Unisolate, and Show All
    assert.equal(hiddenAndIsolated.bottomBar.visible, true);
    assert.equal(hiddenAndIsolated.bottomBar.unhideVisible, true);
    assert.equal(hiddenAndIsolated.bottomBar.unhideLabel, "Unhide (4)");
    assert.equal(hiddenAndIsolated.bottomBar.unisolateVisible, true);
    assert.equal(hiddenAndIsolated.bottomBar.showAllVisible, true);
  });
});
