//! `routing.json` vec + centerline vectors (13) as Rust tests.

use super::super::{derive_centerline, Vec3};

fn v(x: f64, y: f64, z: f64) -> Vec3 {
    Vec3::new(x, y, z)
}

fn close(a: f64, b: f64, tol: f64) -> bool {
    (a - b).abs() <= tol
}

#[test]
fn vec_centerline_rotated_cloud() {
    let pts = vec![
        v(-1.75, -2.25, -0.1),
        v(-1.75, -2.25, 0.1),
        v(-2.25, -1.75, -0.1),
        v(-2.25, -1.75, 0.1),
        v(1.75, 2.25, -0.1),
        v(1.75, 2.25, 0.1),
        v(2.25, 1.75, -0.1),
        v(2.25, 1.75, 0.1),
    ];
    let c = derive_centerline(&pts, 1e-4);
    assert!(c.valid);
    assert!(close(c.length, 5.656854249492381, 0.05));
    assert!(c.confidence > 0.95);
    assert!(close(c.centroid.x, 0.0, 0.05));
    assert!(close(c.centroid.y, 0.0, 0.05));
    assert!(close(c.centroid.z, 0.0, 0.05));
}

#[test]
fn vec_centerline_two_point() {
    let c = derive_centerline(&[v(0.0, 0.0, 0.0), v(4.0, 0.0, 0.0)], 1e-4);
    assert!(c.valid);
    assert!(close(c.length, 4.0, 1e-9));
    assert!(close(c.confidence, 1.0, 1e-9));
    assert!(close(c.start.x, 0.0, 1e-9) && close(c.end.x, 4.0, 1e-9));
}

#[test]
fn vec_centerline_vertical() {
    let c = derive_centerline(&[v(0.0, 0.0, 0.0), v(0.0, 0.0, 5.0)], 1e-4);
    assert!(c.valid);
    assert!(close(c.length, 5.0, 1e-9));
    assert!(close(c.confidence, 1.0, 1e-9));
}

#[test]
fn vec_centerline_empty() {
    let c = derive_centerline(&[], 1e-4);
    assert!(!c.valid);
    assert_eq!(c.reason, "insufficient-vertices");
}

#[test]
fn vec_centerline_single_point() {
    let c = derive_centerline(&[v(1.0, 2.0, 3.0)], 1e-4);
    assert!(!c.valid);
    assert_eq!(c.reason, "insufficient-vertices");
}

#[test]
fn vec_centerline_coincident() {
    let c = derive_centerline(&[v(1.0, 1.0, 1.0), v(1.0, 1.0, 1.0)], 1e-4);
    assert!(!c.valid);
    assert_eq!(c.reason, "centerline-too-short");
    assert!(close(c.length, 0.0, 1e-12));
}

#[test]
fn vec_centerline_minimum_length_option() {
    let c = derive_centerline(&[v(0.0, 0.0, 0.0), v(4.0, 0.0, 0.0)], 10.0);
    assert!(!c.valid);
    assert_eq!(c.reason, "centerline-too-short");
    assert!(close(c.length, 4.0, 1e-12));
}
