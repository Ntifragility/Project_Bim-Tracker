// Revit-Style Conduit Fitting & Bend Radius Solver
// Implements NFPA 70 / NEC Chapter 9 Table 2 conduit bend standards,
// smooth arc fillet elbow generation, auto-riser vertical solvers,
// and NEC 360° cumulative bend checking (NEC 358.26 / 344.26).
//
// Pure mathematical functions, zero DOM dependencies, 100% portable to Rust/Wasm.

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const EPSILON = 1e-7;

/**
 * NFPA 70 / NEC Chapter 9 Table 2: Minimum Radius of Conduit Bends
 * Centerline bend radius for one-shot or full shoe benders.
 * Keys in inches with corresponding millimetres and standard radius in metres.
 */
export const NEC_BEND_TABLE = [
  { tradeSize: '1/2"', label: '½"', mm: 12.7, radiusInches: 4.0, radiusM: 0.1016 },
  { tradeSize: '3/4"', label: '¾"', mm: 19.05, radiusInches: 4.5, radiusM: 0.1143 },
  { tradeSize: '1"', label: '1"', mm: 25.4, radiusInches: 5.75, radiusM: 0.146 },
  { tradeSize: '1-1/4"', label: '1¼"', mm: 31.75, radiusInches: 7.25, radiusM: 0.1841 },
  { tradeSize: '1-1/2"', label: '1½"', mm: 38.1, radiusInches: 8.25, radiusM: 0.2095 },
  { tradeSize: '2"', label: '2"', mm: 50.8, radiusInches: 9.5, radiusM: 0.2413 },
  { tradeSize: '2-1/2"', label: '2½"', mm: 63.5, radiusInches: 10.5, radiusM: 0.2667 },
  { tradeSize: '3"', label: '3"', mm: 76.2, radiusInches: 13.0, radiusM: 0.3302 },
  { tradeSize: '3-1/2"', label: '3½"', mm: 88.9, radiusInches: 15.0, radiusM: 0.381 },
  { tradeSize: '4"', label: '4"', mm: 101.6, radiusInches: 16.0, radiusM: 0.4064 },
];

/**
 * Lookup standard NEC centerline bend radius in metres for a given diameter.
 * @param {string|number} diameterQuery - Trade size string (e.g. '3/4"', '¾"') or diameter in mm
 * @returns {number} Minimum bend radius in metres
 */
export function getNecBendRadiusM(diameterQuery) {
  if (typeof diameterQuery === 'number') {
    // Find closest diameter in mm
    let closest = NEC_BEND_TABLE[0];
    let minDiff = Math.abs(diameterQuery - closest.mm);
    for (const row of NEC_BEND_TABLE) {
      const diff = Math.abs(diameterQuery - row.mm);
      if (diff < minDiff) {
        minDiff = diff;
        closest = row;
      }
    }
    return closest.radiusM;
  }

  const str = String(diameterQuery || '').trim();
  const match = NEC_BEND_TABLE.find(
    (row) =>
      row.tradeSize === str ||
      row.label === str ||
      row.tradeSize.replace(/-/g, ' ') === str.replace(/-/g, ' ')
  );
  return match ? match.radiusM : 0.1143; // Default to 3/4" radius (4.5" = 0.1143m)
}

// Vector math utilities
const v3 = {
  add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }),
  sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }),
  scale: (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s }),
  dot: (a, b) => a.x * b.x + a.y * b.y + a.z * b.z,
  cross: (a, b) => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }),
  lengthSq: (a) => a.x * a.x + a.y * a.y + a.z * a.z,
  length: (a) => Math.hypot(a.x, a.y, a.z),
  normalize: (a) => {
    const len = Math.hypot(a.x, a.y, a.z);
    return len > EPSILON ? { x: a.x / len, y: a.y / len, z: a.z / len } : { x: 0, y: 0, z: 0 };
  },
};

/**
 * Calculates the turn/bend angle in degrees between two connecting line segments:
 * (p1 -> pCorner) and (pCorner -> p2).
 * A straight line = 0° bend. A right-angle corner = 90° bend.
 *
 * @param {Object} p1
 * @param {Object} pCorner
 * @param {Object} p2
 * @returns {number} Bend angle in degrees [0, 180]
 */
export function calculateBendAngle(p1, pCorner, p2) {
  const d1 = v3.sub(pCorner, p1);
  const d2 = v3.sub(p2, pCorner);
  const len1 = v3.length(d1);
  const len2 = v3.length(d2);

  if (len1 < EPSILON || len2 < EPSILON) return 0;

  // Dot product of incoming ray d1 and outgoing ray d2
  const cosTheta = Math.max(-1, Math.min(1, v3.dot(d1, d2) / (len1 * len2)));
  return Math.acos(cosTheta) * RAD_TO_DEG;
}

/**
 * Solves a smooth circular arc elbow fillet fitting between segments (p1 -> pCorner) and (pCorner -> p2).
 *
 * @param {Object} p1 - Incoming point
 * @param {Object} pCorner - Apex/corner intersection point
 * @param {Object} p2 - Outgoing point
 * @param {number} bendRadius - Centerline bend radius in metres (e.g. from getNecBendRadiusM)
 * @param {number} [arcSegments=8] - Number of subdivisions along the curved arc
 * @returns {Object} Solution with tangent points, center, arcPoints, and bend angle
 */
export function solveElbowFitting(p1, pCorner, p2, bendRadius, arcSegments = 8) {
  const bendAngleDeg = calculateBendAngle(p1, pCorner, p2);

  // If angle is negligible (< 1 degree), treat as straight line without an elbow
  if (bendAngleDeg < 1.0) {
    return {
      isValid: false,
      isStraight: true,
      bendAngleDeg: 0,
      tangentStart: pCorner,
      tangentEnd: pCorner,
      arcPoints: [pCorner],
    };
  }

  const u = v3.normalize(v3.sub(p1, pCorner)); // Unit vector back towards p1
  const v = v3.normalize(v3.sub(p2, pCorner)); // Unit vector towards p2

  const halfBendRad = (bendAngleDeg * 0.5) * DEG_TO_RAD;

  // Tangent distance from corner apex to arc start/end
  // T = R * tan(alpha / 2)
  const tangentDist = bendRadius * Math.tan(halfBendRad);

  const len1 = v3.length(v3.sub(p1, pCorner));
  const len2 = v3.length(v3.sub(p2, pCorner));
  const maxAllowableTangent = Math.min(len1, len2) * 0.95;

  const effectiveTangent = Math.min(tangentDist, maxAllowableTangent);
  const effectiveRadius = effectiveTangent / Math.tan(halfBendRad);

  // Tangent contact points
  const pStart = v3.add(pCorner, v3.scale(u, effectiveTangent));
  const pEnd = v3.add(pCorner, v3.scale(v, effectiveTangent));

  // Center of the circle
  // Bisector vector pointing inwards from corner
  const bisector = v3.normalize(v3.add(u, v));
  const distToCenter = effectiveRadius / Math.cos(halfBendRad);
  const center = v3.add(pCorner, v3.scale(bisector, distToCenter));

  // Radii vectors from center to start and end points
  const rStart = v3.sub(pStart, center);
  const rEnd = v3.sub(pEnd, center);

  // Normal to the plane of the bend
  const bendNormal = v3.normalize(v3.cross(u, v));

  // Generate smooth discrete arc points from pStart to pEnd
  const arcPoints = [];
  for (let i = 0; i <= arcSegments; i++) {
    const fraction = i / arcSegments;
    const currentAngleRad = fraction * (bendAngleDeg * DEG_TO_RAD);

    // Rodrigues' rotation formula: rotate rStart around bendNormal towards rEnd
    // But since it's planar in the circle:
    // Slerp or orthogonal basis in circle plane:
    const vOrtho = v3.normalize(v3.cross(bendNormal, v3.normalize(rStart)));
    const ptOnCircle = v3.add(
      center,
      v3.add(
        v3.scale(v3.normalize(rStart), effectiveRadius * Math.cos(currentAngleRad)),
        v3.scale(vOrtho, effectiveRadius * Math.sin(currentAngleRad))
      )
    );
    arcPoints.push(ptOnCircle);
  }

  // Ensure exact endpoints
  arcPoints[0] = pStart;
  arcPoints[arcPoints.length - 1] = pEnd;

  return {
    isValid: true,
    isStraight: false,
    bendAngleDeg,
    bendRadius: effectiveRadius,
    tangentDistance: effectiveTangent,
    tangentStart: pStart,
    tangentEnd: pEnd,
    center,
    arcPoints,
  };
}

/**
 * Calculates cumulative degrees of bend for an entire conduit run.
 * Checks against the NEC 360° maximum limit (NEC 358.26 / 344.26).
 *
 * @param {Array<{ x: number, y: number, z: number }>} points - Ordered points in run
 * @returns {Object} Cumulative bend analysis
 */
export function analyzeRunBends(points) {
  if (!points || points.length < 3) {
    return {
      totalDegrees: 0,
      fittingsCount: 0,
      exceedsNec360: false,
      warning: null,
      bends: [],
    };
  }

  let totalDegrees = 0;
  const bends = [];

  for (let i = 1; i < points.length - 1; i++) {
    const pPrev = points[i - 1];
    const pCurr = points[i];
    const pNext = points[i + 1];

    const angle = calculateBendAngle(pPrev, pCurr, pNext);
    if (angle >= 1.0) {
      totalDegrees += angle;
      bends.push({
        index: i,
        point: pCurr,
        angleDeg: Number(angle.toFixed(1)),
        isQuarterBend: Math.abs(angle - 90) <= 2.0,
      });
    }
  }

  const exceedsNec360 = totalDegrees > 360.0;
  const warning = exceedsNec360
    ? `Warning: Run contains ${totalDegrees.toFixed(1)}° of bends (exceeds NEC 360° maximum allowed between pull points).`
    : null;

  return {
    totalDegrees: Number(totalDegrees.toFixed(1)),
    fittingsCount: bends.length,
    exceedsNec360,
    warning,
    bends,
  };
}

/**
 * Generates an Auto-Riser vertical transition solver between current elevation and target elevation.
 *
 * @param {Object} startPoint - { x, y, z }
 * @param {number} targetElevation - New elevation (e.g. Y in Three.js or Z in IFC)
 * @param {Object} options
 * @param {'Y'|'Z'} [options.upAxis='Y'] - Elevation axis
 * @param {number} [options.diameterMm=19.05] - Conduit diameter
 * @returns {Array<Object>} Generated intermediate nodes representing the vertical riser
 */
export function solveAutoRiser(startPoint, targetElevation, { upAxis = 'Y', diameterMm = 19.05 } = {}) {
  const currentHeight = upAxis === 'Y' ? startPoint.y : startPoint.z;
  const heightDiff = targetElevation - currentHeight;

  if (Math.abs(heightDiff) < 0.01) {
    return [startPoint];
  }

  // Intermediate vertical riser node
  const riserNode = {
    x: startPoint.x,
    y: upAxis === 'Y' ? targetElevation : startPoint.y,
    z: upAxis === 'Z' ? targetElevation : startPoint.z,
    isRiser: true,
    heightDelta: heightDiff,
  };

  return [startPoint, riserNode];
}
