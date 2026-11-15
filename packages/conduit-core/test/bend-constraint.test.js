import test from 'node:test';
import assert from 'node:assert/strict';
import { constrainConduitBendAngle } from '../src/index.js';

test('constrainConduitBendAngle: unconstrained first segment when pPrev is null', () => {
  const pAnchor = { x: 0, y: 0, z: 0 };
  const pCursor = { x: 5, y: 0, z: 5 };
  const res = constrainConduitBendAngle(null, pAnchor, pCursor);

  assert.equal(res.bendAngleDeg, 0);
  assert.equal(res.isSnapped, false);
  assert.ok(Math.abs(res.point.x - 5) < 1e-4);
  assert.ok(Math.abs(res.point.z - 5) < 1e-4);
});

test('constrainConduitBendAngle: snaps straight forward 0° bend', () => {
  const pPrev = { x: 0, y: 0, z: 0 };
  const pAnchor = { x: 5, y: 0, z: 0 };
  // Cursor placed slightly off-axis (approx 2° deviation)
  const pCursor = { x: 10, y: 0, z: 0.15 };
  const res = constrainConduitBendAngle(pPrev, pAnchor, pCursor, { toleranceDeg: 5.0 });

  assert.equal(res.isSnapped, true);
  assert.equal(res.bendAngleDeg, 0);
  assert.ok(Math.abs(res.point.z) < 1e-4);
  assert.ok(res.point.x > 9.9);
});

test('constrainConduitBendAngle: snaps exact 90° right turn', () => {
  const pPrev = { x: 0, y: 0, z: 0 };
  const pAnchor = { x: 5, y: 0, z: 0 };
  // Moving along +Z (90° turn) with slight angle error
  const pCursor = { x: 5.15, y: 0, z: 5 };
  const res = constrainConduitBendAngle(pPrev, pAnchor, pCursor, { toleranceDeg: 5.0 });

  assert.equal(res.isSnapped, true);
  assert.equal(res.bendAngleDeg, 90);
  assert.ok(Math.abs(res.point.x - 5.0) < 1e-4);
  assert.ok(res.point.z > 4.9);
});

test('constrainConduitBendAngle: snaps exact 45° bend with incoming rotated pipe', () => {
  // Incoming pipe rotated at 45° (from (0,0,0) to (5,0,5))
  const pPrev = { x: 0, y: 0, z: 0 };
  const pAnchor = { x: 5, y: 0, z: 5 };
  // Turn 45° to the right -> heading should be 0° (pure +X)
  const pCursor = { x: 10, y: 0, z: 5.2 };
  const res = constrainConduitBendAngle(pPrev, pAnchor, pCursor, { toleranceDeg: 7.5 });

  assert.equal(res.isSnapped, true);
  assert.equal(res.bendAngleDeg, 45);
  // Snapped point heading is pure +X (z remains 5)
  assert.ok(Math.abs(res.point.z - 5.0) < 1e-4);
  assert.ok(res.point.x > 9.9);
});

test('constrainConduitBendAngle: standard field bender angles [15, 22.5, 30, 45, 60, 90]', () => {
  const pPrev = { x: 0, y: 0, z: 0 };
  const pAnchor = { x: 10, y: 0, z: 0 };

  const testAngles = [15, 22.5, 30, 45, 60, 90];
  for (const angle of testAngles) {
    const rad = (angle + 1.0) * (Math.PI / 180); // 1° offset
    const pCursor = { x: 10 + 5 * Math.cos(rad), y: 0, z: 5 * Math.sin(rad) };
    const res = constrainConduitBendAngle(pPrev, pAnchor, pCursor, {
      cartesianReference: false,
      toleranceDeg: 5.0,
    });
    assert.equal(res.isSnapped, true);
    assert.equal(res.bendAngleDeg, angle);
  }
});

test('constrainConduitBendAngle: minimum tangent validation', () => {
  const pPrev = { x: 0, y: 0, z: 0 };
  const pAnchor = { x: 10, y: 0, z: 0 };
  // 90° bend cursor placed too close (distance = 0.08m, min tangent = 0.20m)
  const pCursorClose = { x: 10, y: 0, z: 0.08 };
  const resInvalid = constrainConduitBendAngle(pPrev, pAnchor, pCursorClose, {
    minTangentM: 0.20,
    enforceSpecificAngles: false,
  });
  assert.equal(resInvalid.tangentValid, false);

  // Sufficient distance
  const pCursorFar = { x: 10, y: 0, z: 0.50 };
  const resValid = constrainConduitBendAngle(pPrev, pAnchor, pCursorFar, {
    minTangentM: 0.20,
  });
  assert.equal(resValid.tangentValid, true);
});

test('constrainConduitBendAngle: Cartesian XYZ reference axes [X, Z, 45° offset]', () => {
  const pAnchor = { x: 0, y: 2.8, z: 0 };

  // Cursor in +X direction
  const resXPlus = constrainConduitBendAngle(null, pAnchor, { x: 5, y: 2.8, z: 0.2 });
  assert.equal(resXPlus.cartesianAxis, 'X');
  assert.equal(resXPlus.cartesianHeading, 'X+');
  assert.equal(resXPlus.point.z, 0);

  // Cursor in +Z direction
  const resZPlus = constrainConduitBendAngle(null, pAnchor, { x: 0.1, y: 2.8, z: 6 });
  assert.equal(resZPlus.cartesianAxis, 'Z');
  assert.equal(resZPlus.cartesianHeading, 'Z+');
  assert.equal(resZPlus.point.x, 0);

  // Cursor in 45° diagonal (+X, +Z)
  const resDiag = constrainConduitBendAngle(null, pAnchor, { x: 4.8, y: 2.8, z: 5.2 });
  assert.equal(resDiag.cartesianAxis, 'XZ_45');
  assert.ok(Math.abs(resDiag.point.x - resDiag.point.z) < 1e-4);
});

