//! Advanced Electrical Contractor Bill of Materials (BOM) & Stick Cutting Optimizer in Rust
//! Designed for WebAssembly compilation via `wasm-bindgen`.
//! Matches packages/conduit-core/src/bom-calculator.js 1-to-1.

use wasm_bindgen::prelude::*;

const EPSILON: f64 = 1e-7;
const DEFAULT_STICK_LENGTH_M: f64 = 3.048; // Standard 10 ft

#[derive(Clone, Debug)]
pub struct StickCut {
    pub stick_number: usize,
    pub cuts: Vec<f64>,
    pub waste_m: f64,
}

#[derive(Clone, Debug)]
pub struct StickOptimizationResult {
    pub sticks_needed: usize,
    pub total_length_m: f64,
    pub total_waste_m: f64,
    pub waste_percentage: f64,
    pub sticks: Vec<StickCut>,
}

/// First-Fit Decreasing (FFD) Bin-Packing Algorithm for 10-ft stock sticks.
pub fn optimize_stick_cutting(
    cut_lengths_m: &[f64],
    stock_length_m: f64,
    kerf_waste_m: f64,
) -> StickOptimizationResult {
    if cut_lengths_m.is_empty() {
        return StickOptimizationResult {
            sticks_needed: 0,
            total_length_m: 0.0,
            total_waste_m: 0.0,
            waste_percentage: 0.0,
            sticks: Vec::new(),
        };
    }

    let mut cuts: Vec<f64> = cut_lengths_m
        .iter()
        .copied()
        .filter(|&len| len > EPSILON)
        .collect();

    // Sort descending (First-Fit Decreasing)
    cuts.sort_by(|a, b| b.partial_cmp(a).unwrap_or(std::cmp::Ordering::Equal));

    let total_length_m: f64 = cuts.iter().sum();

    struct InternalStick {
        remaining: f64,
        cuts: Vec<f64>,
    }

    let mut sticks: Vec<InternalStick> = Vec::new();

    for cut in cuts {
        if cut > stock_length_m {
            let mut remaining_cut = cut;
            while remaining_cut > stock_length_m {
                sticks.push(InternalStick {
                    remaining: 0.0,
                    cuts: vec![stock_length_m],
                });
                remaining_cut -= stock_length_m;
            }

            let mut placed = false;
            for stick in &mut sticks {
                if stick.remaining >= remaining_cut + kerf_waste_m {
                    stick.cuts.push(remaining_cut);
                    stick.remaining -= remaining_cut + kerf_waste_m;
                    placed = true;
                    break;
                }
            }
            if !placed {
                sticks.push(InternalStick {
                    remaining: stock_length_m - remaining_cut,
                    cuts: vec![remaining_cut],
                });
            }
            continue;
        }

        let mut placed = false;
        for stick in &mut sticks {
            let required = cut + if !stick.cuts.is_empty() { kerf_waste_m } else { 0.0 };
            if stick.remaining >= required {
                stick.cuts.push(cut);
                stick.remaining -= required;
                placed = true;
                break;
            }
        }

        if !placed {
            sticks.push(InternalStick {
                remaining: stock_length_m - cut,
                cuts: vec![cut],
            });
        }
    }

    let mut total_waste_m = 0.0;
    let mut result_sticks = Vec::new();

    for (idx, stick) in sticks.into_iter().enumerate() {
        total_waste_m += stick.remaining;
        result_sticks.push(StickCut {
            stick_number: idx + 1,
            cuts: stick.cuts,
            waste_m: stick.remaining,
        });
    }

    let total_stock_purchased_m = result_sticks.len() as f64 * stock_length_m;
    let waste_percentage = if total_stock_purchased_m > 0.0 {
        (total_waste_m / total_stock_purchased_m) * 100.0
    } else {
        0.0
    };

    StickOptimizationResult {
        sticks_needed: result_sticks.len(),
        total_length_m,
        total_waste_m,
        waste_percentage,
        sticks: result_sticks,
    }
}
