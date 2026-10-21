//! Revit-Style Conduit Fitting & Bend Radius Solver in Rust
//! Designed for WebAssembly compilation via `wasm-bindgen`.
//! Matches packages/conduit-core/src/fitting-solver.js 1-to-1.

use wasm_bindgen::prelude::*;

const EPSILON: f64 = 1e-7;
const RAD_TO_DEG: f64 = 180.0 / std::f64::consts::PI;
const DEG_TO_RAD: f64 = std::f64::consts::PI / 180.0;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Point3D {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

#[derive(Clone, Debug)]
pub struct ElbowFitting {
    pub is_valid: bool,
    pub bend_angle_deg: f64,
    pub bend_radius: f64,
    pub tangent_distance: f64,
    pub tangent_start: Point3D,
    pub tangent_end: Point3D,
    pub center: Point3D,
    pub arc_points: Vec<Point3D>,
}

#[derive(Clone, Debug)]
pub struct RunBendAnalysis {
    pub total_degrees: f64,
    pub fittings_count: usize,
    pub exceeds_nec_360: bool,
    pub warning: Option<String>,
}

/// NFPA 70 / NEC Chapter 9 Table 2: Minimum Radius of Conduit Bends
pub fn get_nec_bend_radius_m(diameter_mm: f64) -> f64 {
    if diameter_mm <= 15.0 {
        0.1016 // 1/2" -> 4.0 in
    } else if diameter_mm <= 21.0 {
        0.1143 // 3/4" -> 4.5 in
    } else if diameter_mm <= 27.0 {
        0.1460 // 1" -> 5.75 in
    } else if diameter_mm <= 35.0 {
        0.1841 // 1-1/4" -> 7.25 in
    } else if diameter_mm <= 41.0 {
        0.2095 // 1-1/2" -> 8.25 in
    } else if diameter_mm <= 53.0 {
        0.2413 // 2" -> 9.5 in
    } else if diameter_mm <= 63.0 {
        0.2667 // 2-1/2" -> 10.5 in
    } else if diameter_mm <= 78.0 {
        0.3302 // 3" -> 13.0 in
    } else if diameter_mm <= 91.0 {
        0.3810 // 3-1/2" -> 15.0 in
    } else {
        0.4064 // 4" -> 16.0 in
    }
}

pub fn calculate_bend_angle(p1: Point3D, p_corner: Point3D, p2: Point3D) -> f64 {
    let d1 = (p_corner.x - p1.x, p_corner.y - p1.y, p_corner.z - p1.z);
    let d2 = (p2.x - p_corner.x, p2.y - p_corner.y, p2.z - p_corner.z);

    let len1 = (d1.0 * d1.0 + d1.1 * d1.1 + d1.2 * d1.2).sqrt();
    let len2 = (d2.0 * d2.0 + d2.1 * d2.1 + d2.2 * d2.2).sqrt();

    if len1 < EPSILON || len2 < EPSILON {
        return 0.0;
    }

    let dot = d1.0 * d2.0 + d1.1 * d2.1 + d1.2 * d2.2;
    let cos_theta = (dot / (len1 * len2)).clamp(-1.0, 1.0);
    cos_theta.acos() * RAD_TO_DEG
}

pub fn analyze_run_bends(points: &[Point3D]) -> RunBendAnalysis {
    if points.len() < 3 {
        return RunBendAnalysis {
            total_degrees: 0.0,
            fittings_count: 0,
            exceeds_nec_360: false,
            warning: None,
        };
    }

    let mut total_degrees = 0.0;
    let mut fittings_count = 0;

    for i in 1..points.len() - 1 {
        let angle = calculate_bend_angle(points[i - 1], points[i], points[i + 1]);
        if angle >= 1.0 {
            total_degrees += angle;
            fittings_count += 1;
        }
    }

    let exceeds_nec_360 = total_degrees > 360.0;
    let warning = if exceeds_nec_360 {
        Some(format!(
            "Warning: Run contains {:.1}° of bends (exceeds NEC 360° maximum allowed between pull points).",
            total_degrees
        ))
    } else {
        None
    };

    RunBendAnalysis {
        total_degrees,
        fittings_count,
        exceeds_nec_360,
        warning,
    }
}
