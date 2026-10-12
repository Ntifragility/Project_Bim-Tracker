// Quantity takeoff for a conduit network. Fittings are classified per node from
// the segments that meet there, across all runs, so a branch between two runs is
// one tee and not two loose ends:
//   1 segment  -> open end
//   2 segments -> straight, 45° elbow, 90° elbow, or another bend angle
//   3 segments -> tee, 4 -> cross, more -> junction
import { angleBetween, distance, isVertical, sub } from './geometry.js';
import { nodeById } from './network.js';

export const TAKEOFF_DEFAULTS = {
  /** Direction changes up to this many degrees are a straight joint. */
  straightToleranceDeg: 5,
  /** A bend within this many degrees of 45 or 90 is counted as that elbow. */
  bendToleranceDeg: 10,
  /** Segments within this many degrees of vertical are risers. */
  riserToleranceDeg: 10,
};

const EPS = 1e-9;

/** Nominal size in millimetres for ordering: 25mm, 25, 3/4", 1 1/2". */
export function sizeToMillimetres(size) {
  const text = String(size).trim().toLowerCase();
  const mm = /^(\d+(?:[.,]\d+)?)\s*mm$/.exec(text);
  if (mm) return Number(mm[1].replace(',', '.'));
  const inch = /^(?:(\d+)\s+)?(?:(\d+)\s*\/\s*(\d+)|(\d+(?:[.,]\d+)?))\s*(?:"|in|pulg)?$/.exec(text);
  if (inch) {
    const whole = Number(inch[1] ?? 0);
    const value = inch[4] !== undefined ? Number(inch[4].replace(',', '.')) : Number(inch[2]) / Number(inch[3]);
    const total = whole + value;
    return /("|in|pulg)$/.test(text) || inch[2] !== undefined || inch[1] !== undefined ? total * 25.4 : total;
  }
  return Number.NaN;
}

function largestSize(sizes) {
  return [...sizes].sort((a, b) => {
    const diff = (sizeToMillimetres(b) || 0) - (sizeToMillimetres(a) || 0);
    return diff || String(a).localeCompare(String(b));
  })[0];
}

function classifyBend(deviation, options) {
  if (deviation <= options.straightToleranceDeg) return 'straight';
  if (Math.abs(deviation - 90) <= options.bendToleranceDeg) return 'elbow90';
  if (Math.abs(deviation - 45) <= options.bendToleranceDeg) return 'elbow45';
  return 'bend';
}

function nodeIncidence(network) {
  const incidence = new Map(network.nodes.map((node) => [node.id, []]));
  for (const run of network.runs) {
    for (let i = 0; i < run.nodeIds.length - 1; i += 1) {
      const a = nodeById(network, run.nodeIds[i]);
      const b = nodeById(network, run.nodeIds[i + 1]);
      if (!a || !b || distance(a, b) < EPS) continue;
      incidence.get(a.id).push({ runId: run.id, size: run.size, away: sub(b, a) });
      incidence.get(b.id).push({ runId: run.id, size: run.size, away: sub(a, b) });
    }
  }
  return incidence;
}

function classifyNodes(network, options) {
  const incidence = nodeIncidence(network);
  const fittings = new Map();
  for (const node of network.nodes) {
    const ends = incidence.get(node.id) ?? [];
    const sizes = new Set(ends.map((end) => end.size));
    let kind;
    let angle = null;
    if (ends.length === 0) continue;
    if (ends.length === 1) kind = 'end';
    else if (ends.length === 2) {
      angle = 180 - angleBetween(ends[0].away, ends[1].away);
      kind = classifyBend(angle, options);
    } else if (ends.length === 3) kind = 'tee';
    else if (ends.length === 4) kind = 'cross';
    else kind = 'junction';
    fittings.set(node.id, {
      nodeId: node.id,
      kind,
      degree: ends.length,
      angle,
      sizes: [...sizes],
      size: largestSize(sizes),
      ownerRunId: ends[0].runId,
      point: { x: node.x, y: node.y, z: node.z },
    });
  }
  return fittings;
}

function emptyCounts() {
  return { elbow90: 0, elbow45: 0, bends: 0, tees: 0, crosses: 0, junctions: 0 };
}

function countFitting(counts, kind) {
  if (kind === 'elbow90') counts.elbow90 += 1;
  else if (kind === 'elbow45') counts.elbow45 += 1;
  else if (kind === 'bend') counts.bends += 1;
  else if (kind === 'tee') counts.tees += 1;
  else if (kind === 'cross') counts.crosses += 1;
  else if (kind === 'junction') counts.junctions += 1;
}

/**
 * Takeoff of the whole network. Lengths are metres. `couplings` joins sticks
 * inside each straight section (between fittings); couplings needed to connect
 * fittings depend on the conduit material and are left to the user.
 */
export function computeTakeoff(network, overrides = {}) {
  const options = { ...TAKEOFF_DEFAULTS, ...overrides };
  const stick = network.settings.stickLength;
  const fittings = classifyNodes(network, options);

  const runs = network.runs.map((run) => {
    const points = run.nodeIds.map((id) => nodeById(network, id));
    let total = 0;
    let riser = 0;
    let section = 0;
    let couplings = 0;
    const counts = emptyCounts();
    const closeSection = () => {
      if (section > EPS) couplings += Math.max(0, Math.ceil(section / stick - EPS) - 1);
      section = 0;
    };
    for (let i = 0; i < points.length - 1; i += 1) {
      const len = distance(points[i], points[i + 1]);
      total += len;
      if (isVertical(points[i], points[i + 1], options.riserToleranceDeg)) riser += len;
      section += len;
      const fitting = fittings.get(points[i + 1].id);
      if (i + 1 < points.length - 1 && fitting && fitting.kind !== 'straight') closeSection();
    }
    closeSection();
    for (const id of run.nodeIds) {
      const fitting = fittings.get(id);
      if (fitting?.ownerRunId === run.id) countFitting(counts, fitting.kind);
    }
    return {
      id: run.id,
      name: run.name,
      size: run.size,
      system: run.system,
      points: points.length,
      length: total,
      riserLength: riser,
      couplings,
      ...counts,
    };
  });

  const bySizeMap = new Map();
  const sizeRow = (size) => {
    if (!bySizeMap.has(size)) {
      bySizeMap.set(size, { size, length: 0, riserLength: 0, sticks: 0, couplings: 0, ...emptyCounts() });
    }
    return bySizeMap.get(size);
  };
  for (const run of runs) {
    const row = sizeRow(run.size);
    row.length += run.length;
    row.riserLength += run.riserLength;
    row.couplings += run.couplings;
  }
  for (const fitting of fittings.values()) {
    if (fitting.kind === 'end' || fitting.kind === 'straight') continue;
    countFitting(sizeRow(fitting.size), fitting.kind);
  }
  const bySize = [...bySizeMap.values()]
    .map((row) => ({ ...row, sticks: row.length > EPS ? Math.ceil(row.length / stick - EPS) : 0 }))
    .sort((a, b) => (sizeToMillimetres(a.size) || 0) - (sizeToMillimetres(b.size) || 0));

  const fittingList = [...fittings.values()].filter((fitting) => fitting.kind !== 'straight');
  const totals = bySize.reduce(
    (sum, row) => {
      for (const key of ['length', 'riserLength', 'sticks', 'couplings', 'elbow90', 'elbow45', 'bends', 'tees', 'crosses', 'junctions']) {
        sum[key] += row[key];
      }
      return sum;
    },
    { length: 0, riserLength: 0, sticks: 0, couplings: 0, ...emptyCounts() },
  );
  totals.openEnds = fittingList.filter((fitting) => fitting.kind === 'end').length;

  return { stickLength: stick, runs, bySize, fittings: fittingList, totals };
}
