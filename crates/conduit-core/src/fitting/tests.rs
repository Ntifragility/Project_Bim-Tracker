//! `fitting-engine.json` vectors as Rust tests (task 4.3, spec R1-R8).

use super::*;
use geom_core::Vec3;

fn v(x: f64, y: f64, z: f64) -> Vec3 {
    Vec3::new(x, y, z)
}

#[test]
fn fitting_table() {
    assert_eq!(NEC_BEND_TABLE.len(), 10);
    assert_eq!(NEC_BEND_TABLE[0].trade_size, "1/2\"");
    assert_eq!(NEC_BEND_TABLE[9].trade_size, "4\"");
    let q = |s: &str| nec_bend_radius_m(&NecQuery::TradeSize(s.into()));
    assert!((q("1/2\"") - 0.1016).abs() < 1e-9);
    assert!((q("½\"") - 0.1016).abs() < 1e-9);
    assert!((q("3/4\"") - 0.1143).abs() < 1e-9);
    assert!((q("¾\"") - 0.1143).abs() < 1e-9);
    assert!((q("1\"") - 0.146).abs() < 1e-9);
    assert!((q("2\"") - 0.2413).abs() < 1e-9);
    assert!((q("4\"") - 0.4064).abs() < 1e-9);
    assert!((q("5\"") - 0.1143).abs() < 1e-9); // fallback
    assert!((q("1-1/2\"") - 0.2095).abs() < 1e-9);
    assert!((nec_bend_radius_m(&NecQuery::Mm(19.05)) - 0.1143).abs() < 1e-9);
}

#[test]
fn fitting_bend_angles() {
    assert_eq!(
        bend_angle(v(0.0, 0.0, 0.0), v(5.0, 0.0, 0.0), v(10.0, 0.0, 0.0)),
        0.0
    );
    assert!((bend_angle(v(0.0, 0.0, 0.0), v(5.0, 0.0, 0.0), v(5.0, 0.0, 5.0)) - 90.0).abs() < 1e-9);
    assert!(
        (bend_angle(
            v(0.0, 0.0, 0.0),
            v(5.0, 0.0, 0.0),
            v(8.535533905932738, 0.0, 3.5355339059327373)
        ) - 45.0)
            .abs()
            < 0.01
    );
    assert_eq!(
        bend_angle(v(5.0, 0.0, 0.0), v(5.0, 0.0, 0.0), v(5.0, 0.0, 5.0)),
        0.0
    );
}

#[test]
fn fitting_elbow_90() {
    let e = solve_elbow(
        v(0.0, 2.8, 0.0),
        v(5.0, 2.8, 0.0),
        v(5.0, 2.8, 5.0),
        0.1143,
        8,
    );
    assert!(e.valid && !e.straight);
    assert!((e.angle_deg - 90.0).abs() < 1e-9);
    assert!((e.tangent_dist - 0.1143).abs() < 1e-4);
    assert!((e.tangent_start.x - 4.8857).abs() < 1e-4);
    assert!((e.tangent_end.z - 0.1143).abs() < 1e-4);
    assert!((e.center.x - 4.8857).abs() < 1e-4 && (e.center.z - 0.1143).abs() < 1e-4);
    assert_eq!(e.arc_points.len(), 9);
    assert_eq!(e.arc_points[0], e.tangent_start);
    assert_eq!(e.arc_points[8], e.tangent_end);
}

#[test]
fn fitting_elbow_straight_clamped() {
    let s = solve_elbow(
        v(0.0, 0.0, 0.0),
        v(5.0, 0.0, 0.0),
        v(10.0, 0.0, 0.0),
        0.1143,
        8,
    );
    assert!(!s.valid && s.straight && s.angle_deg == 0.0);
    let c = solve_elbow(
        v(0.0, 0.0, 0.0),
        v(0.05, 0.0, 0.0),
        v(0.05, 0.0, 1.0),
        0.5,
        8,
    );
    assert!((c.tangent_dist - 0.0475).abs() < 1e-4);
    assert!(c.tangent_dist < 0.5 * (90.0f64 * 0.5 * DEG_TO_RAD).tan());
}

#[test]
fn fitting_run_bends() {
    let ok = analyze_run_bends(&[
        v(0.0, 0.0, 0.0),
        v(5.0, 0.0, 0.0),
        v(5.0, 0.0, 5.0),
        v(10.0, 0.0, 5.0),
    ]);
    assert_eq!(
        (ok.total_deg, ok.fittings, ok.exceeds_nec360),
        (180.0, 2, false)
    );
    let over = analyze_run_bends(&[
        v(0.0, 0.0, 0.0),
        v(5.0, 0.0, 0.0),
        v(5.0, 0.0, 5.0),
        v(10.0, 0.0, 5.0),
        v(10.0, 0.0, 0.0),
        v(15.0, 0.0, 0.0),
        v(15.0, 0.0, 5.0),
    ]);
    assert_eq!(
        (over.total_deg, over.fittings, over.exceeds_nec360),
        (450.0, 5, true)
    );
    let short = analyze_run_bends(&[v(0.0, 0.0, 0.0), v(5.0, 0.0, 0.0)]);
    assert_eq!(
        (short.total_deg, short.fittings, short.exceeds_nec360),
        (0.0, 0, false)
    );
}

#[test]
fn fitting_riser() {
    let r = solve_auto_riser(v(3.0, 2.8, 4.0), 4.2, true);
    assert_eq!(r.len(), 2);
    assert!(r[1].is_riser && (r[1].height_delta - 1.4).abs() < 1e-9);
    assert_eq!(r[1].point, v(3.0, 4.2, 4.0));
    let z = solve_auto_riser(v(1.0, 2.0, 3.0), 5.0, false);
    assert_eq!(z[1].point, v(1.0, 2.0, 5.0));
    let noop = solve_auto_riser(v(3.0, 2.8, 4.0), 2.805, true);
    assert_eq!(noop.len(), 1);
}
