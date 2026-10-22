//! 3D vector primitive (IFC coordinates: metres, Z-up, `f64`).
//!
//! Ports `legacy/packages/routing-core/src/vector.js` (`add/sub/scale/dot/`
//! `length/distance/normalize/mean`) plus the conduit-local copies in
//! `legacy/packages/conduit-core/src/snap-engine.js` (`vec3`: `lengthSq`,
//! epsilon-guarded `normalize`, `closestPointOnSegment` degenerate guard) and
//! `legacy/packages/conduit-core/src/fitting-solver.js` (`v3`: `cross`).
//!
//! Spec R3: `normalize` maps zero/degenerate input to [`Vec3::ZERO`]
//! (all three legacy copies agree on zero output; conduit guards with
//! `len > 1e-7`, see [`NORMALIZE_EPSILON`]).

use std::ops::{Add, Sub};

/// Length at or below which [`normalize`] returns [`Vec3::ZERO`].
///
/// Pins the conduit `snap-engine.js` / `fitting-solver.js` guard
/// `len > EPSILON` with `EPSILON = 1e-7`.
pub const NORMALIZE_EPSILON: f64 = 1e-7;

/// 3D point / direction vector in original IFC coordinates (metres, Z-up).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Vec3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

impl Vec3 {
    /// The zero vector.
    pub const ZERO: Vec3 = Vec3 {
        x: 0.0,
        y: 0.0,
        z: 0.0,
    };

    /// Construct a vector. Mirrors the legacy `vec(x, y, z)` factory.
    #[must_use]
    pub const fn new(x: f64, y: f64, z: f64) -> Vec3 {
        Vec3 { x, y, z }
    }
}

impl Add for Vec3 {
    type Output = Vec3;
    fn add(self, rhs: Vec3) -> Vec3 {
        Vec3::new(self.x + rhs.x, self.y + rhs.y, self.z + rhs.z)
    }
}

impl Sub for Vec3 {
    type Output = Vec3;
    fn sub(self, rhs: Vec3) -> Vec3 {
        Vec3::new(self.x - rhs.x, self.y - rhs.y, self.z - rhs.z)
    }
}

/// `scale(a, s)` — legacy `vector.js` parity.
#[must_use]
pub fn scale(a: Vec3, s: f64) -> Vec3 {
    Vec3::new(a.x * s, a.y * s, a.z * s)
}

/// `dot(a, b)` — legacy `vector.js` parity.
#[must_use]
pub fn dot(a: Vec3, b: Vec3) -> f64 {
    a.x * b.x + a.y * b.y + a.z * b.z
}

/// `cross(a, b)` — legacy `fitting-solver.js v3.cross` parity.
#[must_use]
pub fn cross(a: Vec3, b: Vec3) -> Vec3 {
    Vec3::new(
        a.y * b.z - a.z * b.y,
        a.z * b.x - a.x * b.z,
        a.x * b.y - a.y * b.x,
    )
}

/// Squared length — legacy `snap-engine.js vec3.lengthSq` parity.
#[must_use]
pub fn length_sq(a: Vec3) -> f64 {
    dot(a, a)
}

/// Euclidean length. Uses `hypot` chaining like the legacy conduit copies.
#[must_use]
pub fn length(a: Vec3) -> f64 {
    a.x.hypot(a.y).hypot(a.z)
}

/// Euclidean distance — legacy `distance(a, b) = length(sub(a, b))` parity.
#[must_use]
pub fn distance(a: Vec3, b: Vec3) -> f64 {
    length(a - b)
}

/// Unit vector, or [`Vec3::ZERO`] for zero/degenerate input (spec R3).
#[must_use]
pub fn normalize(a: Vec3) -> Vec3 {
    let len = length(a);
    if len > NORMALIZE_EPSILON {
        scale(a, 1.0 / len)
    } else {
        Vec3::ZERO
    }
}

/// Centroid; empty input yields [`Vec3::ZERO`] (legacy `mean` parity).
#[must_use]
pub fn mean(points: &[Vec3]) -> Vec3 {
    if points.is_empty() {
        return Vec3::ZERO;
    }
    let sum = points.iter().fold(Vec3::ZERO, |acc, &p| acc + p);
    scale(sum, 1.0 / points.len() as f64)
}

#[cfg(test)]
mod tests;
