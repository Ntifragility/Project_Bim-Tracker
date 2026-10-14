// 3D Drawing Tool & Revit-Style Routing Engine for Conduit Takeoff.
//
// Key Revit MEP mechanics implemented:
// 1. Active Middle Elevation Work Plane (default 2.80 m / configurable).
// 2. Auto-Riser Generation: changing elevation offset mid-run automatically inserts
//    a vertical transition riser between the two heights.
// 3. Eyedropper Elevation Sampling: click any IFC beam, slab, or tray to set height.
// 4. Dynamic Work Plane visual grid sliding with the current elevation offset.
// 5. 3-Axis Orthogonal Snapping (X, Y [riser], Z).
// 6. Continuous conduit bodies at the selected trade diameter, with round joints.

import * as THREE from 'three';
import {
  addNode,
  startRun,
  appendToRun,
  deleteRun,
  nodeById,
} from '@conduit-core';

export function createDrawingTool({ engine, commandStack, diameterRegistry, onStateChange, viewport, surfacePicker }) {
  const scene = engine.world.scene.three;
  const overlayGroup = new THREE.Group();
  overlayGroup.name = 'ConduitTakeoffOverlay';
  scene.add(overlayGroup);

  // Group for completed runs
  const completedRunsGroup = new THREE.Group();
  completedRunsGroup.name = 'CompletedRuns';
  overlayGroup.add(completedRunsGroup);

  // Group for active in-progress run
  const activeRunGroup = new THREE.Group();
  activeRunGroup.name = 'ActiveRun';
  overlayGroup.add(activeRunGroup);

  // Revit Work Plane Visual Grid
  const workPlaneGrid = new THREE.GridHelper(50, 50, 0x6366f1, 0x1e293b);
  workPlaneGrid.name = 'RevitWorkPlaneGrid';
  workPlaneGrid.position.y = 2.8;
  workPlaneGrid.material.opacity = 0.35;
  workPlaneGrid.material.transparent = true;
  workPlaneGrid.renderOrder = 50;
  overlayGroup.add(workPlaneGrid);

  // Snap Indicator Dot
  const snapDotGeo = new THREE.SphereGeometry(0.045, 16, 16);
  const snapDotMat = new THREE.MeshBasicMaterial({
    color: 0x00ffff,
    depthTest: false,
    transparent: true,
    opacity: 0.95,
  });
  const snapDot = new THREE.Mesh(snapDotGeo, snapDotMat);
  snapDot.renderOrder = 1000;
  snapDot.visible = false;
  overlayGroup.add(snapDot);

  // Small square on the face under the cursor, in the Revizto style.
  const surfaceMarker = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      color: 0x7dffb3,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
      depthTest: false,
    }),
  );
  const surfaceMarkerEdge = new THREE.LineSegments(
    new THREE.EdgesGeometry(surfaceMarker.geometry),
    new THREE.LineBasicMaterial({ color: 0xf8fffb, depthTest: false }),
  );
  surfaceMarker.add(surfaceMarkerEdge);
  surfaceMarker.renderOrder = 1001;
  surfaceMarker.visible = false;
  overlayGroup.add(surfaceMarker);

  // Navisworks pivot: a gold bead and a camera-facing ring, about 22px across.
  // Drawn on top so it stays visible when the orbit center sits inside a solid.
  const pivotMarker = new THREE.Group();
  pivotMarker.name = 'NavisOrbitPivot';
  pivotMarker.visible = false;
  const pivotBead = new THREE.Mesh(
    new THREE.SphereGeometry(0.45, 20, 14),
    new THREE.MeshBasicMaterial({ color: 0xf5c518, depthTest: false }),
  );
  const pivotCore = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xfff6d0, depthTest: false }),
  );
  const pivotRing = new THREE.Mesh(
    new THREE.RingGeometry(0.78, 1, 48),
    new THREE.MeshBasicMaterial({
      color: 0xf6c445,
      depthTest: false,
      side: THREE.DoubleSide,
    }),
  );
  const pivotRingShade = new THREE.Mesh(
    new THREE.RingGeometry(1, 1.28, 48),
    new THREE.MeshBasicMaterial({
      color: 0x140e04,
      depthTest: false,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
    }),
  );
  pivotBead.renderOrder = 1003;
  pivotCore.renderOrder = 1004;
  pivotRing.renderOrder = 1003;
  pivotRingShade.renderOrder = 1002;
  pivotMarker.add(pivotRingShade, pivotRing, pivotBead, pivotCore);
  overlayGroup.add(pivotMarker);
  let pivotToken = 0;
  let lockedPivot = null;
  let selectionToken = 0;
  let selectionPivotBound = false;

  const markerNormal = new THREE.Vector3();
  const markerAxis = new THREE.Vector3(0, 0, 1);
  const markerToCamera = new THREE.Vector3();

  // Live Rubberband line
  const rubberbandGeo = new THREE.BufferGeometry();
  rubberbandGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const rubberbandMat = new THREE.LineBasicMaterial({
    color: 0xf59e0b,
    linewidth: 3,
    depthTest: false,
    transparent: true,
    opacity: 0.9,
  });
  const rubberbandLine = new THREE.Line(rubberbandGeo, rubberbandMat);
  rubberbandLine.renderOrder = 999;
  rubberbandLine.visible = false;
  overlayGroup.add(rubberbandLine);

  // Vertical Guide Line
  const vertGuideGeo = new THREE.BufferGeometry();
  vertGuideGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const vertGuideMat = new THREE.LineBasicMaterial({
    color: 0x00e5ff,
    linewidth: 2,
    depthTest: false,
    transparent: true,
    opacity: 0.7,
  });
  const vertGuideLine = new THREE.Line(vertGuideGeo, vertGuideMat);
  vertGuideLine.renderOrder = 998;
  vertGuideLine.visible = false;
  overlayGroup.add(vertGuideLine);

  // Routing State
  let isDrawingMode = false;
  let isOrthoActive = false;
  let isPerpendicularActive = false;
  let isPickElevationActive = false;
  let autoRiserEnabled = true;
  let activeElevation = 2.8; // Metres above 0
  let activeRunPoints = []; // [{ x, y, z }]
  let currentCursorPoint = null; // { x, y, z }
  let cursorOnSurface = false;
  let lastNdc = new THREE.Vector2();
  let lastScreenPos = { x: 0, y: 0 };
  let selectedRunId = null;

  function syncViewportMode() {
    const mode = isPickElevationActive ? 'pick-elevation' : (isDrawingMode ? 'drawing' : 'navigate');
    const allowHighlight = viewport.setMode(mode);
    surfacePicker.applyHighlightPolicy(allowHighlight);
    bindSelectionPivot();
  }

  function cameraView() {
    const canvas = engine.world.renderer.three.domElement;
    const distance = Number(engine.world.camera.controls?.distance);
    return {
      distance: Number.isFinite(distance) && distance > 0 ? distance : 10,
      viewportHeight: canvas?.clientHeight || 1,
    };
  }

  function getCanvasNdc(event) {
    const canvas = engine.world.renderer.three.domElement;
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    return new THREE.Vector2(x, y);
  }

  // Intersect camera ray with the active horizontal work plane (Y = activeElevation)
  function raycastWorkPlane(ndc, elevationY = activeElevation) {
    const camera = engine.world.camera.three;
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -elevationY);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, camera);
    const hitPoint = new THREE.Vector3();
    const hit = raycaster.ray.intersectPlane(plane, hitPoint);
    if (hit) return { x: hitPoint.x, y: elevationY, z: hitPoint.z };

    // Navisworks Orbit Fallback: if viewing horizontally or upwards where the ray doesn't intersect
    // the infinite plane, project along camera ray at camera-to-target distance so line doesn't vanish
    if (activeRunPoints.length > 0) {
      const lastPt = activeRunPoints[activeRunPoints.length - 1];
      const dist = Math.max(5, camera.position.distanceTo(new THREE.Vector3(lastPt.x, lastPt.y, lastPt.z)));
      const pt = raycaster.ray.origin.clone().add(raycaster.ray.direction.clone().multiplyScalar(dist));
      return { x: pt.x, y: elevationY, z: pt.z };
    }

    return null;
  }

  // The pipe end is the surface under the cursor. Empty space stays on the elevation plane.
  async function pointUnderCursor(ndc) {
    const hit = await surfacePicker.sample(ndc);
    if (hit?.point) {
      return { x: hit.point.x, y: hit.point.y, z: hit.point.z, onSurface: true };
    }
    const planePoint = raycastWorkPlane(ndc, activeElevation);
    return planePoint ? { ...planePoint, onSurface: false } : null;
  }

  function showSurfaceMarker(surface) {
    if (!surface?.point) {
      surfaceMarker.visible = false;
      return;
    }
    const point = surface.point;
    surfaceMarker.position.set(point.x, point.y, point.z);
    if (surface.normal?.lengthSq?.() > 0) {
      markerNormal.copy(surface.normal);
    } else {
      markerNormal.set(0, 1, 0);
    }
    markerToCamera.copy(engine.world.camera.three.position).sub(surfaceMarker.position);
    if (markerNormal.dot(markerToCamera) < 0) markerNormal.negate();
    markerNormal.normalize();
    surfaceMarker.position.addScaledVector(markerNormal, 0.012);
    surfaceMarker.quaternion.setFromUnitVectors(markerAxis, markerNormal);
    const distance = engine.world.camera.three.position.distanceTo(surfaceMarker.position);
    const size = Math.min(0.45, Math.max(0.06, distance * 0.035));
    surfaceMarker.scale.setScalar(size);
    surfaceMarker.visible = true;
  }

  function adoptSurfaceElevation(point) {
    if (!point?.onSurface) return;
    activeElevation = Number(point.y.toFixed(3));
    workPlaneGrid.position.y = activeElevation;
  }

  // 3-Axis Orthogonal constraint in Three.js space
  function constrainOrtho3D(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    const absZ = Math.abs(dz);
    const max = Math.max(absX, absY, absZ);

    if (max === absY) {
      return { x: from.x, y: to.y, z: from.z, axis: 'Y' };
    } else if (max === absX) {
      return { x: to.x, y: from.y, z: from.z, axis: 'X' };
    } else {
      return { x: from.x, y: from.y, z: to.z, axis: 'Z' };
    }
  }

  // Project cursor ray onto vertical plane through lastPt
  function getVerticalProjectionPoint(lastPt, ndc) {
    const camera = engine.world.camera.three;
    const camPos = camera.position;

    const normal = new THREE.Vector3(camPos.x - lastPt.x, 0, camPos.z - lastPt.z);
    if (normal.lengthSq() > 0.0001) normal.normalize();
    else normal.set(0, 0, 1);

    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      normal,
      new THREE.Vector3(lastPt.x, lastPt.y, lastPt.z)
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, camera);
    const planeHit = new THREE.Vector3();
    const intersects = raycaster.ray.intersectPlane(plane, planeHit);

    const targetY = intersects ? planeHit.y : (currentCursorPoint?.y ?? lastPt.y);
    return { x: lastPt.x, y: targetY, z: lastPt.z };
  }

  function tradeRadiusM(sizeLabel) {
    const entry = sizeLabel ? diameterRegistry.getByLabel(sizeLabel) : diameterRegistry.getSelected();
    const mm = Number(entry?.mm);
    return ((mm > 0 ? mm : 19.05) / 1000) / 2;
  }

  function conduitMaterial(colorHex, selected) {
    const color = new THREE.Color(colorHex);
    const material = new THREE.MeshPhongMaterial({
      color,
      shininess: 80,
      specular: new THREE.Color('#ffffff'),
      emissive: color,
      emissiveIntensity: selected ? 0.45 : 0.08,
    });
    material.polygonOffset = true;
    material.polygonOffsetFactor = -2;
    material.polygonOffsetUnits = -2;
    return material;
  }

  function createJoint(point, radius, colorHex, selected) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 20, 14),
      conduitMaterial(colorHex, selected),
    );
    mesh.position.set(point.x, point.y, point.z);
    return mesh;
  }

  // Round tube between two points. opacity < 1 is the live preview.
  function createCylinderSegment(p1, p2, radius, colorHex, selected = false, opacity = 1) {
    const v1 = new THREE.Vector3(p1.x, p1.y, p1.z);
    const v2 = new THREE.Vector3(p2.x, p2.y, p2.z);
    const dist = v1.distanceTo(v2);
    if (dist < 0.001) return null;

    const cylGeo = new THREE.CylinderGeometry(radius, radius, dist, 20);
    const cylMat = conduitMaterial(colorHex, selected);
    if (opacity < 1) {
      cylMat.transparent = true;
      cylMat.opacity = opacity;
      cylMat.depthWrite = false;
    }
    const mesh = new THREE.Mesh(cylGeo, cylMat);
    mesh.position.copy(v1).add(v2).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v2.clone().sub(v1).normalize());
    mesh.renderOrder = opacity < 1 ? 940 : 950;
    return mesh;
  }

  // Update visual representation of the active in-progress run
  function updateActiveRunVisuals() {
    while (activeRunGroup.children.length > 0) {
      const child = activeRunGroup.children[0];
      activeRunGroup.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    }

    if (activeRunPoints.length === 0) {
      rubberbandLine.visible = false;
      vertGuideLine.visible = false;
      return null;
    }

    const colorHex = diameterRegistry.getSelected()?.color || '#f59e0b';
    const pipeRadius = tradeRadiusM();
    rubberbandMat.color.set(colorHex);

    for (const pt of activeRunPoints) {
      activeRunGroup.add(createJoint(pt, pipeRadius, colorHex, false));
    }

    if (activeRunPoints.length >= 2) {
      for (let i = 0; i < activeRunPoints.length - 1; i++) {
        const cyl = createCylinderSegment(activeRunPoints[i], activeRunPoints[i + 1], pipeRadius, colorHex);
        if (cyl) activeRunGroup.add(cyl);
      }
    }

    // 3. Update the live rubberband segment to target cursor position
    const lastPt = activeRunPoints[activeRunPoints.length - 1];
    let targetPt = currentCursorPoint;

    if (isPerpendicularActive) {
      targetPt = getVerticalProjectionPoint(lastPt, lastNdc);

      const vpos = vertGuideGeo.attributes.position.array;
      vpos[0] = lastPt.x;
      vpos[1] = lastPt.y - 15;
      vpos[2] = lastPt.z;
      vpos[3] = lastPt.x;
      vpos[4] = lastPt.y + 15;
      vpos[5] = lastPt.z;
      vertGuideGeo.attributes.position.needsUpdate = true;
      vertGuideLine.visible = true;
    } else if (isOrthoActive && targetPt && !cursorOnSurface) {
      const orthoResult = constrainOrtho3D(lastPt, targetPt);
      targetPt = orthoResult;
      if (orthoResult.axis === 'Y') {
        const vpos = vertGuideGeo.attributes.position.array;
        vpos[0] = lastPt.x;
        vpos[1] = lastPt.y - 15;
        vpos[2] = lastPt.z;
        vpos[3] = lastPt.x;
        vpos[4] = lastPt.y + 15;
        vpos[5] = lastPt.z;
        vertGuideGeo.attributes.position.needsUpdate = true;
        vertGuideLine.visible = true;
      } else {
        vertGuideLine.visible = false;
      }
    } else {
      vertGuideLine.visible = false;
    }

    if (targetPt) {
      const pos = rubberbandGeo.attributes.position.array;
      pos[0] = lastPt.x;
      pos[1] = lastPt.y;
      pos[2] = lastPt.z;
      pos[3] = targetPt.x;
      pos[4] = targetPt.y;
      pos[5] = targetPt.z;
      rubberbandGeo.attributes.position.needsUpdate = true;
      rubberbandLine.visible = true;

      const preview = createCylinderSegment(lastPt, targetPt, pipeRadius, colorHex, false, 0.42);
      if (preview) activeRunGroup.add(preview);

      snapDot.position.set(targetPt.x, targetPt.y, targetPt.z);
      snapDot.visible = true;

      const segDist = Math.hypot(targetPt.x - lastPt.x, targetPt.y - lastPt.y, targetPt.z - lastPt.z);
      return { segDist, targetPt, isVertical: isPerpendicularActive || targetPt.axis === 'Y' };
    } else {
      rubberbandLine.visible = false;
      return null;
    }
  }

  // Render all finished conduit runs stored in the network
  function renderCompletedRuns(network) {
    while (completedRunsGroup.children.length > 0) {
      const child = completedRunsGroup.children[0];
      completedRunsGroup.remove(child);
      child.traverse((c) => {
        if (c.geometry) c.geometry.dispose();
        if (c.material) c.material.dispose();
      });
    }

    if (!network?.runs || !Array.isArray(network.runs)) return;

    for (const run of network.runs) {
      const points = (run.nodeIds || [])
        .map((nid) => nodeById(network, nid))
        .filter(Boolean);

      if (points.length < 2) continue;

      const runGroup = new THREE.Group();
      runGroup.name = `Run_${run.id}`;

      const colorHex = diameterRegistry.getColor(run.size) || '#f59e0b';
      const isSelected = run.id === selectedRunId;
      const pipeRadius = tradeRadiusM(run.size);

      for (let i = 0; i < points.length - 1; i++) {
        const cyl = createCylinderSegment(points[i], points[i + 1], pipeRadius, colorHex, isSelected);
        if (cyl) runGroup.add(cyl);
      }

      for (const pt of points) {
        runGroup.add(createJoint(pt, pipeRadius, colorHex, isSelected));
      }

      completedRunsGroup.add(runGroup);
    }
  }

  let pointerTarget = null;

  function refreshPivotMarker() {
    if (!pivotMarker.visible) return;
    const camera = engine.world.camera.three;
    const distance = Math.max(camera.position.distanceTo(pivotMarker.position), 0.05);
    const viewportHeight = engine.world.renderer?.three?.domElement?.clientHeight || 800;
    const worldHeight = camera.isPerspectiveCamera
      ? 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * distance
      : Math.abs(camera.top - camera.bottom) / (camera.zoom || 1);
    pivotMarker.scale.setScalar((worldHeight / Math.max(viewportHeight, 1)) * 11);
    pivotMarker.lookAt(camera.position);
  }

  function placePivot(point) {
    const controls = engine.world.camera.controls;
    controls?.setOrbitPoint(point.x, point.y, point.z);
    pivotMarker.position.set(point.x, point.y, point.z);
    pivotMarker.visible = true;
    refreshPivotMarker();
  }

  async function selectionCenter(modelIdMap) {
    if (!modelIdMap) return null;
    const box = new THREE.Box3();
    let found = false;
    for (const [modelId, ids] of Object.entries(modelIdMap)) {
      const localIds = ids instanceof Set ? [...ids] : Array.isArray(ids) ? ids : [];
      if (localIds.length === 0) continue;
      const model = engine.fragments?.list?.get(modelId);
      if (!model?.getMergedBox) continue;
      try {
        const itemBox = await model.getMergedBox(localIds);
        if (!itemBox || itemBox.isEmpty()) continue;
        box.union(itemBox);
        found = true;
      } catch (error) {
        console.warn('[Conduit Takeoff] Could not read the selected element box:', error);
      }
    }
    return found ? box.getCenter(new THREE.Vector3()) : null;
  }

  async function lockPivotToSelection(modelIdMap) {
    const token = ++selectionToken;
    const center = await selectionCenter(modelIdMap);
    if (token !== selectionToken) return;
    if (!center) {
      lockedPivot = null;
      pivotMarker.visible = false;
      return;
    }
    lockedPivot = { x: center.x, y: center.y, z: center.z };
    placePivot(lockedPivot);
  }

  function bindSelectionPivot() {
    const selectEvents = engine.highlighter?.events?.select;
    if (!selectEvents || selectionPivotBound) return;
    selectionPivotBound = true;
    selectEvents.onHighlight.add(() => {
      void lockPivotToSelection(engine.highlighter?.selection?.select);
    });
    selectEvents.onClear.add(() => {
      selectionToken += 1;
      lockedPivot = null;
      pivotMarker.visible = false;
    });
  }

  async function armPivot(event) {
    if (lockedPivot) {
      placePivot(lockedPivot);
      return;
    }

    const token = ++pivotToken;
    const ndc = getCanvasNdc(event);
    const controls = engine.world.camera.controls;
    const fallback = new THREE.Vector3();
    if (controls?.getTarget) controls.getTarget(fallback);
    placePivot(fallback);

    const surface = await surfacePicker.sample(ndc);
    if (token !== pivotToken || lockedPivot) return;
    if (surface?.point) {
      placePivot(surface.point);
      return;
    }

    const camera = engine.world.camera.three;
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, camera);
    const distance = Math.max(camera.position.distanceTo(fallback), 1);
    placePivot(raycaster.ray.at(distance, new THREE.Vector3()));
  }

  function hidePivot() {
    pivotToken += 1;
    if (lockedPivot) {
      placePivot(lockedPivot);
      return;
    }
    pivotMarker.visible = false;
  }

  function handlePointerDown(event) {
    if (event.button === 1) event.preventDefault();
    viewport.pointerDown(event);
    try {
      pointerTarget?.setPointerCapture?.(event.pointerId);
    } catch {
      // A pointer that is already gone cannot be captured. Orbit still starts.
    }
    const orbitsAroundSelection = lockedPivot && (
      event.button === 2 || (event.button === 1 && event.shiftKey)
    );
    if (orbitsAroundSelection) {
      placePivot(lockedPivot);
      return;
    }
    if (event.button === 1 && event.shiftKey) void armPivot(event);
  }

  // Pointer move handler. Orbit and pan come from the Rust core and must not
  // drop the rubberband or be treated as a conduit click.
  async function handlePointerMove(event) {
    lastNdc = getCanvasNdc(event);
    lastScreenPos = { x: event.clientX, y: event.clientY };
    const decision = viewport.pointerMove(event, cameraView());
    if (decision.action === 'orbit' || decision.action === 'pan') {
      handleCameraUpdate();
      return;
    }
    await updateCursorAtNdc(lastNdc);
  }

  async function updateCursorAtNdc(ndc) {
    if (!isDrawingMode && !isPickElevationActive) {
      showSurfaceMarker(null);
      snapDot.visible = false;
      rubberbandLine.visible = false;
      vertGuideLine.visible = false;
      return;
    }

    const surface = await surfacePicker.sample(ndc);
    showSurfaceMarker(surface);

    if (isPickElevationActive) {
      if (surface?.point) {
        snapDot.position.copy(surface.point);
        snapDot.visible = true;
        onStateChange?.({
          cursor: surface.point,
          sampledElevation: surface.point.y,
          screenPos: lastScreenPos,
        });
      }
      return;
    }

    if (isPerpendicularActive && activeRunPoints.length > 0) {
      const lastPt = activeRunPoints[activeRunPoints.length - 1];
      cursorOnSurface = false;
      currentCursorPoint = getVerticalProjectionPoint(lastPt, ndc);
    } else if (surface?.point) {
      cursorOnSurface = true;
      currentCursorPoint = {
        x: surface.point.x,
        y: surface.point.y,
        z: surface.point.z,
        onSurface: true,
      };
    } else {
      cursorOnSurface = false;
      const planePoint = raycastWorkPlane(ndc, activeElevation);
      currentCursorPoint = planePoint ? { ...planePoint, onSurface: false } : currentCursorPoint;
    }

    if (currentCursorPoint || activeRunPoints.length > 0) {
      const previewInfo = updateActiveRunVisuals();
      if (currentCursorPoint) {
        onStateChange?.({
          cursor: previewInfo?.targetPt || currentCursorPoint,
          liveSegment: previewInfo?.segDist || 0,
          isVertical: !!previewInfo?.isVertical,
          activePoints: activeRunPoints,
          screenPos: lastScreenPos,
        });
      }
    } else {
      snapDot.visible = false;
      rubberbandLine.visible = false;
      vertGuideLine.visible = false;
    }
  }

  // Pointer up: only a Rust-classified left click places or samples.
  // Orbit, pan, and empty clicks leave the rubberband where it is.
  async function handlePointerUp(event) {
    const decision = viewport.pointerUp(event, cameraView());
    hidePivot();
    if (!decision.preserveRubberband) {
      return;
    }
    if (decision.action === 'place' || decision.action === 'sample') {
      await placePointAtNdc(getCanvasNdc(event));
    }
  }

  // Process conduit point placement
  async function placePointAtNdc(ndc) {
    // 1. Handle Pick Elevation Mode (Eyedropper)
    if (isPickElevationActive) {
      const hit = await surfacePicker.sample(ndc, { snap: true });
      if (hit?.point) {
        activeElevation = Number(hit.point.y.toFixed(3));
        workPlaneGrid.position.y = activeElevation;
        isPickElevationActive = false;
        syncViewportMode();
        onStateChange?.({
          elevationPicked: activeElevation,
        });
      }
      return;
    }

    if (!isDrawingMode) return;

    let pointToAdd = null;

    if (activeRunPoints.length > 0) {
      const lastPt = activeRunPoints[activeRunPoints.length - 1];

      if (isPerpendicularActive) {
        pointToAdd = getVerticalProjectionPoint(lastPt, ndc);
      } else {
        const target = await pointUnderCursor(ndc);
        if (!target) return;

        let candidate = target;
        if (!target.onSurface && isOrthoActive) {
          candidate = constrainOrtho3D(lastPt, target);
        }

        // A surface click ends on that surface. The riser is only for a plane click
        // after the elevation was changed by hand.
        if (!target.onSurface && autoRiserEnabled && Math.abs(lastPt.y - activeElevation) > 0.005) {
          activeRunPoints.push({ x: lastPt.x, y: activeElevation, z: lastPt.z });
        }

        adoptSurfaceElevation(target);
        pointToAdd = candidate;
      }
    } else {
      const target = await pointUnderCursor(ndc);
      adoptSurfaceElevation(target);
      pointToAdd = target;
    }

    if (!pointToAdd) return;

    activeRunPoints.push({ x: pointToAdd.x, y: pointToAdd.y, z: pointToAdd.z });
    updateActiveRunVisuals();

    onStateChange?.({
      cursor: pointToAdd,
      liveSegment: 0,
      activePoints: activeRunPoints,
      ...(pointToAdd.onSurface ? { elevationPicked: activeElevation } : {}),
    });
  }

  // Camera Orbit update handler: continuously update live line while user is orbiting/panning
  function handleCameraUpdate() {
    refreshPivotMarker();
    if (activeRunPoints.length > 0 && lastNdc) {
      void updateCursorAtNdc(lastNdc);
    }
  }

  function handleContextMenu(event) {
    event.preventDefault();
  }

  return {
    get isDrawingMode() {
      return isDrawingMode;
    },
    set isDrawingMode(val) {
      isDrawingMode = Boolean(val);
      syncViewportMode();
      if (!isDrawingMode) {
        snapDot.visible = false;
        rubberbandLine.visible = false;
        vertGuideLine.visible = false;
        showSurfaceMarker(null);
      }
    },

    get isOrthoActive() {
      return isOrthoActive;
    },
    set isOrthoActive(val) {
      isOrthoActive = Boolean(val);
      updateActiveRunVisuals();
    },

    get isPerpendicularActive() {
      return isPerpendicularActive;
    },
    set isPerpendicularActive(val) {
      isPerpendicularActive = Boolean(val);
      updateActiveRunVisuals();
    },

    get isPickElevationActive() {
      return isPickElevationActive;
    },
    set isPickElevationActive(val) {
      isPickElevationActive = Boolean(val);
      syncViewportMode();
    },

    get autoRiserEnabled() {
      return autoRiserEnabled;
    },
    set autoRiserEnabled(val) {
      autoRiserEnabled = Boolean(val);
    },

    get activeElevation() {
      return activeElevation;
    },
    set activeElevation(val) {
      activeElevation = Number(val) || 0;
      workPlaneGrid.position.y = activeElevation;
      updateActiveRunVisuals();
    },

    get workPlaneVisible() {
      return workPlaneGrid.visible;
    },
    set workPlaneVisible(val) {
      workPlaneGrid.visible = Boolean(val);
    },

    get activePoints() {
      return [...activeRunPoints];
    },

    get selectedRunId() {
      return selectedRunId;
    },
    set selectedRunId(id) {
      selectedRunId = id;
    },

    // Programmatically append a vertical segment
    addVerticalStep(deltaY) {
      if (activeRunPoints.length === 0) return false;
      const lastPt = activeRunPoints[activeRunPoints.length - 1];
      const newPt = { x: lastPt.x, y: lastPt.y + deltaY, z: lastPt.z };
      activeRunPoints.push(newPt);
      this.activeElevation = newPt.y;
      updateActiveRunVisuals();
      onStateChange?.({
        cursor: newPt,
        liveSegment: 0,
        activePoints: activeRunPoints,
      });
      return true;
    },

    commitDistance(distM) {
      if (activeRunPoints.length === 0 || !currentCursorPoint) return false;
      const lastPt = activeRunPoints[activeRunPoints.length - 1];
      const target = currentCursorPoint;
      const dx = target.x - lastPt.x;
      const dy = target.y - lastPt.y;
      const dz = target.z - lastPt.z;
      const len = Math.hypot(dx, dy, dz);
      if (len < 0.001) return false;

      const newPt = {
        x: lastPt.x + (dx / len) * distM,
        y: lastPt.y + (dy / len) * distM,
        z: lastPt.z + (dz / len) * distM,
      };
      activeRunPoints.push(newPt);
      updateActiveRunVisuals();
      onStateChange?.({
        cursor: newPt,
        liveSegment: 0,
        activePoints: activeRunPoints,
        screenPos: lastScreenPos,
      });
      return true;
    },

    undoLastPoint() {
      if (activeRunPoints.length > 0) {
        activeRunPoints.pop();
        if (activeRunPoints.length > 0) {
          this.activeElevation = activeRunPoints[activeRunPoints.length - 1].y;
        }
        updateActiveRunVisuals();
        onStateChange?.({
          cursor: currentCursorPoint,
          liveSegment: 0,
          activePoints: activeRunPoints,
        });
        return true;
      }
      return false;
    },

    finishCurrentRun(getNetwork, setNetwork, system = 'Power') {
      if (activeRunPoints.length < 2) {
        this.cancelCurrentRun();
        return null;
      }

      const points = [...activeRunPoints];
      const diameter = diameterRegistry.getSelected()?.label || '¾"';

      activeRunPoints = [];
      updateActiveRunVisuals();

      const prevNetwork = getNetwork();
      let newNetwork = prevNetwork;

      const n0 = addNode(newNetwork, points[0]);
      newNetwork = n0.network;

      const runName = `Run ${newNetwork.runs.length + 1}`;
      const runRes = startRun(newNetwork, { size: diameter, system, name: runName }, n0.nodeId);
      newNetwork = runRes.network;
      const runId = runRes.runId;

      for (let i = 1; i < points.length; i++) {
        const nNext = addNode(newNetwork, points[i]);
        newNetwork = nNext.network;
        newNetwork = appendToRun(newNetwork, runId, nNext.nodeId);
      }

      const runCommand = {
        description: `Draw conduit ${runName} (${diameter})`,
        execute() {
          setNetwork(newNetwork);
          renderCompletedRuns(newNetwork);
          onStateChange?.({ activePoints: [], networkUpdated: true });
        },
        undo() {
          setNetwork(prevNetwork);
          renderCompletedRuns(prevNetwork);
          onStateChange?.({ activePoints: [], networkUpdated: true });
        },
      };

      commandStack.execute(runCommand);
      return runId;
    },

    cancelCurrentRun() {
      activeRunPoints = [];
      updateActiveRunVisuals();
      onStateChange?.({ activePoints: [] });
    },

    renderRuns(network) {
      renderCompletedRuns(network);
    },

    attach(container) {
      syncViewportMode();
      bindSelectionPivot();
      pointerTarget = engine.world?.renderer?.three?.domElement || container;
      pointerTarget.addEventListener('pointerdown', handlePointerDown);
      pointerTarget.addEventListener('pointermove', handlePointerMove);
      pointerTarget.addEventListener('pointerup', handlePointerUp);
      pointerTarget.addEventListener('pointercancel', handlePointerUp);
      pointerTarget.addEventListener('contextmenu', handleContextMenu);
      if (engine.world?.camera?.controls) {
        engine.world.camera.controls.addEventListener('update', handleCameraUpdate);
      }
    },

    detach(container) {
      const target = pointerTarget || container;
      target.removeEventListener('pointerdown', handlePointerDown);
      target.removeEventListener('pointermove', handlePointerMove);
      target.removeEventListener('pointerup', handlePointerUp);
      target.removeEventListener('pointercancel', handlePointerUp);
      target.removeEventListener('contextmenu', handleContextMenu);
      if (engine.world?.camera?.controls) {
        engine.world.camera.controls.removeEventListener('update', handleCameraUpdate);
      }
      overlayGroup.clear();
      scene.remove(overlayGroup);
    },
  };
}
