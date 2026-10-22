// Task 4.2 vector runner: executes spec/vectors/conduit/snap-engine.json
// against legacy JS.
//
// Usage: node scripts/run-conduit-snap-vectors.mjs [--file snap-engine]
//
// Exit code 1 on any failure.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const VEC_DIR = path.join(ROOT, 'spec/vectors/conduit');

const LEG = path.join(ROOT, 'legacy/packages/conduit-core/src');
const engine = await import(path.join(LEG, 'snap-engine.js'));

let pass = 0, fail = 0;
const failures = [];

function close(a, b, tol) {
  return Math.abs(a - b) <= tol;
}

function checkPoint(actual, expected, tol, label) {
  for (const k of ['x', 'y', 'z']) {
    if (expected[k] === undefined) continue;
    if (!close(actual[k], expected[k], tol)) {
      throw new Error(`${label}.${k}: ${actual[k]} != ${expected[k]} (tol ${tol})`);
    }
  }
}

async function runCase(vecFile, c) {
  const id = `${vecFile}:${c.id}`;
  const tol = c.tol ?? 1e-9;
  try {
    switch (c.fn) {
      case 'snapToNodes': {
        const nodes = c.input.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y, z: n.z }));
        const r = engine.snapToNodes(c.input.query, nodes, c.input.tolerance);
        if (c.expected === null) {
          if (r !== null) throw new Error(`expected null got ${JSON.stringify(r)}`);
          break;
        }
        if (!r) throw new Error('expected snap, got null');
        if (r.snapType !== c.expected.snapType) throw new Error(`type ${r.snapType}`);
        if (c.expected.targetId && r.targetId !== c.expected.targetId) throw new Error('target');
        if (c.expected.point) checkPoint(r.point, c.expected.point, tol, 'point');
        break;
      }
      case 'snapToSegments': {
        const segs = c.input.segments.map((s) => ({ id: s.id, start: s.start, end: s.end }));
        const r = engine.snapToSegments(c.input.query, segs, c.input.tolerance);
        if (!r) throw new Error('expected snap, got null');
        if (r.snapType !== c.expected.snapType) throw new Error(`type ${r.snapType}`);
        if (c.expected.targetId && r.targetId !== c.expected.targetId) throw new Error('target');
        if (c.expected.point) checkPoint(r.point, c.expected.point, tol, 'point');
        if (c.expected.t !== undefined && !close(r.t, c.expected.t, tol)) throw new Error(`t ${r.t}`);
        break;
      }
      case 'closestPointOnSegment': {
        const r = engine.closestPointOnSegment(c.input.p, c.input.a, c.input.b);
        if (c.expected.point) checkPoint(r.point, c.expected.point, tol, 'point');
        if (c.expected.t !== undefined && !close(r.t, c.expected.t, tol)) throw new Error(`t ${r.t}`);
        if (c.expected.distance !== undefined && !close(r.distance, c.expected.distance, tol)) throw new Error('dist');
        break;
      }
      case 'snapPolarAngle': {
        const r = engine.snapPolarAngle(c.input.from, c.input.to, c.input.options ?? {});
        if (c.expected === null) {
          if (r !== null) throw new Error(`expected null got ${JSON.stringify(r)}`);
          break;
        }
        if (!r) throw new Error('expected snap, got null');
        if (r.snapType !== c.expected.snapType) throw new Error(`type ${r.snapType}`);
        if (c.expected.angleDeg !== undefined && r.angleDeg !== c.expected.angleDeg) throw new Error(`angle ${r.angleDeg}`);
        if (c.expected.guideAxis !== undefined && r.guideAxis !== c.expected.guideAxis) throw new Error(`axis ${r.guideAxis}`);
        if (c.expected.point) checkPoint(r.point, c.expected.point, tol, 'point');
        break;
      }
      case 'snapOrtho3D': {
        const r = engine.snapOrtho3D(c.input.from, c.input.to);
        if (r.snapType !== c.expected.snapType) throw new Error(`type ${r.snapType}`);
        if (c.expected.guideAxis && r.guideAxis !== c.expected.guideAxis) throw new Error(`axis ${r.guideAxis}`);
        if (c.expected.point) checkPoint(r.point, c.expected.point, tol, 'point');
        break;
      }
      case 'raycastElevationPlane': {
        const r = engine.raycastElevationPlane(
          c.input.origin, c.input.dir, c.input.elevation, c.input.upAxis ?? 'Y', c.input.last ?? null,
        );
        if (!r) throw new Error('expected point, got null');
        for (const [k, v] of Object.entries(c.expected)) {
          if (typeof v === 'number' && !close(r[k], v, tol)) throw new Error(`${k} ${r[k]} != ${v}`);
        }
        break;
      }
      case 'SnapEngine.resolve': {
        const se = new engine.SnapEngine({
          toleranceMetres: c.input.config.toleranceMetres,
          angularToleranceDeg: c.input.config.angularToleranceDeg,
          polarEnabled: c.input.config.polarEnabled ?? true,
          orthoEnabled: c.input.config.orthoEnabled ?? false,
        });
        const ctx = {
          lastPoint: c.input.context.lastPoint ?? null,
          nodes: (c.input.context.nodes ?? []).map((n) => ({ id: n.id, x: n.x, y: n.y, z: n.z })),
          segments: (c.input.context.segments ?? []).map((s) => ({ id: s.id, start: s.start, end: s.end })),
        };
        const r = se.resolve(c.input.raw, ctx);
        const e = c.expected;
        if (r.snapType !== e.snapType) throw new Error(`type ${r.snapType}`);
        if (e.targetId && r.targetId !== e.targetId) throw new Error(`target ${r.targetId}`);
        if (e.angleDeg !== undefined && r.angleDeg !== e.angleDeg) throw new Error(`angle ${r.angleDeg}`);
        if (e.guideAxis !== undefined && r.guideAxis !== e.guideAxis) throw new Error(`axis ${r.guideAxis}`);
        if (e.point) checkPoint(r.point, e.point, tol, 'point');
        break;
      }
      case 'SnapConfig.defaults': {
        const se = new engine.SnapEngine();
        const e = c.expected;
        if (se.toleranceMetres !== e.toleranceMetres) throw new Error('tol');
        if (se.angularToleranceDeg !== e.angularToleranceDeg) throw new Error('angular');
        if (se.polarEnabled !== e.polarEnabled) throw new Error('polar');
        if (se.midpointSnapEnabled !== e.midpointSnapEnabled) throw new Error('mid');
        break;
      }
      default: throw new Error(`unknown fn ${c.fn}`);
    }
    pass++;
  } catch (err) {
    fail++;
    failures.push(`${id}: ${err.message}`);
  }
}

const only = process.argv.find((a) => a.startsWith('--file='))?.split('=')[1];
const files = readdirSync(VEC_DIR).filter((f) => f.endsWith('.json')).filter((f) => !only || f === `${only}.json`).filter((f) => f === 'snap-engine.json').sort();
for (const f of files) {
  const vec = JSON.parse(readFileSync(path.join(VEC_DIR, f), 'utf8'));
  for (const c of vec.cases) await runCase(f, c);
}

console.log(`\nconduit-snap vectors: ${pass} passed, ${fail} failed (snap-engine.json)`);
for (const fl of failures) console.log('FAIL', fl);
process.exit(fail ? 1 : 0);
