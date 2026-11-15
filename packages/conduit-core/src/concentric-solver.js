/**
 * Parallel Conduit Rack & Concentric Elbow Solver.
 * Implements the mathematical laws of Autodesk Revit MEP "Parallel Conduits":
 * - Offsets multi-segment 3D runs along the angle bisectors of turns
 * - Computes concentric bend radii R_k = R_base + k * S so pipes never collide
 * - Multi-tier vertical racks (trapeze arrangements)
 * Zero DOM or Three.js dependencies (100% portable to Rust/Wasm).
 */

const EPSILON = 1e-6;

/**
 * Generates an N x M rack of parallel conduit runs from a master path.
 *
 * @param {Array<{ x: number, y: number, z: number }>} masterPoints - Waypoints of the master run
 * @param {Object} options
 * @param {number} [options.horizontalCount=2] - Total number of side-by-side conduits (1..12)
 * @param {number} [options.verticalCount=1] - Number of vertical tiers (1..4)
 * @param {number} [options.spacingM=0.0762] - Center-to-center spacing in metres (default: 3" / 76.2mm)
 * @param {number} [options.verticalSpacingM=0.10] - Vertical tier spacing in metres (default: 100mm)
 * @param {number} [options.minRadiusM=0.1143] - NEC minimum radius for the selected trade size
 * @returns {Array<{ runIndex: number, hIndex: number, vIndex: number, points: Array<{ x: number, y: number, z: number }> }>}
 */
export function generateParallelConduitRack(
  masterPoints,
  {
    horizontalCount = 2,
    verticalCount = 1,
    spacingM = 0.0762,
    verticalSpacingM = 0.10,
    minRadiusM = 0.1143,
  } = {}
) {
  if (!masterPoints || masterPoints.length < 2) return [];

  const hCount = Math.max(1, Math.min(12, Math.floor(horizontalCount)));
  const vCount = Math.max(1, Math.min(4, Math.floor(verticalCount)));

  const runs = [];
  let runIdCounter = 0;

  for (let v = 0; v < vCount; v++) {
    const yOffset = v * verticalSpacingM;

    for (let h = 0; h < hCount; h++) {
      // Lateral offset distance from the master run (h=0 is the master line)
      const lateralOffset = h * spacingM;

      const runPoints = offsetPolyline(masterPoints, lateralOffset, yOffset);
      runs.push({
        runIndex: runIdCounter++,
        hIndex: h,
        vIndex: v,
        points: runPoints,
      });
    }
  }

  return runs;
}

/**
 * Offsets a 3D polyline laterally and vertically, calculating exact corner intersections.
 *
 * @param {Array<{ x: number, y: number, z: number }>} points
 * @param {number} lateralOffsetM - Distance to offset to the side
 * @param {number} verticalOffsetM - Distance to offset along Y
 * @returns {Array<{ x: number, y: number, z: number }>}
 */
export function offsetPolyline(points, lateralOffsetM, verticalOffsetM = 0) {
  if (points.length < 2) return points.map((p) => ({ ...p }));

  if (Math.abs(lateralOffsetM) < EPSILON && Math.abs(verticalOffsetM) < EPSILON) {
    return points.map((p) => ({ ...p }));
  }

  const numPoints = points.length;

  // Single straight segment
  if (numPoints === 2) {
    const p0 = points[0];
    const p1 = points[1];
    const dx = p1.x - p0.x;
    const dz = p1.z - p0.z;
    const len = Math.hypot(dx, dz);
    if (len < EPSILON) {
      return [
        { x: p0.x, y: p0.y + verticalOffsetM, z: p0.z },
        { x: p1.x, y: p1.y + verticalOffsetM, z: p1.z },
      ];
    }
    // Normal perpendicular to direction in horizontal plane (right-hand normal)
    const nx = -dz / len;
    const nz = dx / len;

    return [
      {
        x: p0.x + lateralOffsetM * nx,
        y: p0.y + verticalOffsetM,
        z: p0.z + lateralOffsetM * nz,
      },
      {
        x: p1.x + lateralOffsetM * nx,
        y: p1.y + verticalOffsetM,
        z: p1.z + lateralOffsetM * nz,
      },
    ];
  }

  // Multi-segment polyline: compute segment normals
  const segNormals = [];
  for (let i = 0; i < numPoints - 1; i++) {
    const pA = points[i];
    const pB = points[i + 1];
    const dx = pB.x - pA.x;
    const dz = pB.z - pA.z;
    const len = Math.hypot(dx, dz);
    if (len < EPSILON) {
      segNormals.push({ nx: 0, nz: 0 });
    } else {
      segNormals.push({ nx: -dz / len, nz: dx / len });
    }
  }

  const offsetPoints = [];

  // 1. First endpoint
  const n0 = segNormals[0];
  offsetPoints.push({
    x: points[0].x + lateralOffsetM * n0.nx,
    y: points[0].y + verticalOffsetM,
    z: points[0].z + lateralOffsetM * n0.nz,
  });

  // 2. Intermediate corners: offset along the bisector of incoming and outgoing segment normals
  for (let i = 1; i < numPoints - 1; i++) {
    const nPrev = segNormals[i - 1];
    const nCurr = segNormals[i];

    // Bisector normal
    const bx = nPrev.nx + nCurr.nx;
    const bz = nPrev.nz + nCurr.nz;
    const bLen = Math.hypot(bx, bz);

    if (bLen < EPSILON) {
      // Parallel or 180° turn fallback
      offsetPoints.push({
        x: points[i].x + lateralOffsetM * nCurr.nx,
        y: points[i].y + verticalOffsetM,
        z: points[i].z + lateralOffsetM * nCurr.nz,
      });
    } else {
      // Scale bisector by 1 / cos(theta/2) = 2 / dot(nPrev, bisector)
      const uBx = bx / bLen;
      const uBz = bz / bLen;
      const dot = nPrev.nx * uBx + nPrev.nz * uBz;
      const scale = Math.abs(dot) > EPSILON ? lateralOffsetM / dot : lateralOffsetM;

      offsetPoints.push({
        x: points[i].x + scale * uBx,
        y: points[i].y + verticalOffsetM,
        z: points[i].z + scale * uBz,
      });
    }
  }

  // 3. Last endpoint
  const nLast = segNormals[segNormals.length - 1];
  offsetPoints.push({
    x: points[numPoints - 1].x + lateralOffsetM * nLast.nx,
    y: points[numPoints - 1].y + verticalOffsetM,
    z: points[numPoints - 1].z + lateralOffsetM * nLast.nz,
  });

  return offsetPoints;
}

/**
 * Computes concentric bend radii for a parallel rack so that pipes curve smoothly without collision.
 *
 * @param {number} baseRadiusM - Inner or master conduit radius
 * @param {number} spacingM - Spacing between adjacent pipes
 * @param {number} count - Number of conduits in the rack
 * @returns {number[]} Array of concentric radii
 */
export function calculateConcentricRadii(baseRadiusM, spacingM, count) {
  const radii = [];
  for (let i = 0; i < count; i++) {
    radii.push(Math.round((baseRadiusM + i * spacingM) * 100000) / 100000);
  }
  return radii;
}
