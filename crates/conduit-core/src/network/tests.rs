//! `network.json` vectors as Rust tests (task 4.1, spec R1-R6 + R11).

use super::*;
use crate::takeoff::compute_takeoff;

fn draw(stick: f64, points: &[[f64; 3]]) -> (Network, String) {
    let net = create_network(stick);
    let (net, first) = add_node(&net, points[0][0], points[0][1], points[0][2]);
    let (net, run) = start_run(&net, "3/4\"", "", "", &first).unwrap();
    let mut net = net;
    for p in &points[1..] {
        let (n, id) = add_node(&net, p[0], p[1], p[2]);
        net = append_to_run(&n, &run, &id).unwrap();
    }
    (net, run)
}

#[test]
fn net_create_add_node() {
    let net = create_network(3.0);
    assert_eq!(net.version, NETWORK_VERSION);
    assert_eq!(net.stick_length, 3.0);
    let (next, id) = add_node(&net, 1.0, 2.0, 3.0);
    assert!(id.starts_with('n'));
    assert_eq!(next.nodes.len(), 1);
    assert_eq!(next.nodes[0].x, 1.0);
}

#[test]
fn net_start_run() {
    let net = create_network(3.0);
    let (net, first) = add_node(&net, 0.0, 0.0, 0.0);
    let (net, second) = add_node(&net, 1.0, 0.0, 0.0);
    let (next, run) = start_run(&net, "3/4\"", "Power", "", &first).unwrap();
    assert!(run.starts_with('r'));
    let r = next.runs.iter().find(|r| r.id == run).unwrap();
    assert_eq!(r.name, run.to_uppercase());
    assert_eq!(next.nodes.len(), 2);
    assert!(start_run(&net, "3/4\"", "", "", "n99").is_err());
    let _ = second;
}

#[test]
fn net_append() {
    let (net, run) = draw(3.0, &[[0.0, 0.0, 0.0], [1.0, 0.0, 0.0]]);
    assert!(append_to_run(&net, "r99", &net.nodes[0].id).is_err());
    assert!(append_to_run(&net, &run, "n99").is_err());
    // dup-last no-op: same content, and legacy returns the identical object
    let before = net
        .runs
        .iter()
        .find(|r| r.id == run)
        .unwrap()
        .node_ids
        .len();
    let last = net
        .runs
        .iter()
        .find(|r| r.id == run)
        .unwrap()
        .node_ids
        .last()
        .unwrap()
        .clone();
    let same = append_to_run(&net, &run, &last).unwrap();
    assert_eq!(
        same.runs
            .iter()
            .find(|r| r.id == run)
            .unwrap()
            .node_ids
            .len(),
        before
    );
    // append new
    let (net2, extra) = add_node(&net, 2.0, 0.0, 0.0);
    let next = append_to_run(&net2, &run, &extra).unwrap();
    assert_eq!(
        next.runs
            .iter()
            .find(|r| r.id == run)
            .unwrap()
            .node_ids
            .len(),
        3
    );
}

#[test]
fn net_split_segment() {
    let (net, run) = draw(3.0, &[[0.0, 0.0, 0.0], [10.0, 0.0, 0.0]]);
    let (split, _) = split_segment(&net, &run, 0, 5.0, 0.0, 0.0).unwrap();
    let r = split.runs.iter().find(|r| r.id == run).unwrap();
    assert_eq!(r.node_ids.len(), 3);
    assert!(split_segment(&net, &run, 5, 0.0, 0.0, 0.0).is_err());
}

#[test]
fn net_remove_delete_drop() {
    let (net, run) = draw(3.0, &[[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [2.0, 0.0, 0.0]]);
    let after = remove_last_point(&net, &run);
    assert_eq!(after.nodes.len(), 2);
    let gone = delete_run(&after, &run);
    assert!(gone.nodes.is_empty() && gone.runs.is_empty());
    // single-point run drops entirely
    let solo = create_network(3.0);
    let (solo, n1) = add_node(&solo, 0.0, 0.0, 0.0);
    let (solo, _) = start_run(&solo, "3/4\"", "", "", &n1).unwrap();
    let dropped = drop_incomplete_runs(&solo);
    assert!(dropped.runs.is_empty() && dropped.nodes.is_empty());
}

#[test]
fn net_update_and_stick() {
    let (net, run) = draw(3.0, &[[0.0, 0.0, 0.0], [1.0, 0.0, 0.0]]);
    let next = update_run(&net, &run, Some("New"), Some("1\""), Some("S"));
    let r = next.runs.iter().find(|r| r.id == run).unwrap();
    assert_eq!(
        (r.name.as_str(), r.size.as_str(), r.system.as_str()),
        ("New", "1\"", "S")
    );
    assert_eq!(
        update_run(&net, "r99", Some("X"), None, None).runs.len(),
        net.runs.len()
    );
    assert_eq!(set_stick_length(&net, 4.0).unwrap().stick_length, 4.0);
    assert!(set_stick_length(&net, 0.0).is_err());
}

#[test]
fn net_validate() {
    let (net, run) = draw(3.0, &[[0.0, 0.0, 0.0], [10.0, 0.0, 0.0]]);
    let file = NetworkFile {
        version: 1,
        frame: "ifc-original".into(),
        units: "m".into(),
        stick_length: net.stick_length,
        nodes: net.nodes.clone(),
        runs: net.runs.clone(),
        next_id: 2,
    };
    let v = validate_network(&file).unwrap();
    assert!(v.next_id >= 3);
    assert!(compute_takeoff(&v).runs[0].sticks == 4);
    let _ = run;
    assert!(validate_network(&NetworkFile {
        version: 99,
        ..file.clone()
    })
    .is_err());
    let mut bad = file.clone();
    bad.runs[0].node_ids = vec!["n99".into()];
    assert!(validate_network(&bad).is_err());
}
