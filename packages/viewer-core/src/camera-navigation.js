// Revizto 5-style Camera Navigation & Adaptive Frustum controller for viewer-core.
//
// Solves premature near-plane "sectioning" and dolly jumping when inspecting
// large IFC / .frag models up close:
//   1. Distance-Adaptive Near/Far Frustum: dynamically drops `camera.near` to
//      0.015 m (15 mm) for close-up inspection and scales cleanly at 1+ km.
//   2. Revizto `camera-controls` tuning: `minDistance = 0.05` (5 cm instead of
//      OBC's hardcoded 6 m), `maxDistance = 50000`, `dollyToCursor = true`,
//      `infinityDolly = true`, `smoothTime = 0.12`, `dollySpeed = 0.85`.
//   3. Surface-Aware Zoom & Cursor Orbit Pivot: uses throttled raycasting under
//      the cursor so wheel zoom scales by actual surface distance and orbit
//      rotates around the hovered 3D surface point.

import * as THREE from "three";

const MIN_NEAR_M = 0.015;
const MAX_NEAR_M = 1.0;
const MIN_FAR_M = 2000;
const MAX_FAR_TO_NEAR_RATIO = 150000;
const PICK_THROTTLE_MS = 85;
const HIT_STALE_MS = 450;

/**
 * Pure helper: computes distance-adaptive perspective frustum near/far planes
 * so close-up details (down to 1.5 cm) never slice open while huge industrial
 * sites remain free of Z-fighting.
 */
export function computeAdaptiveFrustum({
  cameraDistance = 10,
  nearestSurfaceDistance = null,
  modelRadius = 200,
} = {}) {
  const safeCamDist = Number.isFinite(cameraDistance) && cameraDistance > 0 ? cameraDistance : 10;
  const hasSurface = Number.isFinite(nearestSurfaceDistance) && nearestSurfaceDistance > 0;
  const dRef = hasSurface ? Math.min(safeCamDist, nearestSurfaceDistance) : safeCamDist;

  let near;
  if (dRef <= 5) {
    near = MIN_NEAR_M;
  } else {
    near = Math.min(MAX_NEAR_M, Math.max(MIN_NEAR_M, dRef * 0.003));
  }

  const safeRadius = Number.isFinite(modelRadius) && modelRadius > 0 ? modelRadius : 200;
  const rawFar = Math.max(MIN_FAR_M, safeRadius * 8 + safeCamDist * 2);
  const far = Math.min(rawFar, near * MAX_FAR_TO_NEAR_RATIO);

  return {
    near: Number(near.toFixed(4)),
    far: Math.round(far),
  };
}

/**
 * Pure helper: computes surface-aware zoom step size and whether the hovered
 * surface should re-anchor the dolly target to avoid multi-meter jumps.
 */
export function computeSurfaceZoomStep({
  surfaceDistance = null,
  targetDistance = 10,
  wheelDeltaY = 0,
  dollySpeed = 0.85,
} = {}) {
  const safeTarget = Number.isFinite(targetDistance) && targetDistance > 0 ? targetDistance : 10;
  const hasSurface = Number.isFinite(surfaceDistance) && surfaceDistance > 0;
  const direction = wheelDeltaY < 0 ? 1 : -1;
  const notch = Math.min(2.5, Math.abs(wheelDeltaY) / 100 || 1);

  const effectiveDist = hasSurface
    ? direction > 0
      ? Math.min(safeTarget, surfaceDistance)
      : Math.min(safeTarget, Math.max(surfaceDistance, 0.25))
    : safeTarget;

  const stepDistance = Math.max(MIN_NEAR_M, effectiveDist * 0.14 * notch * dollySpeed);
  const shouldReanchorTarget = Boolean(
    hasSurface && direction > 0 && surfaceDistance < safeTarget * 0.85,
  );

  return {
    stepDistance,
    direction,
    effectiveDist,
    shouldReanchorTarget,
  };
}

/**
 * Pure helper: dynamically computes an outlier-resistant core bounding box from
 * an array of 3D element positions ({x,y,z} or [x,y,z]).
 *
 * When a model has stray CAD artifacts/survey points kilometers away from the
 * main facility (expanding the raw min/max box by >1.5x), this filters the
 * extreme statistical outliers outside the [P02..P98] Tukey fence so camera
 * fit, orbit pivot, ground grid, and adaptive frustum focus directly on the
 * actual building/plant for any model size.
 */
export function computeRobustCoreBoundingBox(positions = [], fallbackBox = null) {
  const validPts = [];
  if (Array.isArray(positions)) {
    for (let i = 0; i < positions.length; i++) {
      const p = positions[i];
      if (!p) continue;
      const x = Array.isArray(p) ? p[0] : p.x;
      const y = Array.isArray(p) ? p[1] : p.y;
      const z = Array.isArray(p) ? p[2] : p.z;
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        validPts.push([x, y, z]);
      }
    }
  }

  const rawFallback =
    fallbackBox && typeof fallbackBox.isEmpty === "function" && !fallbackBox.isEmpty()
      ? fallbackBox.clone()
      : null;

  if (validPts.length < 10) {
    if (rawFallback) return rawFallback;
    const simpleBox = new THREE.Box3();
    for (const [x, y, z] of validPts) {
      simpleBox.expandByPoint(new THREE.Vector3(x, y, z));
    }
    return simpleBox;
  }

  const n = validPts.length;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  const zs = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = validPts[i][0];
    ys[i] = validPts[i][1];
    zs[i] = validPts[i][2];
  }
  xs.sort();
  ys.sort();
  zs.sort();

  const quantile = (sorted, q) =>
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * q)))];

  const buildFence = (sorted) => {
    const p02 = quantile(sorted, 0.02);
    const p98 = quantile(sorted, 0.98);
    const span = Math.max(p98 - p02, 2.0);
    return { low: p02 - span * 0.75, high: p98 + span * 0.75 };
  };

  const fx = buildFence(xs);
  const fy = buildFence(ys);
  const fz = buildFence(zs);

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  let inlierCount = 0;

  for (let i = 0; i < n; i++) {
    const [x, y, z] = validPts[i];
    if (
      x >= fx.low &&
      x <= fx.high &&
      y >= fy.low &&
      y <= fy.high &&
      z >= fz.low &&
      z <= fz.high
    ) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
      inlierCount++;
    }
  }

  if (inlierCount === 0) {
    return rawFallback || new THREE.Box3();
  }

  const coreBox = new THREE.Box3(
    new THREE.Vector3(minX, minY, minZ),
    new THREE.Vector3(maxX, maxY, maxZ),
  );
  const coreSize = new THREE.Vector3();
  coreBox.getSize(coreSize);
  const coreDiag = Math.max(coreSize.length(), 1.0);
  const margin = Math.max(2.0, coreDiag * 0.03);
  coreBox.expandByScalar(margin);

  if (rawFallback) {
    const rawSize = new THREE.Vector3();
    rawFallback.getSize(rawSize);
    const rawDiag = rawSize.length();
    if (rawDiag <= coreDiag * 1.5) {
      return rawFallback;
    }
  }

  return coreBox;
}

export function createCameraNavigationController({
  world,
  fragments = null,
  pick = null,
  container = null,
  cursorOrbitPivot = true,
} = {}) {
  const camera = world?.camera?.three || null;
  const controls = world?.camera?.controls || null;

  let modelRadius = 200;
  let lastAppliedNear = camera?.near ?? 1;
  let lastAppliedFar = camera?.far ?? 1000;
  let cursorPivotEnabled = Boolean(cursorOrbitPivot);

  let lastHit = null; // { point: THREE.Vector3, distance: number, at: number }
  let lastPickAt = 0;
  let pickInFlight = false;
  let disposed = false;

  const targetVec = new THREE.Vector3();

  // 1. Apply Revizto 5 camera-controls tuning (replaces OBC's minDistance = 6m)
  function applyControlsTuning() {
    if (!controls) return;
    controls.minDistance = 0.05;
    controls.maxDistance = 50000;
    controls.dollyToCursor = true;
    controls.infinityDolly = true;
    controls.dollySpeed = 0.85;
    controls.smoothTime = 0.12;
  }
  applyControlsTuning();

  function enforceAdaptiveFrustum() {
    if (disposed || !camera || !camera.isPerspectiveCamera) return;

    let cameraDistance = 10;
    if (controls?.getTarget) {
      controls.getTarget(targetVec);
      cameraDistance = camera.position.distanceTo(targetVec);
    }

    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const freshHit =
      lastHit && now - lastHit.at <= HIT_STALE_MS
        ? camera.position.distanceTo(lastHit.point)
        : null;

    const { near, far } = computeAdaptiveFrustum({
      cameraDistance,
      nearestSurfaceDistance: freshHit,
      modelRadius,
    });

    const nearChanged = Math.abs(near - lastAppliedNear) / Math.max(lastAppliedNear, 1e-4) > 0.05;
    const farChanged = Math.abs(far - lastAppliedFar) / Math.max(lastAppliedFar, 1) > 0.05;

    if (nearChanged || farChanged || camera.near !== lastAppliedNear) {
      camera.near = near;
      camera.far = far;
      camera.updateProjectionMatrix();
      lastAppliedNear = near;
      lastAppliedFar = far;
    }
  }

  function refreshModelBounds(customBox = null) {
    const merged = new THREE.Box3();
    let hasBounds = false;

    if (customBox && !customBox.isEmpty?.()) {
      merged.copy(customBox);
      hasBounds = true;
    } else if (fragments?.groups) {
      for (const [, model] of fragments.groups) {
        const b = model?.box;
        if (b && !b.isEmpty?.()) {
          merged.union(b);
          hasBounds = true;
        } else if (model?.object) {
          const objBox = new THREE.Box3().setFromObject(model.object);
          if (!objBox.isEmpty()) {
            merged.union(objBox);
            hasBounds = true;
          }
        }
      }
    }

    if (hasBounds && !merged.isEmpty()) {
      const sphere = new THREE.Sphere();
      merged.getBoundingSphere(sphere);
      if (Number.isFinite(sphere.radius) && sphere.radius > 0) {
        modelRadius = Math.max(20, sphere.radius);
      }
    }
    enforceAdaptiveFrustum();
    return modelRadius;
  }

  function getNdcFromEvent(event) {
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
  }

  async function sampleSurfaceUnderPointer(event, force = false) {
    if (disposed || !pick || !camera || pickInFlight) return lastHit;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (!force && now - lastPickAt < PICK_THROTTLE_MS) return lastHit;
    const ndc = getNdcFromEvent(event);
    if (!ndc) return lastHit;

    lastPickAt = now;
    pickInFlight = true;
    try {
      const hit = await pick(ndc, { snap: false });
      if (hit?.point) {
        lastHit = {
          point: hit.point.clone(),
          distance: camera.position.distanceTo(hit.point),
          at: typeof performance !== "undefined" ? performance.now() : Date.now(),
        };
        enforceAdaptiveFrustum();
      } else {
        lastHit = null;
      }
    } catch {
      /* headless / raycast unavailable */
    } finally {
      pickInFlight = false;
    }
    return lastHit;
  }

  const onPointerMove = (event) => {
    void sampleSurfaceUnderPointer(event, false);
  };

  const onWheel = (event) => {
    if (disposed || !controls || !camera) return;
    // Kick off a surface sample for the next tick and use the latest hit immediately
    void sampleSurfaceUnderPointer(event, true);

    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (!lastHit || now - lastHit.at > HIT_STALE_MS) return;

    controls.getTarget(targetVec);
    const targetDistance = camera.position.distanceTo(targetVec);
    const surfaceDistance = camera.position.distanceTo(lastHit.point);

    const zoomPlan = computeSurfaceZoomStep({
      surfaceDistance,
      targetDistance,
      wheelDeltaY: event.deltaY,
      dollySpeed: controls.dollySpeed,
    });

    if (zoomPlan.shouldReanchorTarget && typeof controls.setOrbitPoint === "function") {
      controls.setOrbitPoint(lastHit.point.x, lastHit.point.y, lastHit.point.z);
    }
    enforceAdaptiveFrustum();
  };

  const onPointerDown = (event) => {
    if (disposed || !cursorPivotEnabled || !controls || !camera) return;
    // Left or Right drag orbit without Shift+Middle explicit pivot override
    if (event.button !== 0 && event.button !== 2) return;
    if (event.shiftKey) return;

    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (lastHit && now - lastHit.at <= HIT_STALE_MS && typeof controls.setOrbitPoint === "function") {
      controls.setOrbitPoint(lastHit.point.x, lastHit.point.y, lastHit.point.z);
    }
  };

  let lastFragUpdateAt = 0;
  const FRAG_UPDATE_THROTTLE_MS = 120;

  const triggerFragmentsUpdate = (force = false) => {
    if (disposed || !fragments?.core?.update) return;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (!force && now - lastFragUpdateAt < FRAG_UPDATE_THROTTLE_MS) return;
    lastFragUpdateAt = now;
    try {
      fragments.core.update(true);
    } catch { /* headless */ }
  };

  const onControlsUpdate = () => {
    enforceAdaptiveFrustum();
    triggerFragmentsUpdate(false);
  };

  const onControlsRest = () => {
    enforceAdaptiveFrustum();
    triggerFragmentsUpdate(true);
  };

  try {
    controls?.addEventListener?.("update", onControlsUpdate);
    controls?.addEventListener?.("rest", onControlsRest);
    controls?.addEventListener?.("controlend", onControlsRest);
  } catch { /* headless */ }

  if (container && typeof container.addEventListener === "function") {
    container.addEventListener("pointermove", onPointerMove, { passive: true });
    container.addEventListener("wheel", onWheel, { capture: true, passive: true });
    container.addEventListener("pointerdown", onPointerDown, { capture: true, passive: true });
  }

  // Enforce immediately on startup
  enforceAdaptiveFrustum();

  return {
    enforceAdaptiveFrustum,
    refreshModelBounds,
    setCursorOrbitPivotEnabled(enabled) {
      cursorPivotEnabled = Boolean(enabled);
    },
    getState() {
      return {
        near: camera?.near ?? lastAppliedNear,
        far: camera?.far ?? lastAppliedFar,
        minDistance: controls?.minDistance ?? null,
        maxDistance: controls?.maxDistance ?? null,
        modelRadius,
        cursorOrbitPivot: cursorPivotEnabled,
      };
    },
    dispose() {
      disposed = true;
      try {
        controls?.removeEventListener?.("update", onControlsUpdate);
        controls?.removeEventListener?.("rest", onControlsRest);
        controls?.removeEventListener?.("controlend", onControlsRest);
      } catch { /* noop */ }
      if (container && typeof container.removeEventListener === "function") {
        container.removeEventListener("pointermove", onPointerMove);
        container.removeEventListener("wheel", onWheel, { capture: true });
        container.removeEventListener("pointerdown", onPointerDown, { capture: true });
      }
    },
  };
}
