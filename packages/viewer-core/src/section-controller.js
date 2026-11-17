// Revizto 5-style Section Cut controller for viewer-core.
//
// Features:
//   - Section Plane: framed translucent cross-section quad + "suction-cup"
//     circular base pad (drag base across model to align cut plane parallel to
//     ANY hovered face in real time) + central bidirectional push/pull normal
//     arrow + orthogonal tilt rings.
//   - Section Box (Oriented Bounding Box / OBB):
//       1. Move face  — clean wireframe; single push/pull arrow + highlight on hovered face only
//       2. Scale box  — centered XYZ + uniform scale gizmo
//       3. Move box   — centered XYZ translation triad
//       4. Rotate box — centered XYZ orthogonal rotation rings
//
// Strictly separates Active Tool Mode (`open === true`, gizmos visible & interactive)
// from Passive Scene Cut State (`hasCuts === true`, clipping planes remain active
// while 3D gizmos hide when the Section sub-bar is closed or when switching to Ruler).

import * as THREE from "three";
import * as OBC from "@thatopen/components";

const MIN_HALF_EXTENT = 0.04;
export const SECTION_BOX_MODES = ["move-face", "scale-box", "move-box", "rotate-box"];

/**
 * Pure helper: builds the 6 inward-facing clipping plane definitions for a THREE.Box3.
 * Three.js discards points where `plane.distanceToPoint(p) < 0`.
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
 * Pure helper: computes the 6 inward-facing clipping planes for an Oriented Bounding Box (OBB).
 */
export function computeObbPlaneSpecs({ center, halfExtents, quaternion }) {
  const ux = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion).normalize();
  const uy = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion).normalize();
  const uz = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion).normalize();

  const axes = [
    { axis: "x", dir: ux, h: halfExtents.x, minKey: "minX", maxKey: "maxX" },
    { axis: "y", dir: uy, h: halfExtents.y, minKey: "minY", maxKey: "maxY" },
    { axis: "z", dir: uz, h: halfExtents.z, minKey: "minZ", maxKey: "maxZ" },
  ];

  const specs = [];
  for (const a of axes) {
    specs.push({
      key: a.minKey,
      axis: a.axis,
      sign: -1,
      dir: a.dir,
      normal: a.dir.clone(), // inward points +dir
      point: center.clone().addScaledVector(a.dir, -a.h),
    });
    specs.push({
      key: a.maxKey,
      axis: a.axis,
      sign: 1,
      dir: a.dir,
      normal: a.dir.clone().negate(), // inward points -dir
      point: center.clone().addScaledVector(a.dir, a.h),
    });
  }
  return specs;
}

/**
 * Pure helper: computes the 8 world-space corners of an OBB in standard box order.
 */
export function computeObbCorners({ center, halfExtents, quaternion }) {
  const ux = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion).normalize();
  const uy = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion).normalize();
  const uz = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion).normalize();
  const hx = halfExtents.x;
  const hy = halfExtents.y;
  const hz = halfExtents.z;

  const signs = [
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
    [-1, -1,  1], [1, -1,  1], [1, 1,  1], [-1, 1,  1],
  ];
  return signs.map(([sx, sy, sz]) =>
    center
      .clone()
      .addScaledVector(ux, sx * hx)
      .addScaledVector(uy, sy * hy)
      .addScaledVector(uz, sz * hz),
  );
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
 * Builds a clean Revizto-style bidirectional push/pull arrow along local +Z / -Z.
 */
function createBidirectionalArrowMesh(tagData = {}) {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    depthTest: false,
    transparent: true,
    opacity: 0.95,
  });

  const shaftGeo = new THREE.CylinderGeometry(0.065, 0.065, 2.0, 12);
  shaftGeo.rotateX(Math.PI / 2);
  const shaftMesh = new THREE.Mesh(shaftGeo, mat);
  shaftMesh.userData = { ...tagData };
  shaftMesh.renderOrder = 66;
  group.add(shaftMesh);

  const conePosGeo = new THREE.ConeGeometry(0.24, 0.62, 16);
  conePosGeo.rotateX(Math.PI / 2);
  conePosGeo.translate(0, 0, 1.25);
  const conePosMesh = new THREE.Mesh(conePosGeo, mat);
  conePosMesh.userData = { ...tagData };
  conePosMesh.renderOrder = 67;
  group.add(conePosMesh);

  const coneNegGeo = new THREE.ConeGeometry(0.24, 0.62, 16);
  coneNegGeo.rotateX(-Math.PI / 2);
  coneNegGeo.translate(0, 0, -1.25);
  const coneNegMesh = new THREE.Mesh(coneNegGeo, mat);
  coneNegMesh.userData = { ...tagData };
  coneNegMesh.renderOrder = 67;
  group.add(coneNegMesh);

  const pickMeshes = [shaftMesh, conePosMesh, coneNegMesh];
  return {
    group,
    mat,
    pickMeshes,
    dispose() {
      shaftGeo.dispose();
      conePosGeo.dispose();
      coneNegGeo.dispose();
      mat.dispose();
    },
  };
}

/**
 * Builds a single-axis colored arrow/handle along local +Z for Move Box / Scale Box gizmos.
 */
function createAxisGizmoHandle(axisKey, hexColor, tipShape = "cone", tagPrefix = "move") {
  const mat = new THREE.MeshBasicMaterial({
    color: hexColor,
    depthTest: false,
    transparent: true,
    opacity: 0.94,
  });
  const group = new THREE.Group();
  const shaftGeo = new THREE.CylinderGeometry(0.055, 0.055, 1.8, 12);
  shaftGeo.rotateX(Math.PI / 2);
  shaftGeo.translate(0, 0, 0.9);
  const shaft = new THREE.Mesh(shaftGeo, mat);
  shaft.userData = { sectionBoxGizmo: `${tagPrefix}-${axisKey}`, axis: axisKey };
  shaft.renderOrder = 70;
  group.add(shaft);

  const tipGeo =
    tipShape === "cube"
      ? new THREE.BoxGeometry(0.32, 0.32, 0.32)
      : new THREE.ConeGeometry(0.2, 0.55, 16);
  if (tipShape !== "cube") tipGeo.rotateX(Math.PI / 2);
  tipGeo.translate(0, 0, 1.95);
  const tip = new THREE.Mesh(tipGeo, mat);
  tip.userData = { sectionBoxGizmo: `${tagPrefix}-${axisKey}`, axis: axisKey };
  tip.renderOrder = 71;
  group.add(tip);

  return {
    group,
    mat,
    pickMeshes: [shaft, tip],
    dispose() {
      shaftGeo.dispose();
      tipGeo.dispose();
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

  let open = false;
  let mode = "plane"; // 'plane' | 'box'
  let boxMode = "move-face"; // 'move-face' | 'scale-box' | 'move-box' | 'rotate-box'
  let gizmoVisible = true;
  let lastPlaneId = null;
  let surfacePickPending = false;
  let externalOpenCallback = typeof onToolOpen === "function" ? onToolOpen : null;

  const boxPlaneIds = new Map();
  const customPlaneIds = [];
  const obb = {
    center: new THREE.Vector3(0, 2, 0),
    halfExtents: new THREE.Vector3(5, 3, 5),
    quaternion: new THREE.Quaternion(),
  };
  const modelRefBounds = new THREE.Box3(new THREE.Vector3(-5, -1, -5), new THREE.Vector3(5, 5, 5));
  const externalClippedObjects = new Set();
  const externalBoundsProviders = new Map();
  const stateListeners = new Set();
  const dragListeners = new Set();

  const activePlaneNormal = new THREE.Vector3(0, -1, 0);
  const activePlaneOrigin = new THREE.Vector3(0, 2, 0);

  // =========================================================================
  // 1. Clean Revizto 5 Section Box (OBB) 3D Gizmo + 4 Modes
  // =========================================================================
  const boxGroup = new THREE.Group();
  boxGroup.name = "ReviztoSectionBoxGizmo";
  boxGroup.visible = false;
  boxGroup.renderOrder = 60;

  const wireGeo = new THREE.BufferGeometry();
  const wirePositions = new Float32Array(24 * 3);
  wireGeo.setAttribute("position", new THREE.BufferAttribute(wirePositions, 3));
  const wireMat = new THREE.LineBasicMaterial({
    color: 0x4ade80, // clean Revizto green wireframe
    depthTest: true,
    transparent: true,
    opacity: 0.78,
  });
  const wireLines = new THREE.LineSegments(wireGeo, wireMat);
  wireLines.frustumCulled = false;
  boxGroup.add(wireLines);

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
  const facePickMeshes = [];
  const quadGeo = new THREE.PlaneGeometry(1, 1);
  const dotGeo = new THREE.SphereGeometry(1, 12, 10);

  // Single reusable push/pull arrow that appears ONLY on the hovered/dragged face
  const hoverFaceArrow = createBidirectionalArrowMesh({ isHoverFaceArrow: true });
  hoverFaceArrow.group.visible = false;
  boxGroup.add(hoverFaceArrow.group);

  for (const key of handleFaces) {
    const dotMat = new THREE.MeshBasicMaterial({
      color: 0x4ade80,
      depthTest: false,
      transparent: true,
      opacity: 0.65,
    });
    const dotMesh = new THREE.Mesh(dotGeo, dotMat);
    dotMesh.userData = { sectionFaceKey: key, isFaceDot: true };
    dotMesh.renderOrder = 65;

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

    boxGroup.add(dotMesh);
    boxGroup.add(quadMesh);
    faceHandles.set(key, { dotMesh, dotMat, quadMesh, quadMat });
    facePickMeshes.push(dotMesh, quadMesh);
  }

  // Centered XYZ Move Box Gizmo
  const moveBoxGroup = new THREE.Group();
  moveBoxGroup.visible = false;
  const moveX = createAxisGizmoHandle("x", 0xef4444, "cone", "move");
  moveX.group.rotation.y = Math.PI / 2;
  const moveY = createAxisGizmoHandle("y", 0x22c55e, "cone", "move");
  moveY.group.rotation.x = -Math.PI / 2;
  const moveZ = createAxisGizmoHandle("z", 0x3b82f6, "cone", "move");
  moveBoxGroup.add(moveX.group, moveY.group, moveZ.group);
  boxGroup.add(moveBoxGroup);
  const movePickMeshes = [...moveX.pickMeshes, ...moveY.pickMeshes, ...moveZ.pickMeshes];

  // Centered XYZ + Uniform Scale Box Gizmo
  const scaleBoxGroup = new THREE.Group();
  scaleBoxGroup.visible = false;
  const scaleX = createAxisGizmoHandle("x", 0xef4444, "cube", "scale");
  scaleX.group.rotation.y = Math.PI / 2;
  const scaleY = createAxisGizmoHandle("y", 0x22c55e, "cube", "scale");
  scaleY.group.rotation.x = -Math.PI / 2;
  const scaleZ = createAxisGizmoHandle("z", 0x3b82f6, "cube", "scale");
  const scaleUniformGeo = new THREE.BoxGeometry(0.45, 0.45, 0.45);
  const scaleUniformMat = new THREE.MeshBasicMaterial({
    color: 0xfacc15,
    depthTest: false,
    transparent: true,
    opacity: 0.92,
  });
  const scaleUniformMesh = new THREE.Mesh(scaleUniformGeo, scaleUniformMat);
  scaleUniformMesh.userData = { sectionBoxGizmo: "scale-uniform", axis: "all" };
  scaleUniformMesh.renderOrder = 72;
  scaleBoxGroup.add(scaleX.group, scaleY.group, scaleZ.group, scaleUniformMesh);
  boxGroup.add(scaleBoxGroup);
  const scalePickMeshes = [
    ...scaleX.pickMeshes,
    ...scaleY.pickMeshes,
    ...scaleZ.pickMeshes,
    scaleUniformMesh,
  ];

  // Centered XYZ Rotate Box Gizmo (3 orthogonal full rings)
  const rotateBoxGroup = new THREE.Group();
  rotateBoxGroup.visible = false;
  const rotRingGeo = new THREE.TorusGeometry(2.0, 0.065, 12, 48);
  const rotMatX = new THREE.MeshBasicMaterial({ color: 0xef4444, depthTest: false, transparent: true, opacity: 0.9 });
  const rotMatY = new THREE.MeshBasicMaterial({ color: 0x22c55e, depthTest: false, transparent: true, opacity: 0.9 });
  const rotMatZ = new THREE.MeshBasicMaterial({ color: 0x3b82f6, depthTest: false, transparent: true, opacity: 0.9 });

  const rotRingX = new THREE.Mesh(rotRingGeo, rotMatX);
  rotRingX.rotation.y = Math.PI / 2;
  rotRingX.userData = { sectionBoxGizmo: "rotate-x", axis: "x" };
  rotRingX.renderOrder = 70;

  const rotRingY = new THREE.Mesh(rotRingGeo, rotMatY);
  rotRingY.rotation.x = Math.PI / 2;
  rotRingY.userData = { sectionBoxGizmo: "rotate-y", axis: "y" };
  rotRingY.renderOrder = 70;

  const rotRingZ = new THREE.Mesh(rotRingGeo, rotMatZ);
  rotRingZ.userData = { sectionBoxGizmo: "rotate-z", axis: "z" };
  rotRingZ.renderOrder = 70;

  rotateBoxGroup.add(rotRingX, rotRingY, rotRingZ);
  boxGroup.add(rotateBoxGroup);
  const rotatePickMeshes = [rotRingX, rotRingY, rotRingZ];

  // =========================================================================
  // 2. Revizto 5 Section Plane 3D Gizmo (Compact Suction Cup + Stem + Push/Pull)
  // =========================================================================
  const planeGizmoGroup = new THREE.Group();
  planeGizmoGroup.name = "ReviztoSectionPlaneGizmo";
  planeGizmoGroup.visible = false;
  planeGizmoGroup.renderOrder = 61;

  // Large translucent blue cut plane (hidden when idle; visible ONLY while using the Section cup)
  const planeQuadGeo = new THREE.PlaneGeometry(1, 1);
  const planeQuadMat = new THREE.MeshBasicMaterial({
    color: 0x3b82f6,
    transparent: true,
    opacity: 0.16,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const planeQuadMesh = new THREE.Mesh(planeQuadGeo, planeQuadMat);
  planeQuadMesh.visible = false;
  planeQuadMesh.renderOrder = 59;
  planeGizmoGroup.add(planeQuadMesh);

  const planeBorderVerts = new Float32Array([
    -0.5, -0.5, 0,  0.5, -0.5, 0,
     0.5, -0.5, 0,  0.5,  0.5, 0,
     0.5,  0.5, 0, -0.5,  0.5, 0,
    -0.5,  0.5, 0, -0.5, -0.5, 0,
  ]);
  const planeBorderGeo = new THREE.BufferGeometry();
  planeBorderGeo.setAttribute("position", new THREE.BufferAttribute(planeBorderVerts, 3));
  const planeBorderMat = new THREE.LineBasicMaterial({
    color: 0x2563eb,
    depthTest: false,
    transparent: true,
    opacity: 0.85,
  });
  const planeBorderLines = new THREE.LineSegments(planeBorderGeo, planeBorderMat);
  planeBorderLines.frustumCulled = false;
  planeBorderLines.renderOrder = 63;
  planeQuadMesh.add(planeBorderLines);

  // Handle assembly anchored at `activePlaneOrigin`
  const planeHandleRoot = new THREE.Group();
  planeGizmoGroup.add(planeHandleRoot);

  const plungerMat = new THREE.MeshBasicMaterial({
    color: 0x22c55e, // Revizto green when idle, blue (#3b82f6) when hovered/dragging
    depthTest: false,
    transparent: true,
    opacity: 0.96,
  });

  // 1. Compact Suction-Cup Base Cone resting flat on the plane (drag across any face to align parallel)
  const baseCupGeo = new THREE.ConeGeometry(0.36, 0.34, 24);
  baseCupGeo.rotateX(Math.PI / 2);
  baseCupGeo.translate(0, 0, 0.17);
  const baseCupMesh = new THREE.Mesh(baseCupGeo, plungerMat);
  baseCupMesh.userData = { sectionPlaneAction: "align-base" };
  baseCupMesh.renderOrder = 68;
  planeHandleRoot.add(baseCupMesh);

  // 2. Long thin stem rising perpendicular from the suction cup
  const stemGeo = new THREE.CylinderGeometry(0.032, 0.032, 2.9, 12);
  stemGeo.rotateX(Math.PI / 2);
  stemGeo.translate(0, 0, 1.72);
  const stemMesh = new THREE.Mesh(stemGeo, plungerMat);
  stemMesh.userData = { sectionPlaneAction: "slide" };
  stemMesh.renderOrder = 67;
  planeHandleRoot.add(stemMesh);

  // 3. Top Push/Pull Cluster: [Inward Cone] - [Sphere] - [Outward Cone]
  const coneInGeo = new THREE.ConeGeometry(0.22, 0.32, 20);
  coneInGeo.rotateX(-Math.PI / 2);
  coneInGeo.translate(0, 0, 3.06);
  const coneInMesh = new THREE.Mesh(coneInGeo, plungerMat);
  coneInMesh.userData = { sectionPlaneAction: "slide" };
  coneInMesh.renderOrder = 68;
  planeHandleRoot.add(coneInMesh);

  const sphereGripGeo = new THREE.SphereGeometry(0.15, 16, 12);
  sphereGripGeo.translate(0, 0, 3.38);
  const sphereGripMesh = new THREE.Mesh(sphereGripGeo, plungerMat);
  sphereGripMesh.userData = { sectionPlaneAction: "slide" };
  sphereGripMesh.renderOrder = 68;
  planeHandleRoot.add(sphereGripMesh);

  const coneOutGeo = new THREE.ConeGeometry(0.22, 0.32, 20);
  coneOutGeo.rotateX(Math.PI / 2);
  coneOutGeo.translate(0, 0, 3.70);
  const coneOutMesh = new THREE.Mesh(coneOutGeo, plungerMat);
  coneOutMesh.userData = { sectionPlaneAction: "slide" };
  coneOutMesh.renderOrder = 68;
  planeHandleRoot.add(coneOutMesh);

  const planePickMeshes = [
    baseCupMesh,
    stemMesh,
    coneInMesh,
    sphereGripMesh,
    coneOutMesh,
  ];

  // Suction-Cup Surface Placement Preview (when `New` is clicked)
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
  const suctionRingGeo = new THREE.RingGeometry(0.92, 1.06, 32);
  const suctionRingMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.94,
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
  let hoveredGizmoPart = null; // e.g. 'move-x', 'scale-uniform', 'rotate-y'
  let hoveredPlaneAction = null; // 'align-base' | 'slide' | 'tiltU' | 'tiltV' | null
  let draggingState = null;
  let suctionHitValid = false;
  let suctionPickToken = 0;

  function syncGizmoVisibility() {
    const showAny = open && gizmoVisible;
    boxGroup.visible = showAny && mode === "box" && boxPlaneIds.size > 0;
    planeGizmoGroup.visible = showAny && mode === "plane" && customPlaneIds.length > 0 && !surfacePickPending;
    suctionPreviewGroup.visible = open && surfacePickPending && suctionHitValid;

    moveBoxGroup.visible = boxGroup.visible && boxMode === "move-box";
    scaleBoxGroup.visible = boxGroup.visible && boxMode === "scale-box";
    rotateBoxGroup.visible = boxGroup.visible && boxMode === "rotate-box";

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
    if (draggingState?.type !== "plane-align-base") {
      const targetId = lastPlaneId || customPlaneIds[customPlaneIds.length - 1];
      const simplePlane = rawClipper?.list?.get(targetId);
      if (simplePlane?.normal && simplePlane?.origin) {
        activePlaneNormal.copy(simplePlane.normal).normalize();
        activePlaneOrigin.copy(simplePlane.origin);
      }
    }

    const modelCenter = modelRefBounds.getCenter(new THREE.Vector3());
    const modelSize = modelRefBounds.getSize(new THREE.Vector3());
    // Generous cutting plane span extending cleanly beyond the full model bounds
    const maxSpan = Math.max(modelSize.x, modelSize.y, modelSize.z, 12) * 3.0;

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

    // Anchor the compact suction-cup handle directly at activePlaneOrigin
    planeHandleRoot.position.copy(activePlaneOrigin);
    planeHandleRoot.quaternion.copy(quat);
    const camDist = camera?.position ? camera.position.distanceTo(activePlaneOrigin) : 14;
    const arrowScale = Math.max(0.14, Math.min(1.15, camDist * 0.038));
    planeHandleRoot.scale.setScalar(arrowScale);

    // Revizto rule: cut plane quad is ONLY visible while hovering/dragging the Section cup!
    // Green when idle (no plane shown), Blue when hovering/dragging (large translucent blue plane shown).
    const isInteracting = Boolean(
      hoveredPlaneAction || draggingState?.type?.startsWith("plane-"),
    );
    planeQuadMesh.visible = isInteracting;
    plungerMat.color.setHex(isInteracting ? 0x3b82f6 : 0x22c55e);
    planeQuadMat.opacity = draggingState?.type?.startsWith("plane-") ? 0.18 : 0.14;
  }

  function updateBoxVisuals() {
    const corners = computeObbCorners(obb);
    const edges = [
      [0, 1], [1, 2], [2, 3], [3, 0],
      [4, 5], [5, 6], [6, 7], [7, 4],
      [0, 4], [1, 5], [2, 6], [3, 7],
    ];
    const pos = wireGeo.attributes.position.array;
    let idx = 0;
    for (const [a, b] of edges) {
      pos[idx++] = corners[a].x; pos[idx++] = corners[a].y; pos[idx++] = corners[a].z;
      pos[idx++] = corners[b].x; pos[idx++] = corners[b].y; pos[idx++] = corners[b].z;
    }
    wireGeo.attributes.position.needsUpdate = true;
    wireGeo.computeBoundingSphere();

    const ux = new THREE.Vector3(1, 0, 0).applyQuaternion(obb.quaternion).normalize();
    const uy = new THREE.Vector3(0, 1, 0).applyQuaternion(obb.quaternion).normalize();
    const uz = new THREE.Vector3(0, 0, 1).applyQuaternion(obb.quaternion).normalize();

    const sx = Math.max(obb.halfExtents.x * 2, 0.02);
    const sy = Math.max(obb.halfExtents.y * 2, 0.02);
    const sz = Math.max(obb.halfExtents.z * 2, 0.02);

    const rotXNeg = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);
    const rotXPos = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    const rotYNeg = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    const rotYPos = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    const rotZNeg = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
    const rotZPos = new THREE.Quaternion();

    const faceConfig = {
      minX: { pos: obb.center.clone().addScaledVector(ux, -obb.halfExtents.x), localQuat: rotXNeg, scale: [sz, sy, 1], corners: [0, 3, 7, 4] },
      maxX: { pos: obb.center.clone().addScaledVector(ux,  obb.halfExtents.x), localQuat: rotXPos, scale: [sz, sy, 1], corners: [1, 2, 6, 5] },
      minY: { pos: obb.center.clone().addScaledVector(uy, -obb.halfExtents.y), localQuat: rotYNeg, scale: [sx, sz, 1], corners: [0, 1, 5, 4] },
      maxY: { pos: obb.center.clone().addScaledVector(uy,  obb.halfExtents.y), localQuat: rotYPos, scale: [sx, sz, 1], corners: [3, 2, 6, 7] },
      minZ: { pos: obb.center.clone().addScaledVector(uz, -obb.halfExtents.z), localQuat: rotZNeg, scale: [sx, sy, 1], corners: [0, 1, 2, 3] },
      maxZ: { pos: obb.center.clone().addScaledVector(uz,  obb.halfExtents.z), localQuat: rotZPos, scale: [sx, sy, 1], corners: [4, 5, 6, 7] },
    };

    const isMoveFaceMode = boxMode === "move-face";
    const activeKey = isMoveFaceMode ? (draggingState?.faceKey || hoveredFaceKey) : null;
    const camPos = camera?.position;

    for (const key of handleFaces) {
      const entry = faceHandles.get(key);
      const cfg = faceConfig[key];
      const worldQuat = obb.quaternion.clone().multiply(cfg.localQuat);
      const isActive = activeKey === key;

      entry.quadMesh.visible = isMoveFaceMode;
      entry.quadMesh.position.copy(cfg.pos);
      entry.quadMesh.quaternion.copy(worldQuat);
      entry.quadMesh.scale.set(cfg.scale[0], cfg.scale[1], cfg.scale[2]);
      entry.quadMat.opacity = draggingState?.faceKey === key ? 0.18 : isActive ? 0.11 : 0.0;

      // Clean subtle dot on unhovered faces in Move Face mode
      entry.dotMesh.visible = isMoveFaceMode && !isActive;
      entry.dotMesh.position.copy(cfg.pos);
      const dotDist = camPos ? camPos.distanceTo(cfg.pos) : 12;
      const dotRadius = Math.max(0.035, Math.min(0.18, dotDist * 0.007));
      entry.dotMesh.scale.setScalar(dotRadius);
    }

    // Show the clean single push/pull arrow ONLY on the hovered/dragged face
    if (isMoveFaceMode && activeKey && faceConfig[activeKey]) {
      const cfg = faceConfig[activeKey];
      const worldQuat = obb.quaternion.clone().multiply(cfg.localQuat);
      hoverFaceArrow.group.visible = true;
      hoverFaceArrow.group.position.copy(cfg.pos);
      hoverFaceArrow.group.quaternion.copy(worldQuat);
      const dist = camPos ? camPos.distanceTo(cfg.pos) : 12;
      const arrowScale = Math.max(0.14, Math.min(1.1, dist * 0.036));
      hoverFaceArrow.group.scale.setScalar(arrowScale);
      hoverFaceArrow.mat.color.setHex(draggingState?.faceKey === activeKey ? 0xfacc15 : 0x38bdf8);

      const cIdx = cfg.corners;
      const fEdges = [
        [cIdx[0], cIdx[1]], [cIdx[1], cIdx[2]], [cIdx[2], cIdx[3]], [cIdx[3], cIdx[0]],
      ];
      const fPos = activeFaceEdgeGeo.attributes.position.array;
      let fPtr = 0;
      for (const [a, b] of fEdges) {
        fPos[fPtr++] = corners[a].x; fPos[fPtr++] = corners[a].y; fPos[fPtr++] = corners[a].z;
        fPos[fPtr++] = corners[b].x; fPos[fPtr++] = corners[b].y; fPos[fPtr++] = corners[b].z;
      }
      activeFaceEdgeGeo.attributes.position.needsUpdate = true;
      activeFaceEdgeMat.color.setHex(draggingState?.faceKey ? 0xfacc15 : 0x38bdf8);
      activeFaceEdgeLines.visible = true;
    } else {
      hoverFaceArrow.group.visible = false;
      activeFaceEdgeLines.visible = false;
    }

    // Position & scale centered Move / Scale / Rotate Box gizmos
    const centerDist = camPos ? camPos.distanceTo(obb.center) : 12;
    const centerScale = Math.max(0.16, Math.min(1.4, centerDist * 0.045));
    for (const g of [moveBoxGroup, scaleBoxGroup, rotateBoxGroup]) {
      g.position.copy(obb.center);
      g.quaternion.copy(obb.quaternion);
      g.scale.setScalar(centerScale);
    }

    // Highlight hovered center gizmo axis
    const activeGizmo = draggingState?.gizmoPart || hoveredGizmoPart;
    moveX.mat.color.setHex(activeGizmo === "move-x" ? 0xfacc15 : 0xef4444);
    moveY.mat.color.setHex(activeGizmo === "move-y" ? 0xfacc15 : 0x22c55e);
    moveZ.mat.color.setHex(activeGizmo === "move-z" ? 0xfacc15 : 0x3b82f6);
    scaleX.mat.color.setHex(activeGizmo === "scale-x" ? 0xfacc15 : 0xef4444);
    scaleY.mat.color.setHex(activeGizmo === "scale-y" ? 0xfacc15 : 0x22c55e);
    scaleZ.mat.color.setHex(activeGizmo === "scale-z" ? 0xfacc15 : 0x3b82f6);
    scaleUniformMat.color.setHex(activeGizmo === "scale-uniform" ? 0xffffff : 0xfacc15);
    rotMatX.color.setHex(activeGizmo === "rotate-x" ? 0xfacc15 : 0xef4444);
    rotMatY.color.setHex(activeGizmo === "rotate-y" ? 0xfacc15 : 0x22c55e);
    rotMatZ.color.setHex(activeGizmo === "rotate-z" ? 0xfacc15 : 0x3b82f6);
  }

  function getActivePlanes() {
    if (draggingState?.type === "plane-align-base") return [];
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
    let hintText = "";
    if (open) {
      if (surfacePickPending) {
        hintText = "Section Plane: click any model surface to align cut plane (Esc to cancel)";
      } else if (mode === "plane" && customPlaneIds.length > 0) {
        hintText = "Section Plane: drag the white base pad over any face to align parallel, or drag the arrow to slide";
      } else if (mode === "box" && boxPlaneIds.size > 0) {
        if (boxMode === "move-face") hintText = "Move Face: hover any box face and drag to push/pull";
        else if (boxMode === "scale-box") hintText = "Scale Box: drag an axis cube (or center cube) to resize symmetrically";
        else if (boxMode === "move-box") hintText = "Move Box: drag an axis arrow to translate the cropping box";
        else if (boxMode === "rotate-box") hintText = "Rotate Box: drag a ring to rotate the box to angled geometry";
      }
    }

    const minArr = obb.center.clone().sub(obb.halfExtents).toArray();
    const maxArr = obb.center.clone().add(obb.halfExtents).toArray();

    return {
      open,
      active: open || cuts,
      mode,
      boxMode,
      gizmoVisible,
      handlesVisible: gizmoVisible,
      surfacePickPending,
      hasCuts: cuts,
      planeCount: customPlaneIds.length,
      boxActive: boxPlaneIds.size > 0,
      hintText,
      bounds: { min: minArr, max: maxArr },
      obb: {
        center: obb.center.toArray(),
        halfExtents: obb.halfExtents.toArray(),
        quaternion: obb.quaternion.toArray(),
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
      hoveredGizmoPart = null;
      hoveredPlaneAction = null;
      if (draggingState) {
        draggingState = null;
        stopBaseSmoothing();
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
        if (hasSel) await boxer.addFromModelIdMap(sel);
        else boxer.addFromModels();
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

  function applyObbFromBox3(box) {
    box.getCenter(obb.center);
    const size = box.getSize(new THREE.Vector3());
    obb.halfExtents.set(
      Math.max(MIN_HALF_EXTENT, size.x * 0.5),
      Math.max(MIN_HALF_EXTENT, size.y * 0.5),
      Math.max(MIN_HALF_EXTENT, size.z * 0.5),
    );
    obb.quaternion.identity();
  }

  function applyBoxPlanesToClipper() {
    if (!rawClipper || !world) return;
    rawClipper.enabled = true;
    const specs = computeObbPlaneSpecs(obb);
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

  function applyActivePlaneToClipper({ syncMaterials = true } = {}) {
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
    if (syncMaterials) {
      syncExternalClippedMaterials();
    }
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
    hoveredGizmoPart = null;
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
    applyObbFromBox3(bounds);
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

  const onControlsUpdate = () => {
    if (boxGroup.visible) updateBoxVisuals();
    if (planeGizmoGroup.visible) updatePlaneGizmoVisuals();
  };
  try {
    controls?.addEventListener?.("update", onControlsUpdate);
  } catch { /* headless */ }

  // =========================================================================
  // 3. Interactive Raycasting & Dragging
  // =========================================================================
  const dragRaycaster = new THREE.Raycaster();

  function pickBoxFace(ndc) {
    if (!boxGroup.visible || boxMode !== "move-face" || !camera || !ndc) return null;
    dragRaycaster.setFromCamera(ndc, camera);
    const arrowHits = hoverFaceArrow.group.visible
      ? dragRaycaster.intersectObjects(hoverFaceArrow.pickMeshes, false)
      : [];
    if (arrowHits.length > 0 && hoveredFaceKey) return hoveredFaceKey;
    const hits = dragRaycaster.intersectObjects(facePickMeshes, false);
    if (hits.length === 0) return null;
    const dotHit = hits.find((h) => h.object.userData?.isFaceDot);
    const best = dotHit || hits[0];
    return best.object.userData?.sectionFaceKey || null;
  }

  function pickCenterBoxGizmo(ndc) {
    if (!boxGroup.visible || boxMode === "move-face" || !camera || !ndc) return null;
    dragRaycaster.setFromCamera(ndc, camera);
    const list =
      boxMode === "move-box"
        ? movePickMeshes
        : boxMode === "scale-box"
          ? scalePickMeshes
          : rotatePickMeshes;
    const hits = dragRaycaster.intersectObjects(list, false);
    if (hits.length === 0) return null;
    return hits[0].object.userData?.sectionBoxGizmo || null;
  }

  function pickPlaneGizmoAction(ndc) {
    if (!planeGizmoGroup.visible || !camera || !ndc) return null;
    dragRaycaster.setFromCamera(ndc, camera);
    const hits = dragRaycaster.intersectObjects(planePickMeshes, false);
    if (hits.length === 0) return null;
    const priorityHit = hits.find((h) => h.object !== planeQuadMesh) || hits[0];
    return priorityHit.object.userData?.sectionPlaneAction || null;
  }

  function buildAxisDragPlane(axisDir, anchorPos) {
    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    const tangent = new THREE.Vector3().crossVectors(camDir, axisDir);
    let planeNormal = new THREE.Vector3().crossVectors(axisDir, tangent);
    if (planeNormal.lengthSq() < 1e-6) planeNormal.copy(camDir);
    planeNormal.normalize();
    return new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, anchorPos);
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
        suctionPreviewGroup.scale.setScalar(Math.max(0.15, Math.min(1.2, dist * 0.04)));
        suctionHitValid = true;
        syncGizmoVisibility();
      })
      .catch(() => {});
  }

  let basePickInFlight = false;
  let pendingBaseNdc = null;
  let baseRafId = null;
  let hasBaseTarget = false;
  const targetBaseOrigin = new THREE.Vector3();
  const targetBaseNormal = new THREE.Vector3(0, -1, 0);
  const _unitZ = new THREE.Vector3(0, 0, 1);
  const _qCur = new THREE.Quaternion();
  const _qTarget = new THREE.Quaternion();

  function stopBaseSmoothing() {
    if (baseRafId !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(baseRafId);
    }
    baseRafId = null;
    pendingBaseNdc = null;
  }

  function stepBaseSmoothing() {
    if (!draggingState || draggingState.type !== "plane-align-base") {
      baseRafId = null;
      return;
    }
    if (hasBaseTarget) {
      activePlaneOrigin.lerp(targetBaseOrigin, 0.38);
      _qCur.setFromUnitVectors(_unitZ, activePlaneNormal);
      _qTarget.setFromUnitVectors(_unitZ, targetBaseNormal);
      _qCur.slerp(_qTarget, 0.38);
      activePlaneNormal.copy(_unitZ).applyQuaternion(_qCur).normalize();
      // Only move the 3D gizmo + preview plane while dragging; cutting activates on mouse release
      updatePlaneGizmoVisuals();
    }
    if (typeof requestAnimationFrame === "function") {
      baseRafId = requestAnimationFrame(stepBaseSmoothing);
    }
  }

  async function drainBasePickQueue() {
    if (basePickInFlight || !pick) return;
    basePickInFlight = true;
    try {
      while (pendingBaseNdc && draggingState?.type === "plane-align-base") {
        const nextNdc = pendingBaseNdc;
        pendingBaseNdc = null;
        const hit = await pick(nextNdc, { snap: false });
        if (!draggingState || draggingState.type !== "plane-align-base") break;
        if (!hit?.point) continue;

        const nextNorm = hit.normal ? hit.normal.clone() : targetBaseNormal.clone();
        if (camera) {
          const toCam = camera.position.clone().sub(hit.point);
          if (nextNorm.dot(toCam) > 0) nextNorm.negate();
        }
        nextNorm.normalize();
        targetBaseOrigin.copy(hit.point);
        targetBaseNormal.copy(nextNorm);
        hasBaseTarget = true;
      }
    } catch {
      /* noop */
    } finally {
      basePickInFlight = false;
      if (pendingBaseNdc && draggingState?.type === "plane-align-base") {
        void drainBasePickQueue();
      }
    }
  }

  function alignPlaneBaseToNdc(ndc) {
    if (!pick || !ndc) return;
    pendingBaseNdc = ndc.clone ? ndc.clone() : new THREE.Vector2(ndc.x, ndc.y);
    if (baseRafId === null && typeof requestAnimationFrame === "function") {
      baseRafId = requestAnimationFrame(stepBaseSmoothing);
    }
    void drainBasePickQueue();
  }

  function handlePointerMove(ndc) {
    if (!open || !camera || !ndc) return false;

    if (surfacePickPending) {
      updateSuctionPreview(ndc);
      return true;
    }

    if (draggingState) {
      // Suction-cup base drag: continuously raycast geometry under cursor and align parallel!
      if (draggingState.type === "plane-align-base") {
        alignPlaneBaseToNdc(ndc);
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

      if (draggingState.type === "obb-rotate") {
        const deltaNdc = (ndc.x - draggingState.startNdc.x) + (ndc.y - draggingState.startNdc.y);
        const angleRad = deltaNdc * Math.PI * 0.85;
        const rotQuat = new THREE.Quaternion().setFromAxisAngle(draggingState.rotAxis, angleRad);
        obb.quaternion.copy(rotQuat).multiply(draggingState.startQuat).normalize();
        applyBoxPlanesToClipper();
        notify();
        return true;
      }

      if (draggingState.type === "obb-scale-uniform") {
        const deltaNdc = (ndc.x - draggingState.startNdc.x) + (ndc.y - draggingState.startNdc.y);
        const factor = Math.max(0.15, 1 + deltaNdc * 1.4);
        obb.halfExtents.set(
          Math.max(MIN_HALF_EXTENT, draggingState.startHalfExtents.x * factor),
          Math.max(MIN_HALF_EXTENT, draggingState.startHalfExtents.y * factor),
          Math.max(MIN_HALF_EXTENT, draggingState.startHalfExtents.z * factor),
        );
        applyBoxPlanesToClipper();
        notify();
        return true;
      }

      dragRaycaster.setFromCamera(ndc, camera);
      const hitPoint = new THREE.Vector3();
      if (!dragRaycaster.ray.intersectPlane(draggingState.dragPlane, hitPoint)) {
        return true;
      }

      if (draggingState.type === "obb-face") {
        const deltaVec = hitPoint.clone().sub(draggingState.startHit);
        const signedDelta = deltaVec.dot(draggingState.axisDir);
        const rawNewHalf = draggingState.startHalf + draggingState.sign * signedDelta * 0.5;
        const nextHalf = Math.max(MIN_HALF_EXTENT, rawNewHalf);
        const actualDeltaHalf = nextHalf - draggingState.startHalf;
        obb.halfExtents[draggingState.axis] = nextHalf;
        obb.center
          .copy(draggingState.startCenter)
          .addScaledVector(draggingState.axisDir, draggingState.sign * actualDeltaHalf);
        applyBoxPlanesToClipper();
        notify();
        return true;
      }

      if (draggingState.type === "obb-move") {
        const deltaVec = hitPoint.clone().sub(draggingState.startHit);
        const signedDelta = deltaVec.dot(draggingState.axisDir);
        obb.center.copy(draggingState.startCenter).addScaledVector(draggingState.axisDir, signedDelta);
        applyBoxPlanesToClipper();
        notify();
        return true;
      }

      if (draggingState.type === "obb-scale-axis") {
        const deltaVec = hitPoint.clone().sub(draggingState.startHit);
        const signedDelta = deltaVec.dot(draggingState.axisDir);
        obb.halfExtents[draggingState.axis] = Math.max(
          MIN_HALF_EXTENT,
          draggingState.startHalf + signedDelta,
        );
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
    }

    if (mode === "box" && boxGroup.visible) {
      if (boxMode === "move-face") {
        const nextHover = pickBoxFace(ndc);
        if (nextHover !== hoveredFaceKey) {
          hoveredFaceKey = nextHover;
          updateBoxVisuals();
        }
        return Boolean(hoveredFaceKey);
      } else {
        const nextPart = pickCenterBoxGizmo(ndc);
        if (nextPart !== hoveredGizmoPart) {
          hoveredGizmoPart = nextPart;
          updateBoxVisuals();
        }
        return Boolean(hoveredGizmoPart);
      }
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
    if (surfacePickPending) return false;

    if (mode === "box" && boxGroup.visible) {
      if (boxMode === "move-face") {
        const faceKey = pickBoxFace(ndc);
        if (!faceKey) return false;
        const axis = faceKey.slice(-1).toLowerCase(); // x | y | z
        const sign = faceKey.startsWith("min") ? -1 : 1;
        const unit = new THREE.Vector3(axis === "x" ? 1 : 0, axis === "y" ? 1 : 0, axis === "z" ? 1 : 0);
        const axisDir = unit.applyQuaternion(obb.quaternion).normalize();
        const anchor = obb.center.clone().addScaledVector(axisDir, sign * obb.halfExtents[axis]);
        const dragPlane = buildAxisDragPlane(axisDir, anchor);
        dragRaycaster.setFromCamera(ndc, camera);
        const startHit = new THREE.Vector3();
        if (!dragRaycaster.ray.intersectPlane(dragPlane, startHit)) return false;

        draggingState = {
          type: "obb-face",
          faceKey,
          axis,
          sign,
          axisDir,
          dragPlane,
          startHit,
          startHalf: obb.halfExtents[axis],
          startCenter: obb.center.clone(),
        };
        if (controls) controls.enabled = false;
        notifyDragging(true);
        updateBoxVisuals();
        return true;
      }

      const gizmoPart = pickCenterBoxGizmo(ndc);
      if (!gizmoPart) return false;

      if (gizmoPart === "scale-uniform") {
        draggingState = {
          type: "obb-scale-uniform",
          gizmoPart,
          startNdc: { x: ndc.x, y: ndc.y },
          startHalfExtents: obb.halfExtents.clone(),
        };
      } else if (gizmoPart.startsWith("rotate-")) {
        const axis = gizmoPart.split("-")[1];
        const unit = new THREE.Vector3(axis === "x" ? 1 : 0, axis === "y" ? 1 : 0, axis === "z" ? 1 : 0);
        const rotAxis = unit.applyQuaternion(obb.quaternion).normalize();
        draggingState = {
          type: "obb-rotate",
          gizmoPart,
          rotAxis,
          startNdc: { x: ndc.x, y: ndc.y },
          startQuat: obb.quaternion.clone(),
        };
      } else if (gizmoPart.startsWith("move-") || gizmoPart.startsWith("scale-")) {
        const [op, axis] = gizmoPart.split("-");
        const unit = new THREE.Vector3(axis === "x" ? 1 : 0, axis === "y" ? 1 : 0, axis === "z" ? 1 : 0);
        const axisDir = unit.applyQuaternion(obb.quaternion).normalize();
        const dragPlane = buildAxisDragPlane(axisDir, obb.center);
        dragRaycaster.setFromCamera(ndc, camera);
        const startHit = new THREE.Vector3();
        if (!dragRaycaster.ray.intersectPlane(dragPlane, startHit)) return false;

        draggingState = {
          type: op === "move" ? "obb-move" : "obb-scale-axis",
          gizmoPart,
          axis,
          axisDir,
          dragPlane,
          startHit,
          startCenter: obb.center.clone(),
          startHalf: obb.halfExtents[axis],
        };
      }

      if (draggingState) {
        if (controls) controls.enabled = false;
        notifyDragging(true);
        updateBoxVisuals();
        return true;
      }
    }

    if (mode === "plane" && planeGizmoGroup.visible) {
      const action = pickPlaneGizmoAction(ndc);
      if (!action) return false;

      if (action === "align-base") {
        draggingState = { type: "plane-align-base" };
        hasBaseTarget = false;
        targetBaseOrigin.copy(activePlaneOrigin);
        targetBaseNormal.copy(activePlaneNormal);
        // Temporarily suspend clipping while aiming the Section-Cup so the full model is visible & raycastable
        if (rawClipper) rawClipper.enabled = false;
        syncExternalClippedMaterials();
        if (controls) controls.enabled = false;
        notifyDragging(true);
        updatePlaneGizmoVisuals();
        return true;
      }

      if (action === "slide") {
        const dragPlane = buildAxisDragPlane(activePlaneNormal, activePlaneOrigin);
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
        const quat = planeHandleRoot.quaternion.clone();
        const rotAxis = action === "tiltU"
          ? new THREE.Vector3(1, 0, 0).applyQuaternion(quat).normalize()
          : new THREE.Vector3(0, 1, 0).applyQuaternion(quat).normalize();
        draggingState = {
          type: `plane-${action}`,
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
    const wasBaseAlign = draggingState.type === "plane-align-base";
    draggingState = null;
    stopBaseSmoothing();
    if (wasBaseAlign) {
      if (rawClipper) rawClipper.enabled = true;
      if (hasBaseTarget) {
        activePlaneOrigin.copy(targetBaseOrigin);
        activePlaneNormal.copy(targetBaseNormal);
        hasBaseTarget = false;
      }
      applyActivePlaneToClipper({ syncMaterials: true });
      notify();
    }
    if (controls) controls.enabled = true;
    notifyDragging(false);
    if (boxGroup.visible) updateBoxVisuals();
    if (planeGizmoGroup.visible) updatePlaneGizmoVisuals();
    return true;
  }

  return {
    get active() { return open; },
    get mode() { return mode; },
    get boxMode() { return boxMode; },

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

    setBoxMode(nextBoxMode) {
      if (!SECTION_BOX_MODES.includes(nextBoxMode)) return getState();
      boxMode = nextBoxMode;
      hoveredFaceKey = null;
      hoveredGizmoPart = null;
      if (boxGroup.visible) updateBoxVisuals();
      notify();
      return getState();
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
      return Boolean(hoveredFaceKey || hoveredGizmoPart || hoveredPlaneAction || surfacePickPending);
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
      if (hasActiveCut() || open) this.uncut();
      else await this.activate(preferredMode || mode);
      return getState();
    },

    async newCut(targetMap = null) {
      setOpenInternal(true);
      if (mode === "box") {
        await activateBox(targetMap);
      } else if (pick && world?.renderer?.three) {
        this.startSurfaceCut();
      } else {
        const bounds = await computeTargetBounds(targetMap, 0);
        const center = bounds.getCenter(new THREE.Vector3());
        await addPlane(new THREE.Vector3(0, -1, 0), center);
      }
      return getState();
    },

    async cutPreset(dir = "top") {
      setOpenInternal(true);
      const normal = PRESET_NORMALS[dir] || PRESET_NORMALS.top;
      const bounds = await computeTargetBounds(null, 0);
      const center = bounds.getCenter(new THREE.Vector3());
      if (mode === "box") await activatePlane();
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
      const padded = box.clone().expandByScalar(0.15);
      modelRefBounds.copy(padded);
      applyObbFromBox3(padded);
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
        if (normal.dot(toCam) > 0) normal.negate();
      }
      mode = "plane";
      setOpenInternal(true);
      return await addPlane(normal, hit.point);
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
      stopBaseSmoothing();
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
      dotGeo.dispose();
      hoverFaceArrow.dispose();
      for (const e of faceHandles.values()) {
        e.dotMat.dispose();
        e.quadMat.dispose();
      }
      moveX.dispose(); moveY.dispose(); moveZ.dispose();
      scaleX.dispose(); scaleY.dispose(); scaleZ.dispose();
      scaleUniformGeo.dispose(); scaleUniformMat.dispose();
      rotRingGeo.dispose(); rotMatX.dispose(); rotMatY.dispose(); rotMatZ.dispose();
      planeQuadGeo.dispose(); planeQuadMat.dispose();
      planeBorderGeo.dispose(); planeBorderMat.dispose();
      plungerMat.dispose();
      baseCupGeo.dispose();
      stemGeo.dispose();
      coneInGeo.dispose();
      sphereGripGeo.dispose();
      coneOutGeo.dispose();
      suctionDiscGeo.dispose(); suctionDiscMat.dispose();
      suctionRingGeo.dispose(); suctionRingMat.dispose();
      suctionNormArrow.dispose();
      stateListeners.clear();
      dragListeners.clear();
    },
  };
}
