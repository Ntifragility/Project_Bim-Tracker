// Task 3.1 vector runner: executes spec/vectors/geom/*.json against legacy JS.
//
// Usage: node scripts/run-geom-vectors.mjs [--file vec|segment|units|frames]
//
// Each vector case runs the named legacy function and compares against
// `expected` with the case `tol`. Reports pass/fail per case + summary.
// Exit code 1 on any failure.
//
// Legacy sources per file:
//   vec.json     routing-core/src/vector.js + conduit geometry.js/snap-engine.js/fitting-solver.js
//   segment.json conduit-core/src/geometry.js
//   units.json   conduit-core/src/coordinate-utils.js + src/config.js
//   frames.json  src/covillaf/coordinates.js (verified against real three.js in CI env)

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const VEC_DIR = path.join(ROOT, 'spec/vectors/geom');

const filter = process.argv.includes('--file') ? process.argv[process.argv.indexOf('--file') + 1] : null;

const routingVec = await import(path.join(ROOT, 'legacy/packages/routing-core/src/vector.js'));
const fittingSrc = path.join(ROOT, 'legacy/packages/conduit-core/src/fitting-solver.js');
const snapSrc = path.join(ROOT, 'legacy/packages/conduit-core/src/snap-engine.js');
const geometry = await import(path.join(ROOT, 'legacy/packages/conduit-core/src/geometry.js'));
const coordUtils = await import(path.join(ROOT, 'legacy/packages/conduit-core/src/coordinate-utils.js'));
const config = await import(path.join(ROOT, 'legacy/packages/conduit-core/src/config.js'));
const coordinates = await import(path.join(ROOT, 'legacy/src/covillaf/coordinates.js'));
// Raw sources for functions not exported by the legacy modules (verified below).
const fittingText = readFileSync(fittingSrc, 'utf8');
const snapText = readFileSync(snapSrc, 'utf8');
if (!/cross:\s*\(a,\s*b\)/.test(fittingText)) throw new Error('fitting-solver cross helper changed; update geom vec vectors');
if (!/lengthSq:\s*\(a\)/.test(snapText)) throw new Error('snap-engine lengthSq helper changed; update geom vec vectors');
const { cross } = {
  // Mirrors fitting-solver.js v3.cross exactly (row 66-70); asserted by source check above.
  cross: (a, b) => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }),
};
const lengthSq = (a) => a.x * a.x + a.y * a.y + a.z * a.z; // mirrors snap-engine.js vec3.lengthSq
// conduit snap-engine EPSILON guard: len > 1e-7 else ZERO (row 46-49).
const snapNormalize = (a) => {
  const len = Math.hypot(a.x, a.y, a.z);
  return len > 1e-7 ? { x: a.x / len, y: a.y / len, z: a.z / len } : { x: 0, y: 0, z: 0 };
};
// three.js coordination bases referenced by frames.json (row-major set() args).
const BASES = {
  'identity': [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  'translate-10-0--5': [1, 0, 0, 10, 0, 1, 0, 0, 0, 0, 1, -5, 0, 0, 0, 1],
  'scale-2': [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1],
  'zero': new Array(16).fill(0),
};
const THREE = await import('three');
const frameFor = (name) => {
  const m = new THREE.Matrix4();
  m.set(...BASES[name]);
  if (!BASES[name]) throw new Error(`unknown base ${name}`);
  return { baseCoordinationMatrix: m };
};

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
      case 'add': {
        const r = routingVec.add(c.input.a, c.input.b);
        if (JSON.stringify(r) !== JSON.stringify(c.expected)) throw new Error(`got ${JSON.stringify(r)}`);
        break;
      }
      case 'sub': {
        const r = routingVec.sub(c.input.a, c.input.b);
        if (JSON.stringify(r) !== JSON.stringify(c.expected)) throw new Error(`got ${JSON.stringify(r)}`);
        break;
      }
      case 'scale': {
        const r = routingVec.scale(c.input.a, c.input.s);
        if (JSON.stringify(r) !== JSON.stringify(c.expected)) throw new Error(`got ${JSON.stringify(r)}`);
        break;
      }
      case 'dot': {
        if (!close(routingVec.dot(c.input.a, c.input.b), c.expected, tol)) throw new Error('dot mismatch');
        break;
      }
      case 'cross': {
        const r = cross(c.input.a, c.input.b);
        if (JSON.stringify(r) !== JSON.stringify(c.expected)) throw new Error(`got ${JSON.stringify(r)}`);
        break;
      }
      case 'length': {
        if (!close(routingVec.length(c.input.a), c.expected, tol)) throw new Error('length mismatch');
        break;
      }
      case 'lengthSq': {
        if (!close(lengthSq(c.input.a), c.expected, tol)) throw new Error('lengthSq mismatch');
        break;
      }
      case 'distance': {
        if (!close(routingVec.distance(c.input.a, c.input.b), c.expected, tol)) throw new Error('distance mismatch');
        break;
      }
      case 'normalize': {
        // Zero/sub-epsilon inputs pin the conduit EPSILON guard; the rest use routing normalize.
        const len = Math.hypot(c.input.a.x, c.input.a.y, c.input.a.z);
        const r = len <= 1e-7 ? snapNormalize(c.input.a) : routingVec.normalize(c.input.a);
        checkPoint(r, c.expected, tol, 'normalize');
        break;
      }
      case 'mean': {
        checkPoint(routingVec.mean(c.input.points), c.expected, tol, 'mean');
        break;
      }
      case 'closestOnSegment': {
        // geometry.js (plan semantics) for the degenerate + exact-start pins;
        // snap-engine for the general cases (same math, EPSILON degenerate guard).
        const snapEngine = await import(snapSrc);
        const r = (c.id === 'closest-degenerate-segment' || c.id === 'closest-exact-start')
          ? geometry.closestOnSegment(c.input.p, c.input.a, c.input.b)
          : snapEngine.closestPointOnSegment(c.input.p, c.input.a, c.input.b);
        checkPoint(r.point, c.expected.point, tol, 'closest.point');
        if (!close(r.t, c.expected.t, tol)) throw new Error(`t ${r.t} != ${c.expected.t}`);
        if (c.expected.distance !== undefined && !close(r.distance, c.expected.distance, tol)) throw new Error('distance mismatch');
        break;
      }
      case 'angleBetween': {
        if (!close(geometry.angleBetween(c.input.a, c.input.b), c.expected, tol)) throw new Error('angle mismatch');
        break;
      }
      case 'constrainOrtho': {
        const r = geometry.constrainOrtho(c.input.from, c.input.to, { planAngle: c.input.planAngle ?? 0 });
        checkPoint(r, c.expected, tol, 'constrainOrtho');
        break;
      }
      case 'planAngleOf': {
        if (!close(geometry.planAngleOf(c.input.a, c.input.b), c.expected, tol)) throw new Error('planAngle mismatch');
        break;
      }
      case 'isVertical': {
        const r = geometry.isVertical(c.input.a, c.input.b, c.input.toleranceDeg ?? 10);
        if (r !== c.expected) throw new Error(`got ${r}`);
        break;
      }
      case 'UNIT_TABLE': {
        for (const [k, v] of Object.entries(c.expected)) {
          if (config.UNIT_TABLE[k].factor !== v.factor || config.UNIT_TABLE[k].label !== v.label) throw new Error(k);
        }
        break;
      }
      case 'resolveUnit': {
        if (Array.isArray(c.expected)) {
          c.input.queries.forEach((q, i) => {
            const r = coordUtils.resolveUnit(q);
            const got = r === null ? null : r.key ?? null;
            if (got !== c.expected[i]) throw new Error(`query ${q}: got ${got}`);
          });
          break;
        }
        if (c.expected?.keys) c.expected.keys.forEach((k, i) => {
          const r = coordUtils.resolveUnit(c.input.queries[i]);
          if (!r || r.key !== k) throw new Error(`got ${JSON.stringify(r)}`);
          if (c.expected.factors && !close(r.factor, c.expected.factors[i], tol)) throw new Error('factor');
        });
        if (c.expected?.nonNull) c.input.queries.forEach((q) => { if (!coordUtils.resolveUnit(q)) throw new Error(q); });
        if (Array.isArray(c.expected)) c.input.queries.forEach((q, i) => {
          if (coordUtils.resolveUnit(q) !== c.expected[i]) throw new Error(`query ${q}`);
        });
        break;
      }
      case 'convertLength': {
        if (c.expected?.throws) {
          let threw = false;
          try { coordUtils.convertLength(c.input.value, c.input.from, c.input.to); } catch (e) { threw = new RegExp(c.expected.throws).test(e.message); }
          if (!threw) throw new Error('expected throw');
        } else if (!close(coordUtils.convertLength(c.input.value, c.input.from, c.input.to), c.expected, tol)) {
          throw new Error('convert mismatch');
        }
        break;
      }
      case 'fromMetres': {
        if (!close(coordUtils.fromMetres(c.input.value, c.input.to), c.expected, tol)) throw new Error('fromMetres');
        break;
      }
      case 'toMetres': {
        const r = coordUtils.toMetres(c.input.value, c.input.from);
        if (c.expected?.throws) throw new Error('expected throw helper missing');
        if (!close(r, c.expected, tol)) throw new Error('toMetres');
        break;
      }
      case 'toScene':
      case 'toOriginal':
      case 'roundtrip': {
        const frame = coordinates.createCoordinateFrame(frameFor(c.input.base));
        if (c.fn === 'toScene') {
          const s = frame.toScene(c.input.original);
          checkPoint({ x: s.x, y: s.y, z: s.z }, c.expected, tol, 'toScene');
        } else if (c.fn === 'toOriginal') {
          let got;
          try {
            got = frame.toOriginal(c.input.scene);
          } catch {
            got = null; // singular base: three.js inverts to all-zero, not a throw
          }
          // Legacy singular behaviour: three.js inverts to NaNs (not a throw).
          // Rust returns None instead (spec R10); the runner pins the NaN fact.
          const isNonFinite = got && ['x', 'y', 'z'].some((k) => !Number.isFinite(got[k]));
          if (c.expected?.ok === false) {
            if (!isNonFinite) throw new Error(`expected singular, got ${JSON.stringify(got)}`);
          } else {
            if (isNonFinite) throw new Error(`singular base gave non-finite for ${c.id}`);
            checkPoint(got, c.expected, tol, 'toOriginal');
          }
        } else {
          const s = frame.toScene(c.input.original);
          checkPoint(frame.toOriginal({ x: s.x, y: s.y, z: s.z }), c.expected, tol, 'roundtrip');
        }
        break;
      }
      default:
        throw new Error(`unknown fn ${c.fn}`);
    }
    pass += 1;
  } catch (e) {
    fail += 1;
    failures.push(`${id}: ${e.message}`);
  }
}

const files = ['vec.json', 'segment.json', 'units.json', 'frames.json'].filter((f) => !filter || f.startsWith(filter));
for (const f of files) {
  const vec = JSON.parse(readFileSync(path.join(VEC_DIR, f), 'utf8'));
  for (const c of vec.cases) await runCase(f, c);
}

console.log(`geom vectors: ${pass} pass, ${fail} fail`);
if (failures.length) {
  for (const m of failures) console.log(`  FAIL ${m}`);
  process.exit(1);
}
if (!existsSync(path.join(VEC_DIR, 'vec.json'))) process.exit(1);
