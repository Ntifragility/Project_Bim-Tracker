/**
 * Real-World Electrical Trade Bending Solver (Benfield Bending System & NEC Standards).
 * Computes exact shop formulas for:
 * - Box Offsets & Kick Bends
 * - Three-Point Saddles (pipe/obstruction straddle)
 * - Four-Point Saddles (duct/tray bridge)
 * - True 3D Rolling Offsets (compound multi-axis displacement)
 * Zero DOM or Three.js dependencies (100% portable to Rust/Wasm).
 */

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/**
 * Standard Benfield bender multipliers and shrinkage constants.
 */
export const BENFIELD_TABLE = {
  10: { multiplier: 1 / Math.sin(10 * DEG_TO_RAD), shrinkPerUnit: Math.tan(5 * DEG_TO_RAD), tradeFraction: '1/16"' },
  15: { multiplier: 1 / Math.sin(15 * DEG_TO_RAD), shrinkPerUnit: Math.tan(7.5 * DEG_TO_RAD), tradeFraction: '1/8"' },
  22.5: { multiplier: 1 / Math.sin(22.5 * DEG_TO_RAD), shrinkPerUnit: Math.tan(11.25 * DEG_TO_RAD), tradeFraction: '3/16"' },
  30: { multiplier: 1 / Math.sin(30 * DEG_TO_RAD), shrinkPerUnit: Math.tan(15 * DEG_TO_RAD), tradeFraction: '1/4"' },
  45: { multiplier: 1 / Math.sin(45 * DEG_TO_RAD), shrinkPerUnit: Math.tan(22.5 * DEG_TO_RAD), tradeFraction: '3/8"' },
  60: { multiplier: 1 / Math.sin(60 * DEG_TO_RAD), shrinkPerUnit: Math.tan(30 * DEG_TO_RAD), tradeFraction: '1/2"' },
};

/**
 * Solves a two-bend offset jog (e.g. box offset or obstacle bypass).
 *
 * @param {number} offsetHeightM - Displacement distance in metres
 * @param {number} [angleDeg=30] - Bend angle (10, 15, 22.5, 30, 45, 60)
 * @returns {Object} Solution with distance between bends, shrinkage, and developed length
 */
export function solveBoxOffset(offsetHeightM, angleDeg = 30) {
  const rad = angleDeg * DEG_TO_RAD;
  const sinAngle = Math.sin(rad);
  const distanceBetweenBends = Math.abs(sinAngle) > 1e-6 ? offsetHeightM / sinAngle : offsetHeightM;

  // Shrinkage = H * tan(theta / 2)
  const shrinkM = offsetHeightM * Math.tan(rad * 0.5);

  // Developed length across the jog
  const developedLength = distanceBetweenBends;

  const info = BENFIELD_TABLE[angleDeg] || {
    multiplier: 1 / Math.sin(rad),
    shrinkPerUnit: Math.tan(rad * 0.5),
  };

  return {
    isValid: offsetHeightM > 0,
    angleDeg,
    offsetHeightM,
    distanceBetweenBends,
    shrinkM,
    multiplier: info.multiplier,
    developedLength,
  };
}

/**
 * Solves a three-point saddle straddling a round obstacle (e.g. crossing a pipe).
 * Uses standard field practice: 45° center bend with two 22.5° outer return bends
 * (or 30° center bend with two 15° outer return bends).
 *
 * @param {number} obstacleHeightM - Diameter or height of obstacle in metres
 * @param {number} [centerAngleDeg=45] - Center bend angle (45 or 30)
 * @returns {Object}
 */
export function solveThreePointSaddle(obstacleHeightM, centerAngleDeg = 45) {
  const outerAngleDeg = centerAngleDeg * 0.5;
  const rad = centerAngleDeg * DEG_TO_RAD;

  // For 45° center saddle: outer marks are 2.6 x height from center mark
  // For 30° center saddle: outer marks are 4.0 x height from center mark
  const multiplier = centerAngleDeg === 45 ? 2.6 : 4.0;
  const distanceToOuterMark = obstacleHeightM * multiplier;

  // Total conduit shrinkage (approx 3/16" per inch for 45°, 1/8" per inch for 30°)
  const shrinkFactor = centerAngleDeg === 45 ? 0.1875 : 0.125;
  const shrinkM = obstacleHeightM * shrinkFactor;

  return {
    isValid: obstacleHeightM > 0,
    obstacleHeightM,
    centerAngleDeg,
    outerAngleDeg,
    distanceToOuterMark,
    totalSpanM: distanceToOuterMark * 2,
    shrinkM,
  };
}

/**
 * Solves a four-point saddle bridging a rectangular obstruction (e.g. duct or cable tray).
 *
 * @param {number} obstacleHeightM - Depth/height of obstacle
 * @param {number} obstacleWidthM - Width of obstacle
 * @param {number} [angleDeg=30] - Bend angle
 * @param {number} [clearanceM=0.025] - Air clearance buffer (default: 25mm / 1")
 * @returns {Object}
 */
export function solveFourPointSaddle(obstacleHeightM, obstacleWidthM, angleDeg = 30, clearanceM = 0.025) {
  const effectiveHeight = obstacleHeightM + clearanceM;
  const flatTopSpan = obstacleWidthM + (clearanceM * 2);

  const offset = solveBoxOffset(effectiveHeight, angleDeg);
  const totalShrink = offset.shrinkM * 2;

  return {
    isValid: obstacleHeightM > 0 && obstacleWidthM > 0,
    angleDeg,
    effectiveHeight,
    flatTopSpan,
    legDistanceBetweenBends: offset.distanceBetweenBends,
    totalShrinkM: totalShrink,
  };
}

/**
 * Solves a 3D rolling offset (simultaneous horizontal and vertical jog).
 *
 * @param {number} rollHorizontalM - Displacement in X/Z plane
 * @param {number} rollVerticalM - Displacement along Y (elevation)
 * @param {number} [angleDeg=45] - Bend angle
 * @returns {Object}
 */
export function solveRollingOffset(rollHorizontalM, rollVerticalM, angleDeg = 45) {
  // True 3D offset distance
  const trueOffset = Math.hypot(rollHorizontalM, rollVerticalM);
  const offset = solveBoxOffset(trueOffset, angleDeg);

  // Roll angle in the transverse plane
  const rollAngleDeg = Math.atan2(rollVerticalM, rollHorizontalM) * RAD_TO_DEG;

  return {
    ...offset,
    trueOffsetM: trueOffset,
    rollHorizontalM,
    rollVerticalM,
    rollAngleDeg,
  };
}
