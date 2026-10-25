//! PCA centerline inference.
//!
//! Pure port of `legacy/packages/routing-core/src/centerline.js` (72 lines).
//! All inputs/outputs are IFC Z-up metres `f64` (spec R8 / owner D4).

use geom_core::vec3::{self, Vec3};

/// Centerline inference outcome.
#[derive(Debug, Clone)]
pub struct Centerline {
    pub valid: bool,
    pub reason: String,
    pub centroid: Vec3,
    pub axis: Vec3,
    pub start: Vec3,
    pub end: Vec3,
    pub length: f64,
    pub confidence: f64,
}

fn invalid(reason: &str) -> Centerline {
    Centerline {
        valid: false,
        reason: reason.to_string(),
        centroid: Vec3::ZERO,
        axis: Vec3::ZERO,
        start: Vec3::ZERO,
        end: Vec3::ZERO,
        length: 0.0,
        confidence: 0.0,
    }
}

fn invalid_with_length(reason: &str, length: f64) -> Centerline {
    Centerline {
        length,
        ..invalid(reason)
    }
}

type Mat3 = [[f64; 3]; 3];

fn covariance(points: &[Vec3], centroid: Vec3) -> Mat3 {
    let mut m = [[0.0; 3]; 3];
    for p in points {
        let d = *p - centroid;
        let v = [d.x, d.y, d.z];
        for (row, m_row) in m.iter_mut().enumerate() {
            for (col, cell) in m_row.iter_mut().enumerate() {
                *cell += v[row] * v[col];
            }
        }
    }
    let n = points.len() as f64;
    for m_row in m.iter_mut() {
        for cell in m_row.iter_mut() {
            *cell /= n;
        }
    }
    m
}

fn multiply(m: &Mat3, v: Vec3) -> Vec3 {
    Vec3::new(
        m[0][0] * v.x + m[0][1] * v.y + m[0][2] * v.z,
        m[1][0] * v.x + m[1][1] * v.y + m[1][2] * v.z,
        m[2][0] * v.x + m[2][1] * v.y + m[2][2] * v.z,
    )
}

fn principal_axis(m: &Mat3) -> Vec3 {
    let mut axis = vec3::normalize(Vec3::new(1.0, 0.73, 0.37));
    for _ in 0..32 {
        let next = vec3::normalize(multiply(m, axis));
        if vec3::length(next) == 0.0 {
            break;
        }
        axis = next;
    }
    axis
}

/// R2: `< 2` vertices -> insufficient-vertices; zero axis -> degenerate;
/// non-finite or `< minimum_length` (default 1e-4) -> centerline-too-short.
pub fn derive_centerline(points: &[Vec3], minimum_length: f64) -> Centerline {
    if points.len() < 2 {
        return invalid("insufficient-vertices");
    }
    let centroid = vec3::mean(points);
    let matrix = covariance(points, centroid);
    let axis = principal_axis(&matrix);
    if vec3::length(axis) == 0.0 {
        return invalid("degenerate-geometry");
    }
    let mut minimum = f64::INFINITY;
    let mut maximum = f64::NEG_INFINITY;
    for p in points {
        let projection = vec3::dot(*p - centroid, axis);
        minimum = minimum.min(projection);
        maximum = maximum.max(projection);
    }
    let route_length = maximum - minimum;
    if !route_length.is_finite() || route_length < minimum_length {
        return invalid_with_length("centerline-too-short", route_length);
    }
    let longitudinal = vec3::dot(axis, multiply(&matrix, axis));
    let total = matrix[0][0] + matrix[1][1] + matrix[2][2];
    Centerline {
        valid: true,
        reason: String::new(),
        centroid,
        axis,
        start: centroid + vec3::scale(axis, minimum),
        end: centroid + vec3::scale(axis, maximum),
        length: route_length,
        confidence: if total > 0.0 {
            longitudinal / total
        } else {
            0.0
        },
    }
}

#[cfg(test)]
mod tests;
