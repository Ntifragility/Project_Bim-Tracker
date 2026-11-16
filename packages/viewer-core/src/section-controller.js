// Revizto-style Section Cut controller for viewer-core.
//
// Supports BOTH Section Plane (suction-cap / double-click / multi-plane / flip)
// and Section Box (interactive green 6-face cropping volume with face grips).
// Wraps unmodified OBC.Clipper & OBC.BoundingBoxer from @thatopen/components.

import * as THREE from "three";
import * as OBC from "@thatopen/components";

const MIN_BOX_EXTENT = 0.08;

/**
 * Pure helper: builds the 6 inward-facing clipping plane definitions for a THREE.Box3.
 * Three.js discards points where `plane.distanceToPoint(p) < 0`.
 * With inward normals, all points strictly inside `box` satisfy `distanceToPoint >= 0`.
 */
export function computeBoxPlaneSpecs(box) {
  const min = box.min;
  const max = box.max;
  return [
    { key: "minX", axis: "x", bound: "min", normal: new THREE.Vector3(1, 0, 0), point: new THREE.Vector3(min.x, (min.y + max.y) * 0.5, (min.z + max.z) * 0.5) },
    { key: "maxX", axis: "x", bound: "max", normal: new THREE.Vector3(-1, 0, 0), point: new THREE.Vector3(max.x, (min.y + max.y) * 0.5, (min.z + max.z) * 0.5) },
    { key: "minY", axis: "y", bound: "min", normal: new THREE.Vector3(0, 1, 0), point: new THREE.Vector3((min.x + max.x) * 0.5, min.y, (min.z + max.z) * 0.5) },
    { key: "maxY", axis: "y", bound: "max", normal: new THREE.Vector3(0, -1, 0), point: new THREE.Vector3((min.x + max.x) * 0.5, max.y, (min.z + max.z) * 0.5) },
    { key: "minZ", axis: "z", bound: "min", normal: new THREE.Vector3(0, 0, 1), point: new THREE.Vector3((min.x + max.x) * 0.5, (min.y + max.y) * 0.5, min.z) },
    { key: "maxZ", axis: "z", bound: "max", normal: new THREE.Vector3(0, 0, -1), point: new THREE.Vector3((min.x + max.x) * 0.5, (min.y + max.y) * 0.5, max.z) },
  ];
}

/**
 * Pure helper: returns true if `point` lies on the clipped-away side of any plane.
 */
export function isPointClippedByPlanes(point, planes = [], eps = 1e-4) {
  if (!point || !planes || planes.length === 0) return false;
  for (const plane of planes) {
    if (plane && typeof plane.distanceToPoint === "function") {
      if (plane.distanceToPoint(point) < -eps) return true;
    }
  }
  return false;
}

const PRESET_NORMALS = {
  top: new THREE.Vector3(0, -1, 0),
  bottom: new THREE.Vector3(0, 1, 0),
  front: new THREE.Vector3(0, 0, -1),
  back: new THREE.Vector3(0, 0, 1),
  left: new THREE.Vector3(1, 0, 0),
  right: new THREE.Vector3(-1, 0, 0),
};

export function createSectionController({
  components,
  world,
  rawClipper,
  fragments,
  highlighter = null,
  pick = null,
} = {}) {
  const scene = world?.scene?.three || null;
  const camera = world?.camera?.three || null;
  const controls = world?.camera?.controls || null;

  if (world?.renderer?.three) {
    world.renderer.three.localClippingEnabled = true;
  }
  if (rawClipper && "localClippingPlanes" in rawClipper) {
    // Keeps UI gizmos (Section Box wireframe & Ruler lines) unclipped while clipping IFC/overlays.
    rawClipper.localClippingPlanes = true;
  }

  let open = false; // UI panel / Section tool open
  let mode = "plane"; // 'plane' | 'box' (Revizto defaults to Plane pill)
  let gizmoVisible = true;
  let lastPlaneId = null;
  let surfacePickPending = false;

  const boxPlaneIds = new Map(); // spec.key -> planeId
  const customPlaneIds = []; // ordered list of Plane-mode planeIds
  const activeBox = new THREE.Box3(new THREE.Vector3(-5, -1, -5), new THREE.Vector3(5, 5, 5));
  const externalClippedObjects = new Set();
  const externalBoundsProviders = new Map();
  const stateListeners = new Set();
  const dragListeners = new Set();

  // ---- Interactive Green Section Box 3D Gizmo ----
  const boxGroup = new THREE.Group();
  boxGroup.name = "ReviztoSectionBoxGizmo";
  boxGroup.visible = false;
  boxGroup.renderOrder = 60;

  const wireGeo = new THREE.BufferGeometry();
  const wirePositions = new Float32Array(24 * 3); // 12 edges * 2 vertices
  wireGeo.setAttribute("position", new THREE.BufferAttribute(wirePositions, 3));
  const wireMat = new THREE.LineBasicMaterial({
    color: 0x22c55e,
    depthTest: true,
    transparent: true,
    opacity: 0.95,
  });
  const wireLines = new THREE.LineSegments(wireGeo, wireMat);
  wireLines.frustumCulled = false;
  boxGroup.add(wireLines);

  const handleFaces = ["minX", "maxX", "minY", "maxY", "minZ", "maxZ"];
  const faceHandles = new Map();
  const handleMeshes = [];
  const handleGeo = new THREE.SphereGeometry(1, 16, 12);
  const quadGeo = new THREE.PlaneGeometry(1, 1);

  for (const key of handleFaces) {
    const handleMat = new THREE.MeshBasicMaterial({
      color: 0x22c55e,
      depthTest: false,
      transparent: true,
      opacity: 0.92,
    });
    const handleMesh = new THREE.Mesh(handleGeo, handleMat);
    handleMesh.userData = { sectionFaceKey: key };
    handleMesh.renderOrder = 65;

    const quadMat = new THREE.MeshBasicMaterial({
      color: 0x4ade80,
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const quadMesh = new THREE.Mesh(quadGeo, quadMat);
    quadMesh.renderOrder = 58;

    boxGroup.add(handleMesh);
    boxGroup.add(quadMesh);
    faceHandles.set(key, { handleMesh, handleMat, quadMesh, quadMat });
    handleMeshes.push(handleMesh);
  }

  if (scene) {
    scene.add(boxGroup);
  }

  let hoveredFaceKey = null;
  let draggingState = null; // { faceKey, axis, bound, dragPlane, startAxisVal, startCoord }

  function updateBoxVisuals() {
    const min = activeBox.min;
    const max = activeBox.max;
    const corners = [
      [min.x, min.y, min.z], [max.x, min.y, min.z],
      [max.x, max.y, min.z], [min.x, max.y, min.z],
      [min.x, min.y, max.z], [max.x, min.y, max.z],
      [max.x, max.y, max.z], [min.x, max.y, max.z],
    ];
    const edges = [
      [0, 1], [1, 2], [2, 3], [3, 0],
      [4, 5], [5, 6], [6, 7], [7, 4],
      [0, 4], [1, 5], [2, 6], [3, 7],
    ];
    const pos = wireGeo.attributes.position.array;
    let idx = 0;
    for (const [a, b] of edges) {
      pos[idx++] = corners[a][0]; pos[idx++] = corners[a][1]; pos[idx++] = corners[a][2];
      pos[idx++] = corners[b][0]; pos[idx++] = corners[b][1]; pos[idx++] = corners[b][2];
    }
    wireGeo.attributes.position.needsUpdate = true;
    wireGeo.computeBoundingSphere();

    const cx = (min.x + max.x) * 0.5;
    const cy = (min.y + max.y) * 0.5;
    const cz = (min.z + max.z) * 0.5;
    const sx = Math.max(max.x - min.x, 0.01);
    const sy = Math.max(max.y - min.y, 0.01);
    const sz = Math.max(max.z - min.z, 0.01);

    const faceConfig = {
      minX: { pos: [min.x, cy, cz], rot: [0, -Math.PI / 2, 0], scale: [sz, sy, 1] },
      maxX: { pos: [max.x, cy, cz], rot: [0, Math.PI / 2, 0], scale: [sz, sy, 1] },
      minY: { pos: [cx, min.y, cz], rot: [Math.PI / 2, 0, 0], scale: [sx, sz, 1] },
      maxY: { pos: [cx, max.y, cz], rot: [-Math.PI / 2, 0, 0], scale: [sx, sz, 1] },
      minZ: { pos: [cx, cy, min.z], rot: [0, Math.PI, 0], scale: [sx, sy, 1] },
      maxZ: { pos: [cx, cy, max.z], rot: [0, 0, 0], scale: [sx, sy, 1] },
    };

    const camPos = camera?.position;
    for (const key of handleFaces) {
      const entry = faceHandles.get(key);
      const cfg = faceConfig[key];
      entry.handleMesh.position.set(cfg.pos[0], cfg.pos[1], cfg.pos[2]);
      const dist = camPos ? camPos.distanceTo(entry.handleMesh.position) : 12;
      const radius = Math.max(0.08, Math.min(0.45, dist * 0.016));
      entry.handleMesh.scale.setScalar(
        draggingState?.faceKey === key || hoveredFaceKey === key ? radius * 1.32 : radius,
      );
      const activeKey = draggingState?.faceKey || hoveredFaceKey;
      entry.handleMat.color.setHex(activeKey === key ? 0xfacc15 : 0x22c55e);

      entry.quadMesh.position.set(cfg.pos[0], cfg.pos[1], cfg.pos[2]);
      entry.quadMesh.rotation.set(cfg.rot[0], cfg.rot[1], cfg.rot[2]);
      entry.quadMesh.scale.set(cfg.scale[0], cfg.scale[1], cfg.scale[2]);
      entry.quadMat.opacity = draggingState?.faceKey === key ? 0.16 : hoveredFaceKey === key ? 0.09 : 0.0;
    }
  }

  function getActivePlanes() {
    const planes = [];
    if (rawClipper?.list) {
      for (const [, item] of rawClipper.list) {
        if (item && item.enabled !== false) {
          const pl = item.three || item.plane;
          if (pl) planes.push(pl);
        }
      }
    }
    return planes;
  }

  function syncExternalClippedMaterials() {
    const planes = getActivePlanes();
    const list = planes.length > 0 ? planes : null;
    for (const obj of externalClippedObjects) {
      if (!obj || typeof obj.traverse !== "function") continue;
      obj.traverse((child) => {
        if (!child.isMesh || !child.material) return;
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        for (const mat of mats) {
          mat.clippingPlanes = list;
          mat.clipShadows = Boolean(list);
          mat.needsUpdate = true;
        }
      });
    }
  }

  function hasActiveCut() {
    return boxPlaneIds.size > 0 || customPlaneIds.length > 0 || getActivePlanes().length > 0;
  }

  function getState() {
    const cuts = hasActiveCut();
    return {
      open,
      active: open || cuts,
      mode,
      gizmoVisible,
      handlesVisible: gizmoVisible,
      surfacePickPending,
      hasCuts: cuts,
      planeCount: customPlaneIds.length,
      boxActive: boxPlaneIds.size > 0,
      hintText: surfacePickPending
        ? "Section: click any model surface to cut at that plane (Esc to cancel)"
        : mode === "box" && boxPlaneIds.size > 0
          ? "Section Box: drag any green sphere grip to push/pull a cropping face"
          : "",
      bounds: {
        min: activeBox.min.toArray(),
        max: activeBox.max.toArray(),
      },
    };
  }

  function notify() {
    const st = getState();
    for (const cb of stateListeners) {
      try { cb(st); } catch (err) { console.error("[section] listener error:", err); }
    }
  }

  function notifyDragging(isDragging) {
    for (const cb of dragListeners) {
      try { cb(isDragging); } catch { /* noop */ }
    }
  }

  function hookSimplePlaneControls(simplePlane) {
    if (!simplePlane || simplePlane.__reviztoHooked) return;
    simplePlane.__reviztoHooked = true;
    simplePlane.onDraggingStarted?.add?.(() => {
      if (controls) controls.enabled = false;
      notifyDragging(true);
    });
    simplePlane.onDraggingEnded?.add?.(() => {
      if (controls) controls.enabled = true;
      notifyDragging(false);
      notify();
    });
  }

  async function computeTargetBounds(targetMap = null, pad = 0.35) {
    const merged = new THREE.Box3();
    let found = false;

    const sel = targetMap || highlighter?.selection?.select;
    const hasSel = sel && Object.values(sel).some((ids) => (ids instanceof Set ? ids.size : ids?.length || 0) > 0);

    if (components) {
      try {
        const boxer = components.get(OBC.BoundingBoxer);
        boxer.list.clear();
        if (hasSel) {
          await boxer.addFromModelIdMap(sel);
        } else {
          boxer.addFromModels();
        }
        const b = boxer.get();
        if (b && !b.isEmpty() && Number.isFinite(b.min.x)) {
          merged.union(b);
          found = true;
        }
        boxer.list.clear();
      } catch { /* fallback below */ }
    }

    if (!found && fragments?.groups) {
      for (const [, model] of fragments.groups) {
        const obj = model?.object || model;
        if (obj) {
          const b = new THREE.Box3().setFromObject(obj);
          if (!b.isEmpty()) {
            merged.union(b);
            found = true;
          }
        }
      }
    }

    for (const provider of externalBoundsProviders.values()) {
      try {
        const extBox = provider(hasSel);
        if (extBox && !extBox.isEmpty()) {
          merged.union(extBox);
          found = true;
        }
      } catch { /* noop */ }
    }

    if (!found || merged.isEmpty()) {
      merged.set(new THREE.Vector3(-6, -1, -6), new THREE.Vector3(6, 5, 6));
    } else {
      merged.expandByScalar(pad);
    }
    return merged;
  }

  function applyBoxPlanesToClipper() {
    if (!rawClipper || !world) return;
    rawClipper.enabled = true;
    const specs = computeBoxPlaneSpecs(activeBox);
    for (const spec of specs) {
      const existingId = boxPlaneIds.get(spec.key);
      const existing = existingId ? rawClipper.list.get(existingId) : null;
      if (existing) {
        existing.setFromNormalAndCoplanarPoint(spec.normal, spec.point);
        existing.visible = false;
        existing.enabled = true;
      } else {
        const id = rawClipper.createFromNormalAndCoplanarPoint(world, spec.normal, spec.point);
        boxPlaneIds.set(spec.key, id);
        const created = rawClipper.list.get(id);
        if (created) {
          created.visible = false;
          created.enabled = true;
        }
      }
    }
    boxGroup.visible = gizmoVisible;
    updateBoxVisuals();
    syncExternalClippedMaterials();
  }

  function clearInternal() {
    for (const id of boxPlaneIds.values()) {
      try { rawClipper?.delete?.(world, id); } catch { /* noop */ }
    }
    boxPlaneIds.clear();
    while (customPlaneIds.length > 0) {
      const id = customPlaneIds.pop();
      try { rawClipper?.delete?.(world, id); } catch { /* noop */ }
    }
    lastPlaneId = null;
    if (boxPlaneIds.size === 0 && customPlaneIds.length === 0) {
      try { rawClipper?.deleteAll?.(); } catch { /* noop */ }
    }
    boxGroup.visible = false;
    draggingState = null;
    hoveredFaceKey = null;
    if (rawClipper) rawClipper.enabled = false;
    syncExternalClippedMaterials();
  }

  async function addPlane(normalVec, pointVec) {
    if (!rawClipper || !world) return null;
    rawClipper.enabled = true;
    rawClipper.visible = gizmoVisible;
    const normal = (normalVec ? normalVec.clone() : new THREE.Vector3(0, -1, 0)).normalize();
    let point = pointVec ? pointVec.clone() : null;
    if (!point) {
      const bounds = await computeTargetBounds(null, 0);
      const center = bounds.getCenter(new THREE.Vector3());
      // Default top-to-bottom architectural cut height (~70% elevation)
      point = new THREE.Vector3(
        center.x,
        bounds.min.y + (bounds.max.y - bounds.min.y) * 0.72,
        center.z,
      );
    }
    const id = rawClipper.createFromNormalAndCoplanarPoint(world, normal, point);
    customPlaneIds.push(id);
    lastPlaneId = id;
    const simplePlane = rawClipper.list.get(id);
    if (simplePlane) {
      simplePlane.visible = gizmoVisible;
      hookSimplePlaneControls(simplePlane);
    }
    syncExternalClippedMaterials();
    notify();
    return id;
  }

  async function activateBox(targetMap = null) {
    // Switching cleanly from Plane mode removes standalone planes
    while (customPlaneIds.length > 0) {
      const id = customPlaneIds.pop();
      try { rawClipper?.delete?.(world, id); } catch { /* noop */ }
    }
    mode = "box";
    open = true;
    const bounds = await computeTargetBounds(targetMap, 0.35);
    activeBox.copy(bounds);
    applyBoxPlanesToClipper();
    notify();
  }

  async function activatePlane(targetMap = null) {
    for (const id of boxPlaneIds.values()) {
      try { rawClipper?.delete?.(world, id); } catch { /* noop */ }
    }
    boxPlaneIds.clear();
    boxGroup.visible = false;
    mode = "plane";
    open = true;
    if (customPlaneIds.length === 0) {
      await addPlane(null, null);
    } else {
      syncExternalClippedMaterials();
      notify();
    }
  }

  // Keep green box handles scaled when camera orbits/zooms
  const onControlsUpdate = () => {
    if (boxGroup.visible) updateBoxVisuals();
  };
  try {
    controls?.addEventListener?.("update", onControlsUpdate);
  } catch { /* headless */ }

  // ---- Interactive Box Handle Raycasting & Dragging ----
  const dragRaycaster = new THREE.Raycaster();

  function pickBoxHandle(ndc) {
    if (!boxGroup.visible || !camera || !ndc) return null;
    dragRaycaster.setFromCamera(ndc, camera);
    const hits = dragRaycaster.intersectObjects(handleMeshes, false);
    if (hits.length > 0) {
      return hits[0].object.userData?.sectionFaceKey || null;
    }
    return null;
  }

  function handlePointerMove(ndc) {
    if (!boxGroup.visible || !camera || !ndc) return false;

    if (draggingState) {
      dragRaycaster.setFromCamera(ndc, camera);
      const hitPoint = new THREE.Vector3();
      if (dragRaycaster.ray.intersectPlane(draggingState.dragPlane, hitPoint)) {
        const coordVal = hitPoint[draggingState.axis];
        const delta = coordVal - draggingState.startCoord;
        let nextVal = draggingState.startAxisVal + delta;
        if (draggingState.bound === "min") {
          nextVal = Math.min(nextVal, activeBox.max[draggingState.axis] - MIN_BOX_EXTENT);
          activeBox.min[draggingState.axis] = nextVal;
        } else {
          nextVal = Math.max(nextVal, activeBox.min[draggingState.axis] + MIN_BOX_EXTENT);
          activeBox.max[draggingState.axis] = nextVal;
        }
        applyBoxPlanesToClipper();
        notify();
      }
      return true;
    }

    const nextHover = pickBoxHandle(ndc);
    if (nextHover !== hoveredFaceKey) {
      hoveredFaceKey = nextHover;
      updateBoxVisuals();
    }
    return Boolean(hoveredFaceKey);
  }

  function handlePointerDown(ndc, button = 0) {
    if (button !== 0 || !boxGroup.visible || !camera || !ndc) return false;
    const faceKey = pickBoxHandle(ndc);
    if (!faceKey) return false;

    const entry = faceHandles.get(faceKey);
    const axis = faceKey.slice(-1).toLowerCase(); // x | y | z
    const bound = faceKey.slice(0, 3); // min | max
    const handlePos = entry.handleMesh.position.clone();

    // Build drag plane containing the face movement axis and facing camera
    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    const axisDir = new THREE.Vector3(axis === "x" ? 1 : 0, axis === "y" ? 1 : 0, axis === "z" ? 1 : 0);
    const tangent = new THREE.Vector3().crossVectors(camDir, axisDir);
    let planeNormal = new THREE.Vector3().crossVectors(axisDir, tangent);
    if (planeNormal.lengthSq() < 1e-6) planeNormal.copy(camDir);
    planeNormal.normalize();

    const dragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, handlePos);
    dragRaycaster.setFromCamera(ndc, camera);
    const hitPoint = new THREE.Vector3();
    if (!dragRaycaster.ray.intersectPlane(dragPlane, hitPoint)) return false;

    draggingState = {
      faceKey,
      axis,
      bound,
      dragPlane,
      startAxisVal: activeBox[bound][axis],
      startCoord: hitPoint[axis],
    };
    if (controls) controls.enabled = false;
    notifyDragging(true);
    updateBoxVisuals();
    return true;
  }

  function handlePointerUp() {
    if (!draggingState) return false;
    draggingState = null;
    if (controls) controls.enabled = true;
    notifyDragging(false);
    updateBoxVisuals();
    return true;
  }

  return {
    get active() {
      return open;
    },

    get mode() {
      return mode;
    },

    getState,
    getActivePlanes,

    async setActive(nextActive) {
      const want = Boolean(nextActive);
      if (want) {
        if (!hasActiveCut()) {
          await this.activate(mode);
        } else {
          open = true;
          notify();
        }
      } else {
        open = false;
        surfacePickPending = false;
        notify();
      }
      return getState();
    },

    async toggle() {
      return this.setActive(!open);
    },

    startSurfaceCut() {
      open = true;
      mode = "plane";
      surfacePickPending = true;
      notify();
      return getState();
    },

    async handlePointerClick(ndc) {
      if (!surfacePickPending || !ndc) return null;
      surfacePickPending = false;
      const id = await this.cutAtNdc(ndc);
      notify();
      return id;
    },

    cancelPendingOrClose() {
      if (surfacePickPending) {
        surfacePickPending = false;
        notify();
        return true;
      }
      if (open) {
        open = false;
        notify();
        return true;
      }
      return false;
    },

    isDraggingHandle() {
      return Boolean(draggingState);
    },

    isHoveringHandle() {
      return Boolean(hoveredFaceKey);
    },

    async setMode(nextMode) {
      const m = nextMode === "box" ? "box" : "plane";
      if (mode === m && open && hasActiveCut()) return getState();
      if (m === "box") await activateBox();
      else await activatePlane();
      return getState();
    },

    async activate(preferredMode = null) {
      const m = preferredMode || mode;
      open = true;
      if (m === "box") await activateBox();
      else await activatePlane();
      return getState();
    },

    async toggleCut(preferredMode = null) {
      if (hasActiveCut() || open) {
        this.uncut();
      } else {
        await this.activate(preferredMode || mode);
      }
      return getState();
    },

    async newCut(targetMap = null) {
      open = true;
      if (mode === "box") {
        await activateBox(targetMap);
      } else {
        const bounds = await computeTargetBounds(targetMap, 0);
        const center = bounds.getCenter(new THREE.Vector3());
        const offset = (customPlaneIds.length % 3);
        const normals = [
          new THREE.Vector3(0, -1, 0),
          new THREE.Vector3(-1, 0, 0),
          new THREE.Vector3(0, 0, -1),
        ];
        await addPlane(normals[offset], center);
      }
      return getState();
    },

    async cutPreset(dir = "top") {
      open = true;
      const normal = PRESET_NORMALS[dir] || PRESET_NORMALS.top;
      const bounds = await computeTargetBounds(null, 0);
      const center = bounds.getCenter(new THREE.Vector3());
      if (mode === "box") {
        await activatePlane();
      }
      if (customPlaneIds.length === 0) {
        await addPlane(normal, center);
      } else {
        const plane = rawClipper?.list?.get(lastPlaneId || customPlaneIds[customPlaneIds.length - 1]);
        if (plane) {
          plane.setFromNormalAndCoplanarPoint(normal.clone(), center);
          syncExternalClippedMaterials();
          notify();
        }
      }
      return getState();
    },

    async createPresetCut(dir = "top") {
      return this.cutPreset(dir);
    },

    async setBoxToSelection(targetMap = null) {
      return activateBox(targetMap);
    },

    async setBoxToModel() {
      return activateBox(null);
    },

    setBoxBounds(box) {
      if (!box || box.isEmpty?.()) return getState();
      while (customPlaneIds.length > 0) {
        const id = customPlaneIds.pop();
        try { rawClipper?.delete?.(world, id); } catch { /* noop */ }
      }
      mode = "box";
      open = true;
      activeBox.copy(box).expandByScalar(0.15);
      applyBoxPlanesToClipper();
      notify();
      return getState();
    },

    async cutAtNdc(ndc) {
      if (!pick || (!open && !surfacePickPending) || mode !== "plane") return null;
      const hit = await pick(ndc, { snap: false });
      if (!hit?.point) return null;
      let normal = hit.normal ? hit.normal.clone() : new THREE.Vector3(0, -1, 0);
      if (camera) {
        const toCam = camera.position.clone().sub(hit.point);
        if (normal.dot(toCam) > 0) normal.negate();
      }
      open = true;
      const id = await addPlane(normal, hit.point);
      return id;
    },

    flipActivePlane() {
      if (mode !== "plane" || customPlaneIds.length === 0 || !rawClipper) return false;
      const targetId = lastPlaneId || customPlaneIds[customPlaneIds.length - 1];
      const simplePlane = rawClipper.list.get(targetId);
      if (!simplePlane) return false;
      const inverted = simplePlane.normal.clone().negate();
      simplePlane.setFromNormalAndCoplanarPoint(inverted, simplePlane.origin.clone());
      syncExternalClippedMaterials();
      notify();
      return true;
    },

    setGizmoVisible(visible) {
      gizmoVisible = Boolean(visible);
      boxGroup.visible = mode === "box" && boxPlaneIds.size > 0 && gizmoVisible;
      if (rawClipper) {
        rawClipper.visible = mode === "plane" ? gizmoVisible : false;
        for (const id of customPlaneIds) {
          const item = rawClipper.list.get(id);
          if (item) item.visible = gizmoVisible;
        }
      }
      notify();
    },

    toggleHandlesVisible() {
      this.setGizmoVisible(!gizmoVisible);
      return gizmoVisible;
    },

    clear() {
      surfacePickPending = false;
      clearInternal();
      notify();
      return getState();
    },

    clearAll() {
      return this.clear();
    },

    uncut() {
      open = false;
      surfacePickPending = false;
      clearInternal();
      notify();
      return getState();
    },

    registerClippedObject(keyOrObj, maybeObj = null) {
      const obj3d = maybeObj || keyOrObj;
      if (!obj3d) return;
      externalClippedObjects.add(obj3d);
      syncExternalClippedMaterials();
    },

    unregisterClippedObject(obj3d) {
      externalClippedObjects.delete(obj3d);
    },

    syncExternalClippedMaterials,

    registerBoundsProvider(id, fn) {
      if (id && typeof fn === "function") externalBoundsProviders.set(id, fn);
    },

    registerExternalBounds(id, fn) {
      this.registerBoundsProvider(id, fn);
    },

    handlePointerMove,
    handlePointerDown,
    handlePointerUp,

    onStateChange(cb) {
      stateListeners.add(cb);
      try { cb(getState()); } catch { /* noop */ }
      return () => stateListeners.delete(cb);
    },

    onChange(cb) {
      return this.onStateChange(cb);
    },

    onDragStateChange(cb) {
      dragListeners.add(cb);
      return () => dragListeners.delete(cb);
    },

    dispose() {
      try { controls?.removeEventListener?.("update", onControlsUpdate); } catch { /* noop */ }
      clearInternal();
      boxGroup.removeFromParent();
      wireGeo.dispose();
      wireMat.dispose();
      handleGeo.dispose();
      quadGeo.dispose();
      for (const e of faceHandles.values()) {
        e.handleMat.dispose();
        e.quadMat.dispose();
      }
      stateListeners.clear();
      dragListeners.clear();
    },
  };
}
