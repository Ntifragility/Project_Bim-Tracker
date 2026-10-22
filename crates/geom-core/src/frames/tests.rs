//! `frames.json` acceptance vectors as Rust tests (task 3.1, spec R10).

use super::*;
use crate::vec3::Vec3;

fn v(x: f64, y: f64, z: f64) -> Vec3 {
    Vec3::new(x, y, z)
}

fn translate_10_0_neg5() -> Mat4 {
    Mat4 {
        // Row-major three.js Matrix4().set(1,0,0,10, 0,1,0,0, 0,0,1,-5, 0,0,0,1).
        m: [
            1.0, 0.0, 0.0, 10.0, //
            0.0, 1.0, 0.0, 0.0, //
            0.0, 0.0, 1.0, -5.0, //
            0.0, 0.0, 0.0, 1.0, //
        ],
    }
}

fn scale_2() -> Mat4 {
    Mat4 {
        m: [
            2.0, 0.0, 0.0, 0.0, //
            0.0, 2.0, 0.0, 0.0, //
            0.0, 0.0, 2.0, 0.0, //
            0.0, 0.0, 0.0, 1.0, //
        ],
    }
}

fn assert_vec(actual: Vec3, x: f64, y: f64, z: f64, tol: f64) {
    assert!((actual.x - x).abs() <= tol, "x: {} != {x}", actual.x);
    assert!((actual.y - y).abs() <= tol, "y: {} != {y}", actual.y);
    assert!((actual.z - z).abs() <= tol, "z: {} != {z}", actual.z);
}

#[test]
fn frames_identity_roundtrip() {
    let back = to_original(v(1.5, 0.75, 2.25), &Mat4::IDENTITY).expect("identity inverts");
    assert_vec(back, 1.5, -2.25, 0.75, 1e-12);
}

#[test]
fn frames_translated_to_scene() {
    assert_vec(
        to_scene(v(1.0, 2.0, 3.0), &translate_10_0_neg5()),
        11.0,
        3.0,
        -7.0,
        1e-9,
    );
}

#[test]
fn frames_translated_to_original() {
    let back = to_original(v(11.0, 3.0, -7.0), &translate_10_0_neg5()).expect("inverts");
    assert_vec(back, 1.0, 2.0, 3.0, 1e-9);
}

#[test]
fn frames_axis_swap() {
    // ifc (1,2,3) -> three (1,3,-2); three (1,3,-2) -> ifc (1,2,3).
    assert_vec(
        to_scene(v(1.0, 2.0, 3.0), &Mat4::IDENTITY),
        1.0,
        3.0,
        -2.0,
        1e-12,
    );
    let back = to_original(v(1.0, 3.0, -2.0), &Mat4::IDENTITY).expect("inverts");
    assert_vec(back, 1.0, 2.0, 3.0, 1e-12);
}

#[test]
fn frames_roundtrip_translated() {
    let original = v(-4.0, 0.5, 12.0);
    let scene = to_scene(original, &translate_10_0_neg5());
    let back = to_original(scene, &translate_10_0_neg5()).expect("inverts");
    assert_vec(back, -4.0, 0.5, 12.0, 1e-9);
}

#[test]
fn frames_singular_base() {
    assert_eq!(to_original(v(1.0, 2.0, 3.0), &Mat4 { m: [0.0; 16] }), None);
}

#[test]
fn frames_diagonal_scale() {
    let back = to_original(v(4.0, 4.0, -4.0), &scale_2()).expect("inverts");
    assert_vec(back, 2.0, 2.0, 2.0, 1e-9);
}
