// 3D Drawing Tool & Revit-Style Routing Engine for Conduit Takeoff.
//
// Key Revit MEP mechanics implemented:
// 1. Active Middle Elevation Work Plane (default 2.80 m / configurable).
// 2. Auto-Riser Generation: changing elevation offset mid-run automatically inserts
//    a vertical transition riser between the two heights.
// 3. Eyedropper Elevation Sampling: click any IFC beam, slab, or tray to set height.
// 4. Dynamic Work Plane visual grid sliding with the current elevation offset.
// 5. 3-Axis Orthogonal Snapping (X, Y [riser], Z).
// 6. Continuous 3D solid conduit pipes with smooth joint spheres.

import * as THREE from 'three';
import {
  addNode,
  startRun,
  appendToRun,
  deleteRun,
  nodeById,
} from '@conduit-core';

export function createDrawingTool({ engine, commandStack, diameterRegistry, onStateChange }) {
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
  let isDrawingMode = true;
  let isOrthoActive = false;
  let isPerpendicularActive = false;
  let isPickElevationActive = false;
  let autoRiserEnabled = true;
  let activeElevation = 2.8; // Metres above 0
  let activeRunPoints = []; // [{ x, y, z }]
  let currentCursorPoint = null; // { x, y, z }
  let lastNdc = new THREE.Vector2();
  let selectedRunId = null;

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

  // Helper to create a 3D cylinder segment connecting two 3D points
  function createCylinderSegment(p1, p2, radius, colorHex) {
    const v1 = new THREE.Vector3(p1.x, p1.y, p1.z);
    const v2 = new THREE.Vector3(p2.x, p2.y, p2.z);
    const dist = v1.distanceTo(v2);
    if (dist < 0.001) return null;

    const cylGeo = new THREE.CylinderGeometry(radius, radius, dist, 8);
    const cylMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(colorHex),
      depthTest: false,
      transparent: true,
      opacity: 0.92,
    });
    const mesh = new THREE.Mesh(cylGeo, cylMat);
    mesh.position.copy(v1).add(v2).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v2.clone().sub(v1).normalize());
    mesh.renderOrder = 950;
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
    rubberbandMat.color.set(colorHex);

    // 1. Draw spheres for placed points
    const dotGeo = new THREE.SphereGeometry(0.04, 12, 12);
    const dotMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(colorHex), depthTest: false });

    for (const pt of activeRunPoints) {
      const dot = new THREE.Mesh(dotGeo, dotMat);
      dot.position.set(pt.x, pt.y, pt.z);
      dot.renderOrder = 960;
      activeRunGroup.add(dot);
    }

    // 2. Draw continuous lines and solid cylinders between all placed points
    if (activeRunPoints.length >= 2) {
      const pts = activeRunPoints.map((p) => new THREE.Vector3(p.x, p.y, p.z));
      const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
      const lineMat = new THREE.LineBasicMaterial({
        color: new THREE.Color(colorHex),
        linewidth: 3,
        depthTest: false,
      });
      const line = new THREE.Line(lineGeo, lineMat);
      line.renderOrder = 955;
      activeRunGroup.add(line);

      for (let i = 0; i < activeRunPoints.length - 1; i++) {
        const cyl = createCylinderSegment(activeRunPoints[i], activeRunPoints[i + 1], 0.02, colorHex);
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
    } else if (isOrthoActive && targetPt) {
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
      const displayColor = isSelected ? '#ffffff' : colorHex;

      // 1. Line
      const pts = points.map((p) => new THREE.Vector3(p.x, p.y, p.z));
      const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
      const lineMat = new THREE.LineBasicMaterial({
        color: new THREE.Color(displayColor),
        linewidth: isSelected ? 4 : 2,
        depthTest: false,
        transparent: true,
        opacity: isSelected ? 1.0 : 0.95,
      });
      const lineMesh = new THREE.Line(lineGeo, lineMat);
      lineMesh.renderOrder = 900;
      runGroup.add(lineMesh);

      // 2. 3D Cylinders for solid conduit look
      const pipeRadius = isSelected ? 0.026 : 0.02;
      for (let i = 0; i < points.length - 1; i++) {
        const cyl = createCylinderSegment(points[i], points[i + 1], pipeRadius, displayColor);
        if (cyl) {
          cyl.renderOrder = 901;
          runGroup.add(cyl);
        }
      }

      // 3. Spheres at nodes
      const dotRadius = isSelected ? 0.05 : 0.038;
      const dotGeo = new THREE.SphereGeometry(dotRadius, 12, 12);
      const dotMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(displayColor),
        depthTest: false,
      });

      for (const pt of points) {
        const dot = new THREE.Mesh(dotGeo, dotMat);
        dot.position.set(pt.x, pt.y, pt.z);
        dot.renderOrder = 902;
        runGroup.add(dot);
      }

      completedRunsGroup.add(runGroup);
    }
  }

  let pointerDownPos = { x: 0, y: 0, time: 0, button: 0 };
  let isNavigating = false;

  function handlePointerDown(event) {
    pointerDownPos = {
      x: event.clientX,
      y: event.clientY,
      time: performance.now(),
      button: event.button,
    };
    isNavigating = false;
  }

  // Pointer move handler
  async function handlePointerMove(event) {
    lastNdc = getCanvasNdc(event);

    if (pointerDownPos.time > 0) {
      const dist = Math.hypot(event.clientX - pointerDownPos.x, event.clientY - pointerDownPos.y);
      if (dist > 5) {
        isNavigating = true;
      }
    }

    await updateCursorAtNdc(lastNdc);
  }

  async function updateCursorAtNdc(ndc) {
    if (isPickElevationActive) {
      // In pick elevation mode, raycast model surface to highlight sampled elevation
      const hit = await engine.pick(ndc, { snap: true });
      if (hit?.point) {
        snapDot.position.copy(hit.point);
        snapDot.visible = true;
        onStateChange?.({
          cursor: hit.point,
          sampledElevation: hit.point.y,
        });
      }
      return;
    }

    if (isPerpendicularActive && activeRunPoints.length > 0) {
      const lastPt = activeRunPoints[activeRunPoints.length - 1];
      currentCursorPoint = getVerticalProjectionPoint(lastPt, ndc);
    } else {
      // In Revit/Navisworks conduit mode: raycast onto active horizontal work plane
      const workPlanePoint = raycastWorkPlane(ndc, activeElevation);
      const hit = await engine.pick(ndc, { snap: true });

      if (hit?.snapped && hit?.point) {
        currentCursorPoint = hit.point;
      } else {
        currentCursorPoint = workPlanePoint || hit?.point || currentCursorPoint;
      }
    }

    if (currentCursorPoint || activeRunPoints.length > 0) {
      const previewInfo = updateActiveRunVisuals();
      if (currentCursorPoint) {
        onStateChange?.({
          cursor: previewInfo?.targetPt || currentCursorPoint,
          liveSegment: previewInfo?.segDist || 0,
          isVertical: !!previewInfo?.isVertical,
          activePoints: activeRunPoints,
        });
      }
    } else {
      snapDot.visible = false;
      rubberbandLine.visible = false;
      vertGuideLine.visible = false;
    }
  }

  // Pointer up handler: distinguishes camera navigation (orbit/pan) from genuine clicks
  async function handlePointerUp(event) {
    const dist = Math.hypot(event.clientX - pointerDownPos.x, event.clientY - pointerDownPos.y);
    const duration = performance.now() - pointerDownPos.time;
    const wasNavigating = isNavigating || dist > 5 || duration > 600 || event.button !== 0;
    pointerDownPos.time = 0;
    isNavigating = false;

    // If mouse was dragged or was right/middle button, it's an Orbit/Pan camera gesture.
    // In Navisworks, navigation actions never drop accidental points!
    if (wasNavigating) {
      return;
    }

    // In-place Left Click: place point
    await placePointAtNdc(getCanvasNdc(event));
  }

  // Process conduit point placement
  async function placePointAtNdc(ndc) {
    // 1. Handle Pick Elevation Mode (Eyedropper)
    if (isPickElevationActive) {
      const hit = await engine.pick(ndc, { snap: true });
      if (hit?.point) {
        activeElevation = Number(hit.point.y.toFixed(3));
        workPlaneGrid.position.y = activeElevation;
        isPickElevationActive = false;
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
        // Compute standard horizontal candidate at active elevation
        const planePt = raycastWorkPlane(ndc, activeElevation);
        const hit = await engine.pick(ndc, { snap: true });
        let candidate = (hit?.snapped && hit?.point) ? hit.point : (planePt || hit?.point);

        if (isOrthoActive && candidate) {
          candidate = constrainOrtho3D(lastPt, candidate);
        }

        // --- REVIT AUTO-RISER MECHANIC ---
        // If the elevation has changed mid-run, automatically insert the vertical riser!
        if (autoRiserEnabled && Math.abs(lastPt.y - activeElevation) > 0.005) {
          const riserNode = { x: lastPt.x, y: activeElevation, z: lastPt.z };
          activeRunPoints.push(riserNode);
        }

        pointToAdd = candidate;
      }
    } else {
      // First point of run: project onto active work plane or model snap
      const planePt = raycastWorkPlane(ndc, activeElevation);
      const hit = await engine.pick(ndc, { snap: true });
      pointToAdd = (hit?.snapped && hit?.point) ? hit.point : (planePt || hit?.point);
    }

    if (!pointToAdd) return;

    activeRunPoints.push({ x: pointToAdd.x, y: pointToAdd.y, z: pointToAdd.z });
    updateActiveRunVisuals();

    onStateChange?.({
      cursor: pointToAdd,
      liveSegment: 0,
      activePoints: activeRunPoints,
    });
  }

  // Camera Orbit update handler: continuously update live line while user is orbiting/panning
  function handleCameraUpdate() {
    if (activeRunPoints.length > 0 && lastNdc) {
      if (isPerpendicularActive) {
        const lastPt = activeRunPoints[activeRunPoints.length - 1];
        currentCursorPoint = getVerticalProjectionPoint(lastPt, lastNdc);
      } else {
        const planePt = raycastWorkPlane(lastNdc, activeElevation);
        if (planePt) currentCursorPoint = planePt;
      }
      updateActiveRunVisuals();
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
      if (!isDrawingMode) {
        snapDot.visible = false;
        rubberbandLine.visible = false;
        vertGuideLine.visible = false;
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
      container.addEventListener('pointerdown', handlePointerDown);
      container.addEventListener('pointermove', handlePointerMove);
      container.addEventListener('pointerup', handlePointerUp);
      container.addEventListener('contextmenu', handleContextMenu);
      if (engine.world?.camera?.controls) {
        engine.world.camera.controls.addEventListener('update', handleCameraUpdate);
      }
    },

    detach(container) {
      container.removeEventListener('pointerdown', handlePointerDown);
      container.removeEventListener('pointermove', handlePointerMove);
      container.removeEventListener('pointerup', handlePointerUp);
      container.removeEventListener('contextmenu', handleContextMenu);
      if (engine.world?.camera?.controls) {
        engine.world.camera.controls.removeEventListener('update', handleCameraUpdate);
      }
      overlayGroup.clear();
      scene.remove(overlayGroup);
    },
  };
}
