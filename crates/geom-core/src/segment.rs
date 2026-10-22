//! Segment queries: closest point, angles, ortho constraint, verticality.
//!
//! Ports `legacy/packages/conduit-core/src/geometry.js` in full
//! (`closestOnSegment`, `angleBetween`, `constrainOrtho`, `planAngleOf`,
//! `isVertical`).

use crate::vec3::{self, Vec3};

/// Result of [`closest_on_segment`].
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ClosestPoint {
    /// Closest point on the segment.
    pub point: Vec3,
    /// Parametric position along the segment (`0..=1`).
    pub t: f64,
    /// Distance from the query point to [`ClosestPoint::point`].
    pub distance: f64,
}

/// Tolerance below which a plan projection counts as zero in
/// [`plan_angle_of`] (legacy `1e-9` parity, in metres).
pub const PLAN_PROJECTION_EPSILON: f64 = 1e-9;

/// Closest point on segment `a -> b` to `p`, `t` clamped to `0..=1`.
///
/// A degenerate segment (`a == b`) returns `t = 0`, `point = a`
/// (legacy `geometry.js:22-28` parity, spec R4).
#[must_use]
pub fn closest_on_segment(p: Vec3, a: Vec3, b: Vec3) -> ClosestPoint {
    let ab = b - a;
    let len2 = vec3::length_sq(ab);
    let t = if len2 > 0.0 {
        (vec3::dot(p - a, ab) / len2).clamp(0.0, 1.0)
    } else {
        0.0
    };
    let point = a + vec3::scale(ab, t);
    ClosestPoint {
        point,
        t,
        distance: vec3::distance(p, point),
    }
}

/// Angle in degrees between two direction vectors (`0..=180`).
///
/// Cosine clamped to `[-1, 1]`; zero-length input yields `0.0`
/// (legacy `geometry.js:13-19` parity, spec R5).
#[must_use]
pub fn angle_between(a: Vec3, b: Vec3) -> f64 {
    const RAD_TO_DEG: f64 = 180.0 / std::f64::consts::PI;
    let la = vec3::length(a);
    let lb = vec3::length(b);
    if la == 0.0 || lb == 0.0 {
        return 0.0;
    }
    let cos = (vec3::dot(a, b) / (la * lb)).clamp(-1.0, 1.0);
    cos.acos() * RAD_TO_DEG
}

/// Keep only the dominant axis of the move `from -> to`.
///
/// Plan axes may be rotated by `plan_angle_deg` degrees (about Z) so ortho
/// follows a building grid not aligned with the IFC axes. Ties resolve to
/// X then Z (`indexOf(max)` parity). A vertical win returns
/// `{from.x, from.y, to.z}` (legacy `geometry.js:35-46` parity, spec R6).
#[must_use]
pub fn constrain_ortho(from: Vec3, to: Vec3, plan_angle_deg: f64) -> Vec3 {
    const DEG_TO_RAD: f64 = std::f64::consts::PI / 180.0;
    let angle = plan_angle_deg * DEG_TO_RAD;
    let (c, s) = (angle.cos(), angle.sin());
    let d = to - from;
    let u = d.x * c + d.y * s;
    let v = -d.x * s + d.y * c;
    let abs = [u.abs(), v.abs(), d.z.abs()];
    let max = abs[0].max(abs[1]).max(abs[2]);
    // indexOf(max): first index wins on ties.
    let axis = abs.iter().position(|&v| v == max).unwrap_or(0);
    if axis == 2 {
        return Vec3::new(from.x, from.y, to.z);
    }
    let (along_u, along_v) = if axis == 0 { (u, 0.0) } else { (0.0, v) };
    Vec3::new(
        from.x + along_u * c - along_v * s,
        from.y + along_u * s + along_v * c,
        from.z,
    )
}

/// Plan angle in degrees (about Z) of the segment `a -> b`.
///
/// `0.0` when the plan projection is below [`PLAN_PROJECTION_EPSILON`]
/// (legacy `geometry.js:49-53` parity, spec R7).
#[must_use]
pub fn plan_angle_of(a: Vec3, b: Vec3) -> f64 {
    const RAD_TO_DEG: f64 = 180.0 / std::f64::consts::PI;
    let d = b - a;
    if d.x.hypot(d.y) < PLAN_PROJECTION_EPSILON {
        return 0.0;
    }
    d.y.atan2(d.x) * RAD_TO_DEG
}

/// True when the segment is within `tolerance_deg` of vertical.
///
/// `false` for zero-length segments (legacy `geometry.js:56-61` parity,
/// spec R8).
#[must_use]
pub fn is_vertical(a: Vec3, b: Vec3, tolerance_deg: f64) -> bool {
    const DEG_TO_RAD: f64 = std::f64::consts::PI / 180.0;
    let d = b - a;
    let len = vec3::length(d);
    if len == 0.0 {
        return false;
    }
    d.z.abs() / len >= (tolerance_deg * DEG_TO_RAD).cos()
}

#[cfg(test)]
mod tests;
