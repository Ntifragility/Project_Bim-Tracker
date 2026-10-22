// Task 4.1 vector runner: executes spec/vectors/conduit/network.json against legacy JS.
//
// Usage: node scripts/run-conduit-network-vectors.mjs [--file network]
//
// Each vector case runs the named legacy function and compares against
// `expected` with the case `tol`. Reports pass/fail per case + summary.
// Exit code 1 on any failure. History (command-stack model without
// closures) and registry seed run through the same legacy modules;
// closure/listener/random-id behaviour stays TS-side (io.json jsOnly).

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const VEC_DIR = path.join(ROOT, 'spec/vectors/conduit');

const LEG = path.join(ROOT, 'legacy/packages/conduit-core/src');
const network = await import(path.join(LEG, 'network.js'));
const takeoffMod = await import(path.join(LEG, 'takeoff.js'));
const cmdStack = await import(path.join(LEG, 'command-stack.js'));
const diamReg = await import(path.join(LEG, 'diameter-registry.js'));
const config = await import(path.join(LEG, 'config.js'));

const pt = (x, y, z = 0) => ({ x, y, z });
const fromArr = (a) => pt(a[0], a[1], a[2] ?? 0);

let pass = 0, fail = 0;
const failures = [];

function close(a, b, tol) {
  return Math.abs(a - b) <= tol;
}

function drawRun(stickLength, points, { size = '3/4"', system = '' } = {}) {
  let net = network.createNetwork({ stickLength });
  let nodeId;
  ({ network: net, nodeId } = network.addNode(net, fromArr(points[0])));
  let runId;
  ({ network: net, runId } = network.startRun(net, { size, system }, nodeId));
  for (const p of points.slice(1)) {
    ({ network: net, nodeId } = network.addNode(net, fromArr(p)));
    net = network.appendToRun(net, runId, nodeId);
  }
  return { net, runId };
}

async function runCase(vecFile, c) {
  const id = `${vecFile}:${c.id}`;
  const tol = c.tol ?? 1e-9;
  try {
    switch (c.fn) {
      case 'create/addNode': {
        const net = network.createNetwork({ stickLength: c.input.stickLength });
        if (net.version !== c.expected.version) throw new Error('version');
        if (net.settings.stickLength !== c.expected.stickLength) throw new Error('stick');
        const { network: next, nodeId } = network.addNode(net, fromArr(c.input.point));
        if (!/^n\d+$/.test(nodeId)) throw new Error(`id ${nodeId}`);
        if (next.nodes.length !== c.expected.nodeCount) throw new Error('count');
        break;
      }
      case 'startRun': {
        let net = network.createNetwork({ stickLength: 3 });
        let first;
        ({ network: net, nodeId: first } = network.addNode(net, pt(0, 0, 0)));
        if (c.input.badNode) {
          let threw = null;
          try { network.startRun(net, { size: c.input.size }, c.input.badNode); } catch (e) { threw = e; }
          if (!threw || !new RegExp(c.expected.errorContains).test(threw.message)) throw new Error('no-throw');
          break;
        }
        ({ network: net } = network.addNode(net, pt(1, 0, 0)));
        const { network: next, runId } = network.startRun(net, { size: c.input.size, system: c.input.system }, first);
        if (!/^r\d+$/.test(runId)) throw new Error(`id ${runId}`);
        const run = next.runs.find((r) => r.id === runId);
        if (c.expected.name && run.name !== c.expected.name) throw new Error(`name ${run.name}`);
        if (c.expected.namePattern && !new RegExp(c.expected.namePattern).test(run.name)) throw new Error(`name ${run.name}`);
        if (next.nodes.length !== c.expected.nodeCount) throw new Error('nodes');
        break;
      }
      case 'appendToRun': {
        const { net, runId } = drawRun(3, c.input.points ?? [[0, 0, 0], [1, 0, 0]]);
        if (c.input.badRun) {
          let threw = null;
          try { network.appendToRun(net, 'r99', net.nodes[0].id); } catch (e) { threw = e; }
          if (!threw || !new RegExp(c.expected.errorContains).test(threw.message)) throw new Error('no-throw');
          break;
        }
        if (c.input.badNode) {
          let threw = null;
          try { network.appendToRun(net, runId, 'n99'); } catch (e) { threw = e; }
          if (!threw || !new RegExp(c.expected.errorContains).test(threw.message)) throw new Error('no-throw');
          break;
        }
        if (c.input.dupLast) {
          const run = net.runs.find((r) => r.id === runId);
          const same = network.appendToRun(net, runId, run.nodeIds.at(-1));
          if (same !== net) throw new Error('not same object');
          if (same.runs.find((r) => r.id === runId).nodeIds.length !== c.expected.nodeIds) throw new Error('count');
          break;
        }
        const res = network.addNode(net, pt(2, 0, 0));
        const next = network.appendToRun(res.network, runId, res.nodeId);
        if (next.runs.find((r) => r.id === runId).nodeIds.length !== c.expected.nodeIds) throw new Error('count');
        break;
      }
      case 'splitSegment': {
        const { net, runId } = drawRun(3, c.input.points);
        if (c.input.badIndex !== undefined) {
          let threw = null;
          try { network.splitSegment(net, runId, c.input.badIndex, pt(0, 0, 0)); } catch (e) { threw = e; }
          if (!threw || !new RegExp(c.expected.errorContains).test(threw.message)) throw new Error('no-throw');
          break;
        }
        const { network: split } = network.splitSegment(net, runId, c.input.split.index, fromArr(c.input.split.point));
        const run = split.runs.find((r) => r.id === runId);
        if (run.nodeIds.length !== c.expected.nodeCount) throw new Error('count');
        if (!close(takeoffMod.computeTakeoff(split).runs[0].length, c.expected.length, tol)) throw new Error('length');
        break;
      }
      case 'removeLastPoint+deleteRun': {
        const { net, runId } = drawRun(3, c.input.points);
        const after = network.removeLastPoint(net, runId);
        if (after.nodes.length !== c.expected.nodesAfterRemove) throw new Error(`nodes ${after.nodes.length}`);
        const gone = network.deleteRun(after, runId);
        if (gone.nodes.length !== c.expected.nodesAfterDelete || gone.runs.length !== c.expected.runsAfterDelete) throw new Error('delete');
        break;
      }
      case 'dropIncompleteRuns': {
        let net = network.createNetwork({ stickLength: 3 });
        let n1;
        ({ network: net, nodeId: n1 } = network.addNode(net, pt(0, 0, 0)));
        const { network: n2, runId } = network.startRun(net, { size: '3/4"' }, n1);
        net = n2;
        const dropped = network.dropIncompleteRuns(net);
        if (dropped.runs.length !== c.expected.runCountAfterDrop) throw new Error('runs');
        if (dropped.nodes.length !== c.expected.nodeCountAfterDrop) throw new Error('nodes');
        void runId;
        break;
      }
      case 'updateRun': {
        const { net, runId } = drawRun(3, [[0, 0, 0], [1, 0, 0]]);
        if (c.input.badRun) {
          const same = network.updateRun(net, 'r99', c.input.changes);
          if (same !== net) throw new Error('not same');
          if (!c.expected.otherRunUnchanged) throw new Error('flag');
          break;
        }
        const next = network.updateRun(net, runId, c.input.changes);
        const run = next.runs.find((r) => r.id === runId);
        for (const [k, v] of Object.entries(c.expected)) if (run[k] !== v) throw new Error(`${k} = ${run[k]}`);
        break;
      }
      case 'setStickLength': {
        const { net } = drawRun(3, [[0, 0, 0], [1, 0, 0]]);
        if (c.input.stickLength <= 0) {
          let threw = null;
          try { network.setStickLength(net, c.input.stickLength); } catch (e) { threw = e; }
          if (!threw || !new RegExp(c.expected.errorContains).test(threw.message)) throw new Error('no-throw');
          break;
        }
        const next = network.setStickLength(net, c.input.stickLength);
        if (next.settings.stickLength !== c.expected.stickLength) throw new Error('stick');
        break;
      }
      case 'validateNetwork': {
        let data = { version: 1, frame: 'ifc-original', units: 'm', nodes: [], runs: [], nextId: 1 };
        if (c.input.badVersion) data = { ...data, version: c.input.badVersion };
        if (c.input.dangling) data = { ...data, nodes: [{ id: 'n1', x: 0, y: 0, z: 0 }], runs: [{ id: 'r1', nodeIds: ['n99'] }] };
        let threw = null;
        try { network.validateNetwork(data); } catch (e) { threw = e; }
        if (!threw || !new RegExp(c.expected.errorContains).test(threw.message)) throw new Error('no-throw');
        break;
      }
      case 'validateNetwork(computeTakeoff)': {
        const { net } = drawRun(c.input.stickLength, c.input.points);
        const json = JSON.parse(JSON.stringify(net));
        const reloaded = network.validateNetwork(json);
        const a = takeoffMod.computeTakeoff(net).runs[0];
        const b = takeoffMod.computeTakeoff(reloaded).runs[0];
        if (!close(a.length, c.expected.length, tol) || !close(b.length, c.expected.length, tol)) throw new Error('length');
        if (a.sticks !== c.expected.sticks || b.sticks !== c.expected.sticks) throw new Error('sticks');
        if (c.input.nextId !== undefined) {
          const data = { ...JSON.parse(JSON.stringify(net)), nextId: c.input.nextId };
          const v = network.validateNetwork(data);
          const numeric = [...v.nodes.map((n) => n.id), ...v.runs.map((r) => r.id)]
            .map((id) => Number(String(id).slice(1))).filter(Number.isFinite);
          const want = Math.max(c.input.nextId, ...numeric.map((n) => n + 1));
          if (v.nextId !== want) throw new Error(`nextId ${v.nextId} != ${want}`);
          if (c.expected.nextIdMin !== undefined && v.nextId < c.expected.nextIdMin) throw new Error('nextIdMin');
        }
        break;
      }
      case 'history': {
        // Model parity through the legacy closure stack: sequence + depth.
        // ops: ["exec(+N)"] pushes synthetic labels; undo/redo move them.
        const st = cmdStack.createCommandStack({ maxDepth: c.input.maxDepth });
        let v = 0;
        const mk = (n) => ({ execute: () => { v += n; }, undo: () => { v -= n; } });
        if (c.input.execCount) {
          for (let i = 0; i < c.input.execCount; i++) st.execute(mk(1));
          if (st.undoCount !== c.expected.undoCount) throw new Error('depth');
          break;
        }
        (c.input.ops ?? []).forEach((op, i) => {
          if (op.startsWith('exec')) st.execute(mk(Number(op.match(/[+-]?\d+/)[0])));
          else if (op === 'undo') st.undo();
          else if (op === 'redo') st.redo();
          if (v !== c.expected.states[i]) throw new Error(`step ${i}: ${v}`);
        });
        if (c.expected.states && st.canUndo() !== c.expected.canUndoEnd) throw new Error('canUndo');
        if (c.expected.undoCount !== undefined && st.undoCount !== c.expected.undoCount) throw new Error('depth');
        break;
      }
      case 'registry': {
        const reg = diamReg.createDiameterRegistry();
        const e = c.expected;
        if (reg.getAll().length < e.countGte) throw new Error('count');
        for (const l of e.hasLabels ?? []) if (!reg.getByLabel(l)) throw new Error(`missing ${l}`);
        if (e.defaultSelected && reg.getSelected().label !== e.defaultSelected) throw new Error('default');
        if (e.colorOf1in && reg.getColor('1"') !== e.colorOf1in) throw new Error('color');
        if (e.colorOfUnknown && reg.getColor('nope') !== e.colorOfUnknown) throw new Error('fallback');
        if (e.ids && JSON.stringify(reg.getAll().map((d) => d.id)) !== JSON.stringify(e.ids)) throw new Error('ids');
        break;
      }
      case 'constants': {
        if (config.DEFAULT_STICK_LENGTH_M !== c.expected.stickLength) throw new Error('stick');
        if (config.MAX_UNDO_DEPTH !== c.expected.maxDepth) throw new Error('depth');
        if (config.DEFAULT_DIAMETERS.length !== c.expected.diameterCount) throw new Error('count');
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
const files = readdirSync(VEC_DIR).filter((f) => f.endsWith('.json')).filter((f) => !only || f === `${only}.json`).filter((f) => f === 'network.json' || f === 'network-history.json' || f === 'network-registry.json').sort();
for (const f of files) {
  const vec = JSON.parse(readFileSync(path.join(VEC_DIR, f), 'utf8'));
  for (const c of vec.cases) await runCase(f, c);
}

console.log(`\nconduit-network vectors: ${pass} passed, ${fail} failed (${files.join(', ')})`);
for (const fl of failures) console.log('FAIL', fl);
process.exit(fail ? 1 : 0);
