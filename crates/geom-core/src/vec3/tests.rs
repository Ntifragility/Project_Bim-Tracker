//! `vec.json` acceptance vectors as Rust tests (task 3.1, spec R1-R4).

use super::*;
use crate::segment::closest_on_segment;

fn v(x: f64, y: f64, z: f64) -> Vec3 {
    Vec3::new(x, y, z)
}

fn assert_vec(actual: Vec3, x: f64, y: f64, z: f64, tol: f64) {
    assert!((actual.x - x).abs() <= tol, "x: {} != {x}", actual.x);
    assert!((actual.y - y).abs() <= tol, "y: {} != {y}", actual.y);
    assert!((actual.z - z).abs() <= tol, "z: {} != {z}", actual.z);
}

#[test]
fn vec_add() {
    assert_eq!(v(1.0, 2.0, 3.0) + v(4.0, 5.0, 6.0), v(5.0, 7.0, 9.0));
}

#[test]
fn vec_sub() {
    assert_eq!(v(4.0, 5.0, 6.0) - v(1.0, 2.0, 3.0), v(3.0, 3.0, 3.0));
}

#[test]
fn vec_scale() {
    assert_eq!(scale(v(1.0, 2.0, 3.0), 2.0), v(2.0, 4.0, 6.0));
    assert_eq!(scale(v(1.0, 2.0, 3.0), 0.0), Vec3::ZERO);
}

#[test]
fn vec_dot() {
    assert!((dot(v(1.0, 2.0, 3.0), v(4.0, 5.0, 6.0)) - 32.0).abs() <= 1e-12);
    assert!((dot(v(1.0, 0.0, 0.0), v(0.0, 1.0, 0.0))).abs() <= 1e-12);
}

#[test]
fn vec_cross() {
    assert_eq!(cross(v(1.0, 0.0, 0.0), v(0.0, 1.0, 0.0)), v(0.0, 0.0, 1.0));
    assert_eq!(cross(v(0.0, 1.0, 0.0), v(1.0, 0.0, 0.0)), v(0.0, 0.0, -1.0));
    assert_eq!(cross(v(1.0, 0.0, 0.0), v(2.0, 0.0, 0.0)), Vec3::ZERO);
}

#[test]
fn vec_length() {
    assert!((length(v(0.0, 3.0, 4.0)) - 5.0).abs() <= 1e-12);
    assert_eq!(length(Vec3::ZERO), 0.0);
    assert!((length_sq(v(0.0, 3.0, 4.0)) - 25.0).abs() <= 1e-12);
}

#[test]
fn vec_distance() {
    assert!((distance(v(0.0, 0.0, 0.0), v(3.0, 4.0, 0.0)) - 5.0).abs() <= 1e-12);
}

#[test]
fn vec_normalize() {
    assert_vec(normalize(v(10.0, 0.0, 0.0)), 1.0, 0.0, 0.0, 1e-12);
    assert_eq!(normalize(Vec3::ZERO), Vec3::ZERO);
    // Sub-epsilon input pins the conduit EPSILON=1e-7 guard.
    assert_eq!(normalize(v(1e-8, 0.0, 0.0)), Vec3::ZERO);
}

#[test]
fn vec_mean() {
    assert_vec(
        mean(&[v(1.0, 2.0, 3.0), v(3.0, 4.0, 5.0)]),
        2.0,
        3.0,
        4.0,
        1e-12,
    );
    assert_eq!(mean(&[]), Vec3::ZERO);
    assert_eq!(mean(&[v(5.0, 5.0, 5.0)]), v(5.0, 5.0, 5.0));
}

#[test]
fn vec_closest_midpoint() {
    let r = closest_on_segment(v(5.0, 5.0, 0.0), v(0.0, 2.0, 0.0), v(10.0, 2.0, 0.0));
    assert_vec(r.point, 5.0, 2.0, 0.0, 1e-9);
    assert!((r.t - 0.5).abs() <= 1e-9);
    assert!((r.distance - 3.0).abs() <= 1e-9);
}

#[test]
fn vec_closest_clamped_ends() {
    let r = closest_on_segment(v(-5.0, 2.0, 0.0), v(0.0, 2.0, 0.0), v(10.0, 2.0, 0.0));
    assert_eq!(r.point, v(0.0, 2.0, 0.0));
    assert_eq!(r.t, 0.0);
    let r = closest_on_segment(v(15.0, 2.0, 0.0), v(0.0, 2.0, 0.0), v(10.0, 2.0, 0.0));
    assert_eq!(r.point, v(10.0, 2.0, 0.0));
    assert_eq!(r.t, 1.0);
}

#[test]
fn vec_closest_degenerate() {
    let r = closest_on_segment(v(5.0, 5.0, 0.0), v(1.0, 1.0, 1.0), v(1.0, 1.0, 1.0));
    assert_eq!(r.point, v(1.0, 1.0, 1.0));
    assert_eq!(r.t, 0.0);
    assert!((r.distance - 5.744_562_646_538_029).abs() <= 1e-9);
}

#[test]
fn vec_closest_exact_start() {
    let r = closest_on_segment(v(1.0, 1.0, 1.0), v(1.0, 1.0, 1.0), v(4.0, 5.0, 6.0));
    assert_eq!(r.point, v(1.0, 1.0, 1.0));
    assert_eq!(r.t, 0.0);
    assert_eq!(r.distance, 0.0);
}
