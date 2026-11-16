// Revizto 5-style Section Cut controller for viewer-core.
//
// Supports BOTH:
//   - Section Plane: framed translucent cross-section plane quad + central
//     bidirectional push/pull normal arrow + orthogonal tilt handles +
//     suction-cup surface-normal placement preview on "New".
//   - Section Box: 12-edge bounding box wireframe + face-hover translucent
//     highlighting + 3D bidirectional normal push/pull arrow gizmos on each face.
//
// Strictly separates Active Tool Mode (`open === true`, gizmos visible & interactive)
// from Passive Scene Cut State (`hasCuts === true`, clipping planes remain active
// while 3D gizmos hide when the Section sub-bar is closed or when switching to Ruler).

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

/**
 * Builds a reusable Revizto-style 3D bidirectional push/pull arrow along local +Z / -Z.
 * Local Z axis is aligned with the face/plane normal.
 */
function createBidirectionalArrowMesh(tagData = {}) {
  const group = new THREE.Group();

  const mat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    depthTest: false,
    transparent: true,
    opacity: 0.94,
  });

  // Central disc grip on the plane/face surface (XY plane)
  const discGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.06, 24);
  discGeo.rotateX(Math.PI / 2);
  const discMesh = new THREE.Mesh(discGeo, mat);
  discMesh.userData = { ...tagData };
  discMesh.renderOrder = 66;
  group.add(discMesh);

  // Shaft along Z (-1.25 to +1.25)
  const shaftGeo = new THREE.CylinderGeometry(0.08, 0.08, 2.4, 14);
  shaftGeo.rotateX(Math.PI / 2);
  const shaftMesh = new THREE.Mesh(shaftGeo, mat);
  shaftMesh.userData = { ...tagData };
  shaftMesh.renderOrder = 66;
  group.add(shaftMesh);

  // Forward cone (+Z)
  const conePosGeo = new THREE.ConeGeometry(0.28, 0.68, 18);
  conePosGeo.rotateX(Math.PI / 2);
  conePosGeo.translate(0, 0, 1.45);
  const conePosMesh = new THREE.Mesh(conePosGeo, mat);
  conePosMesh.userData = { ...tagData };
  conePosMesh.renderOrder = 67;
  group.add(conePosMesh);

  // Backward cone (-Z)
  const coneNegGeo = new THREE.ConeGeometry(0.28, 0.68, 18);
  coneNegGeo.rotateX(-Math.PI / 2);
  coneNegGeo.translate(0, 0, -1.45);
  const coneNegMesh = new THREE.Mesh(coneNegGeo, mat);
  coneNegMesh.userData = { ...tagData };
  coneNegMesh.renderOrder = 67;
  group.add(coneNegMesh);

  const pickMeshes = [discMesh, shaftMesh, conePosMesh, coneNegMesh];
  return {
    group,
    mat,
    pickMeshes,
    dispose() {
      discGeo.dispose();
      shaftGeo.dispose();
      conePosGeo.dispose();
      coneNegGeo.dispose();
      mat.dispose();
    },
  };
}

export function createSectionController({
  components,
  world,
  rawClipper,
  fragments,
  highlighter = null,
  pick = null,
  onToolOpen = null,
} = {}) {
  const scene = world?.scene?.three || null;
  const camera = world?.camera?.three || null;
  const controls = world?.camera?.controls || null;

  if (world?.renderer?.three) {
    world.renderer.three.localClippingEnabled = true;
  }
  if (rawClipper && "localClippingPlanes" in rawClipper) {
    rawClipper.localClippingPlanes = true;
  }

  let open = false; // True ONLY while the Section sub-bar / tool is active
  let mode = "plane"; // 'plane' | 'box' (Revizto defaults to Plane)
  let gizmoVisible = true;
  let lastPlaneId = null;
  let surfacePickPending = false;
  let externalOpenCallback = typeof onToolOpen === "function" ? onToolOpen : null;

  const boxPlaneIds = new Map(); // spec.key -> planeId
  const customPlaneIds = []; // ordered list of Plane-mode planeIds
  const activeBox = new THREE.Box3(new THREE.Vector3(-5, -1, -5), new THREE.Vector3(5, 5, 5));
  const modelRefBounds = new THREE.Box3(new THREE.Vector3(-5, -1, -5), new THREE.Vector3(5, 5, 5));
  const externalClippedObjects = new Set();
  const externalBoundsProviders = new Map();
  const stateListeners = new Set();
  const dragListeners = new Set();

  // Track active Plane-mode normal & point explicitly so our Revizto Plane Gizmo drives it smoothly
  const activePlaneNormal = new THREE.Vector3(0, -1, 0);
  const activePlaneOrigin = new THREE.Vector3(0, 2, 0);

  // =========================================================================
  // 1. Revizto 5 Section Box 3D Gizmo (Wireframe + Face Highlight + Normal Arrow)
  // =========================================================================
  const boxGroup = new THREE.Group();
  boxGroup.name = "ReviztoSectionBoxGizmo";
  boxGroup.visible = false;
  boxGroup.renderOrder = 60;

  const wireGeo = new THREE.BufferGeometry();
  const wirePositions = new Float32Array(24 * 3); // 12 edges * 2 vertices
  wireGeo.setAttribute("position", new THREE.BufferAttribute(wirePositions, 3));
  const wireMat = new THREE.LineBasicMaterial({
    color: 0xd4d4d8,
    depthTest: true,
    transparent: true,
    opacity: 0.88,
  });
  const wireLines = new THREE.LineSegments(wireGeo, wireMat);
  wireLines.frustumCulled = false;
  boxGroup.add(wireLines);

  // Highlighted face outline (4 edges of the hovered/dragged face)
  const activeFaceEdgeGeo = new THREE.BufferGeometry();
  const activeFaceEdgePos = new Float32Array(8 * 3);
  activeFaceEdgeGeo.setAttribute("position", new THREE.BufferAttribute(activeFaceEdgePos, 3));
  const activeFaceEdgeMat = new THREE.LineBasicMaterial({
    color: 0x38bdf8,
    depthTest: false,
    transparent: true,
    opacity: 0.98,
  });
  const activeFaceEdgeLines = new THREE.LineSegments(activeFaceEdgeGeo, activeFaceEdgeMat);
  activeFaceEdgeLines.visible = false;
  activeFaceEdgeLines.frustumCulled = false;
  activeFaceEdgeLines.renderOrder = 64;
  boxGroup.add(activeFaceEdgeLines);

  const handleFaces = ["minX", "maxX", "minY", "maxY", "minZ", "maxZ"];
  const faceHandles = new Map();
  const boxPickMeshes = [];
  const quadGeo = new THREE.PlaneGeometry(1, 1);

  for (const key of handleFaces) {
    const arrow = createBidirectionalArrowMesh({ sectionFaceKey: key, isArrow: true });

    const quadMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const quadMesh = new THREE.Mesh(quadGeo, quadMat);
    quadMesh.userData = { sectionFaceKey: key, isFaceQuad: true };
    quadMesh.renderOrder = 58;

    boxGroup.add(arrow.group);
    boxGroup.add(quadMesh);
    faceHandles.set(key, { arrow, quadMesh, quadMat });
    boxPickMeshes.push(...arrow.pickMeshes, quadMesh);
  }

  // =========================================================================
  // 2. Revizto 5 Section Plane 3D Gizmo (Framed Quad + Normal Arrow + Tilt Rings)
  // =========================================================================
  const planeGizmoGroup = new THREE.Group();
  planeGizmoGroup.name = "ReviztoSectionPlaneGizmo";
  planeGizmoGroup.visible = false;
  planeGizmoGroup.renderOrder = 61;

  const planeQuadGeo = new THREE.PlaneGeometry(1, 1);
  const planeQuadMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.07,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const planeQuadMesh = new THREE.Mesh(planeQuadGeo, planeQuadMat);
  planeQuadMesh.userData = { sectionPlaneAction: "slide" };
  planeQuadMesh.renderOrder = 59;
  planeGizmoGroup.add(planeQuadMesh);

  // Framed border + center crosshairs on the section plane quad (unit square -0.5..0.5)
  const planeBorderVerts = new Float32Array([
    -0.5, -0.5, 0,  0.5, -0.5, 0,
     0.5, -0.5, 0,  0.5,  0.5, 0,
     0.5,  0.5, 0, -0.5,  0.5, 0,
    -0.5,  0.5, 0, -0.5, -0.5, 0,
    -0.5,  0.0, 0,  0.5,  0.0, 0,
     0.0, -0.5, 0,  0.0,  0.5, 0,
  ]);
  const planeBorderGeo = new THREE.BufferGeometry();
  planeBorderGeo.setAttribute("position", new THREE.BufferAttribute(planeBorderVerts, 3));
  const planeBorderMat = new THREE.LineBasicMaterial({
    color: 0x38bdf8,
    depthTest: false,
    transparent: true,
    opacity: 0.85,
  });
  const planeBorderLines = new THREE.LineSegments(planeBorderGeo, planeBorderMat);
  planeBorderLines.frustumCulled = false;
  planeBorderLines.renderOrder = 63;
  planeQuadMesh.add(planeBorderLines);

  // Central bidirectional normal arrow on the Section Plane
  const planeArrow = createBidirectionalArrowMesh({ sectionPlaneAction: "slide" });
  planeGizmoGroup.add(planeArrow.group);

  // 2 orthogonal rotation / tilt rings on the Section Plane (tiltU around X, tiltV around Y)
  const tiltRingGeo = new THREE.TorusGeometry(2.1, 0.08, 12, 36, Math.PI * 0.65);
  const tiltMatU = new THREE.MeshBasicMaterial({
    color: 0xa3e635,
    depthTest: false,
    transparent: true,
    opacity: 0.85,
  });
  const tiltMeshU = new THREE.Mesh(tiltRingGeo, tiltMatU);
  tiltMeshU.rotation.y = Math.PI / 2;
  tiltMeshU.rotation.z = -Math.PI * 0.325;
  tiltMeshU.userData = { sectionPlaneAction: "tiltU" };
  tiltMeshU.renderOrder = 66;
  planeArrow.group.add(tiltMeshU);

  const tiltMatV = new THREE.MeshBasicMaterial({
    color: 0xfbbf24,
    depthTest: false,
    transparent: true,
    opacity: 0.85,
  });
  const tiltMeshV = new THREE.Mesh(tiltRingGeo, tiltMatV);
  tiltMeshV.rotation.x = Math.PI / 2;
  tiltMeshV.rotation.z = -Math.PI * 0.325;
  tiltMeshV.userData = { sectionPlaneAction: "tiltV" };
  tiltMeshV.renderOrder = 66;
  planeArrow.group.add(tiltMeshV);

  const planePickMeshes = [
    ...planeArrow.pickMeshes,
    tiltMeshU,
    tiltMeshV,
    planeQuadMesh,
  ];

  // =========================================================================
  // 3. Revizto 5 Suction-Cup Surface Placement Preview (`New` Plane Pick)
  // =========================================================================
  const suctionPreviewGroup = new THREE.Group();
  suctionPreviewGroup.name = "ReviztoSuctionPreview";
  suctionPreviewGroup.visible = false;
  suctionPreviewGroup.renderOrder = 70;

  const suctionDiscGeo = new THREE.CircleGeometry(1.0, 32);
  const suctionDiscMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.28,
    side: THREE.DoubleSide,
    depthTest: false,
  });
  const suctionDiscMesh = new THREE.Mesh(suctionDiscGeo, suctionDiscMat);
  suctionPreviewGroup.add(suctionDiscMesh);

  const suctionRingGeo = new THREE.RingGeometry(0.92, 1.04, 32);
  const suctionRingMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.92,
    side: THREE.DoubleSide,
    depthTest: false,
  });
  const suctionRingMesh = new THREE.Mesh(suctionRingGeo, suctionRingMat);
  suctionPreviewGroup.add(suctionRingMesh);

  const suctionNormArrow = createBidirectionalArrowMesh({});
  suctionPreviewGroup.add(suctionNormArrow.group);

  if (scene) {
    scene.add(boxGroup);
    scene.add(planeGizmoGroup);
    scene.add(suctionPreviewGroup);
  }

  let hoveredFaceKey = null;
  let hoveredPlaneAction = null; // 'slide' | 'tiltU' | 'tiltV' | null
  let draggingState = null;
  let suctionHitValid = false;
  let suctionPickToken = 0;

  function syncGizmoVisibility() {
    // CRITICAL REVIZTO RULE: 3D Section gizmos are ONLY visible while the Section
    // tool (`open`) is active. Closing Section or switching to Ruler hides the
    // 3D gizmos immediately while keeping the clipping planes active on the model.
    const showAny = open && gizmoVisible;
    boxGroup.visible = showAny && mode === "box" && boxPlaneIds.size > 0;
    planeGizmoGroup.visible = showAny && mode === "plane" && customPlaneIds.length > 0 && !surfacePickPending;
    suctionPreviewGroup.visible = open && surfacePickPending && suctionHitValid;

    // Always keep OBC's internal SimplePlane meshes hidden so only our Revizto gizmo renders
    if (rawClipper) {
      rawClipper.visible = false;
      if (rawClipper.list) {
        for (const [, item] of rawClipper.list) {
          if (item) item.visible = false;
        }
      }
    }
  }

  function updatePlaneGizmoVisuals() {
    if (customPlaneIds.length === 0) return;
    const targetId = lastPlaneId || customPlaneIds[customPlaneIds.length - 1];
    const simplePlane = rawClipper?.list?.get(targetId);
    if (simplePlane?.normal && simplePlane?.origin) {
      activePlaneNormal.copy(simplePlane.normal).normalize();
      activePlaneOrigin.copy(simplePlane.origin);
    }

    // Project model center onto the active plane so the framed quad wraps the model nicely
    const modelCenter = modelRefBounds.getCenter(new THREE.Vector3());
    const modelSize = modelRefBounds.getSize(new THREE.Vector3());
    const maxSpan = Math.max(modelSize.x, modelSize.y, modelSize.z, 4) * 1.15;

    const planeMath = new THREE.Plane().setFromNormalAndCoplanarPoint(activePlaneNormal, activePlaneOrigin);
    const quadCenter = new THREE.Vector3();
    planeMath.projectPoint(modelCenter, quadCenter);

    const quat = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      activePlaneNormal,
    );

    planeQuadMesh.position.copy(quadCenter);
    planeQuadMesh.quaternion.copy(quat);
    planeQuadMesh.scale.set(maxSpan, maxSpan, 1);

    planeArrow.group.position.copy(quadCenter);
    planeArrow.group.quaternion.copy(quat);
    const camDist = camera?.position ? camera.position.distanceTo(quadCenter) : 14;
    const arrowScale = Math.max(0.18, Math.min(1.4, camDist * 0.045));
    planeArrow.group.scale.setScalar(arrowScale);

    const isSlideActive = draggingState?.type === "plane-slide" || hoveredPlaneAction === "slide";
    const isTiltUActive = draggingState?.type === "plane-tiltU" || hoveredPlaneAction === "tiltU";
    const isTiltVActive = draggingState?.type === "plane-tiltV" || hoveredPlaneAction === "tiltV";

    planeArrow.mat.color.setHex(
      draggingState?.type === "plane-slide" ? 0xfacc15 : isSlideActive ? 0x38bdf8 : 0xe4e4e7,
    );
    tiltMatU.color.setHex(isTiltUActive ? 0xfacc15 : 0xa3e635);
    tiltMatV.color.setHex(isTiltVActive ? 0xfacc15 : 0xfbbf24);
    planeBorderMat.color.setHex(isSlideActive || isTiltUActive || isTiltVActive ? 0x38bdf8 : 0xd4d4d8);
    planeQuadMat.opacity = draggingState?.type?.startsWith("plane")
      ? 0.18
      : hoveredPlaneAction
        ? 0.12
        : 0.05;
  }

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
      minX: { pos: [min.x, cy, cz], rot: [0, -Math.PI / 2, 0], scale: [sz, sy, 1], corners: [0, 3, 7, 4] },
      maxX: { pos: [max.x, cy, cz], rot: [0, Math.PI / 2, 0], scale: [sz, sy, 1], corners: [1, 2, 6, 5] },
      minY: { pos: [cx, min.y, cz], rot: [Math.PI / 2, 0, 0], scale: [sx, sz, 1], corners: [0, 1, 5, 4] },
      maxY: { pos: [cx, max.y, cz], rot: [-Math.PI / 2, 0, 0], scale: [sx, sz, 1], corners: [3, 2, 6, 7] },
      minZ: { pos: [cx, cy, min.z], rot: [0, Math.PI, 0], scale: [sx, sy, 1], corners: [0, 1, 2, 3] },
      maxZ: { pos: [cx, cy, max.z], rot: [0, 0, 0], scale: [sx, sy, 1], corners: [4, 5, 6, 7] },
    };

    const activeKey = draggingState?.faceKey || hoveredFaceKey;
    const camPos = camera?.position;

    for (const key of handleFaces) {
      const entry = faceHandles.get(key);
      const cfg = faceConfig[key];
      const isActive = activeKey === key;

      entry.arrow.group.position.set(cfg.pos[0], cfg.pos[1], cfg.pos[2]);
      entry.arrow.group.rotation.set(cfg.rot[0], cfg.rot[1], cfg.rot[2]);
      const dist = camPos ? camPos.distanceTo(entry.arrow.group.position) : 12;
      const baseScale = Math.max(0.14, Math.min(1.1, dist * 0.036));
      entry.arrow.group.scale.setScalar(isActive ? baseScale * 1.25 : baseScale * 0.82);

      entry.arrow.mat.color.setHex(
        draggingState?.faceKey === key ? 0xfacc15 : isActive ? 0x38bdf8 : 0xd4d4d8,
      );
      entry.arrow.mat.opacity = isActive ? 0.98 : 0.55;

      entry.quadMesh.position.set(cfg.pos[0], cfg.pos[1], cfg.pos[2]);
      entry.quadMesh.rotation.set(cfg.rot[0], cfg.rot[1], cfg.rot[2]);
      entry.quadMesh.scale.set(cfg.scale[0], cfg.scale[1], cfg.scale[2]);
      entry.quadMat.opacity = draggingState?.faceKey === key ? 0.22 : isActive ? 0.14 : 0.0;
    }

    if (activeKey && faceConfig[activeKey]) {
      const cIdx = faceConfig[activeKey].corners;
      const fEdges = [
        [cIdx[0], cIdx[1]],
        [cIdx[1], cIdx[2]],
        [cIdx[2], cIdx[3]],
        [cIdx[3], cIdx[0]],
      ];
      const fPos = activeFaceEdgeGeo.attributes.position.array;
      let fPtr = 0;
      for (const [a, b] of fEdges) {
        fPos[fPtr++] = corners[a][0]; fPos[fPtr++] = corners[a][1]; fPos[fPtr++] = corners[a][2];
        fPos[fPtr++] = corners[b][0]; fPos[fPtr++] = corners[b][1]; fPos[fPtr++] = corners[b][2];
      }
      activeFaceEdgeGeo.attributes.position.needsUpdate = true;
      activeFaceEdgeMat.color.setHex(draggingState?.faceKey ? 0xfacc15 : 0x38bdf8);
      activeFaceEdgeLines.visible = true;
    } else {
      activeFaceEdgeLines.visible = false;
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
      hintText: !open
        ? ""
        : surfacePickPending
          ? "Section Plane: hover any surface and click to align cut plane (Esc to cancel)"
          : mode === "box" && boxPlaneIds.size > 0
            ? "Section Box: hover any face or arrow and drag to push/pull the cropping volume"
            : mode === "plane" && customPlaneIds.length > 0
              ? "Section Plane: drag the central arrow to slide cut, or drag the rings to tilt"
              : "",
      bounds: {
        min: activeBox.min.toArray(),
        max: activeBox.max.toArray(),
      },
    };
  }

  function notify() {
    syncGizmoVisibility();
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

  function setOpenInternal(nextOpen) {
    const wasOpen = open;
    open = Boolean(nextOpen);
    if (open && !wasOpen && typeof externalOpenCallback === "function") {
      try { externalOpenCallback(); } catch { /* noop */ }
    }
    if (!open) {
      surfacePickPending = false;
      suctionHitValid = false;
      hoveredFaceKey = null;
      hoveredPlaneAction = null;
      if (draggingState) {
        draggingState = null;
        if (controls) controls.enabled = true;
        notifyDragging(false);
      }
    }
    syncGizmoVisibility();
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
    modelRefBounds.copy(merged);
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
    updateBoxVisuals();
    syncGizmoVisibility();
    syncExternalClippedMaterials();
  }

  function applyActivePlaneToClipper() {
    if (!rawClipper || customPlaneIds.length === 0) return;
    const targetId = lastPlaneId || customPlaneIds[customPlaneIds.length - 1];
    const simplePlane = rawClipper.list.get(targetId);
    if (simplePlane) {
      simplePlane.setFromNormalAndCoplanarPoint(activePlaneNormal.clone(), activePlaneOrigin.clone());
      simplePlane.visible = false;
      simplePlane.enabled = true;
    }
    updatePlaneGizmoVisuals();
    syncGizmoVisibility();
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
    draggingState = null;
    hoveredFaceKey = null;
    hoveredPlaneAction = null;
    suctionHitValid = false;
    if (rawClipper) rawClipper.enabled = false;
    syncGizmoVisibility();
    syncExternalClippedMaterials();
  }

  async function addPlane(normalVec, pointVec) {
    if (!rawClipper || !world) return null;
    rawClipper.enabled = true;
    rawClipper.visible = false;
    const bounds = await computeTargetBounds(null, 0.25);
    const normal = (normalVec ? normalVec.clone() : new THREE.Vector3(0, -1, 0)).normalize();
    let point = pointVec ? pointVec.clone() : null;
    if (!point) {
      const center = bounds.getCenter(new THREE.Vector3());
      point = new THREE.Vector3(
        center.x,
        bounds.min.y + (bounds.max.y - bounds.min.y) * 0.68,
        center.z,
      );
    }

    // In Revizto Plane mode, replace previous standalone plane so the single active Section Plane gizmo is unambiguous
    while (customPlaneIds.length > 0) {
      const oldId = customPlaneIds.pop();
      try { rawClipper.delete(world, oldId); } catch { /* noop */ }
    }

    activePlaneNormal.copy(normal);
    activePlaneOrigin.copy(point);

    const id = rawClipper.createFromNormalAndCoplanarPoint(world, normal, point);
    customPlaneIds.push(id);
    lastPlaneId = id;
    const simplePlane = rawClipper.list.get(id);
    if (simplePlane) {
      simplePlane.visible = false;
      simplePlane.enabled = true;
    }
    updatePlaneGizmoVisuals();
    syncGizmoVisibility();
    syncExternalClippedMaterials();
    notify();
    return id;
  }

  async function activateBox(targetMap = null) {
    while (customPlaneIds.length > 0) {
      const id = customPlaneIds.pop();
      try { rawClipper?.delete?.(world, id); } catch { /* noop */ }
    }
    surfacePickPending = false;
    suctionHitValid = false;
    mode = "box";
    setOpenInternal(true);
    const bounds = await computeTargetBounds(targetMap, 0.35);
    activeBox.copy(bounds);
    applyBoxPlanesToClipper();
    notify();
  }

  async function activatePlane() {
    for (const id of boxPlaneIds.values()) {
      try { rawClipper?.delete?.(world, id); } catch { /* noop */ }
    }
    boxPlaneIds.clear();
    mode = "plane";
    setOpenInternal(true);
    if (customPlaneIds.length === 0) {
      await addPlane(null, null);
    } else {
      updatePlaneGizmoVisuals();
      syncExternalClippedMaterials();
      notify();
    }
  }

  // Keep gizmo handles scaled cleanly when camera orbits/zooms
  const onControlsUpdate = () => {
    if (boxGroup.visible) updateBoxVisuals();
    if (planeGizmoGroup.visible) updatePlaneGizmoVisuals();
  };
  try {
    controls?.addEventListener?.("update", onControlsUpdate);
  } catch { /* headless */ }

  // =========================================================================
  // 4. Interactive Raycasting & Dragging (Plane Gizmo, Box Gizmo, Suction Pick)
  // =========================================================================
  const dragRaycaster = new THREE.Raycaster();

  function pickBoxFaceOrArrow(ndc) {
    if (!boxGroup.visible || !camera || !ndc) return null;
    dragRaycaster.setFromCamera(ndc, camera);
    const hits = dragRaycaster.intersectObjects(boxPickMeshes, false);
    if (hits.length === 0) return null;
    // Prefer arrow hits over face quads when both intersect
    const arrowHit = hits.find((h) => h.object.userData?.isArrow);
    const best = arrowHit || hits[0];
    return best.object.userData?.sectionFaceKey || null;
  }

  function pickPlaneGizmoAction(ndc) {
    if (!planeGizmoGroup.visible || !camera || !ndc) return null;
    dragRaycaster.setFromCamera(ndc, camera);
    const hits = dragRaycaster.intersectObjects(planePickMeshes, false);
    if (hits.length === 0) return null;
    // Prefer tilt rings or central arrow before the large plane quad
    const priorityHit = hits.find((h) => h.object !== planeQuadMesh) || hits[0];
    return priorityHit.object.userData?.sectionPlaneAction || null;
  }

  function updateSuctionPreview(ndc) {
    if (!open || !surfacePickPending || !pick || !ndc) {
      suctionHitValid = false;
      syncGizmoVisibility();
      return;
    }
    const token = ++suctionPickToken;
    Promise.resolve(pick(ndc, { snap: false }))
      .then((hit) => {
        if (token !== suctionPickToken || !open || !surfacePickPending) return;
        if (!hit?.point) {
          suctionHitValid = false;
          syncGizmoVisibility();
          return;
        }
        let normal = hit.normal ? hit.normal.clone() : new THREE.Vector3(0, 1, 0);
        if (camera) {
          const toCam = camera.position.clone().sub(hit.point);
          if (normal.dot(toCam) < 0) normal.negate();
        }
        normal.normalize();
        suctionPreviewGroup.position.copy(hit.point).addScaledVector(normal, 0.02);
        const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
        suctionPreviewGroup.quaternion.copy(quat);
        const dist = camera?.position ? camera.position.distanceTo(hit.point) : 10;
        const s = Math.max(0.15, Math.min(1.2, dist * 0.04));
        suctionPreviewGroup.scale.setScalar(s);
        suctionHitValid = true;
        syncGizmoVisibility();
      })
      .catch(() => {});
  }

  function handlePointerMove(ndc) {
    if (!open || !camera || !ndc) return false;

    if (surfacePickPending) {
      updateSuctionPreview(ndc);
      return true;
    }

    if (draggingState) {
      dragRaycaster.setFromCamera(ndc, camera);
      const hitPoint = new THREE.Vector3();
      if (!dragRaycaster.ray.intersectPlane(draggingState.dragPlane, hitPoint)) {
        return true;
      }

      if (draggingState.type === "box-face") {
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
        return true;
      }

      if (draggingState.type === "plane-slide") {
        const deltaVec = hitPoint.clone().sub(draggingState.startHit);
        const signedSlide = deltaVec.dot(draggingState.startNormal);
        activePlaneOrigin
          .copy(draggingState.startOrigin)
          .addScaledVector(draggingState.startNormal, signedSlide);
        applyActivePlaneToClipper();
        notify();
        return true;
      }

      if (draggingState.type === "plane-tiltU" || draggingState.type === "plane-tiltV") {
        const deltaNdc = (ndc.x - draggingState.startNdc.x) + (ndc.y - draggingState.startNdc.y);
        const angleRad = deltaNdc * Math.PI * 0.65;
        const rotQuat = new THREE.Quaternion().setFromAxisAngle(draggingState.rotAxis, angleRad);
        activePlaneNormal.copy(draggingState.startNormal).applyQuaternion(rotQuat).normalize();
        applyActivePlaneToClipper();
        notify();
        return true;
      }
    }

    if (mode === "box" && boxGroup.visible) {
      const nextHover = pickBoxFaceOrArrow(ndc);
      if (nextHover !== hoveredFaceKey) {
        hoveredFaceKey = nextHover;
        updateBoxVisuals();
      }
      return Boolean(hoveredFaceKey);
    }

    if (mode === "plane" && planeGizmoGroup.visible) {
      const nextAction = pickPlaneGizmoAction(ndc);
      if (nextAction !== hoveredPlaneAction) {
        hoveredPlaneAction = nextAction;
        updatePlaneGizmoVisuals();
      }
      return Boolean(hoveredPlaneAction);
    }

    return false;
  }

  function handlePointerDown(ndc, button = 0) {
    if (button !== 0 || !open || !camera || !ndc) return false;
    if (surfacePickPending) return false; // Handled on click

    // 1. Box mode face/arrow drag
    if (mode === "box" && boxGroup.visible) {
      const faceKey = pickBoxFaceOrArrow(ndc);
      if (!faceKey) return false;

      const entry = faceHandles.get(faceKey);
      const axis = faceKey.slice(-1).toLowerCase(); // x | y | z
      const bound = faceKey.slice(0, 3); // min | max
      const handlePos = entry.arrow.group.position.clone();

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
        type: "box-face",
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

    // 2. Plane mode normal arrow / quad slide or tilt drag
    if (mode === "plane" && planeGizmoGroup.visible) {
      const action = pickPlaneGizmoAction(ndc);
      if (!action) return false;

      const gizmoCenter = planeArrow.group.position.clone();
      const camDir = new THREE.Vector3();
      camera.getWorldDirection(camDir);

      if (action === "slide") {
        const tangent = new THREE.Vector3().crossVectors(camDir, activePlaneNormal);
        let dragNormal = new THREE.Vector3().crossVectors(activePlaneNormal, tangent);
        if (dragNormal.lengthSq() < 1e-6) dragNormal.copy(camDir);
        dragNormal.normalize();

        const dragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(dragNormal, gizmoCenter);
        dragRaycaster.setFromCamera(ndc, camera);
        const startHit = new THREE.Vector3();
        if (!dragRaycaster.ray.intersectPlane(dragPlane, startHit)) return false;

        draggingState = {
          type: "plane-slide",
          dragPlane,
          startHit,
          startOrigin: activePlaneOrigin.clone(),
          startNormal: activePlaneNormal.clone(),
        };
      } else {
        const quat = planeArrow.group.quaternion.clone();
        const rotAxis = action === "tiltU"
          ? new THREE.Vector3(1, 0, 0).applyQuaternion(quat).normalize()
          : new THREE.Vector3(0, 1, 0).applyQuaternion(quat).normalize();
        const dragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(camDir, gizmoCenter);

        draggingState = {
          type: `plane-${action}`,
          dragPlane,
          rotAxis,
          startNdc: { x: ndc.x, y: ndc.y },
          startNormal: activePlaneNormal.clone(),
        };
      }

      if (controls) controls.enabled = false;
      notifyDragging(true);
      updatePlaneGizmoVisuals();
      return true;
    }

    return false;
  }

  function handlePointerUp() {
    if (!draggingState) return false;
    draggingState = null;
    if (controls) controls.enabled = true;
    notifyDragging(false);
    if (boxGroup.visible) updateBoxVisuals();
    if (planeGizmoGroup.visible) updatePlaneGizmoVisuals();
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

    setOnToolOpen(fn) {
      externalOpenCallback = typeof fn === "function" ? fn : null;
    },

    async setActive(nextActive) {
      const want = Boolean(nextActive);
      if (want) {
        setOpenInternal(true);
        if (!hasActiveCut()) {
          await this.activate(mode);
        } else {
          if (mode === "box") updateBoxVisuals();
          else updatePlaneGizmoVisuals();
          notify();
        }
      } else {
        setOpenInternal(false);
        notify();
      }
      return getState();
    },

    async toggle() {
      return this.setActive(!open);
    },

    startSurfaceCut() {
      setOpenInternal(true);
      mode = "plane";
      surfacePickPending = true;
      suctionHitValid = false;
      notify();
      return getState();
    },

    async handlePointerClick(ndc) {
      if (!surfacePickPending || !ndc) return null;
      surfacePickPending = false;
      suctionHitValid = false;
      const id = await this.cutAtNdc(ndc);
      notify();
      return id;
    },

    cancelPendingOrClose() {
      if (surfacePickPending) {
        surfacePickPending = false;
        suctionHitValid = false;
        notify();
        return true;
      }
      if (open) {
        setOpenInternal(false);
        notify();
        return true;
      }
      return false;
    },

    isDraggingHandle() {
      return Boolean(draggingState);
    },

    isHoveringHandle() {
      return Boolean(hoveredFaceKey || hoveredPlaneAction || surfacePickPending);
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
      setOpenInternal(true);
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
      setOpenInternal(true);
      if (mode === "box") {
        // In Revizto, clicking "New" in Box mode wraps current selection (if any) or resets to model bounds
        await activateBox(targetMap);
      } else {
        // In Revizto, clicking "New" in Plane mode arms the surface-normal suction-cup picker
        // (and if called in headless tests without pick, creates/cycles an orthogonal cut plane)
        if (pick && world?.renderer?.three) {
          this.startSurfaceCut();
        } else {
          const bounds = await computeTargetBounds(targetMap, 0);
          const center = bounds.getCenter(new THREE.Vector3());
          await addPlane(new THREE.Vector3(0, -1, 0), center);
        }
      }
      return getState();
    },

    async cutPreset(dir = "top") {
      setOpenInternal(true);
      const normal = PRESET_NORMALS[dir] || PRESET_NORMALS.top;
      const bounds = await computeTargetBounds(null, 0);
      const center = bounds.getCenter(new THREE.Vector3());
      if (mode === "box") {
        await activatePlane();
      }
      await addPlane(normal, center);
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
      setOpenInternal(true);
      activeBox.copy(box).expandByScalar(0.15);
      modelRefBounds.copy(activeBox);
      applyBoxPlanesToClipper();
      notify();
      return getState();
    },

    async cutAtNdc(ndc) {
      if (!pick || (!open && !surfacePickPending)) return null;
      const hit = await pick(ndc, { snap: false });
      if (!hit?.point) return null;
      let normal = hit.normal ? hit.normal.clone() : new THREE.Vector3(0, -1, 0);
      if (camera) {
        const toCam = camera.position.clone().sub(hit.point);
        // Cut away the camera-facing side into the surface
        if (normal.dot(toCam) > 0) normal.negate();
      }
      mode = "plane";
      setOpenInternal(true);
      const id = await addPlane(normal, hit.point);
      return id;
    },

    flipActivePlane() {
      if (mode !== "plane" || customPlaneIds.length === 0 || !rawClipper) return false;
      activePlaneNormal.negate();
      applyActivePlaneToClipper();
      notify();
      return true;
    },

    setGizmoVisible(visible) {
      gizmoVisible = Boolean(visible);
      syncGizmoVisibility();
      notify();
    },

    toggleHandlesVisible() {
      this.setGizmoVisible(!gizmoVisible);
      return gizmoVisible;
    },

    clear() {
      surfacePickPending = false;
      suctionHitValid = false;
      clearInternal();
      notify();
      return getState();
    },

    clearAll() {
      return this.clear();
    },

    uncut() {
      setOpenInternal(false);
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
      planeGizmoGroup.removeFromParent();
      suctionPreviewGroup.removeFromParent();
      wireGeo.dispose();
      wireMat.dispose();
      activeFaceEdgeGeo.dispose();
      activeFaceEdgeMat.dispose();
      quadGeo.dispose();
      for (const e of faceHandles.values()) {
        e.arrow.dispose();
        e.quadMat.dispose();
      }
      planeQuadGeo.dispose();
      planeQuadMat.dispose();
      planeBorderGeo.dispose();
      planeBorderMat.dispose();
      planeArrow.dispose();
      tiltRingGeo.dispose();
      tiltMatU.dispose();
      tiltMatV.dispose();
      suctionDiscGeo.dispose();
      suctionDiscMat.dispose();
      suctionRingGeo.dispose();
      suctionRingMat.dispose();
      suctionNormArrow.dispose();
      stateListeners.clear();
      dragListeners.clear();
    },
  };
}
