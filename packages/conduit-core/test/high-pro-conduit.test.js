import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractRunCenterline,
  computeCenterlineLength,
  generateParallelConduitRack,
  offsetPolyline,
  calculateConcentricRadii,
  solveBoxOffset,
  solveThreePointSaddle,
  solveFourPointSaddle,
  solveRollingOffset,
  justifyToCenterline,
  getElevationLevels,
  JUSTIFICATION_MODES,
  generateRunSpoolSheet,
  generateSpoolSheetCsv,
} from '../src/index.js';

const close = (actual, expected, tol = 1e-4) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${actual} ≠ ${expected} (tol ${tol})`);

test('centerline-builder: extracts smooth continuous path with SLERP arc points', () => {
  const points = [
    { x: 0, y: 0, z: 0 },
    { x: 4, y: 0, z: 0 },
    { x: 4, y: 0, z: 4 },
  ];
  const radius = 0.1143; // 3/4" EMT
  const centerline = extractRunCenterline(points, radius, 8);

  assert.ok(centerline.length > 3, 'Centerline should contain discrete arc points');
  assert.equal(centerline[0].x, 0);
  assert.equal(centerline[centerline.length - 1].z, 4);

  const length = computeCenterlineLength(centerline);
  // Total length should be straight legs + developed arc length (less than square 8.0m)
  assert.ok(length < 8.0 && length > 7.9, `Centerline length should reflect gain deduction: ${length}`);
});

test('concentric-solver: generates Revit-style parallel conduit rack with concentric bisector offsets', () => {
  // 90° right turn
  const masterPoints = [
    { x: 0, y: 2.8, z: 0 },
    { x: 5, y: 2.8, z: 0 },
    { x: 5, y: 2.8, z: 5 },
  ];
  const spacing = 0.10; // 100 mm spacing

  const rack = generateParallelConduitRack(masterPoints, {
    horizontalCount: 3,
    verticalCount: 2,
    spacingM: spacing,
    verticalSpacingM: 0.15,
  });

  // 3 horizontal x 2 vertical = 6 total conduit runs
  assert.equal(rack.length, 6);

  // Check run 0 (master)
  assert.equal(rack[0].hIndex, 0);
  assert.equal(rack[0].vIndex, 0);
  close(rack[0].points[0].y, 2.8);

  // Check run 1 (lateral offset = 0.10m, v=0)
  assert.equal(rack[1].hIndex, 1);
  assert.equal(rack[1].vIndex, 0);
  // For incoming along +X, lateral normal points along +Z: (0, 0, 0.1)
  close(rack[1].points[0].z, 0.10);

  // Corner of run 1 must shift along 45° bisector: delta = spacing / cos(45°) = 0.10 * sqrt(2) ≈ 0.1414
  const corner1 = rack[1].points[1];
  close(corner1.x, 5 - 0.10);
  close(corner1.z, 0.10);

  // Check vertical tier 1 (vIndex = 1, y = 2.8 + 0.15 = 2.95m)
  assert.equal(rack[3].vIndex, 1);
  close(rack[3].points[0].y, 2.95);
});

test('concentric-solver: calculateConcentricRadii scales outer pipes smoothly', () => {
  const radii = calculateConcentricRadii(0.10, 0.05, 4);
  assert.deepEqual(radii, [0.10, 0.15, 0.20, 0.25]);
});

test('compound-bends: solveBoxOffset computes Benfield multipliers and shrinkage', () => {
  // 30° box offset with 0.10m (100mm) displacement
  const offset30 = solveBoxOffset(0.10, 30);
  assert.equal(offset30.isValid, true);
  close(offset30.multiplier, 2.0);
  // Distance between marks D = H * csc(30°) = 0.10 * 2 = 0.20m
  close(offset30.distanceBetweenBends, 0.20);
  // Shrink = H * tan(15°) ≈ 0.02679m
  close(offset30.shrinkM, 0.10 * Math.tan(15 * Math.PI / 180));

  // 45° offset with 0.10m displacement
  const offset45 = solveBoxOffset(0.10, 45);
  close(offset45.multiplier, Math.SQRT2);
  close(offset45.distanceBetweenBends, 0.10 * Math.SQRT2);
});

test('compound-bends: solveThreePointSaddle and solveFourPointSaddle', () => {
  // 3-point saddle straddling a 2" (0.0508m) pipe with 45° center bend
  const saddle3 = solveThreePointSaddle(0.0508, 45);
  assert.equal(saddle3.isValid, true);
  assert.equal(saddle3.centerAngleDeg, 45);
  assert.equal(saddle3.outerAngleDeg, 22.5);
  // Distance to outer mark = 2.6 * height
  close(saddle3.distanceToOuterMark, 0.0508 * 2.6);

  // 4-point saddle over a 0.20m high x 0.40m wide cable tray
  const saddle4 = solveFourPointSaddle(0.20, 0.40, 30, 0.025);
  assert.equal(saddle4.isValid, true);
  // Effective height = 0.20 + 0.025 = 0.225m
  close(saddle4.effectiveHeight, 0.225);
  // Flat top span = 0.40 + 2*0.025 = 0.45m
  close(saddle4.flatTopSpan, 0.45);
});

test('compound-bends: solveRollingOffset computes 3D compound displacement and roll angle', () => {
  // 0.3m horizontal jog + 0.4m vertical rise -> true displacement 0.5m
  const roll = solveRollingOffset(0.3, 0.4, 45);
  close(roll.trueOffsetM, 0.5);
  close(roll.distanceBetweenBends, 0.5 * Math.SQRT2);
  close(roll.rollAngleDeg, Math.atan2(0.4, 0.3) * (180 / Math.PI));
});

test('justification: aligns Centerline, TOC (Top), and BOC (Bottom) correctly', () => {
  const ref = { x: 5, y: 3.0, z: 2 };
  const radius = 0.02; // 20mm outer radius

  // Centerline keeps Y = 3.0
  const cl = justifyToCenterline(ref, radius, JUSTIFICATION_MODES.CENTER);
  assert.equal(cl.y, 3.0);

  // Top of Conduit: centerline drops by radius so top rests on Y = 3.0
  const toc = justifyToCenterline(ref, radius, JUSTIFICATION_MODES.TOP);
  close(toc.y, 2.98);

  // Bottom of Conduit: centerline rises by radius so bottom rests on Y = 3.0
  const boc = justifyToCenterline(ref, radius, JUSTIFICATION_MODES.BOTTOM);
  close(boc.y, 3.02);

  const levels = getElevationLevels(3.0, radius);
  assert.equal(levels.centerline, 3.0);
  assert.equal(levels.topOfConduit, 3.02);
  assert.equal(levels.bottomOfConduit, 2.98);
});

test('spool-generator: computes cut length, bend marks, and contractor CSV', () => {
  const run = { id: 'RUN-101', size: '3/4"' };
  const points = [
    { x: 0, y: 0, z: 0 },
    { x: 2, y: 0, z: 0 },
    { x: 2, y: 0, z: 2 },
  ];

  const sheet = generateRunSpoolSheet(run, points);
  assert.equal(sheet.runId, 'RUN-101');
  assert.equal(sheet.bendsCount, 1);
  assert.equal(sheet.bends[0].angleDeg, 90);
  assert.ok(sheet.totalDevelopedLengthM > 0);

  const csv = generateSpoolSheetCsv([sheet]);
  assert.ok(csv.includes('RUN-101'));
  assert.ok(csv.includes('#1'));
  assert.ok(csv.includes('3/4"'));
});
