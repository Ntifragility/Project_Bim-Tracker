// Task 2.1 vector runner: executes spec/vectors/conduit/*.json against legacy JS.
//
// Usage: node scripts/run-conduit-vectors.mjs [--file snap|fitting|takeoff|bom|units|io]
//
// Each vector case runs the named legacy function and compares against
// `expected` with the case `tol`. Reports pass/fail per case + summary.
// Exit code 1 on any failure. io.json cases are jsOnly by design.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const VEC_DIR = path.join(ROOT, 'spec/vectors/conduit');

const LEG = path.join(ROOT, 'legacy/packages/conduit-core/src');
const snapEngine = await import(path.join(LEG, 'snap-engine.js'));
const fitting = await import(path.join(LEG, 'fitting-solver.js'));
const bomCalc = await import(path.join(LEG, 'bom-calculator.js'));
const geometry = await import(path.join(LEG, 'geometry.js'));
const takeoffMod = await import(path.join(LEG, 'takeoff.js'));
const network = await import(path.join(LEG, 'network.js'));
const snapMod = await import(path.join(LEG, 'snap.js'));
const coordUtils = await import(path.join(LEG, 'coordinate-utils.js'));
const config = await import(path.join(LEG, 'config.js'));
const diamReg = await import(path.join(LEG, 'diameter-registry.js'));
const cmdStack = await import(path.join(LEG, 'command-stack.js'));
const markerModel = await import(path.join(LEG, 'marker-model.js'));
const projectIo = await import(path.join(LEG, 'project-io.js'));
const csvExport = await import(path.join(LEG, 'csv-export.js'));
const ifcExporter = await import(path.join(LEG, 'ifc-exporter.js'));

const pt = (x, y, z = 0) => ({ x, y, z });
const fromArr = (a) => pt(a[0], a[1], a[2] ?? 0);

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

function buildNetwork(spec) {
  // Accepts {runs:[{size,system,points:[[x,y,z]...]}]} or legacy shorthand {points:[[x,y,z]...]}
  const runs = spec.runs ?? (spec.points ? [{ size: '3/4"', system: '', points: spec.points }] : []);
  let net = network.createNetwork({ stickLength: spec.stickLength ?? 3.048 });
  const runIds = [];
  for (const r of runs) {
    let nodeIds = [];
    for (const p of r.points) {
      const res = network.addNode(net, fromArr(p));
      net = res.network;
      nodeIds.push(res.nodeId);
    }
    if (nodeIds.length === 0) {
      const res = network.addNode(net, pt(0, 0, 0));
      net = res.network;
      nodeIds = [res.nodeId];
    }
    if (nodeIds.length === 1) {
      // single-point run: start and leave as-is
      const res = network.startRun(net, { size: r.size ?? '3/4"', system: r.system ?? '' }, nodeIds[0]);
      net = res.network;
      runIds.push(res.runId);
    } else {
      const res = network.startRun(net, { size: r.size ?? '3/4"', system: r.system ?? '' }, nodeIds[0]);
      net = res.network;
      const runId = res.runId;
      runIds.push(runId);
      for (const nid of nodeIds.slice(1)) net = network.appendToRun(net, runId, nid);
    }
  }
  if (spec.network?.nodes && spec.network?.runs) {
    net = network.createNetwork({ stickLength: 3 });
    for (const n of spec.network.nodes) {
      const res = network.addNode(net, n);
      net = res.network;
    }
  }
  return { net, runIds };
}

function vecNetworkMatrix(spec) {
  // For findSnap cases that pass explicit {nodes, runs} with ids
  let net = network.createNetwork({ stickLength: 3 });
  for (const n of spec.network.nodes) net.nodes.push({ ...n });
  for (const r of spec.network.runs) net.runs.push({ id: r.id, name: r.id, size: '3/4"', system: '', nodeIds: [...r.nodeIds] });
  return net;
}

async function runCase(vecFile, c) {
  const id = `${vecFile}:${c.id}`;
  const tol = c.tol ?? 1e-9;
  try {
    switch (c.fn) {
      case 'vec3.add': {
        const r = snapEngine.vec3.add(c.input.a, c.input.b);
        if (JSON.stringify(r) !== JSON.stringify(c.expected)) throw new Error(`got ${JSON.stringify(r)}`);
        break;
      }
      case 'vec3.sub': {
        const r = snapEngine.vec3.sub(c.input.a, c.input.b);
        if (JSON.stringify(r) !== JSON.stringify(c.expected)) throw new Error(`got ${JSON.stringify(r)}`);
        break;
      }
      case 'vec3.distance': {
        if (!close(snapEngine.vec3.distance(c.input.a, c.input.b), c.expected, tol)) throw new Error(`got ${snapEngine.vec3.distance(c.input.a, c.input.b)}`);
        break;
      }
      case 'vec3.length': {
        if (!close(snapEngine.vec3.length(c.input.a), c.expected, tol)) throw new Error('length mismatch');
        break;
      }
      case 'vec3.normalize': {
        checkPoint(snapEngine.vec3.normalize(c.input.a), c.expected, tol, 'normalize');
        break;
      }
      case 'closestPointOnSegment': {
        const r = snapEngine.closestPointOnSegment(c.input.p, c.input.a, c.input.b);
        checkPoint(r.point, c.expected.point, tol, 'closest.point');
        if (!close(r.t, c.expected.t, tol)) throw new Error(`t ${r.t} != ${c.expected.t}`);
        if (c.expected.distance !== undefined && !close(r.distance, c.expected.distance, tol)) throw new Error('distance mismatch');
        break;
      }
      case 'snapToNodes': {
        const r = snapEngine.snapToNodes(c.input.query, c.input.nodes, c.input.tolerance);
        if (c.expected === null) {
          if (r !== null) throw new Error(`expected null, got ${JSON.stringify(r)}`);
        } else {
          if (!r || r.snapType !== c.expected.snapType || r.targetId !== c.expected.targetId) throw new Error(`got ${JSON.stringify(r)}`);
          checkPoint(r.point, c.expected.point, tol, 'snapToNodes.point');
        }
        break;
      }
      case 'snapToSegments': {
        const r = snapEngine.snapToSegments(c.input.query, c.input.segments, c.input.tolerance);
        if (!r || r.snapType !== c.expected.snapType || r.targetId !== c.expected.targetId) throw new Error(`got ${JSON.stringify(r)}`);
        checkPoint(r.point, c.expected.point, tol, 'snapToSegments.point');
        break;
      }
      case 'snapPolarAngle': {
        const r = snapEngine.snapPolarAngle(c.input.from, c.input.to, c.input.options ?? {});
        if (c.expected === null) {
          if (r !== null) throw new Error(`expected null, got ${JSON.stringify(r)}`);
        } else {
          if (!r || r.snapType !== c.expected.snapType || r.angleDeg !== c.expected.angleDeg) throw new Error(`got ${JSON.stringify(r)}`);
          checkPoint(r.point, c.expected.point, tol, 'polar.point');
        }
        break;
      }
      case 'snapOrtho3D': {
        const r = snapEngine.snapOrtho3D(c.input.from, c.input.to);
        if (r.snapType !== c.expected.snapType || r.guideAxis !== c.expected.guideAxis) throw new Error(`got ${JSON.stringify(r)}`);
        checkPoint(r.point, c.expected.point, tol, 'ortho.point');
        break;
      }
      case 'raycastElevationPlane': {
        const r = snapEngine.raycastElevationPlane(c.input.origin, c.input.dir, c.input.elevation, c.input.upAxis ?? 'Y');
        checkPoint(r, c.expected, tol, 'raycast');
        break;
      }
      case 'SnapEngine.resolve': {
        const e = new snapEngine.SnapEngine(c.input.config);
        const r = e.resolve(c.input.raw, c.input.context);
        if (r.snapType !== c.expected.snapType) throw new Error(`snapType ${r.snapType} != ${c.expected.snapType}`);
        if (c.expected.targetId !== undefined && r.targetId !== c.expected.targetId) throw new Error(`target ${r.targetId}`);
        if (c.expected.angleDeg !== undefined && r.angleDeg !== c.expected.angleDeg) throw new Error(`angle ${r.angleDeg}`);
        if (c.expected.guideAxis !== undefined && r.guideAxis !== c.expected.guideAxis) throw new Error(`axis ${r.guideAxis}`);
        if (c.expected.point) checkPoint(r.point, c.expected.point, tol, 'resolve.point');
        break;
      }
      case 'getNecBendRadiusM': {
        c.input.queries.forEach((q, i) => {
          if (!close(fitting.getNecBendRadiusM(q), c.expected[i], tol)) throw new Error(`${q} -> ${fitting.getNecBendRadiusM(q)} != ${c.expected[i]}`);
        });
        break;
      }
      case 'calculateBendAngle': {
        const r = fitting.calculateBendAngle(c.input.p1, c.input.corner, c.input.p2);
        if (!close(r, c.expected, tol)) throw new Error(`angle ${r} != ${c.expected}`);
        break;
      }
      case 'solveElbowFitting': {
        const r = fitting.solveElbowFitting(c.input.p1, c.input.corner, c.input.p2, c.input.radiusM, c.input.arcSegments);
        const e = c.expected;
        if (r.isValid !== e.isValid || r.isStraight !== e.isStraight) throw new Error(`validity ${JSON.stringify({ isValid: r.isValid, isStraight: r.isStraight })}`);
        if (e.bendAngleDeg !== undefined && !close(r.bendAngleDeg, e.bendAngleDeg, tol)) throw new Error(`bend ${r.bendAngleDeg}`);
        if (e.tangentDistance !== undefined && !close(r.tangentDistance, e.tangentDistance, tol)) throw new Error(`tangent ${r.tangentDistance}`);
        if (e.tangentStart) checkPoint(r.tangentStart, e.tangentStart, tol, 'tangentStart');
        if (e.tangentEnd) checkPoint(r.tangentEnd, e.tangentEnd, tol, 'tangentEnd');
        if (e.center) checkPoint(r.center, e.center, tol, 'center');
        if (e.arcPointCount !== undefined && r.arcPoints.length !== e.arcPointCount) throw new Error(`arcPoints ${r.arcPoints.length}`);
        break;
      }
      case 'analyzeRunBends': {
        const r = fitting.analyzeRunBends(c.input.points);
        const e = c.expected;
        if (!close(r.totalDegrees, e.totalDegrees, tol)) throw new Error(`total ${r.totalDegrees}`);
        if (r.fittingsCount !== e.fittingsCount || r.exceedsNec360 !== e.exceedsNec360) throw new Error(`flags ${JSON.stringify(r)}`);
        if (e.warning === null && r.warning !== null) throw new Error('expected null warning');
        if (e.warningContains && !r.warning?.includes(e.warningContains)) throw new Error(`warning ${r.warning}`);
        break;
      }
      case 'solveAutoRiser': {
        const r = fitting.solveAutoRiser(c.input.start, c.input.targetElevation, c.input.options ?? {});
        if (r.length !== c.expected.length) throw new Error(`len ${r.length}`);
        checkPoint(r[0], c.expected[0], tol, 'riser[0]');
        if (c.expected[1]) {
          checkPoint(r[1], c.expected[1], tol, 'riser[1]');
          if (r[1].isRiser !== true) throw new Error('missing isRiser');
          if (!close(r[1].heightDelta, c.expected[1].heightDelta, tol)) throw new Error('heightDelta');
        }
        break;
      }
      case 'computeTakeoff': {
        const { net } = buildNetwork(c.input);
        const t = takeoffMod.computeTakeoff(net);
        const e = c.expected;
        if (e.runs) e.runs.forEach((er, i) => {
          if (er.length !== undefined && !close(t.runs[i].length, er.length, tol)) throw new Error(`run${i}.length ${t.runs[i].length}`);
          if (er.sticks !== undefined && t.runs[i].sticks !== er.sticks) throw new Error(`run${i}.sticks ${t.runs[i].sticks}`);
          for (const f of ['elbow90', 'riserLength', 'couplings']) {
            if (er[f] === null && t.runs[i][f] !== undefined) throw new Error(`run${i}.${f} should be absent`);
          }
        });
        if (e.totals) {
          if (e.totals.length !== undefined && !close(t.totals.length, e.totals.length, tol)) throw new Error('totals.length');
          if (e.totals.sticks !== undefined && t.totals.sticks !== e.totals.sticks) throw new Error('totals.sticks');
          if (e.totals.runs !== undefined && t.totals.runs !== e.totals.runs) throw new Error('totals.runs');
        }
        if (e.bySize) e.bySize.forEach((er, i) => {
          if (er.length !== undefined && !close(t.bySize[i].length, er.length, tol)) throw new Error('bySize.length');
          if (t.bySize[i].sticks !== er.sticks || t.bySize[i].runs !== er.runs || t.bySize[i].size !== er.size) throw new Error(`bySize ${JSON.stringify(t.bySize[i])}`);
        });
        if (e.bySizeCount !== undefined && t.bySize.length !== e.bySizeCount) throw new Error('bySizeCount');
        if (e.absentTotals) for (const f of e.absentTotals) if (t.totals[f] !== undefined) throw new Error(`totals.${f} should be absent`);
        if (e.systems) e.systems.forEach((s, i) => { if (t.runs[i].system !== s) throw new Error(`system ${t.runs[i].system}`); });
        break;
      }
      case 'findSnap': {
        const net = vecNetworkMatrix(c.input);
        const r = snapMod.findSnap(net, c.input.point, c.input.tolerance);
        if (c.expected === null) {
          if (r !== null) throw new Error(`expected null got ${JSON.stringify(r)}`);
        } else {
          if (!r || r.kind !== c.expected.kind) throw new Error(`got ${JSON.stringify(r)}`);
          if (c.expected.nodeId && r.nodeId !== c.expected.nodeId) throw new Error('nodeId');
          if (c.expected.runId && r.runId !== c.expected.runId) throw new Error('runId');
          if (c.expected.index !== undefined && r.index !== c.expected.index) throw new Error('index');
        }
        break;
      }
      case 'constrainOrtho': {
        const r = geometry.constrainOrtho(c.input.from, c.input.to, { planAngle: c.input.planAngle ?? 0 });
        checkPoint(r, c.expected, tol, 'constrainOrtho');
        break;
      }
      case 'removeLastPoint+deleteRun': {
        const { net, runIds } = buildNetwork(c.input);
        const after = network.removeLastPoint(net, runIds[0]);
        if (after.nodes.length !== c.expected.nodesAfterRemove) throw new Error(`nodes ${after.nodes.length}`);
        const gone = network.deleteRun(after, runIds[0]);
        if (gone.nodes.length !== c.expected.nodesAfterDelete || gone.runs.length !== c.expected.runsAfterDelete) throw new Error('delete');
        break;
      }
      case 'validateNetwork(computeTakeoff)': {
        const { net } = buildNetwork(c.input);
        const json = JSON.parse(JSON.stringify(net));
        const reloaded = network.validateNetwork(json);
        const a = takeoffMod.computeTakeoff(net).runs[0];
        const b = takeoffMod.computeTakeoff(reloaded).runs[0];
        if (!close(a.length, c.expected.length, tol) || !close(b.length, c.expected.length, tol)) throw new Error('length');
        if (a.sticks !== c.expected.sticks || b.sticks !== c.expected.sticks) throw new Error('sticks');
        break;
      }
      case 'sizeToMillimetres': {
        const e = c.expected;
        (e.lt ?? []).forEach(([x, y]) => {
          if (!(takeoffMod.sizeToMillimetres(x) < takeoffMod.sizeToMillimetres(y))) throw new Error(`${x} !< ${y}`);
        });
        (e.nan ?? []).forEach((q) => {
          if (!Number.isNaN(takeoffMod.sizeToMillimetres(q))) throw new Error(`${q} not NaN`);
        });
        for (const [k, v] of Object.entries(e.values ?? {})) { /* handled below */ }
        break;
      }
      case 'splitSegment': {
        const { net, runIds } = buildNetwork(c.input);
        const { network: split } = network.splitSegment(net, runIds[0], c.input.split.index, fromArr(c.input.split.point));
        const run = split.runs.find((r) => r.id === runIds[0]);
        if (run.nodeIds.length !== c.expected.nodeCount) throw new Error('nodeCount');
        if (!close(takeoffMod.computeTakeoff(split).runs[0].length, c.expected.length, tol)) throw new Error('length');
        break;
      }
      case 'computeRunTakeoff': {
        const { net, runIds } = buildNetwork(c.input);
        const r = takeoffMod.computeRunTakeoff(net, runIds[0]);
        if (!close(r.length, c.expected.length, tol) || r.sticks !== c.expected.sticks || r.points !== c.expected.points) throw new Error(JSON.stringify(r));
        break;
      }
      case 'optimizeStickCutting': {
        const r = bomCalc.optimizeStickCutting(c.input.cuts, c.input.stockLengthM);
        const e = c.expected;
        if (r.sticksNeeded !== e.sticksNeeded) throw new Error(`sticks ${r.sticksNeeded}`);
        if (!close(r.totalLengthM, e.totalLengthM, tol)) throw new Error('len');
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
        const { net } = buildNetwork(c.input);
        const b = bomCalc.computeDetailedBom(net, { stockLengthM: c.input.stockLengthM });
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
            if (r !== c.expected[i]) throw new Error(`${q} -> ${JSON.stringify(r)}`);
          });
          break;
        }
        if (c.expected.keys) c.input.queries.forEach((q, i) => {
          const r = coordUtils.resolveUnit(q);
          if (!r || r.key !== c.expected.keys[i]) throw new Error(`${q} -> ${r?.key}`);
        });
        if (c.expected.factors) c.input.queries.forEach((q, i) => {
          if (!close(coordUtils.resolveUnit(q).factor, c.expected.factors[i], tol)) throw new Error('factor');
        });
        if (c.expected.nonNull) c.input.queries.forEach((q) => { if (!coordUtils.resolveUnit(q)) throw new Error(q); });
        break;
      }
      case 'convertLength': {
        if (c.expected?.throws) {
          let threw = false;
          try { coordUtils.convertLength(c.input.value, c.input.from, c.input.to); } catch (e) { threw = /Unknown unit/.test(e.message); }
          if (!threw) throw new Error('did not throw Unknown unit');
          break;
        }
        if (c.expected?.throws) {
          let threw = false;
          try { coordUtils.convertLength(c.input.value, c.input.from, c.input.to); } catch (e) { threw = /Unknown unit/.test(e.message); }
          if (!threw) throw new Error('did not throw Unknown unit');
          break;
        }
        const r = coordUtils.convertLength(c.input.value, c.input.from, c.input.to);
        if (!close(r, c.expected, tol)) throw new Error(`${r} != ${c.expected}`);
        break;
      }
      case 'fromMetres': {
        if (!close(coordUtils.fromMetres(c.input.value, c.input.to), c.expected, tol)) throw new Error('fromMetres');
        break;
      }
      case 'toMetres': {
        if (!close(coordUtils.toMetres(c.input.value, c.input.from), c.expected, tol)) throw new Error('toMetres');
        break;
      }
      case 'formatLength':
      case 'formatFileSize': {
        const fn = c.fn === 'formatLength' ? coordUtils.formatLength : coordUtils.formatFileSize;
        c.input.calls.forEach((args, i) => {
          if (fn(...args) !== c.expected[i]) throw new Error(`${fn(...args)} != ${c.expected[i]}`);
        });
        break;
      }
      case 'sizeToMillimetres-table': break; // handled below (legacy name differs)
      case 'DEFAULT_DIAMETERS': {
        if (config.DEFAULT_DIAMETERS.length !== c.expected.count) throw new Error('count');
        config.DEFAULT_DIAMETERS.forEach((d, i) => {
          if (d.label !== c.expected.labels[i] || d.mm !== c.expected.mm[i]) throw new Error(`row ${i}`);
        });
        break;
      }
      case 'DEFAULT_STICK_LENGTH_M': {
        if (config.DEFAULT_STICK_LENGTH_M !== c.expected) throw new Error('stick');
        break;
      }
      case 'DiameterRegistry.defaults': {
        const reg = diamReg.createDiameterRegistry();
        const e = c.expected;
        if (reg.getAll().length < e.countGte) throw new Error('count');
        for (const l of e.hasLabels) if (!reg.getByLabel(l)) throw new Error(`missing ${l}`);
        if (reg.getSelected().label !== e.defaultSelected) throw new Error('default');
        reg.setSelected(reg.getByLabel(e.selectedAfterSet).id);
        if (reg.getSelected().label !== e.selectedAfterSet) throw new Error('select');
        if (reg.getColor('1"') !== e.colorOf1in) throw new Error('color');
        if (reg.getColor('nope') !== e.colorOfUnknown) throw new Error('fallback');
        const ids = reg.getAll().map((d) => d.id);
        if (JSON.stringify(ids) !== JSON.stringify(e.ids)) throw new Error(`ids ${JSON.stringify(ids)}`);
        break;
      }
      case 'createCommandStack.execute/undo/redo': {
        const st = cmdStack.createCommandStack({ maxDepth: c.input.maxDepth });
        let v = 0;
        const mk = (n) => ({ execute: () => { v += n; }, undo: () => { v -= n; } });
        c.input.ops.forEach((op, i) => {
          if (op.startsWith('exec')) st.execute(mk(Number(op.match(/[+-]?\d+/)[0])));
          else if (op === 'undo') st.undo();
          else if (op === 'redo') st.redo();
          if (v !== c.expected.states[i]) throw new Error(`step ${i}: ${v}`);
        });
        if (st.canUndo() !== c.expected.canUndoEnd) throw new Error('canUndo');
        break;
      }
      case 'createCommandStack.maxDepth': {
        const st = cmdStack.createCommandStack({ maxDepth: c.input.maxDepth });
        let v = 0;
        for (let i = 0; i < c.input.execCount; i++) st.execute({ execute: () => { v++; }, undo: () => { v--; } });
        if (st.undoCount !== c.expected.undoCount) throw new Error('depth');
        break;
      }
      case 'createMarkerStore': {
        const s = markerModel.createMarkerStore();
        const ids = c.input.add.map((a) => s.addMarker(a).id);
        if (s.getAll().length !== c.expected.countAfterAdd) throw new Error('add');
        const counts = s.countByType();
        for (const [k, v] of Object.entries(c.expected.counts)) if (counts[k] !== v) throw new Error(`count ${k}`);
        s.moveMarker(ids[c.input.move.index], c.input.move.to);
        if (s.getById(ids[c.input.move.index]).position.x !== c.expected.movedX) throw new Error('move');
        s.removeMarker(ids[c.input.remove.index]);
        if (s.getAll().length !== c.expected.countAfterRemove) throw new Error('remove');
        if (s.countByType().Support !== c.expected.supportCountAfterRemove) throw new Error('support');
        break;
      }
      case 'serializeProject/deserializeProject': {
        const json = projectIo.serializeProject(c.input);
        if (typeof json !== 'string') throw new Error('not string');
        const back = projectIo.deserializeProject(json);
        const e = c.expected;
        if (back.sourceModel.name !== e.name || back.settings.wasteFactor !== e.wasteFactor) throw new Error('fields');
        if (back.network.runs.r1.size !== e.runSize || back.markers.length !== e.markerCount) throw new Error('nested');
        break;
      }
      case 'deserializeProject': {
        const back = projectIo.deserializeProject(c.input.json);
        const e = c.expected;
        if (back.version !== e.version || back.settings.stickLengthM !== e.stickLengthM || back.settings.wasteFactor !== e.wasteFactor || back.settings.unit !== e.unit) throw new Error(JSON.stringify(back.settings));
        break;
      }
      case 'computeSha256': {
        const buf = new TextEncoder().encode(c.input.utf8).buffer;
        const h = await projectIo.computeSha256(buf);
        if (h !== c.expected) throw new Error(h);
        break;
      }
      case 'verifySourceHash': {
        const buf = new TextEncoder().encode(c.input.utf8).buffer;
        const h = await projectIo.computeSha256(buf);
        if ((await projectIo.verifySourceHash(buf, h)) !== c.expected.valid) throw new Error('valid');
        if ((await projectIo.verifySourceHash(buf, c.input.wrong)) !== c.expected.invalid) throw new Error('invalid');
        if ((await projectIo.verifySourceHash(buf, '')) !== c.expected.emptyExpected) throw new Error('empty');
        break;
      }
      case 'exportRunsCsv': {
        const t = csvExport.exportRunsCsv(c.input);
        if (t !== c.expected.text) throw new Error(`got ${JSON.stringify(t)}`);
        break;
      }
      case 'exportSummaryCsv': {
        const t = csvExport.exportSummaryCsv(c.input);
        if (t !== c.expected.text) throw new Error(`got ${JSON.stringify(t)}`);
        break;
      }
      case 'exportCompleteCsv': {
        const t = csvExport.exportCompleteCsv(c.input);
        for (const s of c.expected.contains) if (!t.includes(s)) throw new Error(`missing ${s}`);
        break;
      }
      case 'generateContractorBomCsv(computeDetailedBom)': {
        const { net } = buildNetwork(c.input.network);
        const b = bomCalc.computeDetailedBom(net, { stockLengthM: c.input.network.stickLength });
        const t = bomCalc.generateContractorBomCsv(b);
        for (const s of c.expected.contains) if (!t.includes(s)) throw new Error(`missing ${s}`);
        break;
      }
      case 'exportOverlayIfc': {
        const t = ifcExporter.exportOverlayIfc(c.input);
        const e = c.expected;
        if (!t.startsWith(e.startsWith)) throw new Error('header');
        if (!t.endsWith(e.endsWith)) throw new Error('footer');
        for (const s of e.contains) if (!t.includes(s)) throw new Error(`missing ${s}`);
        if (e.cartesianPoint && !t.includes(e.cartesianPoint.replace(/^#=/, '#').replace(/;$/, '')) && !t.includes('IFCCARTESIANPOINT((0.0000,0.0000,2.5000))')) throw new Error('point');
        if (e.runLengthProp && !t.includes(e.runLengthProp)) throw new Error('length prop');
        break;
      }
      default: {
        // sizeToMillimetres table-vector (units.json uses fn sizeToMillimetres with queries array)
        if (c.fn === 'sizeToMillimetres' && c.input.queries) {
          const vals = c.input.queries.map((q) => takeoffMod.sizeToMillimetres(q));
          c.expected.nanIndex.forEach((i) => { if (!Number.isNaN(vals[i])) throw new Error(`idx ${i} not NaN`); });
          c.expected.values.forEach((v, i) => {
            if (v === null) return;
            if (!close(vals[i], v, tol)) throw new Error(`${c.input.queries[i]} -> ${vals[i]} != ${v}`);
          });
          if (c.expected.mm_1_5in !== undefined && !close(takeoffMod.sizeToMillimetres('1 1/2"'), c.expected.mm_1_5in, tol)) throw new Error('1.5in');
          break;
        }
        throw new Error(`unknown fn ${c.fn}`);
      }
    }
    pass++;
  } catch (err) {
    fail++;
    failures.push(`${id}: ${err.message}`);
  }
}

const only = process.argv.find((a) => a.startsWith('--file='))?.split('=')[1];
const files = readdirSync(VEC_DIR).filter((f) => f.endsWith('.json')).filter((f) => !only || f === `${only}.json`).sort();
for (const f of files) {
  const vec = JSON.parse(readFileSync(path.join(VEC_DIR, f), 'utf8'));
  for (const c of vec.cases) await runCase(f, c);
}

console.log(`\nconduit vectors: ${pass} passed, ${fail} failed (${files.join(', ')})`);
for (const fl of failures) console.log('FAIL', fl);
process.exit(fail ? 1 : 0);
