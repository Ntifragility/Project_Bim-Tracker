//! `routing.json` vec-helper vectors as Rust tests (vec re-exports).

use crate::{vec_add, vec_distance, vec_dot, vec_mean, vec_normalize, vec_sub, Vec3};

#[test]
fn vec_add_fn() {
    let r = vec_add(Vec3::new(1.0, 2.0, 3.0), Vec3::new(4.0, 5.0, 6.0));
    assert_eq!(r, Vec3::new(5.0, 7.0, 9.0));
}

#[test]
fn vec_sub_fn() {
    let r = vec_sub(Vec3::new(4.0, 5.0, 6.0), Vec3::new(1.0, 2.0, 3.0));
    assert_eq!(r, Vec3::new(3.0, 3.0, 3.0));
}

#[test]
fn vec_dot_fn() {
    assert!((vec_dot(Vec3::new(1.0, 2.0, 3.0), Vec3::new(4.0, -5.0, 6.0)) - 12.0).abs() <= 1e-12);
}

#[test]
fn vec_distance_fn() {
    assert!(
        (vec_distance(Vec3::new(0.0, 0.0, 0.0), Vec3::new(3.0, 4.0, 0.0)) - 5.0).abs() <= 1e-12
    );
}

#[test]
fn vec_normalize_zero() {
    assert_eq!(vec_normalize(Vec3::ZERO), Vec3::ZERO);
}

#[test]
fn vec_mean_fn() {
    let r = vec_mean(&[Vec3::new(1.0, 2.0, 3.0), Vec3::new(3.0, 4.0, 5.0)]);
    assert!((r.x - 2.0).abs() <= 1e-12 && (r.y - 3.0).abs() <= 1e-12 && (r.z - 4.0).abs() <= 1e-12);
}

#[test]
fn vec_mean_empty() {
    assert_eq!(vec_mean(&[]), Vec3::ZERO);
}
