//! Minimal quantity takeoff (task 4.1, spec R7-R8).
//!
//! Direct port of `legacy/packages/conduit-core/src/takeoff.js`:
//! per-run `{length, sticks, points}`, per-run `ceil(length / stick)`
//! summed (never `ceil(total / stick)`), `bySize` sorted by [`size_to_mm`].
//! Elbows/risers/couplings are OUT OF SCOPE (conduit is bent on site).

use crate::network::Network;
use geom_core::{vec3, Vec3};

/// Stick-count epsilon (legacy `EPS = 1e-9` parity).
pub const TAKEOFF_EPS: f64 = 1e-9;

/// Nominal size in millimetres (legacy `sizeToMillimetres` parity):
/// `25mm` -> 25; fractions `1 1/2"` -> 38.1; bare numbers stay bare;
/// unicode fractions and garbage -> `None` (legacy NaN).
#[must_use]
pub fn size_to_mm(size: &str) -> Option<f64> {
    let text = size.trim().to_lowercase().replace(',', ".");
    // millimetres: "<n>mm"
    if let Some(num) = text.strip_suffix("mm") {
        if let Ok(v) = num.trim().parse::<f64>() {
            if v.is_finite() {
                return Some(v);
            }
        }
        return None;
    }
    // inches: optional whole + optional fraction/decimal + optional unit mark
    let mut rest = text.as_str();
    let mut whole = 0.0f64;
    // leading whole number followed by space
    if let Some(sp) = rest.find(' ') {
        if let Ok(w) = rest[..sp].parse::<f64>() {
            if w.is_finite() {
                let after = rest[sp + 1..].trim();
                // only treat as whole+fraction when a fraction follows
                if after.contains('/') {
                    whole = w;
                    rest = after;
                }
            }
        }
    }
    let (value, has_unit) = if let Some(slash) = rest.find('/') {
        let num: f64 = rest[..slash].trim().parse().ok()?;
        let tail = rest[slash + 1..].trim();
        // denominator then optional unit mark
        let mut denom_str = String::new();
        let mut unit = false;
        for c in tail.chars() {
            if c.is_ascii_digit() || c == '.' {
                denom_str.push(c);
            } else if c == '"' || c == 'i' {
                unit = true; // " | in | pulg prefix
                break;
            } else if c.is_whitespace() {
                if tail
                    .trim_start_matches(|d: char| d.is_ascii_digit() || d == '.')
                    .trim_start()
                    .starts_with(['"', 'i'])
                {
                    unit = true;
                }
                break;
            } else {
                return None;
            }
        }
        // 'pulg' starts with 'p', not 'i' — check the raw tail
        if tail.to_lowercase().starts_with("pulg") {
            unit = true;
        }
        // inch mark as suffix of the whole original text
        let denom: f64 = denom_str.parse().ok()?;
        if denom <= 0.0 {
            return None;
        }
        (num / denom, unit)
    } else {
        // decimal with optional unit mark
        let mut num_str = String::new();
        let mut unit = false;
        for c in rest.chars() {
            if c.is_ascii_digit() || c == '.' || c == '-' || c == '+' {
                num_str.push(c);
            } else if c == '"' || c == 'i' || c == 'p' {
                // `"` | `in` | `pulg` unit mark (legacy parity)
                unit = true;
                break;
            } else {
                return None;
            }
        }
        if num_str.is_empty() || num_str == "-" || num_str == "+" || num_str == "." {
            return None;
        }
        (num_str.parse::<f64>().ok()?, unit)
    };
    if !value.is_finite() {
        return None;
    }
    // legacy: `/"|in|pulg$/` on the whole text OR fraction OR leading whole
    // forces inches; otherwise bare numbers stay bare.
    let text_unit = text.ends_with('"') || text.ends_with("in") || text.ends_with("pulg");
    let inch = text_unit || has_unit || rest.contains('/') || whole > 0.0;
    Some(if inch {
        (whole + value) * 25.4
    } else {
        whole + value
    })
}

/// Per-run takeoff (legacy `computeRunTakeoff` parity).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct RunTakeoff {
    pub length: f64,
    pub sticks: u32,
    pub points: usize,
}

/// Full takeoff (legacy `computeTakeoff` parity, minimal shape).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Takeoff {
    pub stick_length: f64,
    pub runs: Vec<TakeoffRun>,
    pub by_size: Vec<TakeoffSize>,
    pub totals: TakeoffTotals,
}

/// One per-run row: `{id, name, size, system, length, sticks, points}`.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct TakeoffRun {
    pub id: String,
    pub name: String,
    pub size: String,
    pub system: String,
    pub length: f64,
    pub sticks: u32,
    pub points: usize,
}

/// One per-size summary row.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct TakeoffSize {
    pub size: String,
    pub runs: usize,
    pub length: f64,
    pub sticks: u32,
}

/// Grand totals.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct TakeoffTotals {
    pub runs: usize,
    pub length: f64,
    pub sticks: u32,
}

fn node_point(net: &Network, id: &str) -> Option<Vec3> {
    net.nodes
        .iter()
        .find(|n| n.id == *id)
        .map(|n| Vec3::new(n.x, n.y, n.z))
}

/// Compute one run's takeoff (unknown runs -> zeros, legacy parity).
#[must_use]
pub fn compute_run_takeoff(net: &Network, run_id: &str) -> RunTakeoff {
    let Some(run) = net.runs.iter().find(|r| r.id == run_id) else {
        return RunTakeoff {
            length: 0.0,
            sticks: 0,
            points: 0,
        };
    };
    let points: Vec<Vec3> = run
        .node_ids
        .iter()
        .filter_map(|id| node_point(net, id))
        .collect();
    let mut total = 0.0;
    for w in points.windows(2) {
        total += vec3::distance(w[0], w[1]);
    }
    let sticks = if total > TAKEOFF_EPS {
        (total / net.stick_length - TAKEOFF_EPS).ceil().max(0.0) as u32
    } else {
        0
    };
    RunTakeoff {
        length: total,
        sticks,
        points: points.len(),
    }
}

/// Compute the full takeoff (legacy `computeTakeoff` parity).
#[must_use]
pub fn compute_takeoff(net: &Network) -> Takeoff {
    let mut runs: Vec<TakeoffRun> = net
        .runs
        .iter()
        .map(|run| {
            let t = compute_run_takeoff(net, &run.id);
            TakeoffRun {
                id: run.id.clone(),
                name: run.name.clone(),
                size: run.size.clone(),
                system: run.system.clone(),
                length: t.length,
                sticks: t.sticks,
                points: t.points,
            }
        })
        .collect();
    let _ = &mut runs;
    // group by size, preserving first-seen order, then stable-sort by mm
    let mut order: Vec<String> = Vec::new();
    let mut map: std::collections::BTreeMap<String, (usize, f64, u32)> =
        std::collections::BTreeMap::new();
    for r in &runs {
        if !map.contains_key(&r.size) {
            order.push(r.size.clone());
        }
        let e = map.entry(r.size.clone()).or_insert((0, 0.0, 0));
        e.0 += 1;
        e.1 += r.length;
        e.2 += r.sticks;
    }
    let mut by_size: Vec<TakeoffSize> = order
        .into_iter()
        .map(|size| {
            let (runs, length, sticks) = map[&size];
            TakeoffSize {
                size,
                runs,
                length,
                sticks,
            }
        })
        .collect();
    by_size.sort_by(|a, b| {
        (size_to_mm(&a.size).unwrap_or(0.0))
            .partial_cmp(&size_to_mm(&b.size).unwrap_or(0.0))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let totals = by_size
        .iter()
        .fold(TakeoffTotals::default(), |mut acc, row| {
            acc.runs += row.runs;
            acc.length += row.length;
            acc.sticks += row.sticks;
            acc
        });
    Takeoff {
        stick_length: net.stick_length,
        runs,
        by_size,
        totals,
    }
}

#[cfg(test)]
mod tests;
