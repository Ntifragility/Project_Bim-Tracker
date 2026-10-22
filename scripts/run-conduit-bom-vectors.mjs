// Task 4.4 vector runner: executes spec/vectors/conduit/bom-engine.json
// against legacy JS. Exit code 1 on any failure.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const VEC_DIR = path.join(ROOT, 'spec/vectors/conduit');

const LEG = path.join(ROOT, 'legacy/packages/conduit-core/src');
const bomCalc = await import(path.join(LEG, 'bom-calculator.js'));

let pass = 0, fail = 0;
const failures = [];

function close(a, b, tol) {
  return Math.abs(a - b) <= tol;
}

function buildNetwork(c) {
  let net = { settings: { stickLength: c.input.stockLengthM ?? 3.048 }, nodes: [], runs: [] };
  let nid = 0, rid = 0;
  for (const r of c.input.runs) {
    const ids = [];
    for (const p of r.points) {
      nid += 1;
      const id = `n${nid}`;
      net.nodes.push({ id, x: p[0], y: p[1], z: p[2] ?? 0 });
      ids.push(id);
    }
    rid += 1;
    net.runs.push({ id: `r${rid}`, name: `Run ${rid}`, size: r.size, system: r.system, nodeIds: ids });
  }
  return net;
}

async function runCase(vecFile, c) {
  const id = `${vecFile}:${c.id}`;
  const tol = c.tol ?? 1e-9;
  try {
    switch (c.fn) {
      case 'optimizeStickCutting': {
        const r = bomCalc.optimizeStickCutting(c.input.cuts, c.input.stockLengthM);
        const e = c.expected;
        if (r.sticksNeeded !== e.sticksNeeded) throw new Error(`sticks ${r.sticksNeeded}`);
        if (!close(r.totalLengthM, e.totalLengthM, tol)) throw new Error(`len ${r.totalLengthM}`);
        if (e.totalWasteM !== undefined && !close(r.totalWasteM, e.totalWasteM, tol)) throw new Error(`waste ${r.totalWasteM}`);
        if (e.wastePercentage !== undefined && r.wastePercentage !== e.wastePercentage) throw new Error('pct');
        if (e.sticks) {
          if (r.sticks.length !== e.sticks.length) throw new Error('stick rows');
          e.sticks.forEach((es, i) => {
            if (JSON.stringify(r.sticks[i].cuts) !== JSON.stringify(es.cuts)) throw new Error(`cuts ${i}`);
            if (!close(r.sticks[i].wasteM, es.wasteM, tol)) throw new Error(`waste ${i}`);
          });
        }
        break;
      }
      case 'computeDetailedBom': {
        const net = buildNetwork(c);
        const b = bomCalc.computeDetailedBom(net, {
          stockLengthM: c.input.stockLengthM,
          wasteFactorPct: c.input.wasteFactorPct ?? 0,
        });
        const e = c.expected;
        if (e.totals) for (const [k, v] of Object.entries(e.totals)) {
          if (k.endsWith('Gte')) { if (!(b.totals[k.slice(0, -3)] >= v)) throw new Error(`totals.${k}`); }
          else if (k === 'lengthM') { if (!close(b.totals.lengthM, v, tol)) throw new Error('lengthM'); }
          else if (b.totals[k] !== v) throw new Error(`totals.${k} = ${b.totals[k]} != ${v}`);
        }
        if (e.runs) e.runs.forEach((er, i) => {
          if (er.isNecCompliant !== undefined && b.runs[i].isNecCompliant !== er.isNecCompliant) throw new Error('compliance');
          if (er.cumulativeBendsDegGt !== undefined && !(b.runs[i].cumulativeBendsDeg > er.cumulativeBendsDegGt)) throw new Error('bends');
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
const files = readdirSync(VEC_DIR).filter((f) => f.endsWith('.json')).filter((f) => !only || f === `${only}.json`).filter((f) => f === 'bom-engine.json').sort();
for (const f of files) {
  const vec = JSON.parse(readFileSync(path.join(VEC_DIR, f), 'utf8'));
  for (const c of vec.cases) await runCase(f, c);
}

console.log(`\nconduit-bom vectors: ${pass} passed, ${fail} failed (bom-engine.json)`);
for (const fl of failures) console.log('FAIL', fl);
process.exit(fail ? 1 : 0);
