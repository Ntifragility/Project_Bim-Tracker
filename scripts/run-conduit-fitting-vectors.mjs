// Task 4.3 vector runner: executes spec/vectors/conduit/fitting-engine.json
// against legacy JS. Exit code 1 on any failure.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const VEC_DIR = path.join(ROOT, 'spec/vectors/conduit');

const LEG = path.join(ROOT, 'legacy/packages/conduit-core/src');
const fitting = await import(path.join(LEG, 'fitting-solver.js'));

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
      case 'getNecBendRadiusM': {
        c.input.queries.forEach((q, i) => {
          const r = fitting.getNecBendRadiusM(q);
          if (!close(r, c.expected[i], tol)) throw new Error(`${q} -> ${r} != ${c.expected[i]}`);
        });
        break;
      }
      case 'NEC_BEND_TABLE.shape': {
        if (fitting.NEC_BEND_TABLE.length !== c.expected.count) throw new Error('count');
        if (fitting.NEC_BEND_TABLE[0].tradeSize !== c.expected.first) throw new Error('first');
        if (fitting.NEC_BEND_TABLE.at(-1).tradeSize !== c.expected.last) throw new Error('last');
        break;
      }
      case 'calculateBendAngle': {
        const r = fitting.calculateBendAngle(c.input.p1, c.input.corner, c.input.p2);
        if (!close(r, c.expected, tol)) throw new Error(`angle ${r}`);
        break;
      }
      case 'solveElbowFitting': {
        const r = fitting.solveElbowFitting(c.input.p1, c.input.corner, c.input.p2, c.input.radiusM, c.input.arcSegments);
        const e = c.expected;
        if (r.isValid !== e.isValid || r.isStraight !== e.isStraight) throw new Error('flags');
        if (!close(r.bendAngleDeg, e.bendAngleDeg, tol)) throw new Error(`angle ${r.bendAngleDeg}`);
        if (e.tangentDistance !== undefined) {
          if (!close(r.tangentDistance, e.tangentDistance, tol)) throw new Error(`tan ${r.tangentDistance}`);
          if (e.tangentStart) checkPoint(r.tangentStart, e.tangentStart, tol, 'start');
          if (e.tangentEnd) checkPoint(r.tangentEnd, e.tangentEnd, tol, 'end');
          if (e.center) checkPoint(r.center, e.center, tol, 'center');
          if (e.arcPointCount !== undefined && r.arcPoints.length !== e.arcPointCount) throw new Error(`arc ${r.arcPoints.length}`);
        }
        if (e.clamped) {
          const requested = c.input.radiusM * Math.tan((r.bendAngleDeg * 0.5) * Math.PI / 180);
          if (!(r.tangentDistance < requested)) throw new Error('not clamped');
        }
        break;
      }
      case 'analyzeRunBends': {
        const r = fitting.analyzeRunBends(c.input.points);
        const e = c.expected;
        if (!close(r.totalDegrees, e.totalDegrees, tol)) throw new Error(`total ${r.totalDegrees}`);
        if (r.fittingsCount !== e.fittingsCount || r.exceedsNec360 !== e.exceedsNec360) throw new Error('flags');
        if (e.warning === null && r.warning !== null) throw new Error('expected null warning');
        if (e.warningContains && !r.warning?.includes(e.warningContains)) throw new Error(`warning ${r.warning}`);
        break;
      }
      case 'solveAutoRiser': {
        const r = fitting.solveAutoRiser(c.input.start, c.input.targetElevation, c.input.options ?? {});
        if (r.length !== c.expected.length) throw new Error(`len ${r.length}`);
        c.expected.forEach((ep, i) => {
          checkPoint(r[i], ep, tol, `riser[${i}]`);
          if (ep.isRiser !== null && ep.isRiser !== undefined && r[i].isRiser !== ep.isRiser) throw new Error('riser flag');
          if (ep.heightDelta !== null && ep.heightDelta !== undefined && !close(r[i].heightDelta, ep.heightDelta, tol)) throw new Error('delta');
        });
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
const files = readdirSync(VEC_DIR).filter((f) => f.endsWith('.json')).filter((f) => !only || f === `${only}.json`).filter((f) => f === 'fitting-engine.json').sort();
for (const f of files) {
  const vec = JSON.parse(readFileSync(path.join(VEC_DIR, f), 'utf8'));
  for (const c of vec.cases) await runCase(f, c);
}

console.log(`\nconduit-fitting vectors: ${pass} passed, ${fail} failed (fitting-engine.json)`);
for (const fl of failures) console.log('FAIL', fl);
process.exit(fail ? 1 : 0);
