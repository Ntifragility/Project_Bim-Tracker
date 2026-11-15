/**
 * Contractor Fabrication Spool & Bending Marks Schedule Generator.
 * Calculates shop cut lengths, bender shoe alignment marks (Arrow, Star, Center),
 * take-up deductions, and gain for physical field prefabrication.
 * Zero DOM or Three.js dependencies (100% portable to Rust/Wasm).
 */

import { calculateBendAngle, solveElbowFitting, getNecBendRadiusM } from './fitting-solver.js';
import { extractRunCenterline, computeCenterlineLength } from './centerline-builder.js';

const M_TO_INCH = 39.3701;
const INCH_TO_M = 0.0254;

/**
 * Standard bender take-up deductions in inches (approximate Benfield hand benders).
 */
export const BENDER_TAKE_UP_INCHES = {
  '1/2"': 5.0,
  '3/4"': 6.0,
  '1"': 8.0,
  '1-1/4"': 11.0,
  '1-1/2"': 13.0,
  '2"': 15.0,
};

/**
 * Generates an electrical prefabrication spool sheet for a single conduit run.
 *
 * @param {Object} run - Conduit run object with id, size, and node points
 * @param {Array<{ x: number, y: number, z: number }>} points
 * @returns {Object} Spool sheet with cut length, segment breakdown, and bend marks
 */
export function generateRunSpoolSheet(run, points) {
  if (!points || points.length < 2) return null;

  const size = run?.size || '3/4"';
  const minRadiusM = getNecBendRadiusM(size);
  const takeUpInches = BENDER_TAKE_UP_INCHES[size] || 6.0;
  const takeUpM = takeUpInches * INCH_TO_M;

  const centerline = extractRunCenterline(points, minRadiusM);
  const totalDevelopedLengthM = computeCenterlineLength(centerline);

  const bends = [];
  let runningDistanceM = 0;

  for (let i = 1; i < points.length - 1; i++) {
    const pPrev = points[i - 1];
    const pCurr = points[i];
    const pNext = points[i + 1];
    const angle = calculateBendAngle(pPrev, pCurr, pNext);

    if (angle >= 10.0) {
      const elbow = solveElbowFitting(pPrev, pCurr, pNext, minRadiusM, 12);
      if (elbow.isValid) {
        // Distance from previous waypoint to corner
        const dx = pCurr.x - pPrev.x;
        const dy = pCurr.y - pPrev.y;
        const dz = pCurr.z - pPrev.z;
        const legInLen = Math.hypot(dx, dy, dz);

        // Distance from run start to bend tangent start
        const distToTangentStart = runningDistanceM + (legInLen - elbow.tangentDistance);

        // Stub-up mark position (distance to bender arrow for a 90° turn)
        const stubMarkPosM = Math.max(0, legInLen - takeUpM);

        bends.push({
          bendIndex: bends.length + 1,
          angleDeg: Math.round(angle * 10) / 10,
          radiusInches: (minRadiusM * M_TO_INCH).toFixed(1),
          developedLengthInches: (elbow.developedLength * M_TO_INCH).toFixed(2),
          gainInches: (elbow.gain * M_TO_INCH).toFixed(2),
          tangentDistanceInches: (elbow.tangentDistance * M_TO_INCH).toFixed(2),
          takeUpInches,
          distFromStartInches: (distToTangentStart * M_TO_INCH).toFixed(2),
          stubMarkInches: (stubMarkPosM * M_TO_INCH).toFixed(2),
          hasSufficientClamp: elbow.hasSufficientClamp,
        });

        runningDistanceM = distToTangentStart + elbow.developedLength;
      }
    }
  }

  return {
    runId: run?.id || 'run-1',
    size,
    totalDevelopedLengthM,
    totalLengthFeet: (totalDevelopedLengthM * 3.28084).toFixed(2),
    bendsCount: bends.length,
    bends,
  };
}

/**
 * Formats multiple run spool sheets into a contractor CSV cut sheet.
 *
 * @param {Array<Object>} spoolSheets
 * @returns {string} CSV formatted content
 */
export function generateSpoolSheetCsv(spoolSheets) {
  const lines = [
    'Run ID,Trade Size,Total Length (ft),Bend #,Angle (deg),CLR (in),Gain (in),Stub Mark (in),Distance From Start (in),Clamp Check',
  ];

  for (const sheet of spoolSheets) {
    if (!sheet) continue;
    if (sheet.bends.length === 0) {
      lines.push(`${sheet.runId},${sheet.size},${sheet.totalLengthFeet},None,0,0,0,0,0,OK`);
    } else {
      for (const b of sheet.bends) {
        lines.push(
          `${sheet.runId},${sheet.size},${sheet.totalLengthFeet},#${b.bendIndex},${b.angleDeg},${b.radiusInches},${b.gainInches},${b.stubMarkInches},${b.distFromStartInches},${b.hasSufficientClamp ? 'PASS' : 'WARNING (<2")'}`
        );
      }
    }
  }

  return lines.join('\n');
}
