//! Scene <-> IFC coordinate frame (pure `Mat4` math, no Three.js).
//!
//! Ports the math of `legacy/src/covillaf/coordinates.js`
//! (`createCoordinateFrame`): the loader moves the first model near the
//! origin (`COORDINATE_TO_ORIGIN`) and later models are placed relative to
//! it, so every model shares one coordination matrix:
//! `scene = base * original` in Three axes (Y-up, metres). Original IFC
//! coordinates are Z-up: `(x, y, z)_ifc = (x, -z, y)_three`.
//!
//! The TS adapter keeps owning the live `fragments.baseCoordinationMatrix`
//! (Three.js I/O); this module owns the invertible axis-swap + affine math
//! so every downstream core agrees on one frame (spec R10).

use crate::vec3::Vec3;

/// Row-major 4x4 affine matrix; identity means "no shift".
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Mat4 {
    /// Row-major entries `m[row * 4 + col]`.
    pub m: [f64; 16],
}

impl Mat4 {
    /// Identity matrix.
    pub const IDENTITY: Mat4 = Mat4 {
        m: [
            1.0, 0.0, 0.0, 0.0, //
            0.0, 1.0, 0.0, 0.0, //
            0.0, 0.0, 1.0, 0.0, //
            0.0, 0.0, 0.0, 1.0, //
        ],
    };

    /// Multiply matrix by a point (`w = 1`).
    #[must_use]
    pub fn apply_point(self, p: Vec3) -> Vec3 {
        let m = self.m;
        Vec3::new(
            m[0] * p.x + m[1] * p.y + m[2] * p.z + m[3],
            m[4] * p.x + m[5] * p.y + m[6] * p.z + m[7],
            m[8] * p.x + m[9] * p.y + m[10] * p.z + m[11],
        )
    }

    /// Invert the affine matrix (Gauss-Jordan). `None` when singular,
    /// e.g. an all-zero matrix (spec R10).
    #[must_use]
    pub fn inverse(self) -> Option<Mat4> {
        const N: usize = 4;
        let mut aug = [[0.0_f64; 2 * N]; N];
        for (r, row) in aug.iter_mut().enumerate().take(N) {
            for (c, cell) in row.iter_mut().enumerate().take(N) {
                *cell = self.m[r * N + c];
            }
            row[N + r] = 1.0;
        }
        for col in 0..N {
            let mut pivot = col;
            for r in (col + 1)..N {
                if aug[r][col].abs() > aug[pivot][col].abs() {
                    pivot = r;
                }
            }
            if aug[pivot][col] == 0.0 {
                return None;
            }
            aug.swap(col, pivot);
            let div = aug[col][col];
            for cell in aug[col].iter_mut() {
                *cell /= div;
            }
            for r in 0..N {
                if r != col {
                    let factor = aug[r][col];
                    let (dst, src) = if r < col {
                        let (head, tail) = aug.split_at_mut(col);
                        (&mut head[r], &tail[0])
                    } else {
                        let (head, tail) = aug.split_at_mut(r);
                        (&mut tail[0], &head[col])
                    };
                    for (d, s) in dst.iter_mut().zip(src.iter()) {
                        *d -= factor * s;
                    }
                }
            }
        }
        let mut m = [0.0_f64; 16];
        for r in 0..N {
            for c in 0..N {
                m[r * N + c] = aug[r][N + c];
            }
        }
        Some(Mat4 { m })
    }
}

/// Original IFC coordinates (metres, Z-up) -> scene point.
///
/// Computes `three = (x, z, -y)` then applies `base`
/// (legacy `toScene` parity, spec R10).
#[must_use]
pub fn to_scene(original: Vec3, base: &Mat4) -> Vec3 {
    let three = Vec3::new(original.x, original.z, -original.y);
    base.apply_point(three)
}

/// Scene point -> original IFC coordinates (metres, Z-up).
///
/// Inverts `base`, applies it, then maps `(x, y, z)` to `(x, -z, y)`
/// (legacy `toOriginal` parity). `None` when `base` is singular (spec R10).
#[must_use]
pub fn to_original(scene: Vec3, base: &Mat4) -> Option<Vec3> {
    let inv = base.inverse()?;
    let p = inv.apply_point(scene);
    Some(Vec3::new(p.x, -p.z, p.y))
}

#[cfg(test)]
mod tests;
