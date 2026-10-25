//! `routing.json` graph + diagnostics + pathfinding vectors (13) as Rust tests.

use super::super::diagnostics::diagnose_graph;
use super::super::graph::{build_connectivity_graph, connected_components, SegmentRef};
use super::super::pathfinding::shortest_path;
use super::super::Vec3;

fn v(x: f64, y: f64, z: f64) -> Vec3 {
    Vec3::new(x, y, z)
}

fn seg(id: &str, sx: f64, ex: f64, len: f64, conf: Option<f64>) -> SegmentRef {
    SegmentRef {
        id: id.to_string(),
        start: v(sx, 0.0, 0.0),
        end: v(ex, 0.0, 0.0),
        length: len,
        confidence: conf,
    }
}

fn chain() -> Vec<SegmentRef> {
    vec![
        seg("a", 0.0, 2.0, 2.0, Some(1.0)),
        seg("b", 2.04, 5.0, 2.96, Some(1.0)),
    ]
}

#[test]
fn vec_graph_clusters_nearby_endpoints() {
    let g = build_connectivity_graph(&chain(), 0.05);
    assert_eq!(g.nodes.len(), 3);
    assert_eq!(g.edges.len(), 2);
    let a = g.edges.iter().find(|e| e.id == "a").unwrap();
    // node-1 holds a:start (first endpoint), node-2 holds the merged joint.
    assert_eq!(g.nodes[0].id, a.from);
    assert_eq!(g.nodes[1].id, a.to);
}

#[test]
fn vec_graph_gap_beyond_tolerance_splits() {
    let g = build_connectivity_graph(
        &[
            seg("a", 0.0, 2.0, 2.0, Some(1.0)),
            seg("b", 2.2, 5.0, 2.8, Some(1.0)),
        ],
        0.05,
    );
    assert_eq!(g.nodes.len(), 4);
    assert_eq!(g.edges.len(), 2);
}

#[test]
fn vec_graph_default_tolerance() {
    // Caller passes the resolved default (runner semantics: options omitted).
    let g = build_connectivity_graph(&chain(), super::super::graph::DEFAULT_TOLERANCE_M);
    assert_eq!(g.nodes.len(), 3);
    assert_eq!(g.edges.len(), 2);
    assert!((g.tolerance - 0.1).abs() <= 1e-12);
}

#[test]
fn vec_diagnose_single_chain() {
    let g = build_connectivity_graph(&chain(), 0.05);
    let d = diagnose_graph(&g, 0.65);
    assert_eq!(d.segment_count, 2);
    assert_eq!(d.node_count, 3);
    assert_eq!(d.component_count, 1);
    assert_eq!(d.dangling_nodes.len(), 2);
    assert_eq!(d.ambiguous_nodes.len(), 0);
    assert!(d.low_confidence_edges.is_empty());
    assert!(d.is_connected);
}

#[test]
fn vec_diagnose_disconnected_low_confidence() {
    let g = build_connectivity_graph(
        &[
            seg("a", 0.0, 1.0, 1.0, Some(0.4)),
            seg("b", 10.0, 11.0, 1.0, Some(1.0)),
        ],
        0.1,
    );
    let d = diagnose_graph(&g, 0.65);
    assert_eq!(d.component_count, 2);
    assert_eq!(d.low_confidence_edges, vec!["a".to_string()]);
    assert!(!d.is_connected);
}

#[test]
fn vec_diagnose_ambiguous_star() {
    let segs: Vec<SegmentRef> = (0..5)
        .map(|i| SegmentRef {
            id: format!("e{i}"),
            start: v(0.0, 0.0, 0.0),
            end: v((i + 1) as f64, 0.0, 0.0),
            length: (i + 1) as f64,
            confidence: Some(1.0),
        })
        .collect();
    let g = build_connectivity_graph(&segs, 0.001);
    let d = diagnose_graph(&g, 0.65);
    assert_eq!(d.node_count, 6);
    assert_eq!(d.segment_count, 5);
    assert_eq!(d.component_count, 1);
    assert_eq!(d.ambiguous_nodes.len(), 1);
    assert!(d.is_connected);
}

#[test]
fn vec_diagnose_custom_confidence_threshold() {
    let g = build_connectivity_graph(&chain(), 0.05);
    let d = diagnose_graph(&g, 0.99);
    assert!(d.low_confidence_edges.is_empty());
}

#[test]
fn vec_components_sorted_by_edge_size() {
    let g = build_connectivity_graph(
        &[
            seg("a", 0.0, 1.0, 1.0, None),
            seg("b", 1.0, 2.0, 1.0, None),
            seg("c", 9.0, 10.0, 5.0, None),
        ],
        0.001,
    );
    let cc = connected_components(&g);
    assert_eq!(cc.len(), 2);
    let sizes: Vec<usize> = cc.iter().map(|c| c.edge_ids.len()).collect();
    assert_eq!(sizes, vec![2, 1]);
}

#[test]
fn vec_shortest_weighted_path() {
    let g = build_connectivity_graph(
        &[
            seg("a", 0.0, 1.0, 1.0, None),
            seg("b", 1.0, 2.0, 1.0, None),
            SegmentRef {
                id: "c".to_string(),
                start: v(0.0, 0.0, 0.0),
                end: v(2.0, 0.0, 0.0),
                length: 5.0,
                confidence: None,
            },
        ],
        0.001,
    );
    let a = g.edges.iter().find(|e| e.id == "a").unwrap();
    let b = g.edges.iter().find(|e| e.id == "b").unwrap();
    let p = shortest_path(&g, &a.from, &b.to, &[]);
    assert!(p.found);
    assert_eq!(p.edge_ids, vec!["a".to_string(), "b".to_string()]);
    assert!((p.length - 2.0).abs() <= 1e-9);
}

#[test]
fn vec_shortest_exclude_endpoint_edges() {
    let g = build_connectivity_graph(
        &[
            seg("start", 0.0, 1.0, 1.0, None),
            seg("middle", 1.0, 2.0, 1.0, None),
            seg("end", 2.0, 3.0, 1.0, None),
        ],
        0.001,
    );
    let s = g.edges.iter().find(|e| e.id == "start").unwrap();
    let e = g.edges.iter().find(|e| e.id == "end").unwrap();
    let p = shortest_path(
        &g,
        &s.to,
        &e.from,
        &["start".to_string(), "end".to_string()],
    );
    assert!(p.found);
    assert_eq!(p.edge_ids, vec!["middle".to_string()]);
    assert!((p.length - 1.0).abs() <= 1e-9);
}

#[test]
fn vec_shortest_disconnected() {
    let g = build_connectivity_graph(
        &[
            seg("a", 0.0, 1.0, 1.0, None),
            seg("b", 9.0, 10.0, 1.0, None),
        ],
        0.001,
    );
    let a = g.edges.iter().find(|e| e.id == "a").unwrap();
    let b = g.edges.iter().find(|e| e.id == "b").unwrap();
    let p = shortest_path(&g, &a.from, &b.to, &[]);
    assert!(!p.found);
    assert_eq!(p.reason, "disconnected");
}

#[test]
fn vec_shortest_unknown_node() {
    let g = build_connectivity_graph(&[seg("a", 0.0, 1.0, 1.0, None)], 0.001);
    let p = shortest_path(&g, "unknown-node", "node-2", &[]);
    assert!(!p.found);
    assert_eq!(p.reason, "unknown-node");
}
