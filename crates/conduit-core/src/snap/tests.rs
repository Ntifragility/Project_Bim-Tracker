//! `snap-engine.json` + `takeoff-io-engine.json` vectors as Rust tests
//! (task 4.2, spec R1-R8; task 4.5, spec R1-R6).

use super::*;
use geom_core::Vec3;

fn v(x: f64, y: f64, z: f64) -> Vec3 {
    Vec3::new(x, y, z)
}

fn node(id: &str, x: f64, y: f64, z: f64) -> SnapNode {
    SnapNode {
        id: id.into(),
        point: v(x, y, z),
    }
}

fn seg(id: &str, a: [f64; 3], b: [f64; 3]) -> SnapSegment {
    SnapSegment {
        id: id.into(),
        start: v(a[0], a[1], a[2]),
        end: v(b[0], b[1], b[2]),
    }
}

#[test]
fn snap_config_defaults() {
    let c = SnapConfig::default();
    assert_eq!((c.tolerance_m, c.angular_tolerance_deg), (0.25, 4.5));
    assert!(c.polar_enabled && !c.ortho_enabled);
    assert!(c.midpoint_enabled && c.endpoint_enabled && c.segment_enabled);
}

#[test]
fn snap_nodes_hit_miss() {
    let nodes = vec![node("n1", 0.0, 2.8, 0.0), node("n2", 5.0, 2.8, 5.0)];
    let hit = snap_to_nodes(v(0.1, 2.8, 0.05), &nodes, 0.25).unwrap();
    assert_eq!(hit.snap_type, SnapType::Endpoint);
    assert_eq!(hit.target_id.as_deref(), Some("n1"));
    assert_eq!(hit.point, v(0.0, 2.8, 0.0));
    assert!(snap_to_nodes(v(2.5, 2.8, 2.5), &nodes, 0.25).is_none());
}

#[test]
fn snap_segments_mid_plain() {
    let segs = vec![seg("s1", [0.0, 2.8, 0.0], [10.0, 2.8, 0.0])];
    let mid = snap_to_segments(v(4.95, 2.85, 0.05), &segs, 0.25, 0.08).unwrap();
    assert_eq!(mid.snap_type, SnapType::Midpoint);
    assert_eq!(mid.t, Some(0.5));
    assert_eq!(mid.point, v(5.0, 2.8, 0.0));
    let plain = snap_to_segments(v(2.0, 2.85, 0.05), &segs, 0.25, 0.08).unwrap();
    assert_eq!(plain.snap_type, SnapType::Segment);
    assert!((plain.t.unwrap() - 0.2).abs() < 1e-4);
}

#[test]
fn snap_closest_delegates() {
    let hit = closest_on_segment(v(5.0, 5.0, 0.0), v(0.0, 2.0, 0.0), v(10.0, 2.0, 0.0));
    assert!((hit.t - 0.5).abs() < 1e-12);
    assert!((hit.distance - 3.0).abs() < 1e-12);
}

#[test]
fn snap_polar_cases() {
    let hit = snap_polar_angle(
        v(0.0, 2.8, 0.0),
        v(3.59669903089038, 2.8, 3.473290233548544),
        &[0.0, 45.0, 90.0, 135.0, 180.0, 225.0, 270.0, 315.0, 360.0],
        5.0,
        true,
    )
    .unwrap();
    assert_eq!(hit.snap_type, SnapType::PolarAngle);
    assert_eq!(hit.angle_deg, Some(45.0));
    assert!((hit.point.x - 3.5355339059327378).abs() < 1e-4);
    assert!(snap_polar_angle(
        v(0.0, 2.8, 0.0),
        v(4.330126018922193, 2.8, 2.5),
        &[0.0, 45.0, 90.0],
        4.0,
        true
    )
    .is_none());
    let zup =
        snap_polar_angle(v(0.0, 0.0, 0.0), v(0.1, 4.0, 0.0), &[0.0, 90.0], 5.0, false).unwrap();
    assert_eq!((zup.angle_deg, zup.guide_axis), (Some(90.0), Some('Y')));
}

#[test]
fn snap_ortho_axes() {
    let x = snap_ortho_3d(v(1.0, 2.0, 3.0), v(5.0, 2.1, 3.05));
    assert_eq!((x.guide_axis, x.point), (Some('X'), v(5.0, 2.0, 3.0)));
    let y = snap_ortho_3d(v(1.0, 2.0, 3.0), v(1.05, 6.5, 2.95));
    assert_eq!((y.guide_axis, y.point), (Some('Y'), v(1.0, 6.5, 3.0)));
    let z = snap_ortho_3d(v(1.0, 2.0, 3.0), v(0.95, 2.05, 9.0));
    assert_eq!((z.guide_axis, z.point), (Some('Z'), v(1.0, 2.0, 9.0)));
    // tie X/Y -> Y first (legacy max === absY chain)
    let tie = snap_ortho_3d(v(1.0, 2.0, 3.0), v(8.0, 9.0, 3.0));
    assert_eq!(tie.guide_axis, Some('Y'));
}

#[test]
fn snap_raycast_cases() {
    let hit = raycast_elevation_plane(v(0.0, 10.0, 0.0), v(0.0, -1.0, 0.0), 2.8, true, None);
    assert_eq!(hit, v(0.0, 2.8, 0.0));
    let fb = raycast_elevation_plane(
        v(0.0, 10.0, 0.0),
        v(0.0, 0.0, 1.0),
        2.8,
        true,
        Some(v(0.0, 2.8, 20.0)),
    );
    assert!((fb.y - 2.8).abs() < 1e-12);
    let zup = raycast_elevation_plane(v(1.0, 2.0, 10.0), v(0.0, 0.0, -1.0), 5.0, false, None);
    assert!((zup.z - 5.0).abs() < 1e-12);
}

#[test]
fn snap_resolve_priority() {
    let cfg = SnapConfig {
        tolerance_m: 0.3,
        angular_tolerance_deg: 5.0,
        polar_enabled: true,
        ortho_enabled: false,
        ..Default::default()
    };
    let nodes = vec![node("node_target", 2.0, 2.8, 2.0)];
    let segs = vec![seg("seg_target", [0.0, 2.8, 10.0], [10.0, 2.8, 10.0])];
    let last = Some(v(0.0, 2.8, 0.0));
    let ep = resolve(v(2.05, 2.8, 1.95), &cfg, last, &nodes, &segs);
    assert_eq!(
        (ep.snap_type, ep.target_id.as_deref()),
        (SnapType::Endpoint, Some("node_target"))
    );
    let mid = resolve(v(5.02, 2.8, 9.98), &cfg, last, &nodes, &segs);
    assert_eq!(
        (mid.snap_type, mid.target_id.as_deref()),
        (SnapType::Midpoint, Some("seg_target"))
    );
    let pol = resolve(v(0.1, 2.8, 4.0), &cfg, last, &nodes, &segs);
    assert_eq!(pol.snap_type, SnapType::PolarAngle);
    assert_eq!(pol.angle_deg, Some(90.0));
    // workplane raw when everything disabled
    let off = SnapConfig {
        polar_enabled: false,
        ortho_enabled: false,
        ..Default::default()
    };
    let raw = resolve(v(12.34, 2.8, 56.78), &off, last, &[], &[]);
    assert_eq!(raw.snap_type, SnapType::Workplane);
    assert_eq!((raw.distance, raw.point), (0.0, v(12.34, 2.8, 56.78)));
    // ortho when enabled
    let ocfg = SnapConfig {
        ortho_enabled: true,
        polar_enabled: false,
        ..Default::default()
    };
    let ortho = resolve(v(5.0, 1.0, 0.0), &ocfg, Some(v(0.0, 0.0, 0.0)), &[], &[]);
    assert_eq!(ortho.snap_type, SnapType::Ortho);
}

// --- task 4.5: `takeoff-io-engine.json` find_snap vectors (spec R1-R6) ---

use crate::network::{add_node, append_to_run, create_network, start_run, Network};

fn line_net(nodes: &[[f64; 3]], run: &str) -> (Network, String) {
    let mut net = create_network(3.048);
    let mut ids = Vec::new();
    for p in nodes {
        let (n, id) = add_node(&net, p[0], p[1], p[2]);
        net = n;
        ids.push(id);
    }
    let first = ids[0].clone();
    let (n, run_id) = start_run(&net, "3/4\"", "", run, &first).unwrap();
    net = n;
    for id in ids.iter().skip(1) {
        net = append_to_run(&net, &run_id, id).unwrap();
    }
    (net, run_id)
}

#[test]
fn findsnap_node_segment_miss() {
    let (net, run_id) = line_net(&[[0.0, 0.0, 0.0], [10.0, 0.0, 0.0]], "");
    let hit = find_snap(&net, v(0.001, 0.001, 0.0), 0.01).unwrap();
    assert!(matches!(hit, FindSnapHit::Node { ref node_id, .. } if node_id == "n1"));
    let hit = find_snap(&net, v(5.0, 0.005, 0.0), 0.01).unwrap();
    assert!(
        matches!(hit, FindSnapHit::Segment { run_id: ref got, index: 0, .. } if *got == run_id)
    );
    assert!(find_snap(&net, v(5.0, 1.0, 0.0), 0.01).is_none());
}

#[test]
fn findsnap_node_beats_closer_segment() {
    // Query ~0.0091 m from n1 but only ~0.001 m from the segment: the node
    // stage short-circuits, node wins (snap.js early return, spec R3).
    let (net, _) = line_net(&[[0.0, 0.0, 0.0], [10.0, 0.0, 0.0]], "");
    let hit = find_snap(&net, v(0.009, 0.001, 0.0), 0.01).unwrap();
    assert!(matches!(hit, FindSnapHit::Node { ref node_id, .. } if node_id == "n1"));
}

#[test]
fn findsnap_tie_keeps_first_node() {
    // Equidistant nodes: strictly-smaller comparison keeps the first
    // scanned (legacy `d < best.distance` parity, spec R2).
    let (net, _) = line_net(&[[0.0, 0.0, 0.0], [0.0, 0.0, 0.0]], "");
    let hit = find_snap(&net, v(0.005, 0.0, 0.0), 0.01).unwrap();
    assert!(matches!(hit, FindSnapHit::Node { ref node_id, .. } if node_id == "n1"));
}

#[test]
fn findsnap_dangling_ref_skipped() {
    // R6 deviation: legacy throws TypeError on the unresolvable pair; Rust
    // skips it. Unreachable after validate_network. The run's ONLY pair is
    // dangling here, so no segment can hit.
    let mut net = create_network(3.048);
    let (n, n1) = add_node(&net, 0.0, 0.0, 0.0);
    net = n;
    let (n, n2) = add_node(&net, 10.0, 0.0, 0.0);
    net = n;
    let (n, run_id) = start_run(&net, "3/4\"", "", "", &n1).unwrap();
    net = n;
    net = append_to_run(&net, &run_id, &n2).unwrap();
    assert_eq!(net.runs.len(), 1);
    if let Some(r) = net.runs.iter_mut().find(|r| r.id == run_id) {
        // Replace the resolvable pair with a dangling one.
        r.node_ids = vec!["n1".into(), "n99".into()];
    }
    assert!(find_snap(&net, v(5.0, 0.005, 0.0), 0.01).is_none());
}
