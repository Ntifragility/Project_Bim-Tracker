/**
 * Pure mathematical centerline generator for 3D electrical conduit runs.
 * Extracts smooth continuous polyline paths consisting of straight segments
 * and circular SLERP elbow arcs.
 * Zero DOM or Three.js dependencies (100% portable to Rust/Wasm).
 */

import { calculateBendAngle, solveElbowFitting } from './fitting-solver.js';

const EPSILON = 1e-6;

/**
 * Extracts the full continuous 3D centerline of straight legs and circular elbow arcs.
 *
 * @param {Array<{ x: number, y: number, z: number }>} points - Waypoints of the conduit run
 * @param {number} minRadiusM - Centerline bend radius in metres (e.g. from getNecBendRadiusM)
 * @param {number} [arcSegments=12] - Number of subdivisions along each elbow arc
 * @returns {Array<{ x: number, y: number, z: number, isArc?: boolean }>}
 */
export function extractRunCenterline(points, minRadiusM, arcSegments = 12) {
  if (!points || points.length < 2) return [];
  if (points.length === 2) {
    return [
      { x: points[0].x, y: points[0].y, z: points[0].z },
      { x: points[1].x, y: points[1].y, z: points[1].z },
    ];
  }

  const centerline = [{ x: points[0].x, y: points[0].y, z: points[0].z }];

  for (let i = 1; i < points.length - 1; i++) {
    const pPrev = points[i - 1];
    const pCurr = points[i];
    const pNext = points[i + 1];
    const angle = calculateBendAngle(pPrev, pCurr, pNext);
    const hasTurn = angle >= 10.0;
    const elbow = hasTurn ? solveElbowFitting(pPrev, pCurr, pNext, minRadiusM, arcSegments) : null;

    if (elbow && elbow.isValid && !elbow.isStraight) {
      centerline.push({
        x: elbow.tangentStart.x,
        y: elbow.tangentStart.y,
        z: elbow.tangentStart.z,
      });

      for (let a = 1; a < elbow.arcPoints.length - 1; a++) {
        centerline.push({
          x: elbow.arcPoints[a].x,
          y: elbow.arcPoints[a].y,
          z: elbow.arcPoints[a].z,
          isArc: true,
        });
      }

      centerline.push({
        x: elbow.tangentEnd.x,
        y: elbow.tangentEnd.y,
        z: elbow.tangentEnd.z,
      });
    } else {
      centerline.push({ x: pCurr.x, y: pCurr.y, z: pCurr.z });
    }
  }

  centerline.push({
    x: points[points.length - 1].x,
    y: points[points.length - 1].y,
    z: points[points.length - 1].z,
  });

  return centerline;
}

/**
 * Computes the total physical developed length along a 3D centerline path.
 *
 * @param {Array<{ x: number, y: number, z: number }>} centerline
 * @returns {number} Length in metres
 */
export function computeCenterlineLength(centerline) {
  if (!centerline || centerline.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < centerline.length; i++) {
    const dx = centerline[i].x - centerline[i - 1].x;
    const dy = centerline[i].y - centerline[i - 1].y;
    const dz = centerline[i].z - centerline[i - 1].z;
    total += Math.hypot(dx, dy, dz);
  }
  return total;
}

/**
 * Splits a conduit run into discrete straight pipe segments and curved elbow fittings
 * so MEP exporters (IFC4/IFC2X3) and spool generators can schedule segments and bends individually.
 *
 * @param {Array<{ x: number, y: number, z: number }>} points
 * @param {number} minRadiusM
 * @param {number} [arcSegments=12]
 * @returns {Array<{ kind: 'segment'|'fitting', points: Array<{x:number,y:number,z:number}>, bendAngle?: number, radiusM?: number }>}
 */
export function extractRunParts(points, minRadiusM, arcSegments = 12) {
  if (!points || points.length < 2) return [];
  if (points.length === 2) {
    return [{
      kind: 'segment',
      points: [
        { x: points[0].x, y: points[0].y, z: points[0].z },
        { x: points[1].x, y: points[1].y, z: points[1].z },
      ],
    }];
  }

  const parts = [];
  let segStart = { x: points[0].x, y: points[0].y, z: points[0].z };

  const pushSegment = (a, b) => {
    const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    if (len > EPSILON) {
      parts.push({ kind: 'segment', points: [{ x: a.x, y: a.y, z: a.z }, { x: b.x, y: b.y, z: b.z }] });
    }
  };

  for (let i = 1; i < points.length - 1; i++) {
    const pPrev = points[i - 1];
    const pCurr = points[i];
    const pNext = points[i + 1];
    const angle = calculateBendAngle(pPrev, pCurr, pNext);
    const hasTurn = angle >= 10.0;
    const elbow = hasTurn ? solveElbowFitting(pPrev, pCurr, pNext, minRadiusM, arcSegments) : null;

    if (elbow && elbow.isValid && !elbow.isStraight && elbow.arcPoints.length >= 2) {
      pushSegment(segStart, elbow.tangentStart);
      parts.push({
        kind: 'fitting',
        points: elbow.arcPoints.map((p) => ({ x: p.x, y: p.y, z: p.z })),
        bendAngle: angle,
        radiusM: minRadiusM,
      });
      segStart = { x: elbow.tangentEnd.x, y: elbow.tangentEnd.y, z: elbow.tangentEnd.z };
    } else {
      pushSegment(segStart, pCurr);
      segStart = { x: pCurr.x, y: pCurr.y, z: pCurr.z };
    }
  }

  pushSegment(segStart, points[points.length - 1]);
  return parts;
}
