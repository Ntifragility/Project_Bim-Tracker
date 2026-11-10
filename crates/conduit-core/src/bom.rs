//! Conduit BOM + stick cutting optimizer (task 4.4).
//!
//! Direct port of `legacy/packages/conduit-core/src/bom-calculator.js`:
//! First-Fit Decreasing bin packing for standard sticks plus the detailed
//! hardware BOM (couplings, box connectors, straps, elbows, pull boxes).
//! Consumes 4.1 (`Network`, `size_to_mm`) and 4.3 (`bend_angle`). CSV text
//! rendering stays TS-side (4.5).

use crate::fitting::bend_angle;
use crate::network::Network;
use crate::takeoff::size_to_mm;
use geom_core::Vec3;

const EPSILON: f64 = 1e-7;

/// Default stock stick length in metres (10 ft, legacy parity).
pub const DEFAULT_STICK_LENGTH_M: f64 = 3.048;

/// Saw kerf loss per cut in metres (legacy parity).
pub const KERF_WASTE_M: f64 = 0.003;

/// Straight-pull limit in metres (100 ft, legacy `MAX_PULL_DISTANCE_M`).
pub const MAX_PULL_DISTANCE_M: f64 = 30.48;

/// One planned stock stick.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct StickPlan {
    pub cuts: Vec<f64>,
    pub waste_m: f64,
}

/// FFD cutting plan (legacy `optimizeStickCutting` result parity).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct CuttingPlan {
    pub sticks_needed: usize,
    pub total_length_m: f64,
    pub total_waste_m: f64,
    pub waste_pct: f64,
    pub sticks: Vec<StickPlan>,
}

fn round3(v: f64) -> f64 {
    (v * 1000.0).round() / 1000.0
}

/// FFD bin packing (legacy `optimizeStickCutting` parity, R2-R3).
#[must_use]
pub fn optimize_stick_cutting(cuts: &[f64], stock_m: f64, kerf_m: f64) -> CuttingPlan {
    let mut sorted: Vec<f64> = cuts.iter().copied().filter(|l| *l > EPSILON).collect();
    sorted.sort_by(|a, b| b.partial_cmp(a).unwrap_or(std::cmp::Ordering::Equal));
    let total: f64 = sorted.iter().sum();
    if sorted.is_empty() {
        return CuttingPlan {
            sticks_needed: 0,
            total_length_m: 0.0,
            total_waste_m: 0.0,
            waste_pct: 0.0,
            sticks: vec![],
        };
    }
    // (cuts, remaining)
    let mut sticks: Vec<(Vec<f64>, f64)> = Vec::new();
    for cut in sorted {
        if cut > stock_m {
            // Oversize: whole sticks first, then first-fit the remainder.
            let mut remaining = cut;
            while remaining > stock_m {
                sticks.push((vec![stock_m], 0.0));
                remaining -= stock_m;
            }
            let mut placed = false;
            for (scuts, srem) in sticks.iter_mut() {
                if *srem >= remaining + kerf_m {
                    scuts.push(remaining);
                    *srem -= remaining + kerf_m;
                    placed = true;
                    break;
                }
            }
            if !placed {
                sticks.push((vec![remaining], stock_m - remaining));
            }
            continue;
        }
        let mut placed = false;
        for (scuts, srem) in sticks.iter_mut() {
            let required = cut + if scuts.is_empty() { 0.0 } else { kerf_m };
            if *srem >= required {
                scuts.push(cut);
                *srem -= required;
                placed = true;
                break;
            }
        }
        if !placed {
            sticks.push((vec![cut], stock_m - cut));
        }
    }
    let mut waste_total = 0.0;
    let plans: Vec<StickPlan> = sticks
        .into_iter()
        .map(|(c, rem)| {
            waste_total += rem;
            StickPlan {
                cuts: c,
                waste_m: round3(rem),
            }
        })
        .collect();
    let purchased = plans.len() as f64 * stock_m;
    CuttingPlan {
        sticks_needed: plans.len(),
        total_length_m: round3(total),
        total_waste_m: round3(waste_total),
        waste_pct: if purchased > 0.0 {
            ((waste_total / purchased) * 100.0 * 10.0).round() / 10.0
        } else {
            0.0
        },
        sticks: plans,
    }
}

/// BOM options (legacy `computeDetailedBom` options parity).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct BomOptions {
    pub stock_length_m: f64,
    pub waste_factor_pct: f64,
}

impl Default for BomOptions {
    fn default() -> Self {
        BomOptions {
            stock_length_m: DEFAULT_STICK_LENGTH_M,
            waste_factor_pct: 0.0,
        }
    }
}

/// One run's hardware row.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct RunBom {
    pub run_id: String,
    pub name: String,
    pub size: String,
    pub system: String,
    pub length_m: f64,
    pub sticks_basic: u32,
    pub couplings: u32,
    pub box_connectors: u32,
    pub straps: u32,
    pub elbows90: u32,
    pub elbows45: u32,
    pub cumulative_bends_deg: f64,
    pub pull_boxes: u32,
    pub nec_compliant: bool,
}

/// One trade-size summary row.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct SizeBom {
    pub size: String,
    pub mm: f64,
    pub runs: usize,
    pub length_m: f64,
    pub raw_sticks: usize,
    pub optimized_sticks: usize,
    pub waste_pct: f64,
    pub couplings: u32,
    pub box_connectors: u32,
    pub straps: u32,
    pub elbows90: u32,
    pub elbows45: u32,
}

/// Grand totals.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct BomTotals {
    pub runs: usize,
    pub length_m: f64,
    pub sticks: usize,
    pub couplings: u32,
    pub box_connectors: u32,
    pub straps: u32,
    pub elbows90: u32,
    pub elbows45: u32,
    pub pull_boxes: u32,
}

/// Detailed BOM (legacy `computeDetailedBom` shape parity, rounded report
/// fields only — internals keep full precision).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct DetailedBom {
    pub stock_length_m: f64,
    pub totals: BomTotals,
    pub by_size: Vec<SizeBom>,
    pub runs: Vec<RunBom>,
}

fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

fn points_of(net: &Network, run_idx: usize) -> Vec<Vec3> {
    net.runs[run_idx]
        .node_ids
        .iter()
        .filter_map(|id| {
            net.nodes
                .iter()
                .find(|n| &n.id == id)
                .map(|n| Vec3::new(n.x, n.y, n.z))
        })
        .collect()
}

fn seg_len(a: Vec3, b: Vec3) -> f64 {
    vec_len(b - a)
}

fn vec_len(v: Vec3) -> f64 {
    (v.x * v.x + v.y * v.y + v.z * v.z).sqrt()
}

/// Compute the detailed BOM (legacy `computeDetailedBom` parity, R4-R8).
#[must_use]
pub fn compute_detailed_bom(net: &Network, opts: &BomOptions) -> DetailedBom {
    let stock = if opts.stock_length_m > 0.0 {
        opts.stock_length_m
    } else {
        net.stick_length
    };
    let waste_factor = opts.waste_factor_pct / 100.0;
    let mut run_rows: Vec<RunBom> = Vec::new();
    // size -> aggregate
    struct Agg {
        mm: f64,
        runs: usize,
        length: f64,
        segments: Vec<f64>,
        couplings: u32,
        connectors: u32,
        straps: u32,
        e90: u32,
        e45: u32,
    }
    let mut order: Vec<String> = Vec::new();
    let mut map: std::collections::BTreeMap<String, Agg> = std::collections::BTreeMap::new();
    let mut totals = BomTotals {
        runs: net.runs.len(),
        ..Default::default()
    };

    for (ri, run) in net.runs.iter().enumerate() {
        let points = points_of(net, ri);
        let size = if run.size.is_empty() {
            "¾\"".to_string()
        } else {
            run.size.clone()
        };
        let system = if run.system.is_empty() {
            "Power".to_string()
        } else {
            run.system.clone()
        };
        let mut seg_lens = Vec::new();
        let mut len = 0.0;
        for w in points.windows(2) {
            let l = seg_len(w[0], w[1]);
            seg_lens.push(l);
            len += l;
        }
        let sticks_basic = if len > EPSILON {
            (len / stock).ceil() as u32
        } else {
            0
        };
        let couplings = sticks_basic.saturating_sub(1);
        let connectors = if len > EPSILON { 2 } else { 0 };
        let straps = if len > EPSILON {
            2u32.max(2 + (len / stock).floor() as u32)
        } else {
            0
        };
        let mut e90 = 0u32;
        let mut e45 = 0u32;
        let mut cumulative = 0.0;
        for i in 1..points.len().saturating_sub(1) {
            let bend = bend_angle(points[i - 1], points[i], points[i + 1]);
            if bend >= 1.0 {
                cumulative += bend;
                if (bend - 90.0).abs() <= 5.0 {
                    e90 += 1;
                } else if (bend - 45.0).abs() <= 5.0 {
                    e45 += 1;
                }
            }
        }
        let pull = if cumulative > 360.0 || len > MAX_PULL_DISTANCE_M {
            ((cumulative / 360.0).floor() as u32).max(((len / MAX_PULL_DISTANCE_M).floor()) as u32)
        } else {
            0
        };
        totals.length_m += len;
        totals.couplings += couplings;
        totals.box_connectors += connectors;
        totals.straps += straps;
        totals.elbows90 += e90;
        totals.elbows45 += e45;
        totals.pull_boxes += pull;
        if !map.contains_key(&size) {
            order.push(size.clone());
        }
        let agg = map.entry(size.clone()).or_insert(Agg {
            mm: size_to_mm(&size).unwrap_or(0.0),
            runs: 0,
            length: 0.0,
            segments: vec![],
            couplings: 0,
            connectors: 0,
            straps: 0,
            e90: 0,
            e45: 0,
        });
        agg.runs += 1;
        agg.length += len;
        agg.segments.extend(seg_lens.iter().copied());
        agg.couplings += couplings;
        agg.connectors += connectors;
        agg.straps += straps;
        agg.e90 += e90;
        agg.e45 += e45;
        run_rows.push(RunBom {
            run_id: run.id.clone(),
            name: if run.name.is_empty() {
                format!("Run {}", run.id)
            } else {
                run.name.clone()
            },
            size,
            system,
            length_m: round2(len),
            sticks_basic,
            couplings,
            box_connectors: connectors,
            straps,
            elbows90: e90,
            elbows45: e45,
            cumulative_bends_deg: round2(cumulative),
            pull_boxes: pull,
            nec_compliant: cumulative <= 360.0,
        });
    }
    let mut by_size: Vec<SizeBom> = Vec::new();
    for size in order {
        let agg = &map[&size];
        let plan = optimize_stick_cutting(&agg.segments, stock, KERF_WASTE_M);
        let optimized = ((plan.sticks_needed as f64 * (1.0 + waste_factor)).ceil()) as usize;
        totals.sticks += optimized;
        by_size.push(SizeBom {
            size: size.clone(),
            mm: agg.mm,
            runs: agg.runs,
            length_m: round2(agg.length),
            raw_sticks: plan.sticks_needed,
            optimized_sticks: optimized,
            waste_pct: plan.waste_pct,
            couplings: agg.couplings,
            box_connectors: agg.connectors,
            straps: agg.straps,
            elbows90: agg.e90,
            elbows45: agg.e45,
        });
    }
    by_size.sort_by(|a, b| a.mm.partial_cmp(&b.mm).unwrap_or(std::cmp::Ordering::Equal));
    totals.length_m = round2(totals.length_m);
    DetailedBom {
        stock_length_m: stock,
        totals,
        by_size,
        runs: run_rows,
    }
}

#[cfg(test)]
mod tests;
