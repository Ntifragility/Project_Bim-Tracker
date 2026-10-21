// Advanced Electrical Contractor Bill of Materials (BOM) & Stick Cutting Optimizer
//
// Key Features:
// 1. First-Fit Decreasing (FFD) Bin-Packing Optimizer for standard 10-ft (3.048 m) sticks.
// 2. Hardware Bill of Materials (BOM):
//    - Standard stick couplings (runs > 10 ft)
//    - Box connectors (2 per run termination)
//    - Factory 90° and 45° elbows (with trade size breakdown)
//    - Conduit straps & one-hole/two-hole straps (NEC 358.30 / 344.30)
//    - Pull box recommendations (NEC 360° bend rule & 100-ft maximum straight pull)
// 3. Contractor Purchasing Schedule CSV generator.
//
// Pure JavaScript, zero DOM dependencies, 100% portable to Rust/Wasm.

import { distance } from './geometry.js';
import { nodeById } from './network.js';
import { sizeToMillimetres } from './takeoff.js';

const EPSILON = 1e-7;
const DEFAULT_STICK_LENGTH_M = 3.048; // Standard 10 ft
const MAX_PULL_DISTANCE_M = 30.48; // Standard 100 ft straight pull limit

/**
 * Optimizes cutting a list of required segment lengths from standard stock sticks
 * using the First-Fit Decreasing (FFD) Bin-Packing Algorithm.
 *
 * @param {number[]} cutLengthsM - Array of individual segment lengths in metres
 * @param {number} [stockLengthM=3.048] - Stock stick length (default 10 ft / 3.048 m)
 * @param {number} [kerfWasteM=0.003] - Saw blade cutting loss per cut (default 3mm)
 * @returns {Object} Optimization results with stock count, drops/waste, and stick cut patterns
 */
export function optimizeStickCutting(cutLengthsM, stockLengthM = DEFAULT_STICK_LENGTH_M, kerfWasteM = 0.003) {
  if (!cutLengthsM || cutLengthsM.length === 0) {
    return {
      sticksNeeded: 0,
      totalLengthM: 0,
      totalWasteM: 0,
      wastePercentage: 0,
      sticks: [],
    };
  }

  // Filter out zero/negative cuts and sort descending (Decreasing order)
  const cuts = cutLengthsM
    .filter((len) => len > EPSILON)
    .sort((a, b) => b - a);

  const totalLengthM = cuts.reduce((sum, len) => sum + len, 0);

  // Array of sticks: each stick has remaining length and cuts placed in it
  const sticks = [];

  for (const cut of cuts) {
    // If cut exceeds single stock length, it requires multiple sticks
    if (cut > stockLengthM) {
      let remainingCut = cut;
      while (remainingCut > stockLengthM) {
        sticks.push({
          remaining: 0,
          cuts: [stockLengthM],
          wasteM: 0,
        });
        remainingCut -= stockLengthM;
      }
      // Place remainder
      let placed = false;
      for (const stick of sticks) {
        if (stick.remaining >= remainingCut + kerfWasteM) {
          stick.cuts.push(remainingCut);
          stick.remaining -= (remainingCut + kerfWasteM);
          placed = true;
          break;
        }
      }
      if (!placed) {
        sticks.push({
          remaining: stockLengthM - remainingCut,
          cuts: [remainingCut],
          wasteM: 0,
        });
      }
      continue;
    }

    // Standard FFD: Find first stick that can accommodate this cut
    let placed = false;
    for (const stick of sticks) {
      const required = cut + (stick.cuts.length > 0 ? kerfWasteM : 0);
      if (stick.remaining >= required) {
        stick.cuts.push(cut);
        stick.remaining -= required;
        placed = true;
        break;
      }
    }

    // If no existing stick fits, open a new stock stick
    if (!placed) {
      sticks.push({
        remaining: stockLengthM - cut,
        cuts: [cut],
        wasteM: 0,
      });
    }
  }

  // Calculate waste (unused remaining lengths)
  let totalWasteM = 0;
  sticks.forEach((s) => {
    s.wasteM = Number(s.remaining.toFixed(3));
    totalWasteM += s.remaining;
  });

  const totalStockPurchasedM = sticks.length * stockLengthM;
  const wastePercentage = totalStockPurchasedM > 0
    ? (totalWasteM / totalStockPurchasedM) * 100
    : 0;

  return {
    sticksNeeded: sticks.length,
    totalLengthM: Number(totalLengthM.toFixed(3)),
    totalWasteM: Number(totalWasteM.toFixed(3)),
    wastePercentage: Number(wastePercentage.toFixed(1)),
    sticks: sticks.map((s, idx) => ({
      stickNumber: idx + 1,
      cuts: s.cuts.map((c) => Number(c.toFixed(3))),
      wasteM: s.wasteM,
    })),
  };
}

/**
 * Computes a detailed electrical contractor Bill of Materials (BOM) for the entire conduit network.
 *
 * @param {Object} network - Conduit network object
 * @param {Object} options
 * @param {number} [options.wasteFactorPct=0] - Additional user waste percentage factor
 * @param {number} [options.stockLengthM=3.048] - Standard stick length (10 ft)
 * @returns {Object} Comprehensive hardware and material BOM
 */
export function computeDetailedBom(network, options = {}) {
  const stockLengthM = options.stockLengthM || network.settings?.stickLength || DEFAULT_STICK_LENGTH_M;
  const wasteFactor = (options.wasteFactorPct || 0) / 100;

  const runsSummary = [];
  const bySizeMap = new Map();

  let grandCouplings = 0;
  let grandBoxConnectors = 0;
  let grandStraps = 0;
  let grandElbows90 = 0;
  let grandElbows45 = 0;
  let grandPullBoxes = 0;

  for (const run of network.runs) {
    const points = (run.nodeIds || []).map((nid) => nodeById(network, nid)).filter(Boolean);
    const size = run.size || '¾"';
    const system = run.system || 'Power';

    // 1. Calculate segment lengths along run
    const segmentLengths = [];
    let runLength = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const segLen = distance(points[i], points[i + 1]);
      segmentLengths.push(segLen);
      runLength += segLen;
    }

    // 2. Hardware fittings calculations:
    // Couplings: needed for each full standard stick length in run
    const runSticksBasic = runLength > EPSILON ? Math.ceil(runLength / stockLengthM) : 0;
    const couplingsCount = Math.max(0, runSticksBasic - 1);

    // Box Connectors: 2 per run (entering/exiting boxes)
    const boxConnectorsCount = runLength > EPSILON ? 2 : 0;

    // Straps (NEC 358.30): 1 within 3 ft (0.9m) of each termination + 1 every 10 ft (3.048m)
    const strapsCount = runLength > EPSILON
      ? Math.max(2, 2 + Math.floor(runLength / stockLengthM))
      : 0;

    // Elbows: identify 90° and 45° bends
    let elbows90 = 0;
    let elbows45 = 0;
    let cumulativeBendsDeg = 0;

    for (let i = 1; i < points.length - 1; i++) {
      const p1 = points[i - 1];
      const p2 = points[i];
      const p3 = points[i + 1];

      const d1 = { x: p2.x - p1.x, y: p2.y - p1.y, z: p2.z - p1.z };
      const d2 = { x: p3.x - p2.x, y: p3.y - p2.y, z: p3.z - p2.z };
      const l1 = Math.hypot(d1.x, d1.y, d1.z);
      const l2 = Math.hypot(d2.x, d2.y, d2.z);

      if (l1 > EPSILON && l2 > EPSILON) {
        const cosAngle = Math.max(-1, Math.min(1, (d1.x * d2.x + d1.y * d2.y + d1.z * d2.z) / (l1 * l2)));
        const bendDeg = Math.acos(cosAngle) * (180 / Math.PI);
        if (bendDeg >= 1.0) {
          cumulativeBendsDeg += bendDeg;
          if (Math.abs(bendDeg - 90) <= 5.0) elbows90++;
          else if (Math.abs(bendDeg - 45) <= 5.0) elbows45++;
        }
      }
    }

    // Pull Box recommendation: if bends > 360° or length > 100 ft (30.48 m)
    const pullBoxesNeeded = (cumulativeBendsDeg > 360 || runLength > MAX_PULL_DISTANCE_M)
      ? Math.max(Math.floor(cumulativeBendsDeg / 360), Math.floor(runLength / MAX_PULL_DISTANCE_M))
      : 0;

    // Accumulate grand totals
    grandCouplings += couplingsCount;
    grandBoxConnectors += boxConnectorsCount;
    grandStraps += strapsCount;
    grandElbows90 += elbows90;
    grandElbows45 += elbows45;
    grandPullBoxes += pullBoxesNeeded;

    // 3. Group by trade size
    if (!bySizeMap.has(size)) {
      bySizeMap.set(size, {
        size,
        mm: sizeToMillimetres(size) || 0,
        runsCount: 0,
        totalLengthM: 0,
        segments: [],
        couplings: 0,
        boxConnectors: 0,
        straps: 0,
        elbows90: 0,
        elbows45: 0,
      });
    }

    const sizeRow = bySizeMap.get(size);
    sizeRow.runsCount += 1;
    sizeRow.totalLengthM += runLength;
    sizeRow.segments.push(...segmentLengths);
    sizeRow.couplings += couplingsCount;
    sizeRow.boxConnectors += boxConnectorsCount;
    sizeRow.straps += strapsCount;
    sizeRow.elbows90 += elbows90;
    sizeRow.elbows45 += elbows45;

    runsSummary.push({
      runId: run.id,
      name: run.name || `Run ${run.id}`,
      size,
      system,
      lengthM: Number(runLength.toFixed(2)),
      lengthFt: Number((runLength * 3.28084).toFixed(1)),
      sticksBasic: runSticksBasic,
      couplings: couplingsCount,
      boxConnectors: boxConnectorsCount,
      straps: strapsCount,
      elbows90,
      elbows45,
      cumulativeBendsDeg: Number(cumulativeBendsDeg.toFixed(1)),
      pullBoxesNeeded,
      isNecCompliant: cumulativeBendsDeg <= 360,
    });
  }

  // 4. Run FFD bin packing optimization per trade size
  const sizeSummary = [];
  let totalOptimizedSticks = 0;
  let totalBaseLengthM = 0;

  for (const [size, data] of bySizeMap.entries()) {
    const optimization = optimizeStickCutting(data.segments, stockLengthM);
    // Apply user extra waste factor if set
    const finalSticksCount = Math.ceil(optimization.sticksNeeded * (1 + wasteFactor));

    totalOptimizedSticks += finalSticksCount;
    totalBaseLengthM += data.totalLengthM;

    sizeSummary.push({
      size,
      mm: data.mm,
      runsCount: data.runsCount,
      totalLengthM: Number(data.totalLengthM.toFixed(2)),
      totalLengthFt: Number((data.totalLengthM * 3.28084).toFixed(1)),
      rawSticksNeeded: optimization.sticksNeeded,
      optimizedSticks: finalSticksCount,
      wastePercentage: optimization.wastePercentage,
      couplings: data.couplings,
      boxConnectors: data.boxConnectors,
      straps: data.straps,
      elbows90: data.elbows90,
      elbows45: data.elbows45,
    });
  }

  sizeSummary.sort((a, b) => a.mm - b.mm);

  return {
    stockLengthM,
    totals: {
      runs: network.runs.length,
      lengthM: Number(totalBaseLengthM.toFixed(2)),
      lengthFt: Number((totalBaseLengthM * 3.28084).toFixed(1)),
      sticks: totalOptimizedSticks,
      couplings: grandCouplings,
      boxConnectors: grandBoxConnectors,
      straps: grandStraps,
      elbows90: grandElbows90,
      elbows45: grandElbows45,
      pullBoxes: grandPullBoxes,
    },
    bySize: sizeSummary,
    runs: runsSummary,
  };
}

/**
 * Generates an electrical contractor purchase schedule formatted as standard CSV.
 *
 * @param {Object} bom - Detailed BOM produced by computeDetailedBom
 * @returns {string} Formatted CSV text
 */
export function generateContractorBomCsv(bom) {
  const lines = [];

  lines.push('# ==============================================================================');
  lines.push('# CONDUIT TAKEOFF & ELECTRICAL CONTRACTOR BILL OF MATERIALS (BOM)');
  lines.push(`# Standard Stick Length: ${bom.stockLengthM} m (10 ft)`);
  lines.push('# ==============================================================================');
  lines.push('');

  // 1. Conduit Sticks Section
  lines.push('### SECTION 1: CONDUIT STICKS SCHEDULE');
  lines.push('Trade Size,Runs Count,Base Length (m),Base Length (ft),10ft Sticks (Optimized),Est. Waste %');
  for (const s of bom.bySize) {
    lines.push(`"${s.size}",${s.runsCount},${s.totalLengthM},${s.totalLengthFt},${s.optimizedSticks},${s.wastePercentage}%`);
  }
  lines.push(`"TOTAL",${bom.totals.runs},${bom.totals.lengthM},${bom.totals.lengthFt},${bom.totals.sticks},-`);
  lines.push('');

  // 2. Fittings & Hardware Schedule Section
  lines.push('### SECTION 2: FITTINGS & HARDWARE SCHEDULE');
  lines.push('Trade Size,Couplings,Box Connectors,Straps & Hangers (NEC 358.30),90° Elbows,45° Elbows');
  for (const s of bom.bySize) {
    lines.push(`"${s.size}",${s.couplings},${s.boxConnectors},${s.straps},${s.elbows90},${s.elbows45}`);
  }
  lines.push(`"TOTAL",${bom.totals.couplings},${bom.totals.boxConnectors},${bom.totals.straps},${bom.totals.elbows90},${bom.totals.elbows45}`);
  lines.push('');

  // 3. Pull Boxes & Inspection
  lines.push('### SECTION 3: PULL BOXES & CODE COMPLIANCE');
  lines.push(`Recommended Pull Boxes (Runs > 360° or > 100ft):,${bom.totals.pullBoxes}`);
  lines.push('');

  // 4. Run-by-run Detail
  lines.push('### SECTION 4: RUN-BY-RUN DETAIL');
  lines.push('Run ID,Name,Size,System,Length (m),Length (ft),10ft Sticks,Couplings,Bends (Deg),NEC 360° Compliant');
  for (const r of bom.runs) {
    lines.push(`"${r.runId}","${r.name}","${r.size}","${r.system}",${r.lengthM},${r.lengthFt},${r.sticksBasic},${r.couplings},${r.cumulativeBendsDeg}°,${r.isNecCompliant ? 'YES' : 'NO - EXCEEDS LIMIT'}`);
  }

  return lines.join('\n');
}
