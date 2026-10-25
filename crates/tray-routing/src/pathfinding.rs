//! Dijkstra shortest path by physical length.
//!
//! Pure port of `legacy/packages/routing-core/src/pathfinding.js` (50 lines).

use crate::graph::Graph;

/// Pathfinding outcome.
#[derive(Debug, Clone)]
pub struct Path {
    pub found: bool,
    pub reason: String,
    pub node_ids: Vec<String>,
    pub edge_ids: Vec<String>,
    pub length: f64,
}

fn not_found(reason: &str) -> Path {
    Path {
        found: false,
        reason: reason.to_string(),
        node_ids: Vec::new(),
        edge_ids: Vec::new(),
        length: f64::INFINITY,
    }
}

/// R6: Dijkstra over edge `length`; unknown nodes -> unknown-node;
/// unreachable -> disconnected; broken chain -> incomplete-path;
/// `exclude_edge_ids` skipped; returns ordered node/edge ids + length.
pub fn shortest_path(graph: &Graph, start: &str, end: &str, exclude_edge_ids: &[String]) -> Path {
    let has = |id: &str| graph.nodes.iter().any(|n| n.id == id);
    if !has(start) || !has(end) {
        return not_found("unknown-node");
    }
    // distance map in node order; linear min-scan like legacy.
    let mut dist: Vec<(&String, f64)> =
        graph.nodes.iter().map(|n| (&n.id, f64::INFINITY)).collect();
    let mut prev: Vec<(String, Option<(String, String)>)> =
        graph.nodes.iter().map(|n| (n.id.clone(), None)).collect();
    let set_dist = |dist: &mut Vec<(&String, f64)>, id: &str, v: f64| {
        if let Some(slot) = dist.iter_mut().find(|(i, _)| i.as_str() == id) {
            slot.1 = v;
        }
    };
    let get_dist = |dist: &[(&String, f64)], id: &str| -> f64 {
        dist.iter()
            .find(|(i, _)| i.as_str() == id)
            .map(|(_, v)| *v)
            .unwrap_or(f64::INFINITY)
    };
    set_dist(&mut dist, start, 0.0);
    let mut remaining: Vec<String> = graph.nodes.iter().map(|n| n.id.clone()).collect();

    while !remaining.is_empty() {
        let mut current: Option<String> = None;
        for candidate in &remaining {
            match &current {
                None => current = Some(candidate.clone()),
                Some(c) => {
                    if get_dist(&dist, candidate) < get_dist(&dist, c) {
                        current = Some(candidate.clone());
                    }
                }
            }
        }
        let Some(current) = current else { break };
        if get_dist(&dist, &current) == f64::INFINITY {
            break;
        }
        remaining.retain(|id| *id != current);
        if current == end {
            break;
        }
        let node = graph.nodes.iter().find(|n| n.id == current);
        let Some(node) = node else { continue };
        for edge_id in &node.edge_ids {
            if exclude_edge_ids.iter().any(|x| x == edge_id) {
                continue;
            }
            let Some(edge) = graph.edges.iter().find(|e| &e.id == edge_id) else {
                continue;
            };
            let neighbor = if edge.from == current {
                edge.to.clone()
            } else {
                edge.from.clone()
            };
            if !remaining.contains(&neighbor) {
                continue;
            }
            let candidate = get_dist(&dist, &current) + edge.length;
            if candidate < get_dist(&dist, &neighbor) {
                set_dist(&mut dist, &neighbor, candidate);
                if let Some(slot) = prev.iter_mut().find(|(i, _)| *i == neighbor) {
                    slot.1 = Some((current.clone(), edge_id.clone()));
                }
            }
        }
    }

    if get_dist(&dist, end) == f64::INFINITY {
        return not_found("disconnected");
    }
    let mut node_ids = vec![end.to_string()];
    let mut edge_ids: Vec<String> = Vec::new();
    let mut cursor = end.to_string();
    while cursor != start {
        let step = prev
            .iter()
            .find(|(i, _)| *i == cursor)
            .and_then(|(_, s)| s.clone());
        let Some((prev_node, prev_edge)) = step else {
            return not_found("incomplete-path");
        };
        edge_ids.insert(0, prev_edge);
        node_ids.insert(0, prev_node.clone());
        cursor = prev_node;
    }
    Path {
        found: true,
        reason: String::new(),
        node_ids,
        edge_ids,
        length: get_dist(&dist, end),
    }
}
