//! Revit-Style Precision Snapping Engine in Rust
//! Designed for high-performance WebAssembly compilation via `wasm-bindgen`.
//! Matches packages/conduit-core/src/snap-engine.js 1-to-1.

use wasm_bindgen::prelude::*;

const EPSILON: f64 = 1e-7;
const RAD_TO_DEG: f64 = 180.0 / std::f64::consts::PI;
const DEG_TO_RAD: f64 = std::f64::consts::PI / 180.0;

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Point3D {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

#[wasm_bindgen]
impl Point3D {
    #[wasm_bindgen(constructor)]
    pub fn new(x: f64, y: f64, z: f64) -> Self {
        Self { x, y, z }
    }

    pub fn distance_to(&self, other: &Point3D) -> f64 {
        ((self.x - other.x).powi(2) + (self.y - other.y).powi(2) + (self.z - other.z).powi(2)).sqrt()
    }
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum SnapType {
    Endpoint,
    Midpoint,
    Segment,
    PolarAngle,
    Ortho,
    WorkPlane,
}

#[wasm_bindgen]
pub struct SnapCandidate {
    pub point: Point3D,
    pub snap_type: SnapType,
    pub distance: f64,
    pub angle_deg: Option<f64>,
}

pub fn closest_point_on_segment(p: Point3D, a: Point3D, b: Point3D) -> (Point3D, f64, f64) {
    let ab_x = b.x - a.x;
    let ab_y = b.y - a.y;
    let ab_z = b.z - a.z;
    let ab_len_sq = ab_x * ab_x + ab_y * ab_y + ab_z * ab_z;

    if ab_len_sq < EPSILON {
        return (a, 0.0, p.distance_to(&a));
    }

    let ap_x = p.x - a.x;
    let ap_y = p.y - a.y;
    let ap_z = p.z - a.z;
    let dot = ap_x * ab_x + ap_y * ab_y + ap_z * ab_z;
    let t = (dot / ab_len_sq).clamp(0.0, 1.0);

    let proj = Point3D {
        x: a.x + t * ab_x,
        y: a.y + t * ab_y,
        z: a.z + t * ab_z,
    };
    (proj, t, p.distance_to(&proj))
}

pub fn snap_polar_angle(
    from: Point3D,
    to: Point3D,
    allowed_angles_deg: &[f64],
    tolerance_deg: f64,
) -> Option<SnapCandidate> {
    let dx = to.x - from.x;
    let dz = to.z - from.z;
    let radial_dist = (dx * dx + dz * dz).sqrt();

    if radial_dist < 0.05 {
        return None;
    }

    let mut raw_angle = (dz.atan2(dx) * RAD_TO_DEG + 360.0) % 360.0;
    let mut closest_angle: Option<f64> = None;
    let mut min_diff = tolerance_deg;

    for &angle in allowed_angles_deg {
        let target = (angle % 360.0 + 360.0) % 360.0;
        let mut diff = (raw_angle - target).abs();
        if diff > 180.0 {
            diff = 360.0 - diff;
        }
        if diff <= min_diff {
            min_diff = diff;
            closest_angle = Some(target);
        }
    }

    if let Some(angle) = closest_angle {
        let rad = angle * DEG_TO_RAD;
        let snapped_pt = Point3D {
            x: from.x + radial_dist * rad.cos(),
            y: from.y,
            z: from.z + radial_dist * rad.sin(),
        };
        Some(SnapCandidate {
            point: snapped_pt,
            snap_type: SnapType::PolarAngle,
            distance: to.distance_to(&snapped_pt),
            angle_deg: Some(angle),
        })
    } else {
        None
    }
}
