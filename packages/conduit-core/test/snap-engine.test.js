import test from 'node:test';
import assert from 'node:assert/strict';
import {
  vec3,
  closestPointOnSegment,
  snapToNodes,
  snapToSegments,
  snapPolarAngle,
  snapOrtho3D,
  raycastElevationPlane,
  SnapEngine,
} from '../src/snap-engine.js';

const close = (actual, expected, tol = 1e-4) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${actual} ≠ ${expected} (tol ${tol})`);

test('vec3 primitives: vector operations', () => {
  const a = { x: 1, y: 2, z: 3 };
  const b = { x: 4, y: 5, z: 6 };

  const sum = vec3.add(a, b);
  assert.deepEqual(sum, { x: 5, y: 7, z: 9 });

  const diff = vec3.sub(b, a);
  assert.deepEqual(diff, { x: 3, y: 3, z: 3 });

  close(vec3.distance({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 }), 5);
  close(vec3.length({ x: 0, y: 3, z: 4 }), 5);

  const norm = vec3.normalize({ x: 10, y: 0, z: 0 });
  close(norm.x, 1);
  close(norm.y, 0);
  close(norm.z, 0);
});

test('closestPointOnSegment: projects onto 3D line segment', () => {
  const p1 = { x: 0, y: 2, z: 0 };
  const p2 = { x: 10, y: 2, z: 0 };

  // Midpoint projection
  const hit = closestPointOnSegment({ x: 5, y: 5, z: 0 }, p1, p2);
  close(hit.point.x, 5);
  close(hit.point.y, 2);
  close(hit.point.z, 0);
  close(hit.t, 0.5);
  close(hit.distance, 3);

  // Clamped before start
  const hitBefore = closestPointOnSegment({ x: -5, y: 2, z: 0 }, p1, p2);
  close(hitBefore.t, 0);
  close(hitBefore.point.x, 0);

  // Clamped after end
  const hitAfter = closestPointOnSegment({ x: 15, y: 2, z: 0 }, p1, p2);
  close(hitAfter.t, 1);
  close(hitAfter.point.x, 10);
});

test('snapToNodes: snaps to nearest endpoint within tolerance', () => {
  const nodes = [
    { id: 'n1', x: 0, y: 2.8, z: 0 },
    { id: 'n2', x: 5, y: 2.8, z: 5 },
  ];

  // Within tolerance of n1
  const snap1 = snapToNodes({ x: 0.1, y: 2.8, z: 0.05 }, nodes, 0.25);
  assert.ok(snap1);
  assert.equal(snap1.snapType, 'endpoint');
  assert.equal(snap1.targetId, 'n1');
  close(snap1.point.x, 0);
  close(snap1.point.y, 2.8);
  close(snap1.point.z, 0);

  // Outside tolerance of all nodes
  const snapNone = snapToNodes({ x: 2.5, y: 2.8, z: 2.5 }, nodes, 0.25);
  assert.equal(snapNone, null);
});

test('snapToSegments: distinguishes midpoints and regular segment projection', () => {
  const segments = [
    { id: 's1', start: { x: 0, y: 2.8, z: 0 }, end: { x: 10, y: 2.8, z: 0 } },
  ];

  // Near midpoint (t ~ 0.5)
  const snapMid = snapToSegments({ x: 4.95, y: 2.85, z: 0.05 }, segments, 0.25);
  assert.ok(snapMid);
  assert.equal(snapMid.snapType, 'midpoint');
  assert.equal(snapMid.targetId, 's1');
  close(snapMid.point.x, 5.0);

  // Near segment but not midpoint (t ~ 0.2)
  const snapSeg = snapToSegments({ x: 2.0, y: 2.85, z: 0.05 }, segments, 0.25);
  assert.ok(snapSeg);
  assert.equal(snapSeg.snapType, 'segment');
  assert.equal(snapSeg.targetId, 's1');
  close(snapSeg.point.x, 2.0);
});

test('snapPolarAngle: snaps to 0, 45, 90, 135 degrees and maintains radial distance', () => {
  const fromPoint = { x: 0, y: 2.8, z: 0 };

  // Angle ~ 44 degrees (should snap to 45 deg)
  const dist = 5.0;
  const rawAngleRad = 44 * (Math.PI / 180);
  const toPoint = {
    x: fromPoint.x + dist * Math.cos(rawAngleRad),
    y: 2.8,
    z: fromPoint.z + dist * Math.sin(rawAngleRad),
  };

  const polar = snapPolarAngle(fromPoint, toPoint, { toleranceDeg: 5.0, upAxis: 'Y' });
  assert.ok(polar);
  assert.equal(polar.snapType, 'polar_angle');
  assert.equal(polar.angleDeg, 45);

  // Verify snapped coordinates match exact 45 degrees
  const expected45Rad = 45 * (Math.PI / 180);
  close(polar.point.x, dist * Math.cos(expected45Rad));
  close(polar.point.z, dist * Math.sin(expected45Rad));
  close(polar.point.y, 2.8);

  // Outside angular tolerance (~30 deg when allowed are 0, 45, 90)
  const raw30Rad = 30 * (Math.PI / 180);
  const toPoint30 = {
    x: dist * Math.cos(raw30Rad),
    y: 2.8,
    z: dist * Math.sin(raw30Rad),
  };
  const polarFail = snapPolarAngle(fromPoint, toPoint30, {
    allowedAnglesDeg: [0, 45, 90],
    toleranceDeg: 4.0,
  });
  assert.equal(polarFail, null);
});

test('snapOrtho3D: constrains to dominant axis X, Y, or Z', () => {
  const fromPoint = { x: 1, y: 2, z: 3 };

  // Moving mostly along X
  const toX = { x: 5, y: 2.1, z: 3.05 };
  const orthoX = snapOrtho3D(fromPoint, toX);
  assert.equal(orthoX.guideAxis, 'X');
  close(orthoX.point.x, 5);
  close(orthoX.point.y, 2);
  close(orthoX.point.z, 3);

  // Moving mostly along Y (vertical riser)
  const toY = { x: 1.05, y: 6.5, z: 2.95 };
  const orthoY = snapOrtho3D(fromPoint, toY);
  assert.equal(orthoY.guideAxis, 'Y');
  close(orthoY.point.x, 1);
  close(orthoY.point.y, 6.5);
  close(orthoY.point.z, 3);

  // Moving mostly along Z
  const toZ = { x: 0.95, y: 2.05, z: 9 };
  const orthoZ = snapOrtho3D(fromPoint, toZ);
  assert.equal(orthoZ.guideAxis, 'Z');
  close(orthoZ.point.x, 1);
  close(orthoZ.point.y, 2);
  close(orthoZ.point.z, 9);
});

test('raycastElevationPlane: intersection and horizon fallback', () => {
  // Ray pointing downward from camera at (0, 10, 0) towards ground (dir: 0, -1, 0)
  const origin = { x: 0, y: 10, z: 0 };
  const dir = { x: 0, y: -1, z: 0 };
  const hit = raycastElevationPlane(origin, dir, 2.8, 'Y');
  assert.ok(hit);
  close(hit.y, 2.8);
  close(hit.x, 0);
  close(hit.z, 0);

  // Ray pointing horizontally (parallel to plane, dir.y = 0)
  const horizDir = { x: 1, y: 0, z: 0 };
  const lastPt = { x: 5, y: 2.8, z: 5 };
  const fallbackHit = raycastElevationPlane(origin, horizDir, 2.8, 'Y', lastPt);
  assert.ok(fallbackHit);
  close(fallbackHit.y, 2.8);
  assert.ok(Number.isFinite(fallbackHit.x));
  assert.ok(Number.isFinite(fallbackHit.z));
});

test('SnapEngine: priority resolution', () => {
  const engine = new SnapEngine({
    toleranceMetres: 0.3,
    angularToleranceDeg: 5,
    polarEnabled: true,
    orthoEnabled: false,
  });

  const nodes = [{ id: 'node_target', x: 2, y: 2.8, z: 2 }];
  const segments = [
    { id: 'seg_target', start: { x: 0, y: 2.8, z: 10 }, end: { x: 10, y: 2.8, z: 10 } },
  ];
  const lastPoint = { x: 0, y: 2.8, z: 0 };

  // 1. Endpoint wins when close to a node
  const snapNode = engine.resolve({ x: 2.05, y: 2.8, z: 1.95 }, { lastPoint, nodes, segments });
  assert.equal(snapNode.snapType, 'endpoint');
  assert.equal(snapNode.targetId, 'node_target');

  // 2. Midpoint wins when close to segment middle
  const snapMid = engine.resolve({ x: 5.02, y: 2.8, z: 9.98 }, { lastPoint, nodes, segments });
  assert.equal(snapMid.snapType, 'midpoint');
  assert.equal(snapMid.targetId, 'seg_target');

  // 3. Polar angle wins when not close to any node/segment
  // 90 degrees in plan (along Z)
  const snapPolar = engine.resolve({ x: 0.1, y: 2.8, z: 4.0 }, { lastPoint, nodes, segments });
  assert.equal(snapPolar.snapType, 'polar_angle');
  close(snapPolar.point.x, 0); // Snapped to X=0
  close(snapPolar.point.z, Math.hypot(0.1, 4.0));

  // 4. Raw fallback when nothing applies
  const engineNoPolar = new SnapEngine({ polarEnabled: false });
  const rawSnap = engineNoPolar.resolve({ x: 12.34, y: 2.8, z: 56.78 }, { lastPoint });
  assert.equal(rawSnap.snapType, 'workplane');
  close(rawSnap.point.x, 12.34);
  close(rawSnap.point.z, 56.78);
});
