import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NEC_BEND_TABLE,
  getNecBendRadiusM,
  calculateBendAngle,
  solveElbowFitting,
  analyzeRunBends,
  solveAutoRiser,
  snapToStandardBendAngle,
  getRunNecAudit,
} from '../src/fitting-solver.js';

const close = (actual, expected, tol = 1e-4) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${actual} ≠ ${expected} (tol ${tol})`);

test('getNecBendRadiusM: standard NEC Chapter 9 Table 2 lookup', () => {
  // 1/2" -> 4.0 inches = 0.1016 m
  close(getNecBendRadiusM('1/2"'), 0.1016);
  close(getNecBendRadiusM('½"'), 0.1016);

  // 3/4" -> 4.5 inches = 0.1143 m
  close(getNecBendRadiusM('3/4"'), 0.1143);
  close(getNecBendRadiusM('¾"'), 0.1143);

  // 1" -> 5.75 inches = 0.146 m
  close(getNecBendRadiusM('1"'), 0.146);

  // 2" -> 9.5 inches = 0.2413 m
  close(getNecBendRadiusM('2"'), 0.2413);

  // 4" -> 16.0 inches = 0.4064 m
  close(getNecBendRadiusM('4"'), 0.4064);

  // Numeric lookup in mm (19.05 mm is 3/4")
  close(getNecBendRadiusM(19.05), 0.1143);
});

test('calculateBendAngle: accurate bend angle detection', () => {
  // Collinear points: straight line (0° bend)
  const straightP1 = { x: 0, y: 0, z: 0 };
  const straightCorner = { x: 5, y: 0, z: 0 };
  const straightP2 = { x: 10, y: 0, z: 0 };
  close(calculateBendAngle(straightP1, straightCorner, straightP2), 0.0);

  // 90 degree right turn
  const rightP1 = { x: 0, y: 0, z: 0 };
  const rightCorner = { x: 5, y: 0, z: 0 };
  const rightP2 = { x: 5, y: 0, z: 5 };
  close(calculateBendAngle(rightP1, rightCorner, rightP2), 90.0);

  // 45 degree turn
  const diagP1 = { x: 0, y: 0, z: 0 };
  const diagCorner = { x: 5, y: 0, z: 0 };
  const diagP2 = { x: 5 + 5 * Math.cos(Math.PI / 4), y: 0, z: 5 * Math.sin(Math.PI / 4) };
  close(calculateBendAngle(diagP1, diagCorner, diagP2), 45.0, 0.01);
});

test('solveElbowFitting: computes tangent points and smooth arc for 90° elbow', () => {
  const p1 = { x: 0, y: 2.8, z: 0 };
  const pCorner = { x: 5, y: 2.8, z: 0 };
  const p2 = { x: 5, y: 2.8, z: 5 };
  const radius = 0.1143; // 3/4" radius

  const fitting = solveElbowFitting(p1, pCorner, p2, radius, 8);
  assert.equal(fitting.isValid, true);
  assert.equal(fitting.isStraight, false);
  close(fitting.bendAngleDeg, 90.0);

  // For a 90° elbow, T = R * tan(45°) = R
  close(fitting.tangentDistance, radius);

  // Tangent start should be at (5 - R, 2.8, 0)
  close(fitting.tangentStart.x, 5 - radius);
  close(fitting.tangentStart.y, 2.8);
  close(fitting.tangentStart.z, 0);

  // Tangent end should be at (5, 2.8, R)
  close(fitting.tangentEnd.x, 5);
  close(fitting.tangentEnd.y, 2.8);
  close(fitting.tangentEnd.z, radius);

  // Arc points generated
  assert.equal(fitting.arcPoints.length, 9);
  close(fitting.arcPoints[0].x, fitting.tangentStart.x);
  close(fitting.arcPoints[fitting.arcPoints.length - 1].z, fitting.tangentEnd.z);

  // Invariant 1: Constant Radius (every arc point must be exactly at distance R from center)
  for (let i = 0; i < fitting.arcPoints.length; i++) {
    const pt = fitting.arcPoints[i];
    const dist = Math.hypot(pt.x - fitting.center.x, pt.y - fitting.center.y, pt.z - fitting.center.z);
    close(dist, radius, 1e-4);
  }

  // Invariant 2: Monotonic progression along interior curve (NO backward ballooning)
  for (let i = 1; i < fitting.arcPoints.length; i++) {
    const prev = fitting.arcPoints[i - 1];
    const curr = fitting.arcPoints[i];
    assert.ok(curr.x >= prev.x - 1e-5, `X must monotonically increase: ${curr.x} >= ${prev.x}`);
    assert.ok(curr.z >= prev.z - 1e-5, `Z must monotonically increase: ${curr.z} >= ${prev.z}`);
  }

  // Real-world trade metrics: developed length and gain
  // L_arc = R * (pi / 2)
  const expectedDevLen = radius * (Math.PI / 2);
  close(fitting.developedLength, expectedDevLen, 1e-4);

  // Gain = 2T - L_arc = 2R - R*(pi/2)
  const expectedGain = 2 * radius - expectedDevLen;
  close(fitting.gain, expectedGain, 1e-4);
  assert.equal(fitting.hasSufficientClamp, true);
});

test('solveElbowFitting: 3D vertical riser and compound angles have flawless radius and monotonicity', () => {
  // Turn from horizontal +X to vertical +Y (riser bend)
  const p1 = { x: 0, y: 0, z: 0 };
  const pCorner = { x: 3, y: 0, z: 0 };
  const p2 = { x: 3, y: 3, z: 0 };
  const radius = 0.2413; // 2" trade size radius

  const riserFitting = solveElbowFitting(p1, pCorner, p2, radius, 10);
  assert.equal(riserFitting.isValid, true);
  close(riserFitting.bendAngleDeg, 90.0);

  // Check constant radius for all 11 points
  assert.equal(riserFitting.arcPoints.length, 11);
  for (const pt of riserFitting.arcPoints) {
    const dist = Math.hypot(pt.x - riserFitting.center.x, pt.y - riserFitting.center.y, pt.z - riserFitting.center.z);
    close(dist, radius, 1e-4);
  }

  // 45 degree compound offset bend in 3D
  const o1 = { x: 0, y: 0, z: 0 };
  const oCorner = { x: 2, y: 0, z: 2 };
  const o2 = { x: 4, y: 1.414, z: 2 };
  const offsetFitting = solveElbowFitting(o1, oCorner, o2, 0.146, 8);
  assert.equal(offsetFitting.isValid, true);
  for (const pt of offsetFitting.arcPoints) {
    const dist = Math.hypot(pt.x - offsetFitting.center.x, pt.y - offsetFitting.center.y, pt.z - offsetFitting.center.z);
    close(dist, offsetFitting.bendRadius, 1e-4);
  }
});

test('analyzeRunBends: cumulative angle tracking and NEC 360° violation check', () => {
  // A run with two 90° bends (180° total) -> Passes NEC
  const compliantRun = [
    { x: 0, y: 0, z: 0 },
    { x: 5, y: 0, z: 0 }, // 90° bend
    { x: 5, y: 0, z: 5 }, // 90° bend
    { x: 10, y: 0, z: 5 },
  ];
  const analysis1 = analyzeRunBends(compliantRun);
  close(analysis1.totalDegrees, 180.0);
  assert.equal(analysis1.fittingsCount, 2);
  assert.equal(analysis1.exceedsNec360, false);
  assert.equal(analysis1.warning, null);

  // A run with five 90° bends (450° total) -> Exceeds NEC 360° limit
  const exceedingRun = [
    { x: 0, y: 0, z: 0 },
    { x: 5, y: 0, z: 0 },  // #1: 90°
    { x: 5, y: 0, z: 5 },  // #2: 90°
    { x: 10, y: 0, z: 5 }, // #3: 90°
    { x: 10, y: 0, z: 0 }, // #4: 90°
    { x: 15, y: 0, z: 0 }, // #5: 90°
    { x: 15, y: 0, z: 5 },
  ];
  const analysis2 = analyzeRunBends(exceedingRun);
  close(analysis2.totalDegrees, 450.0);
  assert.equal(analysis2.fittingsCount, 5);
  assert.equal(analysis2.exceedsNec360, true);
  assert.ok(analysis2.warning.includes('360°'));
});

test('snapToStandardBendAngle: snaps within window and detects standard angles', () => {
  // 88.5° snaps to 90°
  const snap90 = snapToStandardBendAngle(88.5);
  assert.equal(snap90.snappedAngle, 90);
  assert.equal(snap90.isStandard, true);

  // 44.1° snaps to 45°
  const snap45 = snapToStandardBendAngle(44.1);
  assert.equal(snap45.snappedAngle, 45);
  assert.equal(snap45.isStandard, true);

  // 29.8° snaps to 30°
  const snap30 = snapToStandardBendAngle(29.8);
  assert.equal(snap30.snappedAngle, 30);
  assert.equal(snap30.isStandard, true);

  // Non-standard angle (e.g. 71.3°) remains non-standard
  const nonStd = snapToStandardBendAngle(71.3, 5.0);
  assert.equal(nonStd.isStandard, false);
});

test('getRunNecAudit: comprehensive NEC compliance audit and article citations', () => {
  const points = [
    { x: 0, y: 0, z: 0 },
    { x: 3, y: 0, z: 0 }, // 90° bend
    { x: 3, y: 0, z: 3 }, // 90° bend
    { x: 6, y: 0, z: 3 },
  ];
  const audit = getRunNecAudit(points, '3/4"', 9.0);
  assert.equal(audit.status, 'COMPLIANT');
  assert.equal(audit.totalBendDegrees, 180.0);
  assert.equal(audit.maxAllowedBendDegrees, 360.0);
  assert.equal(audit.bendCount, 2);
  assert.equal(audit.minRadiusInches, 4.5);
  assert.ok(audit.citations.some((c) => c.article === 'NEC 358.26' && c.compliant));
  assert.ok(audit.citations.some((c) => c.article.includes('NEC 358.24')));
  assert.ok(audit.citations.some((c) => c.article === 'NEC 358.30'));
});

test('solveAutoRiser: generates intermediate riser transition', () => {
  const start = { x: 3.0, y: 2.8, z: 4.0 };
  const targetElevation = 4.2;

  const riser = solveAutoRiser(start, targetElevation, { upAxis: 'Y' });
  assert.equal(riser.length, 2);
  assert.deepEqual(riser[0], start);

  // Riser top node
  close(riser[1].x, 3.0);
  close(riser[1].y, 4.2);
  close(riser[1].z, 4.0);
  assert.equal(riser[1].isRiser, true);
  close(riser[1].heightDelta, 1.4);
});
