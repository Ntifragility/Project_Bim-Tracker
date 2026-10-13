// Quantity takeoff for a conduit network.
//
// Per-run quantities:
//   length = sum of 3D segment distances (metres)
//   sticks = ceil(length / stick_length)
//
// Summary groups per-run results by diameter. Stick counts are summed from
// the per-run values — rounding happens per run, not on the total.
//
// Elbows, risers, tees, and couplings are OUT OF SCOPE. Conduit is bent
// on site, so elbows are not counted as fittings.

import { distance } from './geometry.js';
import { nodeById } from './network.js';

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
    return /"|in|pulg$/.test(text) || inch[2] !== undefined || inch[1] !== undefined ? total * 25.4 : total;
  }
  return Number.NaN;
}

/**
 * Compute the takeoff for a single run. Returns { length, sticks }.
 * Length is in metres (the network's native unit). Sticks are rounded
 * per run: ceil(run_length / stick_length).
 */
export function computeRunTakeoff(network, runId) {
  const run = network.runs.find((r) => r.id === runId);
  if (!run) return { length: 0, sticks: 0, points: 0 };
  const stick = network.settings.stickLength;
  const points = run.nodeIds.map((id) => nodeById(network, id));
  let total = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    total += distance(points[i], points[i + 1]);
  }
  const sticks = total > EPS ? Math.ceil(total / stick - EPS) : 0;
  return { length: total, sticks, points: points.length };
}

/**
 * Full takeoff of the entire network.
 *
 * Returns:
 *   stickLength - the network's stick length setting
 *   runs        - per-run breakdown: id, name, size, system, length, sticks, points
 *   bySize      - summary grouped by diameter: size, runs, length, sticks
 *   totals      - grand totals: runs, length, sticks
 */
export function computeTakeoff(network) {
  const stick = network.settings.stickLength;

  const runs = network.runs.map((run) => {
    const { length, sticks, points } = computeRunTakeoff(network, run.id);
    return {
      id: run.id,
      name: run.name,
      size: run.size,
      system: run.system,
      length,
      sticks,
      points,
    };
  });

  // Group by size
  const bySizeMap = new Map();
  for (const run of runs) {
    if (!bySizeMap.has(run.size)) {
      bySizeMap.set(run.size, { size: run.size, runs: 0, length: 0, sticks: 0 });
    }
    const row = bySizeMap.get(run.size);
    row.runs += 1;
    row.length += run.length;
    row.sticks += run.sticks; // sum of per-run ceil values
  }
  const bySize = [...bySizeMap.values()]
    .sort((a, b) => (sizeToMillimetres(a.size) || 0) - (sizeToMillimetres(b.size) || 0));

  const totals = bySize.reduce(
    (sum, row) => {
      sum.runs += row.runs;
      sum.length += row.length;
      sum.sticks += row.sticks;
      return sum;
    },
    { runs: 0, length: 0, sticks: 0 },
  );

  return { stickLength: stick, runs, bySize, totals };
}
