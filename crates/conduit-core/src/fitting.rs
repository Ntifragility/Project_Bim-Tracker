//! Conduit fitting & bend radius solver (task 4.3).
//!
//! Direct port of `legacy/packages/conduit-core/src/fitting-solver.js`:
//! NFPA 70 / NEC Chapter 9 Table 2 bend radii, bend-angle computation,
//! smooth arc elbow fillets, NEC 360° run-bend analysis, and the auto-riser
//! solver. Vector math delegates to `geom-core` (`cross`/`normalize`
//! already live there from 3.1).

use geom_core::{vec3, Vec3};

const DEG_TO_RAD: f64 = std::f64::consts::PI / 180.0;
const RAD_TO_DEG: f64 = 180.0 / std::f64::consts::PI;
const EPSILON: f64 = 1e-7;

/// NEC Chapter 9 Table 2 row (legacy `NEC_BEND_TABLE` parity).
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct NecBendRow {
    pub trade_size: &'static str,
    pub label: &'static str,
    pub mm: f64,
    pub radius_in: f64,
    pub radius_m: f64,
}

/// NEC Chapter 9 Table 2: minimum centerline bend radius, metres
/// (legacy exact data parity).
pub const NEC_BEND_TABLE: [NecBendRow; 10] = [
    NecBendRow {
        trade_size: "1/2\"",
        label: "½\"",
        mm: 12.7,
        radius_in: 4.0,
        radius_m: 0.1016,
    },
    NecBendRow {
        trade_size: "3/4\"",
        label: "¾\"",
        mm: 19.05,
        radius_in: 4.5,
        radius_m: 0.1143,
    },
    NecBendRow {
        trade_size: "1\"",
        label: "1\"",
        mm: 25.4,
        radius_in: 5.75,
        radius_m: 0.146,
    },
    NecBendRow {
        trade_size: "1-1/4\"",
        label: "1¼\"",
        mm: 31.75,
        radius_in: 7.25,
        radius_m: 0.1841,
    },
    NecBendRow {
        trade_size: "1-1/2\"",
        label: "1½\"",
        mm: 38.1,
        radius_in: 8.25,
        radius_m: 0.2095,
    },
    NecBendRow {
        trade_size: "2\"",
        label: "2\"",
        mm: 50.8,
        radius_in: 9.5,
        radius_m: 0.2413,
    },
    NecBendRow {
        trade_size: "2-1/2\"",
        label: "2½\"",
        mm: 63.5,
        radius_in: 10.5,
        radius_m: 0.2667,
    },
    NecBendRow {
        trade_size: "3\"",
        label: "3\"",
        mm: 76.2,
        radius_in: 13.0,
        radius_m: 0.3302,
    },
    NecBendRow {
        trade_size: "3-1/2\"",
        label: "3½\"",
        mm: 88.9,
        radius_in: 15.0,
        radius_m: 0.381,
    },
    NecBendRow {
        trade_size: "4\"",
        label: "4\"",
        mm: 101.6,
        radius_in: 16.0,
        radius_m: 0.4064,
    },
];

/// Default radius (¾") for unknown trade sizes (legacy parity).
pub const DEFAULT_BEND_RADIUS_M: f64 = 0.1143;

/// Bend radius query: trade-size string or diameter in mm.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum NecQuery {
    TradeSize(String),
    Mm(f64),
}

/// NEC bend radius lookup (legacy `getNecBendRadiusM` parity).
#[must_use]
pub fn nec_bend_radius_m(query: &NecQuery) -> f64 {
    match query {
        NecQuery::Mm(mm) => {
            let mut closest = &NEC_BEND_TABLE[0];
            let mut min_diff = (mm - closest.mm).abs();
            for row in &NEC_BEND_TABLE {
                let diff = (mm - row.mm).abs();
                if diff < min_diff {
                    min_diff = diff;
                    closest = row;
                }
            }
            closest.radius_m
        }
        NecQuery::TradeSize(s) => {
            let str = s.trim();
            NEC_BEND_TABLE
                .iter()
                .find(|row| {
                    row.trade_size == str
                        || row.label == str
                        || row.trade_size.replace('-', " ") == str.replace('-', " ")
                })
                .map_or(DEFAULT_BEND_RADIUS_M, |row| row.radius_m)
        }
    }
}

/// Turn angle between segments in degrees 0..180 (legacy parity).
#[must_use]
pub fn bend_angle(p1: Vec3, corner: Vec3, p2: Vec3) -> f64 {
    let d1 = corner - p1;
    let d2 = p2 - corner;
    let len1 = vec3::length(d1);
    let len2 = vec3::length(d2);
    if len1 < EPSILON || len2 < EPSILON {
        return 0.0;
    }
    let cos = (vec3::dot(d1, d2) / (len1 * len2)).clamp(-1.0, 1.0);
    cos.acos() * RAD_TO_DEG
}

/// Solved elbow fillet (legacy `solveElbowFitting` shape parity).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ElbowSolution {
    pub valid: bool,
    pub straight: bool,
    pub angle_deg: f64,
    pub radius_m: f64,
    pub tangent_dist: f64,
    pub tangent_start: Vec3,
    pub tangent_end: Vec3,
    pub center: Vec3,
    pub arc_points: Vec<Vec3>,
}

/// Smooth arc elbow (legacy `solveElbowFitting` parity, R4-R5).
#[must_use]
pub fn solve_elbow(
    p1: Vec3,
    corner: Vec3,
    p2: Vec3,
    radius_m: f64,
    arc_segments: usize,
) -> ElbowSolution {
    let angle = bend_angle(p1, corner, p2);
    if angle < 1.0 {
        return ElbowSolution {
            valid: false,
            straight: true,
            angle_deg: 0.0,
            radius_m,
            tangent_dist: 0.0,
            tangent_start: corner,
            tangent_end: corner,
            center: corner,
            arc_points: vec![corner],
        };
    }
    let u = vec3::normalize(p1 - corner);
    let v = vec3::normalize(p2 - corner);
    let half_rad = (angle * 0.5) * DEG_TO_RAD;
    let tangent = radius_m * half_rad.tan();
    let len1 = vec3::length(p1 - corner);
    let len2 = vec3::length(p2 - corner);
    let max_tangent = len1.min(len2) * 0.95;
    let eff_tangent = tangent.min(max_tangent);
    let eff_radius = eff_tangent / half_rad.tan();
    let p_start = corner + vec3::scale(u, eff_tangent);
    let p_end = corner + vec3::scale(v, eff_tangent);
    let bisector = vec3::normalize(u + v);
    let center = corner + vec3::scale(bisector, eff_radius / half_rad.cos());
    let r_start = p_start - center;
    let normal = vec3::normalize(vec3::cross(u, v));
    let r_start_n = vec3::normalize(r_start);
    let v_ortho = vec3::normalize(vec3::cross(normal, r_start_n));
    let n = arc_segments.max(1);
    let mut arc: Vec<Vec3> = (0..=n)
        .map(|i| {
            let theta = (i as f64 / n as f64) * (angle * DEG_TO_RAD);
            center
                + vec3::scale(r_start_n, eff_radius * theta.cos())
                + vec3::scale(v_ortho, eff_radius * theta.sin())
        })
        .collect();
    if let Some(first) = arc.first_mut() {
        *first = p_start;
    }
    if let Some(last) = arc.last_mut() {
        *last = p_end;
    }
    ElbowSolution {
        valid: true,
        straight: false,
        angle_deg: angle,
        radius_m: eff_radius,
        tangent_dist: eff_tangent,
        tangent_start: p_start,
        tangent_end: p_end,
        center,
        arc_points: arc,
    }
}

/// One bend in a run (legacy `bends[]` entry parity).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct BendInfo {
    pub index: usize,
    pub angle_deg: f64,
    pub quarter_bend: bool,
}

/// Run-bend analysis (legacy `analyzeRunBends` parity).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct RunBends {
    pub total_deg: f64,
    pub fittings: usize,
    pub exceeds_nec360: bool,
    pub bends: Vec<BendInfo>,
}

/// Cumulative bend analysis with NEC 360° flag (legacy parity).
#[must_use]
pub fn analyze_run_bends(points: &[Vec3]) -> RunBends {
    if points.len() < 3 {
        return RunBends {
            total_deg: 0.0,
            fittings: 0,
            exceeds_nec360: false,
            bends: vec![],
        };
    }
    let mut total = 0.0;
    let mut bends = Vec::new();
    for i in 1..points.len() - 1 {
        let angle = bend_angle(points[i - 1], points[i], points[i + 1]);
        if angle >= 1.0 {
            total += angle;
            bends.push(BendInfo {
                index: i,
                angle_deg: (angle * 10.0).round() / 10.0,
                quarter_bend: (angle - 90.0).abs() <= 2.0,
            });
        }
    }
    RunBends {
        total_deg: (total * 10.0).round() / 10.0,
        fittings: bends.len(),
        exceeds_nec360: total > 360.0,
        bends,
    }
}

/// Auto-riser node (legacy riser-node shape parity).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct RiserNode {
    pub point: Vec3,
    pub is_riser: bool,
    pub height_delta: f64,
}

/// Vertical transition solver (legacy `solveAutoRiser` parity).
#[must_use]
pub fn solve_auto_riser(start: Vec3, target_elevation: f64, up_axis_y: bool) -> Vec<RiserNode> {
    let current = if up_axis_y { start.y } else { start.z };
    let delta = target_elevation - current;
    if delta.abs() < 0.01 {
        return vec![RiserNode {
            point: start,
            is_riser: false,
            height_delta: 0.0,
        }];
    }
    let point = if up_axis_y {
        Vec3::new(start.x, target_elevation, start.z)
    } else {
        Vec3::new(start.x, start.y, target_elevation)
    };
    vec![
        RiserNode {
            point: start,
            is_riser: false,
            height_delta: 0.0,
        },
        RiserNode {
            point,
            is_riser: true,
            height_delta: delta,
        },
    ]
}

#[cfg(test)]
mod tests;
