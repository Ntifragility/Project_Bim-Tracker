// packages/conduit-core/src/trace-excel.js
// Extracts grouped conduit traces from either live drawn runs OR an uploaded Native IFC STEP file
// (grouping all segments & elbows belonging to each IFCELEMENTASSEMBLY / Pset_ConduitRun.RunId)
// and generates a formatted 2-sheet Excel (.xlsx) workbook.

import * as XLSX from 'xlsx';
import { extractRunParts } from './centerline-builder.js';
import { getNecBendRadiusM } from './fitting-solver.js';

const METRES_TO_FEET = 1 / 0.3048;
const STICK_LENGTH_FT = 10;

function unescapeStepStr(s) {
  return String(s ?? '').replace(/''/g, "'");
}

function parseStepRefs(listStr) {
  const out = [];
  const re = /#(\d+)/g;
  let m;
  while ((m = re.exec(listStr)) !== null) {
    out.push(Number(m[1]));
  }
  return out;
}

function parseNominalValue(raw) {
  const trimmed = String(raw || '').trim();
  const strMatch = trimmed.match(/^[A-Z0-9_]+\(\s*'((?:''|[^'])*)'\s*\)$/i);
  if (strMatch) return unescapeStepStr(strMatch[1]);
  const numMatch = trimmed.match(/^[A-Z0-9_]+\(\s*([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*\)$/i);
  if (numMatch) return Number(numMatch[1]);
  return trimmed;
}

/**
 * Pure STEP parser: extracts 1 grouped record per continuous conduit trace from an IFC file,
 * even when dozens of separate traces live inside a single IFC file.
 */
export function extractConduitTracesFromStep(ifcText) {
  if (!ifcText || typeof ifcText !== 'string') return [];

  const singleValues = new Map(); // id -> { name, value }
  const propertySets = new Map(); // id -> { name, props: Map<string, any> }
  const assemblies = new Map();   // id -> { name, desc, tag, childIds: number[], psets: Map<string, Map> }
  const entityPsets = new Map();  // entityId -> Array<psetId>
  const relAggregates = [];       // { parentId, childIds }

  const lines = ifcText.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx < 2) continue;
    const id = Number(line.slice(1, eqIdx).trim());
    if (!Number.isFinite(id)) continue;
    const rest = line.slice(eqIdx + 1).trim();

    if (rest.startsWith('IFCPROPERTYSINGLEVALUE(')) {
      const m = rest.match(/^IFCPROPERTYSINGLEVALUE\(\s*'((?:''|[^'])*)'\s*,\s*[^,]*,\s*(.+?)\s*,\s*[^)]*\)\s*;?$/i);
      if (m) {
        singleValues.set(id, { name: unescapeStepStr(m[1]), value: parseNominalValue(m[2]) });
      }
    } else if (rest.startsWith('IFCPROPERTYSET(')) {
      const m = rest.match(/^IFCPROPERTYSET\(\s*'[^']*'\s*,\s*[^,]*,\s*'((?:''|[^'])*)'\s*,\s*[^,]*,\s*\(([^)]*)\)\s*\)\s*;?$/i);
      if (m) {
        propertySets.set(id, { name: unescapeStepStr(m[1]), propIds: parseStepRefs(m[2]) });
      }
    } else if (rest.startsWith('IFCRELDEFINESBYPROPERTIES(')) {
      const m = rest.match(/^IFCRELDEFINESBYPROPERTIES\([^,]*,[^,]*,[^,]*,[^,]*,\s*\(([^)]*)\)\s*,\s*#(\d+)\s*\)\s*;?$/i);
      if (m) {
        const targets = parseStepRefs(m[1]);
        const psetId = Number(m[2]);
        for (const tid of targets) {
          if (!entityPsets.has(tid)) entityPsets.set(tid, []);
          entityPsets.get(tid).push(psetId);
        }
      }
    } else if (rest.startsWith('IFCELEMENTASSEMBLY(')) {
      const m = rest.match(/^IFCELEMENTASSEMBLY\(\s*'[^']*'\s*,\s*[^,]*,\s*'((?:''|[^'])*)'\s*,\s*(?:'((?:''|[^'])*)'|\$)\s*,[^,]*,[^,]*,[^,]*,\s*(?:'((?:''|[^'])*)'|\$)/i);
      if (m) {
        assemblies.set(id, {
          id,
          name: unescapeStepStr(m[1]),
          desc: m[2] ? unescapeStepStr(m[2]) : '',
          tag: m[3] ? unescapeStepStr(m[3]) : '',
          childIds: [],
        });
      }
    } else if (rest.startsWith('IFCRELAGGREGATES(')) {
      const m = rest.match(/^IFCRELAGGREGATES\([^,]*,[^,]*,[^,]*,[^,]*,\s*#(\d+)\s*,\s*\(([^)]*)\)\s*\)\s*;?$/i);
      if (m) {
        relAggregates.push({ parentId: Number(m[1]), childIds: parseStepRefs(m[2]) });
      }
    }
  }

  for (const rel of relAggregates) {
    const asm = assemblies.get(rel.parentId);
    if (asm) {
      asm.childIds.push(...rel.childIds);
    }
  }

  function resolvePsetProps(psetId) {
    const ps = propertySets.get(psetId);
    if (!ps) return null;
    const props = {};
    for (const pid of ps.propIds) {
      const sv = singleValues.get(pid);
      if (sv) props[sv.name] = sv.value;
    }
    return { name: ps.name, props };
  }

  const tracesByKey = new Map();

  // 1. Primary path: iterate every IFCELEMENTASSEMBLY (1 assembly = 1 continuous trace)
  for (const asm of assemblies.values()) {
    const psetIds = entityPsets.get(asm.id) || [];
    let runProps = null;
    for (const psId of psetIds) {
      const resolved = resolvePsetProps(psId);
      if (resolved && resolved.name === 'Pset_ConduitRun') {
        runProps = resolved.props;
        break;
      }
    }

    // Fallback: sum child segment lengths if Pset_ConduitRun wasn't attached directly
    let summedChildLenM = 0;
    for (const cid of asm.childIds) {
      for (const psId of entityPsets.get(cid) || []) {
        const resolved = resolvePsetProps(psId);
        if (!resolved) continue;
        if (!runProps && resolved.name === 'Pset_ConduitRun') {
          runProps = resolved.props;
        }
        const segM = Number(resolved.props.SegmentLengthM ?? resolved.props.ArcLengthM ?? 0);
        if (Number.isFinite(segM) && segM > 0) summedChildLenM += segM;
      }
    }

    const totalLengthM = Number(runProps?.TotalLengthM ?? runProps?.Length ?? summedChildLenM) || 0;
    const totalLengthFt = Number(runProps?.TotalLengthFt) || totalLengthM * METRES_TO_FEET;
    const sticks10Ft = Number(runProps?.Sticks10Ft) || (totalLengthFt > 0 ? Math.ceil(totalLengthFt / STICK_LENGTH_FT) : 0);
    const runId = String(runProps?.RunId ?? asm.id);
    const runName = String(runProps?.RunName || asm.name || `Run ${runId}`);
    const tag = String(runProps?.Tag || asm.tag || runName);

    tracesByKey.set(runId, {
      tag,
      runId,
      runName,
      system: String(runProps?.System || 'Power'),
      size: String(runProps?.Size || ''),
      totalLengthM: Number(totalLengthM.toFixed(3)),
      totalLengthFt: Number(totalLengthFt.toFixed(2)),
      sticks10Ft,
      totalBendDeg: Number(runProps?.TotalBendDeg || 0),
      partCount: Number(runProps?.PartCount || asm.childIds.length || 0),
      colorHex: String(runProps?.ColorHex || ''),
      comments: String(runProps?.Comments || ''),
    });
  }

  // 2. Fallback path: if IFC had Pset_ConduitRun directly on segments without IFCELEMENTASSEMBLY
  if (tracesByKey.size === 0) {
    for (const [psId, ps] of propertySets.entries()) {
      if (ps.name !== 'Pset_ConduitRun') continue;
      const resolved = resolvePsetProps(psId);
      if (!resolved) continue;
      const rp = resolved.props;
      const runId = String(rp.RunId ?? psId);
      if (tracesByKey.has(runId)) continue;
      const totalLengthM = Number(rp.TotalLengthM ?? rp.Length ?? 0) || 0;
      const totalLengthFt = Number(rp.TotalLengthFt) || totalLengthM * METRES_TO_FEET;
      const runName = String(rp.RunName || `Run ${runId}`);
      tracesByKey.set(runId, {
        tag: String(rp.Tag || runName),
        runId,
        runName,
        system: String(rp.System || 'Power'),
        size: String(rp.Size || ''),
        totalLengthM: Number(totalLengthM.toFixed(3)),
        totalLengthFt: Number(totalLengthFt.toFixed(2)),
        sticks10Ft: Number(rp.Sticks10Ft) || (totalLengthFt > 0 ? Math.ceil(totalLengthFt / STICK_LENGTH_FT) : 0),
        totalBendDeg: Number(rp.TotalBendDeg || 0),
        partCount: Number(rp.PartCount || 0),
        colorHex: String(rp.ColorHex || ''),
        comments: String(rp.Comments || ''),
      });
    }
  }

  return Array.from(tracesByKey.values());
}

/**
 * Builds the same normalized trace records from live drawn runs in Conduit Takeoff.
 */
export function buildTracesFromNetwork({ runs = [], nodes = {}, getRunColor = null } = {}) {
  const out = [];
  for (const run of runs) {
    const pts = (run.nodeIds || [])
      .map((nid) => {
        if (typeof nid === 'object' && nid !== null) return nid;
        if (Array.isArray(nodes)) return nodes.find((n) => n.id === nid);
        return nodes ? nodes[nid] : null;
      })
      .filter(Boolean);
    if (pts.length < 2) continue;

    let computedLenM = 0;
    for (let i = 1; i < pts.length; i++) {
      computedLenM += Math.hypot(
        Number(pts[i].x) - Number(pts[i - 1].x),
        Number(pts[i].y) - Number(pts[i - 1].y),
        Number(pts[i].z) - Number(pts[i - 1].z),
      );
    }
    const size = run.size || run.diameter || '3/4"';
    const totalLengthM = Number(run.length) > 0 ? Number(run.length) : computedLenM;
    const totalLengthFt = totalLengthM * METRES_TO_FEET;
    const sticks10Ft = totalLengthFt > 0 ? Math.ceil(totalLengthFt / STICK_LENGTH_FT) : 0;
    const parts = extractRunParts(pts, getNecBendRadiusM(size), 12);
    const totalBendDeg = parts.reduce(
      (sum, part) => sum + (part.kind === 'fitting' ? Number(part.bendAngle || 0) : 0),
      0,
    );
    const runId = String(run.id ?? out.length + 1);
    const runName = run.name || `Run ${runId}`;
    const colorHex = (typeof getRunColor === 'function' ? getRunColor(run) : null) || run.color || '';

    out.push({
      tag: String(run.tag || runName),
      runId,
      runName,
      system: run.system || 'Power',
      size,
      totalLengthM: Number(totalLengthM.toFixed(3)),
      totalLengthFt: Number(totalLengthFt.toFixed(2)),
      sticks10Ft,
      totalBendDeg: Number(totalBendDeg.toFixed(1)),
      partCount: parts.length,
      colorHex,
      comments: String(run.comments || ''),
    });
  }
  return out;
}

/**
 * Generates a formatted 2-sheet Excel (.xlsx) workbook as a Uint8Array.
 * Sheet 1 ("Conduit Traces"): 1 row per continuous trace (grouped across segments & elbows).
 * Sheet 2 ("Summary by Size"): Rolled-up totals per System & Size including waste factor.
 */
export function exportTracesToExcelBytes(traces = [], { wasteFactor = 0.1 } = {}) {
  const wb = XLSX.utils.book_new();

  const traceRows = traces.map((t) => ({
    'Tag': t.tag || t.runName || t.runId,
    'Run Name': t.runName || '',
    'Run ID': t.runId || '',
    'System': t.system || 'Power',
    'Size': t.size || '',
    'Total Length (m)': Number(t.totalLengthM || 0),
    'Total Length (ft)': Number(t.totalLengthFt || 0),
    '10-ft Sticks': Number(t.sticks10Ft || 0),
    'Total Bends (deg)': Number(t.totalBendDeg || 0),
    'Parts': Number(t.partCount || 0),
    'Color': t.colorHex || '',
    'Comments': t.comments || '',
  }));

  const wsTraces = XLSX.utils.json_to_sheet(
    traceRows.length > 0
      ? traceRows
      : [{ 'Tag': '', 'Run Name': '', 'Run ID': '', 'System': '', 'Size': '', 'Total Length (m)': 0, 'Total Length (ft)': 0, '10-ft Sticks': 0, 'Total Bends (deg)': 0, 'Parts': 0, 'Color': '', 'Comments': '' }],
  );
  wsTraces['!cols'] = [
    { wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 14 }, { wch: 10 },
    { wch: 16 }, { wch: 16 }, { wch: 13 }, { wch: 17 }, { wch: 8 },
    { wch: 11 }, { wch: 26 },
  ];
  XLSX.utils.book_append_sheet(wb, wsTraces, 'Conduit Traces');

  // Roll-up summary by System + Size
  const summaryMap = new Map();
  for (const t of traces) {
    const key = `${t.system || 'Power'}||${t.size || 'Unspecified'}`;
    if (!summaryMap.has(key)) {
      summaryMap.set(key, {
        system: t.system || 'Power',
        size: t.size || 'Unspecified',
        traceCount: 0,
        netM: 0,
        netFt: 0,
        sticksNet: 0,
      });
    }
    const row = summaryMap.get(key);
    row.traceCount += 1;
    row.netM += Number(t.totalLengthM || 0);
    row.netFt += Number(t.totalLengthFt || 0);
    row.sticksNet += Number(t.sticks10Ft || 0);
  }

  const wf = Math.max(0, Number(wasteFactor) || 0);
  const summaryRows = Array.from(summaryMap.values()).map((s) => {
    const withWasteFt = s.netFt * (1 + wf);
    return {
      'System': s.system,
      'Size': s.size,
      'Trace Count': s.traceCount,
      'Net Length (m)': Number(s.netM.toFixed(3)),
      'Net Length (ft)': Number(s.netFt.toFixed(2)),
      'With Waste (ft)': Number(withWasteFt.toFixed(2)),
      '10-ft Sticks (Net)': s.sticksNet,
      '10-ft Sticks (With Waste)': Math.ceil(withWasteFt / STICK_LENGTH_FT),
    };
  });

  const wsSummary = XLSX.utils.json_to_sheet(
    summaryRows.length > 0
      ? summaryRows
      : [{ 'System': '', 'Size': '', 'Trace Count': 0, 'Net Length (m)': 0, 'Net Length (ft)': 0, 'With Waste (ft)': 0, '10-ft Sticks (Net)': 0, '10-ft Sticks (With Waste)': 0 }],
  );
  wsSummary['!cols'] = [
    { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 15 },
    { wch: 15 }, { wch: 16 }, { wch: 18 }, { wch: 24 },
  ];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary by Size');

  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Uint8Array(out);
}
