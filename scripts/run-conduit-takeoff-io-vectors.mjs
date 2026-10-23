// Task 4.5 vector runner: executes spec/vectors/conduit/takeoff-io-engine.json
// against legacy JS. Exit code 1 on any failure.
//
// Usage: node scripts/run-conduit-takeoff-io-vectors.mjs [--file takeoff-io-engine]
//
// findSnap is the last pure conduit port (legacy snap.js). The dangling-ref
// case documents the R6 deviation: legacy throws TypeError on an unresolvable
// node pair; the Rust port skips the pair (validate_network already rejects
// dangling refs, so parity holds on every valid input).

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const VEC_DIR = path.join(ROOT, 'spec/vectors/conduit');

const LEG = path.join(ROOT, 'legacy/packages/conduit-core/src');
const snapMod = await import(path.join(LEG, 'snap.js'));

let pass = 0, fail = 0;
const failures = [];

function close(a, b, tol) {
  return Math.abs(a - b) <= tol;
}

async function runCase(vecFile, c) {
  const id = `${vecFile}:${c.id}`;
  const tol = c.tol ?? 1e-9;
  try {
    if (c.fn !== 'findSnap') throw new Error(`unknown fn ${c.fn}`);
    const net = {
      nodes: c.input.network.nodes.map((n) => ({ ...n })),
      runs: c.input.network.runs.map((r) => ({ ...r, nodeIds: [...r.nodeIds] })),
    };
    let got = null;
    let threw = null;
    try {
      got = snapMod.findSnap(net, c.input.point, c.input.tolerance);
    } catch (e) {
      threw = e;
    }
    const e = c.expected;
    if (e === null) {
      // Legacy parity: null on miss. The dangling-ref case documents the
      // R6 deviation (legacy throws TypeError here; Rust skips the pair).
      if (c.id === 'findsnap-dangling-ref-skipped') {
        if (!threw || !(threw instanceof TypeError)) throw new Error('expected legacy TypeError');
        pass++;
        return;
      }
      if (threw) throw threw;
      if (got !== null) throw new Error(`expected null, got ${JSON.stringify(got)}`);
    } else {
      if (threw) throw threw;
      if (!got || got.kind !== e.kind) throw new Error(`kind ${JSON.stringify(got)}`);
      if (e.nodeId !== undefined && got.nodeId !== e.nodeId) throw new Error(`node ${got.nodeId}`);
      if (e.runId !== undefined && got.runId !== e.runId) throw new Error(`run ${got.runId}`);
      if (e.index !== undefined && got.index !== e.index) throw new Error(`index ${got.index}`);
      if (e.point !== undefined) {
        for (const k of ['x', 'y', 'z']) {
          if (e.point[k] !== undefined && !close(got.point[k], e.point[k], tol)) throw new Error(`point.${k}`);
        }
      }
      if (e.distance !== undefined && !close(got.distance, e.distance, tol)) throw new Error('distance');
    }
    pass++;
  } catch (err) {
    fail++;
    failures.push(`${id}: ${err.message}`);
  }
}

const only = process.argv.find((a) => a.startsWith('--file='))?.split('=')[1];
const files = readdirSync(VEC_DIR).filter((f) => f.endsWith('.json')).filter((f) => !only || f === `${only}.json`).filter((f) => f === 'takeoff-io-engine.json').sort();
for (const f of files) {
  const vec = JSON.parse(readFileSync(path.join(VEC_DIR, f), 'utf8'));
  for (const c of vec.cases) await runCase(f, c);
}

console.log(`\nconduit-takeoff-io vectors: ${pass} passed, ${fail} failed (takeoff-io-engine.json)`);
for (const fl of failures) console.log('FAIL', fl);
process.exit(fail ? 1 : 0);
