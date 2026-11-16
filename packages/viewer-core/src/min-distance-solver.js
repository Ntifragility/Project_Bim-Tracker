// Pure 3D geometry closest-point & length formatting helpers for Revizto Ruler.
// Handles:
//   - Multi-unit formatting (m, cm, mm, ft, in, ft-in with nearest 1/16")
//   - Exact triangle-to-triangle / point-to-triangle / segment-to-segment closest pairs
//   - Triangle extraction from Three.js objects AND @thatopen/fragments localIds

import * as THREE from "three";

export const MEASUREMENT_UNITS = ["m", "cm", "mm", "ft", "in", "ft-in"];

export const MEASUREMENT_UNIT_LABELS = {
  m: "Meters",
  cm: "Centimeters",
  mm: "Millimeters",
  ft: "Feet",
  in: "Inches",
  "ft-in": "Feet & Inches",
};

const M_TO_FT = 1 / 0.3048;
const M_TO_IN = 1 / 0.0254;
const EPS = 1e-10;

function gcd(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

/**
 * Formats a distance in meters into the requested engineering unit.
 */
export function formatMeasurementLength(meters, unit = "m", { showPlus = false } = {}) {
  const num = Number(meters);
  if (!Number.isFinite(num)) return "0.000 m";

  const absVal = Math.abs(num);
  const sign = num < -1e-6 ? "-" : showPlus && num > 1e-6 ? "+" : "";

  switch (unit) {
    case "mm": {
      const mm = Math.round(absVal * 1000);
      return `${mm === 0 ? "" : sign}${mm} mm`;
    }
    case "cm": {
      const cm = absVal * 100;
      const str = cm.toFixed(1);
      return `${Number(str) === 0 ? "" : sign}${str} cm`;
    }
    case "ft": {
      const ft = absVal * M_TO_FT;
      const str = ft.toFixed(3);
      return `${Number(str) === 0 ? "" : sign}${str} ft`;
    }
    case "in": {
      const inches = absVal * M_TO_IN;
      const str = inches.toFixed(2);
      return `${Number(str) === 0 ? "" : sign}${str} in`;
    }
    case "ft-in": {
      const totalSixteenths = Math.round(absVal * M_TO_IN * 16);
      if (totalSixteenths === 0) return `0'-0"`;
      let totalInches = Math.floor(totalSixteenths / 16);
      let remSixteenths = totalSixteenths % 16;
      const feet = Math.floor(totalInches / 12);
      const inches = totalInches % 12;
      if (remSixteenths === 0) {
        return `${sign}${feet}'-${inches}"`;
      }
      const d = gcd(remSixteenths, 16);
      const frac = `${remSixteenths / d}/${16 / d}`;
      return `${sign}${feet}'-${inches} ${frac}"`;
    }
    case "m":
    default: {
      const str = absVal.toFixed(3);
      return `${Number(str) === 0 ? "" : sign}${str} m`;
    }
  }
}

/**
 * Exact Voronoi-region closest point on triangle (a, b, c) to point p.
 * Adapted from Christer Ericson, Real-Time Collision Detection.
 */
export function pointToTriangleClosest(p, a, b, c) {
  const abX = b.x - a.x;
  const abY = b.y - a.y;
  const abZ = b.z - a.z;

  const acX = c.x - a.x;
  const acY = c.y - a.y;
  const acZ = c.z - a.z;

  const apX = p.x - a.x;
  const apY = p.y - a.y;
  const apZ = p.z - a.z;

  const d1 = abX * apX + abY * apY + abZ * apZ;
  const d2 = acX * apX + acY * apY + acZ * apZ;
  if (d1 <= 0 && d2 <= 0) {
    return {
      point: new THREE.Vector3(a.x, a.y, a.z),
      distSq: apX * apX + apY * apY + apZ * apZ,
    };
  }

  const bpX = p.x - b.x;
  const bpY = p.y - b.y;
  const bpZ = p.z - b.z;
  const d3 = abX * bpX + abY * bpY + abZ * bpZ;
  const d4 = acX * bpX + acY * bpY + acZ * bpZ;
  if (d3 >= 0 && d4 <= d3) {
    return {
      point: new THREE.Vector3(b.x, b.y, b.z),
      distSq: bpX * bpX + bpY * bpY + bpZ * bpZ,
    };
  }

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    const px = a.x + v * abX;
    const py = a.y + v * abY;
    const pz = a.z + v * abZ;
    const dx = p.x - px;
    const dy = p.y - py;
    const dz = p.z - pz;
    return {
      point: new THREE.Vector3(px, py, pz),
      distSq: dx * dx + dy * dy + dz * dz,
    };
  }

  const cpX = p.x - c.x;
  const cpY = p.y - c.y;
  const cpZ = p.z - c.z;
  const d5 = abX * cpX + abY * cpY + abZ * cpZ;
  const d6 = acX * cpX + acY * cpY + acZ * cpZ;
  if (d6 >= 0 && d5 <= d6) {
    return {
      point: new THREE.Vector3(c.x, c.y, c.z),
      distSq: cpX * cpX + cpY * cpY + cpZ * cpZ,
    };
  }

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    const px = a.x + w * acX;
    const py = a.y + w * acY;
    const pz = a.z + w * acZ;
    const dx = p.x - px;
    const dy = p.y - py;
    const dz = p.z - pz;
    return {
      point: new THREE.Vector3(px, py, pz),
      distSq: dx * dx + dy * dy + dz * dz,
    };
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    const px = b.x + w * (c.x - b.x);
    const py = b.y + w * (c.y - b.y);
    const pz = b.z + w * (c.z - b.z);
    const dx = p.x - px;
    const dy = p.y - py;
    const dz = p.z - pz;
    return {
      point: new THREE.Vector3(px, py, pz),
      distSq: dx * dx + dy * dy + dz * dz,
    };
  }

  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  const px = a.x + abX * v + acX * w;
  const py = a.y + abY * v + acY * w;
  const pz = a.z + abZ * v + acZ * w;
  const dx = p.x - px;
  const dy = p.y - py;
  const dz = p.z - pz;
  return {
    point: new THREE.Vector3(px, py, pz),
    distSq: dx * dx + dy * dy + dz * dz,
  };
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Exact closest points between two 3D segments [p1, q1] and [p2, q2].
 */
export function segmentToSegmentClosest(p1, q1, p2, q2) {
  const d1x = q1.x - p1.x;
  const d1y = q1.y - p1.y;
  const d1z = q1.z - p1.z;

  const d2x = q2.x - p2.x;
  const d2y = q2.y - p2.y;
  const d2z = q2.z - p2.z;

  const rx = p1.x - p2.x;
  const ry = p1.y - p2.y;
  const rz = p1.z - p2.z;

  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;

  let s = 0;
  let t = 0;

  if (a <= EPS && e <= EPS) {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    const dz = p1.z - p2.z;
    return {
      pointA: new THREE.Vector3(p1.x, p1.y, p1.z),
      pointB: new THREE.Vector3(p2.x, p2.y, p2.z),
      distSq: dx * dx + dy * dy + dz * dz,
    };
  }

  if (a <= EPS) {
    s = 0;
    t = clamp01(f / e);
  } else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= EPS) {
      t = 0;
      s = clamp01(-c / a);
    } else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = a * e - b * b;
      s = denom !== 0 ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp01(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp01((b - c) / a);
      }
    }
  }

  const c1x = p1.x + d1x * s;
  const c1y = p1.y + d1y * s;
  const c1z = p1.z + d1z * s;

  const c2x = p2.x + d2x * t;
  const c2y = p2.y + d2y * t;
  const c2z = p2.z + d2z * t;

  const dx = c1x - c2x;
  const dy = c1y - c2y;
  const dz = c1z - c2z;

  return {
    pointA: new THREE.Vector3(c1x, c1y, c1z),
    pointB: new THREE.Vector3(c2x, c2y, c2z),
    distSq: dx * dx + dy * dy + dz * dz,
  };
}

/**
 * Checks if segment [p, q] pierces triangle (a, b, c) via Möller-Trumbore.
 * Returns intersection point or null.
 */
function intersectSegmentTriangle(p, q, a, b, c) {
  const dirX = q.x - p.x;
  const dirY = q.y - p.y;
  const dirZ = q.z - p.z;
  const lenSq = dirX * dirX + dirY * dirY + dirZ * dirZ;
  if (lenSq <= EPS) return null;

  const e1x = b.x - a.x;
  const e1y = b.y - a.y;
  const e1z = b.z - a.z;

  const e2x = c.x - a.x;
  const e2y = c.y - a.y;
  const e2z = c.z - a.z;

  const hx = dirY * e2z - dirZ * e2y;
  const hy = dirZ * e2x - dirX * e2z;
  const hz = dirX * e2y - dirY * e2x;

  const det = e1x * hx + e1y * hy + e1z * hz;
  if (det > -1e-12 && det < 1e-12) return null;

  const invDet = 1 / det;
  const sx = p.x - a.x;
  const sy = p.y - a.y;
  const sz = p.z - a.z;
  const u = invDet * (sx * hx + sy * hy + sz * hz);
  if (u < -1e-6 || u > 1 + 1e-6) return null;

  const qx = sy * e1z - sz * e1y;
  const qy = sz * e1x - sx * e1z;
  const qz = sx * e1y - sy * e1x;
  const v = invDet * (dirX * qx + dirY * qy + dirZ * qz);
  if (v < -1e-6 || u + v > 1 + 1e-6) return null;

  const t = invDet * (e2x * qx + e2y * qy + e2z * qz);
  if (t >= -1e-6 && t <= 1 + 1e-6) {
    const clampedT = clamp01(t);
    return new THREE.Vector3(
      p.x + dirX * clampedT,
      p.y + dirY * clampedT,
      p.z + dirZ * clampedT,
    );
  }
  return null;
}

function segmentTriangleClosest(p, q, a, b, c) {
  const hit = intersectSegmentTriangle(p, q, a, b, c);
  if (hit) {
    return {
      pointSeg: hit.clone(),
      pointTri: hit.clone(),
      distSq: 0,
    };
  }

  let best = pointToTriangleClosest(p, a, b, c);
  let bestPair = {
    pointSeg: new THREE.Vector3(p.x, p.y, p.z),
    pointTri: best.point,
    distSq: best.distSq,
  };

  const qHit = pointToTriangleClosest(q, a, b, c);
  if (qHit.distSq < bestPair.distSq) {
    bestPair = {
      pointSeg: new THREE.Vector3(q.x, q.y, q.z),
      pointTri: qHit.point,
      distSq: qHit.distSq,
    };
  }

  const edges = [
    [a, b],
    [b, c],
    [c, a],
  ];
  for (const [e0, e1] of edges) {
    const res = segmentToSegmentClosest(p, q, e0, e1);
    if (res.distSq < bestPair.distSq) {
      bestPair = {
        pointSeg: res.pointA,
        pointTri: res.pointB,
        distSq: res.distSq,
      };
    }
  }
  return bestPair;
}

/**
 * Exact closest points between two 3D triangles `[a1, b1, c1]` and `[a2, b2, c2]`.
 * Returns `{ pointA, pointB, distSq }`.
 */
export function triangleToTriangleClosest(t1, t2) {
  const [a1, b1, c1] = t1;
  const [a2, b2, c2] = t2;

  let best = {
    pointA: new THREE.Vector3(a1.x, a1.y, a1.z),
    pointB: new THREE.Vector3(a2.x, a2.y, a2.z),
    distSq: Infinity,
  };

  const e1 = [
    [a1, b1],
    [b1, c1],
    [c1, a1],
  ];
  for (const [p, q] of e1) {
    const r = segmentTriangleClosest(p, q, a2, b2, c2);
    if (r.distSq < best.distSq) {
      best = { pointA: r.pointSeg, pointB: r.pointTri, distSq: r.distSq };
      if (best.distSq <= EPS) return best;
    }
  }

  const e2 = [
    [a2, b2],
    [b2, c2],
    [c2, a2],
  ];
  for (const [p, q] of e2) {
    const r = segmentTriangleClosest(p, q, a1, b1, c1);
    if (r.distSq < best.distSq) {
      best = { pointA: r.pointTri, pointB: r.pointSeg, distSq: r.distSq };
      if (best.distSq <= EPS) return best;
    }
  }

  return best;
}

function wrapTriangle(a, b, c) {
  return {
    tri: [a, b, c],
    minX: Math.min(a.x, b.x, c.x),
    minY: Math.min(a.y, b.y, c.y),
    minZ: Math.min(a.z, b.z, c.z),
    maxX: Math.max(a.x, b.x, c.x),
    maxY: Math.max(a.y, b.y, c.y),
    maxZ: Math.max(a.z, b.z, c.z),
  };
}

function boxToBoxDistSq(a, b) {
  let dx = 0;
  if (a.maxX < b.minX) dx = b.minX - a.maxX;
  else if (b.maxX < a.minX) dx = a.minX - b.maxX;

  let dy = 0;
  if (a.maxY < b.minY) dy = b.minY - a.maxY;
  else if (b.maxY < a.minY) dy = a.minY - b.maxY;

  let dz = 0;
  if (a.maxZ < b.minZ) dz = b.minZ - a.maxZ;
  else if (b.maxZ < a.minZ) dz = a.minZ - b.maxZ;

  return dx * dx + dy * dy + dz * dz;
}

function computeOverallBounds(wrapped) {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const w of wrapped) {
    if (w.minX < minX) minX = w.minX;
    if (w.minY < minY) minY = w.minY;
    if (w.minZ < minZ) minZ = w.minZ;
    if (w.maxX > maxX) maxX = w.maxX;
    if (w.maxY > maxY) maxY = w.maxY;
    if (w.maxZ > maxZ) maxZ = w.maxZ;
  }
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

/**
 * Computes minimum distance between two arrays of `[Vector3, Vector3, Vector3]` triangles.
 * Returns `{ distance, pointA, pointB, clashing }` or `null` if either set is empty.
 */
export function computeMinDistance(trianglesA, trianglesB) {
  if (!trianglesA?.length || !trianglesB?.length) return null;

  const wrappedA = trianglesA.map((t) => wrapTriangle(t[0], t[1], t[2]));
  const wrappedB = trianglesB.map((t) => wrapTriangle(t[0], t[1], t[2]));
  const boxB = computeOverallBounds(wrappedB);
  const boxA = computeOverallBounds(wrappedA);

  for (const w of wrappedA) w.lb = boxToBoxDistSq(w, boxB);
  for (const w of wrappedB) w.lb = boxToBoxDistSq(w, boxA);

  wrappedA.sort((x, y) => x.lb - y.lb);
  wrappedB.sort((x, y) => x.lb - y.lb);

  let best = {
    distSq: Infinity,
    pointA: wrappedA[0].tri[0].clone(),
    pointB: wrappedB[0].tri[0].clone(),
  };

  for (let i = 0; i < wrappedA.length; i++) {
    const wa = wrappedA[i];
    if (wa.lb >= best.distSq) break;

    for (let j = 0; j < wrappedB.length; j++) {
      const wb = wrappedB[j];
      if (wb.lb >= best.distSq) break;
      if (boxToBoxDistSq(wa, wb) >= best.distSq) continue;

      const pair = triangleToTriangleClosest(wa.tri, wb.tri);
      if (pair.distSq < best.distSq) {
        best = pair;
        if (best.distSq <= EPS) {
          return {
            distance: 0,
            pointA: best.pointA,
            pointB: best.pointB,
            clashing: true,
          };
        }
      }
    }
  }

  const distance = Math.sqrt(Math.max(0, best.distSq));
  return {
    distance,
    pointA: best.pointA,
    pointB: best.pointB,
    clashing: distance <= 1e-4,
  };
}

function appendIndexedTriangles(positions, indices, matrixWorld, out) {
  if (!positions || positions.length < 9) return;
  if (indices && indices.length >= 3) {
    for (let i = 0; i + 2 < indices.length; i += 3) {
      const ia = indices[i] * 3;
      const ib = indices[i + 1] * 3;
      const ic = indices[i + 2] * 3;
      if (ic + 2 >= positions.length) continue;
      const a = new THREE.Vector3(positions[ia], positions[ia + 1], positions[ia + 2]).applyMatrix4(matrixWorld);
      const b = new THREE.Vector3(positions[ib], positions[ib + 1], positions[ib + 2]).applyMatrix4(matrixWorld);
      const c = new THREE.Vector3(positions[ic], positions[ic + 1], positions[ic + 2]).applyMatrix4(matrixWorld);
      out.push([a, b, c]);
    }
    return;
  }
  for (let i = 0; i + 8 < positions.length; i += 9) {
    const a = new THREE.Vector3(positions[i], positions[i + 1], positions[i + 2]).applyMatrix4(matrixWorld);
    const b = new THREE.Vector3(positions[i + 3], positions[i + 4], positions[i + 5]).applyMatrix4(matrixWorld);
    const c = new THREE.Vector3(positions[i + 6], positions[i + 7], positions[i + 8]).applyMatrix4(matrixWorld);
    out.push([a, b, c]);
  }
}

/**
 * Extracts world-space triangles from a Three.js Object3D tree (e.g., conduit runs).
 */
export function collectWorldTrianglesFromObject(object3D, { maxTriangles = 12000 } = {}) {
  const triangles = [];
  if (!object3D) return triangles;
  object3D.updateMatrixWorld(true);
  object3D.traverse((child) => {
    if (triangles.length >= maxTriangles) return;
    if (!child.visible || !child.isMesh || !child.geometry) return;
    const pos = child.geometry.attributes?.position;
    if (!pos) return;
    const positions = pos.array;
    const idx = child.geometry.index?.array || null;
    appendIndexedTriangles(positions, idx, child.matrixWorld, triangles);
  });
  return triangles.length > maxTriangles ? triangles.slice(0, maxTriangles) : triangles;
}

/**
 * Extracts world-space triangles for `{ modelId, localIds }` via @thatopen/fragments.
 */
export async function extractItemWorldTriangles(fragments, modelId, localIds, { maxTriangles = 12000 } = {}) {
  const triangles = [];
  if (!fragments || !modelId || !localIds?.length) return triangles;
  const model = fragments.list?.get?.(modelId);
  if (!model?.getItemsGeometry) return triangles;

  model.object?.updateMatrixWorld?.(true);
  const modelMatrix = model.object?.matrixWorld || new THREE.Matrix4();
  const batches = await model.getItemsGeometry(localIds);
  const meshMatrix = new THREE.Matrix4();
  const sampleMatrix = new THREE.Matrix4();

  for (const itemGeoms of batches || []) {
    if (!Array.isArray(itemGeoms)) continue;
    for (const geom of itemGeoms) {
      if (!geom?.positions?.length) continue;
      if (geom.transform) {
        const elems = geom.transform.elements || geom.transform;
        sampleMatrix.fromArray(elems);
        meshMatrix.multiplyMatrices(modelMatrix, sampleMatrix);
      } else {
        meshMatrix.copy(modelMatrix);
      }
      appendIndexedTriangles(geom.positions, geom.indices, meshMatrix, triangles);
      if (triangles.length >= maxTriangles) {
        return triangles.slice(0, maxTriangles);
      }
    }
  }
  return triangles;
}
