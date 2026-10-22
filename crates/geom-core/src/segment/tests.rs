//! `segment.json` acceptance vectors as Rust tests (task 3.1, spec R4-R8).

use super::*;
use crate::vec3::Vec3;

fn v(x: f64, y: f64, z: f64) -> Vec3 {
    Vec3::new(x, y, z)
}

#[test]
fn segment_angles() {
    assert!((angle_between(v(1.0, 0.0, 0.0), v(0.0, 1.0, 0.0)) - 90.0).abs() <= 1e-9);
    assert!((angle_between(v(1.0, 0.0, 0.0), v(-1.0, 0.0, 0.0)) - 180.0).abs() <= 1e-9);
    assert!((angle_between(v(0.0, 0.0, 1.0), v(0.0, 0.0, 1.0))).abs() <= 1e-9);
    assert_eq!(angle_between(Vec3::ZERO, v(1.0, 0.0, 0.0)), 0.0);
}

#[test]
fn segment_ortho_axis_wins() {
    // Mirrors the conduit takeoff.json constrain-ortho-axis case verbatim.
    let r = constrain_ortho(v(0.0, 0.0, 0.0), v(3.0, 1.0, 0.0), 0.0);
    assert!((r.x - 3.0).abs() <= 1e-9, "x: {}", r.x);
    assert!((r.y).abs() <= 1e-9, "y: {}", r.y);
    assert!((r.z).abs() <= 1e-9, "z: {}", r.z);
}

#[test]
fn segment_ortho_tie_keeps_x() {
    // indexOf(max) tie-break parity: |dx| == |dy| keeps X.
    assert_eq!(
        constrain_ortho(v(0.0, 0.0, 5.0), v(1.0, 1.0, 5.0), 0.0),
        v(1.0, 0.0, 5.0)
    );
}

#[test]
fn segment_ortho_rotated_grid() {
    let r = constrain_ortho(v(0.0, 0.0, 0.0), v(3.0, 1.0, 0.0), 45.0);
    assert!((r.x - 2.0000000000000004).abs() <= 1e-9, "x: {}", r.x);
    assert!((r.y - 2.0).abs() <= 1e-9, "y: {}", r.y);
    assert!((r.z).abs() <= 1e-9, "z: {}", r.z);
}

#[test]
fn segment_plan_angle() {
    assert!((plan_angle_of(v(0.0, 0.0, 0.0), v(1.0, 1.0, 0.0)) - 45.0).abs() <= 1e-9);
    assert_eq!(plan_angle_of(v(0.0, 0.0, 0.0), v(0.0, 0.0, 5.0)), 0.0);
}

#[test]
fn segment_is_vertical() {
    assert!(is_vertical(v(0.0, 0.0, 0.0), v(0.01, 0.01, 10.0), 10.0));
    assert!(!is_vertical(v(0.0, 0.0, 0.0), v(10.0, 0.0, 0.01), 10.0));
    assert!(!is_vertical(v(1.0, 1.0, 1.0), v(1.0, 1.0, 1.0), 10.0));
}
