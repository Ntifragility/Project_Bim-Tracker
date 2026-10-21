// Revit-Style Precision Snapping & Polar Alignment Engine
// Pure mathematical functions and stateful SnapEngine class.
//
// Designed with Rust data-oriented architecture:
// - Zero DOM or Three.js dependencies (100% portable to Rust/Wasm).
// - Strict numerical stability (epsilon guards against div-by-zero & parallel raycasting).
// - Deterministic snap priority resolution:
//     1. Endpoint / Node Snap
//     2. Midpoint Snap
//     3. Segment Centerline Snap
//     4. Polar Angle / Orthogonal Alignment Snap
//     5. Elevation Workplane Raycast Fallback

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const EPSILON = 1e-7;

/**
 * @typedef {Object} Point3D
 * @property {number} x
 * @property {number} y
 * @property {number} z
 */

/**
 * @typedef {Object} SnapCandidate
 * @property {Point3D} point - The snapped coordinate in 3D
 * @property {'endpoint'|'midpoint'|'segment'|'polar_angle'|'ortho'|'workplane'} snapType
 * @property {number} distance - Distance from raw query point to snapped point
 * @property {string|null} [targetId] - ID of node or segment snapped to
 * @property {number|null} [angleDeg] - Snapped angle if polar
 * @property {string|null} [guideAxis] - 'X' | 'Y' | 'Z' if ortho
 * @property {number|null} [t] - Parametric position along segment (0..1)
 */

// Vector Math Primitives
export const vec3 = {
  create: (x = 0, y = 0, z = 0) => ({ x, y, z }),
  add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }),
  sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }),
  scale: (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s }),
  dot: (a, b) => a.x * b.x + a.y * b.y + a.z * b.z,
  lengthSq: (a) => a.x * a.x + a.y * a.y + a.z * a.z,
  length: (a) => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z),
  distance: (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z),
  normalize: (a) => {
    const len = Math.hypot(a.x, a.y, a.z);
    return len > EPSILON ? { x: a.x / len, y: a.y / len, z: a.z / len } : { x: 0, y: 0, z: 0 };
  },
  equals: (a, b, tol = 1e-4) =>
    Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol && Math.abs(a.z - b.z) <= tol,
};

/**
 * Closest point on 3D segment A -> B to query point P.
 * Returns projection point, parameter t in [0, 1], and 3D distance.
 */
export function closestPointOnSegment(p, a, b) {
  const ab = vec3.sub(b, a);
  const abLenSq = vec3.lengthSq(ab);
  if (abLenSq < EPSILON) {
    return { point: { x: a.x, y: a.y, z: a.z }, t: 0, distance: vec3.distance(p, a) };
  }
  const ap = vec3.sub(p, a);
  const t = Math.min(1, Math.max(0, vec3.dot(ap, ab) / abLenSq));
  const point = vec3.add(a, vec3.scale(ab, t));
  return { point, t, distance: vec3.distance(p, point) };
}

/**
 * Snap to the closest node/point within linear distance tolerance.
 * @param {Point3D} queryPoint
 * @param {Array<{ id: string, x: number, y: number, z: number }>} nodes
 * @param {number} toleranceMetres
 * @returns {SnapCandidate|null}
 */
export function snapToNodes(queryPoint, nodes, toleranceMetres = 0.25) {
  let closest = null;
  let minDistance = toleranceMetres;

  for (const node of nodes) {
    const d = vec3.distance(queryPoint, node);
    if (d <= minDistance) {
      minDistance = d;
      closest = {
        point: { x: node.x, y: node.y, z: node.z },
        snapType: 'endpoint',
        targetId: node.id || null,
        distance: d,
        guideAxis: null,
      };
    }
  }
  return closest;
}

/**
 * Snap to segment centerlines or midpoints within distance tolerance.
 * @param {Point3D} queryPoint
 * @param {Array<{ id: string, start: Point3D, end: Point3D }>} segments
 * @param {number} toleranceMetres
 * @param {number} midpointThreshold - Fractional range around t=0.5 to trigger midpoint snap (default +/- 0.08)
 * @returns {SnapCandidate|null}
 */
export function snapToSegments(queryPoint, segments, toleranceMetres = 0.2, midpointThreshold = 0.08) {
  let closest = null;
  let minDistance = toleranceMetres;

  for (const seg of segments) {
    const hit = closestPointOnSegment(queryPoint, seg.start, seg.end);
    if (hit.distance <= minDistance) {
      // Exclude strict endpoints (t near 0 or 1) as they are handled by node snapping
      if (hit.t > 0.02 && hit.t < 0.98) {
        minDistance = hit.distance;
        const isMid = Math.abs(hit.t - 0.5) <= midpointThreshold;
        const snapPoint = isMid
          ? vec3.scale(vec3.add(seg.start, seg.end), 0.5)
          : hit.point;

        closest = {
          point: snapPoint,
          snapType: isMid ? 'midpoint' : 'segment',
          targetId: seg.id || null,
          distance: isMid ? vec3.distance(queryPoint, snapPoint) : hit.distance,
          t: isMid ? 0.5 : hit.t,
          guideAxis: null,
        };
      }
    }
  }
  return closest;
}

/**
 * Revit-style Polar Angle Snapping on the horizontal plane.
 * Constrains the vector (fromPoint -> toPoint) to increments such as 0°, 45°, 90°, 135°, 180°.
 *
 * @param {Point3D} fromPoint - Start anchor point of the active segment
 * @param {Point3D} toPoint - Raw candidate point from cursor
 * @param {Object} options
 * @param {number[]} [options.allowedAnglesDeg] - Angles to snap to (default 0, 45, 90, 135, 180, 225, 270, 315)
 * @param {number} [options.toleranceDeg] - Max angle deviation to trigger snap (default 4°)
 * @param {'Y'|'Z'} [options.upAxis] - Up axis: 'Y' for Three.js (plan is XZ), 'Z' for IFC (plan is XY)
 * @returns {SnapCandidate|null}
 */
export function snapPolarAngle(
  fromPoint,
  toPoint,
  {
    allowedAnglesDeg = [0, 45, 90, 135, 180, 225, 270, 315, 360],
    toleranceDeg = 4.5,
    upAxis = 'Y',
  } = {}
) {
  if (!fromPoint || !toPoint) return null;

  // Plan coordinates
  const dx = toPoint.x - fromPoint.x;
  const dPlane = upAxis === 'Y' ? toPoint.z - fromPoint.z : toPoint.y - fromPoint.y;
  const radialDist = Math.hypot(dx, dPlane);

  // If too close to start point, don't snap angle
  if (radialDist < 0.05) return null;

  // Calculate angle in degrees [0, 360)
  let rawAngle = Math.atan2(dPlane, dx) * RAD_TO_DEG;
  if (rawAngle < 0) rawAngle += 360;

  // Find closest allowed angle
  let closestAngle = null;
  let minDiff = toleranceDeg;

  for (const angle of allowedAnglesDeg) {
    const normalizedTarget = ((angle % 360) + 360) % 360;
    let diff = Math.abs(rawAngle - normalizedTarget);
    if (diff > 180) diff = 360 - diff;

    if (diff <= minDiff) {
      minDiff = diff;
      closestAngle = normalizedTarget;
    }
  }

  if (closestAngle === null) return null;

  // Re-project point along exact snapped angle ray with current radial distance
  const snapRad = closestAngle * DEG_TO_RAD;
  const snappedX = fromPoint.x + radialDist * Math.cos(snapRad);
  const snappedPlane = upAxis === 'Y'
    ? fromPoint.z + radialDist * Math.sin(snapRad)
    : fromPoint.y + radialDist * Math.sin(snapRad);

  const snappedPoint = upAxis === 'Y'
    ? { x: snappedX, y: fromPoint.y, z: snappedPlane }
    : { x: snappedX, y: snappedPlane, z: fromPoint.z };

  return {
    point: snappedPoint,
    snapType: 'polar_angle',
    angleDeg: closestAngle,
    distance: vec3.distance(toPoint, snappedPoint),
    guideAxis: closestAngle % 90 === 0 ? (closestAngle % 180 === 0 ? 'X' : upAxis === 'Y' ? 'Z' : 'Y') : null,
  };
}

/**
 * 3-Axis Orthogonal Snapping (locks to dominant single axis X, Y, or Z).
 * @param {Point3D} fromPoint
 * @param {Point3D} toPoint
 * @returns {SnapCandidate}
 */
export function snapOrtho3D(fromPoint, toPoint) {
  const dx = toPoint.x - fromPoint.x;
  const dy = toPoint.y - fromPoint.y;
  const dz = toPoint.z - fromPoint.z;

  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  const absZ = Math.abs(dz);
  const max = Math.max(absX, absY, absZ);

  let point;
  let guideAxis;

  if (max === absY) {
    point = { x: fromPoint.x, y: toPoint.y, z: fromPoint.z };
    guideAxis = 'Y';
  } else if (max === absX) {
    point = { x: toPoint.x, y: fromPoint.y, z: fromPoint.z };
    guideAxis = 'X';
  } else {
    point = { x: fromPoint.x, y: fromPoint.y, z: toPoint.z };
    guideAxis = 'Z';
  }

  return {
    point,
    snapType: 'ortho',
    distance: vec3.distance(toPoint, point),
    guideAxis,
  };
}

/**
 * Intersects a 3D ray with a horizontal elevation plane with camera horizon fallback.
 *
 * @param {Point3D} rayOrigin - Camera world position
 * @param {Point3D} rayDir - Normalized camera view direction vector
 * @param {number} elevation - Target elevation height
 * @param {'Y'|'Z'} [upAxis='Y'] - Height axis ('Y' for Three.js, 'Z' for IFC)
 * @param {Point3D|null} [lastPoint=null] - Last placed point for horizon fallback projection
 * @returns {Point3D|null}
 */
export function raycastElevationPlane(rayOrigin, rayDir, elevation, upAxis = 'Y', lastPoint = null) {
  const originHeight = upAxis === 'Y' ? rayOrigin.y : rayOrigin.z;
  const dirHeight = upAxis === 'Y' ? rayDir.y : rayDir.z;

  // Plane equation: point[upAxis] = elevation
  // ray: P = origin + t * dir => originHeight + t * dirHeight = elevation
  // t = (elevation - originHeight) / dirHeight

  if (Math.abs(dirHeight) > EPSILON) {
    const t = (elevation - originHeight) / dirHeight;
    if (t > 0) {
      // Valid forward intersection
      const hit = vec3.add(rayOrigin, vec3.scale(rayDir, t));
      if (upAxis === 'Y') hit.y = elevation;
      else hit.z = elevation;
      return hit;
    }
  }

  // Horizon Fallback: If camera is horizontal or pointing away from plane,
  // project along ray at a fixed comfortable distance so the line never vanishes.
  const fallbackDist = lastPoint
    ? Math.max(5.0, vec3.distance(rayOrigin, lastPoint))
    : 10.0;

  const forwardPoint = vec3.add(rayOrigin, vec3.scale(rayDir, fallbackDist));
  if (upAxis === 'Y') forwardPoint.y = elevation;
  else forwardPoint.z = elevation;
  return forwardPoint;
}

/**
 * Comprehensive Snap Engine class with Revit-like priority resolution.
 */
export class SnapEngine {
  constructor(options = {}) {
    this.toleranceMetres = options.toleranceMetres ?? 0.25;
    this.angularToleranceDeg = options.angularToleranceDeg ?? 4.5;
    this.upAxis = options.upAxis ?? 'Y';
    this.polarEnabled = options.polarEnabled ?? true;
    this.orthoEnabled = options.orthoEnabled ?? false;
    this.endpointSnapEnabled = options.endpointSnapEnabled ?? true;
    this.midpointSnapEnabled = options.midpointSnapEnabled ?? true;
    this.segmentSnapEnabled = options.segmentSnapEnabled ?? true;
    this.allowedPolarAngles = options.allowedPolarAngles ?? [0, 45, 90, 135, 180, 225, 270, 315];
  }

  /**
   * Resolve best snap target for a given raw point.
   * Priority:
   *  1. Endpoint Snap
   *  2. Midpoint Snap
   *  3. Segment Centerline Snap
   *  4. Ortho Lock (if enabled and lastPoint exists)
   *  5. Polar Angle Snap (if enabled and lastPoint exists)
   *  6. Unmodified raw point
   *
   * @param {Point3D} rawPoint
   * @param {Object} context
   * @param {Point3D|null} [context.lastPoint]
   * @param {Array<{ id: string, x: number, y: number, z: number }>} [context.nodes]
   * @param {Array<{ id: string, start: Point3D, end: Point3D }>} [context.segments]
   * @returns {SnapCandidate}
   */
  resolve(rawPoint, context = {}) {
    const { lastPoint = null, nodes = [], segments = [] } = context;

    // 1. Endpoint Snap
    if (this.endpointSnapEnabled && nodes.length > 0) {
      const nodeSnap = snapToNodes(rawPoint, nodes, this.toleranceMetres);
      if (nodeSnap) return nodeSnap;
    }

    // 2. Segment & Midpoint Snap
    if ((this.midpointSnapEnabled || this.segmentSnapEnabled) && segments.length > 0) {
      const segSnap = snapToSegments(rawPoint, segments, this.toleranceMetres);
      if (segSnap) {
        if (segSnap.snapType === 'midpoint' && this.midpointSnapEnabled) return segSnap;
        if (segSnap.snapType === 'segment' && this.segmentSnapEnabled) return segSnap;
      }
    }

    // 3. Orthogonal Constraint (Strict 3-Axis)
    if (this.orthoEnabled && lastPoint) {
      return snapOrtho3D(lastPoint, rawPoint);
    }

    // 4. Polar Angle Snap (Revit Angular Guide)
    if (this.polarEnabled && lastPoint) {
      const polarSnap = snapPolarAngle(lastPoint, rawPoint, {
        allowedAnglesDeg: this.allowedPolarAngles,
        toleranceDeg: this.angularToleranceDeg,
        upAxis: this.upAxis,
      });
      if (polarSnap) return polarSnap;
    }

    // 5. Raw point fallback (Workplane)
    return {
      point: { x: rawPoint.x, y: rawPoint.y, z: rawPoint.z },
      snapType: 'workplane',
      distance: 0,
      targetId: null,
      guideAxis: null,
    };
  }
}
