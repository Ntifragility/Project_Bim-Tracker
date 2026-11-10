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

/**
 * Revit MEP-Style Bend Angle Constraint during interactive layout.
 *
 * Constrains the candidate cursor point (pCursor) relative to the incoming segment
 * (pPrev -> pAnchor) according to standard NEC / Revit bend angles:
 * [0°, 11.25°, 15°, 22.5°, 30°, 45°, 60°, 90°].
 *
 * @param {Point3D} pPrev - Start of incoming segment
 * @param {Point3D} pAnchor - End of incoming segment (the apex/corner)
 * @param {Point3D} pCursor - Raw cursor candidate point in 3D
 * @param {Object} [options]
 * @param {number[]} [options.allowedAnglesDeg] - Allowed bend angles (default [0, 11.25, 15, 22.5, 30, 45, 60, 90])
 * @param {number} [options.toleranceDeg] - Angular snap tolerance window (default 6.0°)
 * @param {boolean} [options.enforceSpecificAngles] - When true, forces snapping to nearest allowed angle
 * @param {number} [options.minTangentM] - Minimum required straight tangent distance (meters)
 * @param {'Y'|'Z'} [options.upAxis] - Up axis ('Y' for Three.js, 'Z' for IFC)
 * @returns {{
 *   point: Point3D,
 *   bendAngleDeg: number,
 *   rawAngleDeg: number,
 *   isSnapped: boolean,
 *   isStandard: boolean,
 *   tangentValid: boolean,
 *   minTangentM: number,
 *   distance: number
 * }}
 */
/**
 * Revit MEP-Style Cartesian XYZ Bend Angle Constraint during interactive layout.
 *
 * Constrains candidate cursor points strictly relative to the Cartesian XYZ coordinate reference:
 * - Primary Orthogonal Axes: X (East-West), Z (North-South), Y (Vertical Elevation).
 * - Planar Diagonals: 45° offsets in the horizontal plane (X-Z).
 *
 * When turning from an X-pipe to a Z-pipe: exact 90° Cartesian corner fillet in the X-Z plane.
 * When turning from a horizontal pipe to a vertical riser: exact 90° Cartesian vertical fillet in X-Y or Z-Y plane.
 * When taking an offset: exact 45° Cartesian fillet in the X-Z plane.
 * When extending collinear: 0° bend (straight continuation without curves).
 *
 * @param {Point3D} pPrev - Start of incoming segment
 * @param {Point3D} pAnchor - End of incoming segment (the apex/corner)
 * @param {Point3D} pCursor - Raw cursor candidate point in 3D
 * @param {Object} [options]
 * @param {number[]} [options.allowedAnglesDeg] - Allowed relative turn angles (default [0, 45, 90])
 * @param {number} [options.toleranceDeg] - Angular snap tolerance window (default 18.0°)
 * @param {boolean} [options.enforceSpecificAngles] - When true, forces snapping to nearest Cartesian direction
 * @param {boolean} [options.allow45] - Allow 45° diagonal snap (default true)
 * @param {number} [options.minTangentM] - Minimum required straight tangent distance (meters)
 * @param {'Y'|'Z'} [options.upAxis] - Up axis ('Y' for Three.js, 'Z' for IFC)
 * @returns {{
 *   point: Point3D,
 *   bendAngleDeg: number,
 *   rawAngleDeg: number,
 *   cartesianAxis: 'X'|'Z'|'Y'|'XZ_45'|'none',
 *   cartesianHeading: string,
 *   isSnapped: boolean,
 *   isStandard: boolean,
 *   tangentValid: boolean,
 *   minTangentM: number,
 *   distance: number
 * }}
 */
export function constrainConduitBendAngle(
  pPrev,
  pAnchor,
  pCursor,
  {
    allowedAnglesDeg = [0, 15, 22.5, 30, 45, 60, 90],
    toleranceDeg = 18.0,
    enforceSpecificAngles = true,
    cartesianReference = true,
    allow45 = true,
    minTangentM = 0,
    upAxis = 'Y',
  } = {}
) {
  if (!pAnchor || !pCursor) {
    return {
      point: pCursor,
      bendAngleDeg: 0,
      rawAngleDeg: 0,
      cartesianAxis: 'none',
      cartesianHeading: '',
      isSnapped: false,
      isStandard: false,
      tangentValid: true,
      minTangentM: 0,
      distance: 0,
    };
  }

  // Coordinate projections on the active work plane
  const dxOut = pCursor.x - pAnchor.x;
  const dPlaneOut = upAxis === 'Y' ? pCursor.z - pAnchor.z : pCursor.y - pAnchor.y;
  const outLen = Math.hypot(dxOut, dPlaneOut);

  // If the cursor is extremely close to the anchor, return anchor
  if (outLen < 0.03) {
    return {
      point: { ...pCursor },
      bendAngleDeg: 0,
      rawAngleDeg: 0,
      cartesianAxis: 'none',
      cartesianHeading: '',
      isSnapped: false,
      isStandard: true,
      tangentValid: minTangentM <= 0.03,
      minTangentM,
      distance: outLen,
    };
  }

  // Relative mode (when cartesianReference is explicitly false)
  if (!cartesianReference) {
    if (!pPrev) {
      return {
        point: pCursor,
        bendAngleDeg: 0,
        rawAngleDeg: 0,
        cartesianAxis: 'none',
        cartesianHeading: '',
        isSnapped: false,
        isStandard: true,
        tangentValid: true,
        minTangentM: 0,
        distance: vec3.distance(pAnchor, pCursor),
      };
    }

    const dxIn = pAnchor.x - pPrev.x;
    const dPlaneIn = upAxis === 'Y' ? pAnchor.z - pPrev.z : pAnchor.y - pPrev.y;
    const inLen = Math.hypot(dxIn, dPlaneIn);

    if (inLen < EPSILON) {
      return {
        point: { ...pCursor },
        bendAngleDeg: 90,
        rawAngleDeg: 90,
        cartesianAxis: 'Y',
        cartesianHeading: 'Y',
        isSnapped: true,
        isStandard: true,
        tangentValid: outLen >= minTangentM,
        minTangentM,
        distance: outLen,
      };
    }

    const headingIn = Math.atan2(dPlaneIn, dxIn);
    const headingOut = Math.atan2(dPlaneOut, dxOut);

    let deltaAngleRad = headingOut - headingIn;
    while (deltaAngleRad > Math.PI) deltaAngleRad -= 2 * Math.PI;
    while (deltaAngleRad <= -Math.PI) deltaAngleRad += 2 * Math.PI;

    const rawAngleDeg = Math.abs(deltaAngleRad) * RAD_TO_DEG;
    const turnSign = deltaAngleRad >= 0 ? 1 : -1;

    let closestAngle = allowedAnglesDeg[0];
    let minDiff = Infinity;
    for (const std of allowedAnglesDeg) {
      const diff = Math.abs(rawAngleDeg - std);
      if (diff < minDiff) {
        minDiff = diff;
        closestAngle = std;
      }
    }

    const isSnapped = minDiff <= toleranceDeg;
    const useAngle = (isSnapped || enforceSpecificAngles) ? closestAngle : rawAngleDeg;
    const isStandard = isSnapped || (enforceSpecificAngles && minDiff <= 15.0);

    const finalHeadingRad = headingIn + (turnSign * useAngle * DEG_TO_RAD);
    const effectiveLen = Math.max(outLen, minTangentM > 0 && enforceSpecificAngles ? minTangentM : 0);
    const tangentValid = outLen >= (minTangentM - 0.01);

    const snappedX = pAnchor.x + effectiveLen * Math.cos(finalHeadingRad);
    const snappedPlane = (upAxis === 'Y' ? pAnchor.z : pAnchor.y) + effectiveLen * Math.sin(finalHeadingRad);

    const snappedPoint = upAxis === 'Y'
      ? { x: snappedX, y: pCursor.y, z: snappedPlane }
      : { x: snappedX, y: snappedPlane, z: pCursor.z };

    return {
      point: snappedPoint,
      bendAngleDeg: useAngle,
      rawAngleDeg: Math.round(rawAngleDeg * 10) / 10,
      cartesianAxis: 'none',
      cartesianHeading: '',
      isSnapped,
      isStandard,
      tangentValid,
      minTangentM,
      distance: effectiveLen,
    };
  }

  // 1. Cartesian XYZ Reference Mode (Default in 3D BIM)
  const cartesianTargets = allow45
    ? [0, 45, 90, 135, 180, 225, 270, 315]
    : [0, 90, 180, 270];

  let rawHeadingDeg = Math.atan2(dPlaneOut, dxOut) * RAD_TO_DEG;
  if (rawHeadingDeg < 0) rawHeadingDeg += 360;

  let closestHeading = cartesianTargets[0];
  let minDiff = Infinity;
  for (const target of cartesianTargets) {
    let diff = Math.abs(rawHeadingDeg - target);
    if (diff > 180) diff = 360 - diff;
    if (diff < minDiff) {
      minDiff = diff;
      closestHeading = target;
    }
  }

  const isCartesianSnapped = minDiff <= toleranceDeg || enforceSpecificAngles;
  const snappedHeading = isCartesianSnapped ? closestHeading : rawHeadingDeg;

  const snapRad = snappedHeading * DEG_TO_RAD;
  let snappedX = pAnchor.x + outLen * Math.cos(snapRad);
  let snappedPlane = (upAxis === 'Y' ? pAnchor.z : pAnchor.y) + outLen * Math.sin(snapRad);

  let cartesianAxis = 'none';
  let cartesianHeading = '';
  if (snappedHeading === 0) {
    snappedPlane = upAxis === 'Y' ? pAnchor.z : pAnchor.y;
    cartesianAxis = 'X';
    cartesianHeading = 'X+';
  } else if (snappedHeading === 180) {
    snappedPlane = upAxis === 'Y' ? pAnchor.z : pAnchor.y;
    cartesianAxis = 'X';
    cartesianHeading = 'X-';
  } else if (snappedHeading === 90) {
    snappedX = pAnchor.x;
    cartesianAxis = upAxis === 'Y' ? 'Z' : 'Y';
    cartesianHeading = upAxis === 'Y' ? 'Z+' : 'Y+';
  } else if (snappedHeading === 270) {
    snappedX = pAnchor.x;
    cartesianAxis = upAxis === 'Y' ? 'Z' : 'Y';
    cartesianHeading = upAxis === 'Y' ? 'Z-' : 'Y-';
  } else if (snappedHeading % 90 === 45) {
    cartesianAxis = 'XZ_45';
    cartesianHeading = '45° Offset';
  }

  const snappedPoint = upAxis === 'Y'
    ? { x: snappedX, y: pCursor.y, z: snappedPlane }
    : { x: snappedX, y: snappedPlane, z: pCursor.z };

  if (!pPrev) {
    return {
      point: snappedPoint,
      bendAngleDeg: 0,
      rawAngleDeg: 0,
      cartesianAxis,
      cartesianHeading,
      isSnapped: false, // first segment has no prior bend
      isStandard: true,
      tangentValid: true,
      minTangentM: 0,
      distance: outLen,
    };
  }

  const dxIn = pAnchor.x - pPrev.x;
  const dPlaneIn = upAxis === 'Y' ? pAnchor.z - pPrev.z : pAnchor.y - pPrev.y;
  const inLen = Math.hypot(dxIn, dPlaneIn);

  let bendAngleDeg = 0;
  let isStandard = true;

  if (inLen > EPSILON) {
    let inHeadingDeg = Math.atan2(dPlaneIn, dxIn) * RAD_TO_DEG;
    if (inHeadingDeg < 0) inHeadingDeg += 360;

    let closestInHeading = cartesianTargets[0];
    let minInDiff = Infinity;
    for (const target of cartesianTargets) {
      let diff = Math.abs(inHeadingDeg - target);
      if (diff > 180) diff = 360 - diff;
      if (diff < minInDiff) {
        minInDiff = diff;
        closestInHeading = target;
      }
    }
    const refInHeading = minInDiff <= 18.0 ? closestInHeading : inHeadingDeg;

    let deltaDeg = snappedHeading - refInHeading;
    while (deltaDeg > 180) deltaDeg -= 360;
    while (deltaDeg <= -180) deltaDeg += 360;

    bendAngleDeg = Math.round(Math.abs(deltaDeg) * 10) / 10;
    isStandard = allowedAnglesDeg.some((a) => Math.abs(bendAngleDeg - a) <= 1.0);
  } else {
    bendAngleDeg = 90;
    isStandard = true;
  }

  const tangentValid = outLen >= (minTangentM - 0.01);

  return {
    point: snappedPoint,
    bendAngleDeg,
    rawAngleDeg: bendAngleDeg,
    cartesianAxis,
    cartesianHeading,
    isSnapped: isCartesianSnapped,
    isStandard,
    tangentValid,
    minTangentM,
    distance: outLen,
  };
}
