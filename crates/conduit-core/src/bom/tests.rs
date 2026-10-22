//! `bom-engine.json` vectors as Rust tests (task 4.4, spec R1-R8).

use super::*;
use crate::network::{add_node, append_to_run, create_network, start_run};

fn draw(size: &str, points: &[[f64; 3]]) -> Network {
    let net = create_network(3.048);
    let (net, first) = add_node(&net, points[0][0], points[0][1], points[0][2]);
    let (net, run) = start_run(&net, size, "Power", "", &first).unwrap();
    let mut net = net;
    for p in &points[1..] {
        let (n, id) = add_node(&net, p[0], p[1], p[2]);
        net = append_to_run(&n, &run, &id).unwrap();
    }
    net
}

#[test]
fn bom_ffd_cases() {
    let p = optimize_stick_cutting(&[1.4, 1.4], 3.048, KERF_WASTE_M);
    assert_eq!(p.sticks_needed, 1);
    assert!((p.total_length_m - 2.8).abs() < 1e-9);
    assert!((p.sticks[0].waste_m - 0.245).abs() < 1e-3);
    let p = optimize_stick_cutting(&[1.6, 1.6, 1.6], 3.048, KERF_WASTE_M);
    assert_eq!(p.sticks_needed, 3);
    assert!((p.total_waste_m - 4.344).abs() < 1e-3);
    let p = optimize_stick_cutting(&[7.0], 3.048, KERF_WASTE_M);
    assert_eq!(p.sticks_needed, 3);
    assert!((p.total_waste_m - 2.144).abs() < 1e-3);
    let p = optimize_stick_cutting(&[], 3.048, KERF_WASTE_M);
    assert_eq!((p.sticks_needed, p.waste_pct), (0, 0.0));
    assert!(p.sticks.is_empty());
}

#[test]
fn bom_l_run_hardware() {
    let net = draw(
        "3/4\"",
        &[[0.0, 0.0, 0.0], [3.0, 0.0, 0.0], [3.0, 5.0, 0.0]],
    );
    let b = compute_detailed_bom(&net, &BomOptions::default());
    assert_eq!(b.totals.runs, 1);
    assert!((b.totals.length_m - 8.0).abs() < 1e-9);
    assert_eq!(b.totals.sticks, 3);
    assert_eq!(b.totals.couplings, 2);
    assert_eq!(b.totals.box_connectors, 2);
    assert_eq!(b.totals.elbows90, 1);
    assert_eq!(b.totals.pull_boxes, 0);
    assert!(b.runs[0].nec_compliant);
}

#[test]
fn bom_violation_and_straps_and_waste() {
    let net = draw(
        "1\"",
        &[
            [0.0, 0.0, 0.0],
            [2.0, 0.0, 0.0],
            [2.0, 2.0, 0.0],
            [4.0, 2.0, 0.0],
            [4.0, 0.0, 0.0],
            [6.0, 0.0, 0.0],
            [6.0, 2.0, 0.0],
        ],
    );
    let b = compute_detailed_bom(&net, &BomOptions::default());
    assert!(!b.runs[0].nec_compliant);
    assert!(b.runs[0].cumulative_bends_deg > 360.0);
    assert!(b.totals.pull_boxes >= 1);
    let net = draw("1\"", &[[0.0, 0.0, 0.0], [6.0, 0.0, 0.0]]);
    let b = compute_detailed_bom(&net, &BomOptions::default());
    assert_eq!(b.totals.straps, 3);
    let net = draw("3/4\"", &[[0.0, 0.0, 0.0], [8.0, 0.0, 0.0]]);
    let b = compute_detailed_bom(
        &net,
        &BomOptions {
            stock_length_m: 3.048,
            waste_factor_pct: 25.0,
        },
    );
    assert_eq!(b.totals.sticks, 4);
}
