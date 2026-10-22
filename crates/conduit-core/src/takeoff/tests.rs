//! Takeoff vectors as Rust tests (task 4.1, spec R7-R8).

use super::*;
use crate::network::{add_node, append_to_run, create_network, start_run};

fn draw(stick: f64, points: &[[f64; 3]], size: &str, system: &str) -> Network {
    let net = create_network(stick);
    let (net, first) = add_node(&net, points[0][0], points[0][1], points[0][2]);
    let (net, run) = start_run(&net, size, system, "", &first).unwrap();
    let mut net = net;
    for p in &points[1..] {
        let (n, id) = add_node(&net, p[0], p[1], p[2]);
        net = append_to_run(&n, &run, &id).unwrap();
    }
    net
}

#[test]
fn takeoff_straight() {
    let net = draw(3.0, &[[0.0, 0.0, 0.0], [10.0, 0.0, 0.0]], "3/4\"", "");
    let t = compute_takeoff(&net);
    assert!((t.totals.length - 10.0).abs() < 1e-9);
    assert_eq!((t.runs[0].sticks, t.totals.sticks), (4, 4));
}

#[test]
fn takeoff_exact_and_25ft() {
    let t = compute_takeoff(&draw(
        3.048,
        &[[0.0, 0.0, 0.0], [3.048, 0.0, 0.0]],
        "3/4\"",
        "",
    ));
    assert_eq!(t.totals.sticks, 1);
    let t = compute_takeoff(&draw(
        3.048,
        &[[0.0, 0.0, 0.0], [7.62, 0.0, 0.0]],
        "3/4\"",
        "",
    ));
    assert_eq!(t.runs[0].sticks, 3);
}

#[test]
fn takeoff_per_run_sum_not_total() {
    let mut net = draw(3.0, &[[0.0, 0.0, 0.0], [7.0, 0.0, 0.0]], "3/4\"", "");
    // second run
    let (n, first) = add_node(&net, 0.0, 5.0, 0.0);
    net = n;
    let (n, run) = start_run(&net, "3/4\"", "", "", &first).unwrap();
    net = n;
    let (n, id) = add_node(&net, 5.0, 5.0, 0.0);
    net = append_to_run(&n, &run, &id).unwrap();
    let t = compute_takeoff(&net);
    assert_eq!(t.totals.sticks, 5); // 3 + 2, not ceil(12/3) = 4
    assert_eq!(t.by_size.len(), 1);
    assert!((t.by_size[0].length - 12.0).abs() < 1e-9);
}

#[test]
fn takeoff_grouping_and_fields() {
    let net = draw(3.0, &[[0.0, 0.0, 0.0], [6.0, 0.0, 0.0]], "3/4\"", "Power");
    let t = compute_takeoff(&net);
    assert_eq!(t.by_size.len(), 1);
    assert_eq!(
        (t.runs[0].size.as_str(), t.runs[0].system.as_str()),
        ("3/4\"", "Power")
    );
    assert_eq!(t.runs[0].points, 2);
}

#[test]
fn takeoff_zero_and_unknown() {
    let net = create_network(3.0);
    let t = compute_run_takeoff(&net, "r99");
    assert_eq!((t.length, t.sticks, t.points), (0.0, 0, 0));
}

#[test]
fn size_to_mm_table() {
    let close = |a: Option<f64>, b: f64| (a.unwrap() - b).abs() < 1e-9;
    assert!(close(size_to_mm("3/4\""), 19.05));
    assert!(close(size_to_mm("1\""), 25.4));
    assert_eq!(size_to_mm("25mm"), Some(25.0));
    assert!(close(size_to_mm("1 1/2\""), 38.1));
    assert_eq!(size_to_mm("foo"), None);
    assert_eq!(size_to_mm("½\""), None); // unicode fraction: TS edge normalizes
    assert!(size_to_mm("3/4\"").unwrap() < size_to_mm("1\"").unwrap());
    assert!(size_to_mm("25mm").unwrap() < size_to_mm("2\"").unwrap());
}
