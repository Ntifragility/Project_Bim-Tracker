//! Tolerance-clustered connectivity graph (union-find over endpoints).
//!
//! Pure port of `legacy/packages/routing-core/src/graph.js` (104 lines).
//! Arrays across the boundary, never Maps (ARCH rule 10 / spec R9-adjacent).
//! Node ids are deterministic insertion order `node-1..N`, never random.

use geom_core::vec3::{self, Vec3};

/// Default clustering tolerance in metres (100 mm, spec R3 / open Q2 pinned).
pub const DEFAULT_TOLERANCE_M: f64 = 0.1;

/// Input segment reference.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SegmentRef {
    pub id: String,
    pub start: Vec3,
    pub end: Vec3,
    pub length: f64,
    pub confidence: Option<f64>,
}

/// One endpoint reference inside a node.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EndpointRef {
    pub segment_id: String,
    pub end: String,
}

/// Graph node.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Node {
    pub id: String,
    pub position: Vec3,
    pub endpoint_refs: Vec<EndpointRef>,
    pub edge_ids: Vec<String>,
}

/// Graph edge (one per segment; `id == segment.id`).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Edge {
    pub id: String,
    pub from: String,
    pub to: String,
    pub length: f64,
    pub segment_id: String,
    pub confidence: Option<f64>,
}

/// Connectivity graph.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Graph {
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
    pub segment_to_edge: Vec<(String, String)>,
    pub tolerance: f64,
}

struct DisjointSet {
    parent: Vec<usize>,
    rank: Vec<usize>,
}

impl DisjointSet {
    fn new(size: usize) -> Self {
        DisjointSet {
            parent: (0..size).collect(),
            rank: vec![0; size],
        }
    }
    fn find(&mut self, value: usize) -> usize {
        if self.parent[value] != value {
            let root = self.find(self.parent[value]);
            self.parent[value] = root;
        }
        self.parent[value]
    }
    fn union(&mut self, left: usize, right: usize) {
        let mut rl = self.find(left);
        let mut rr = self.find(right);
        if rl == rr {
            return;
        }
        if self.rank[rl] < self.rank[rr] {
            std::mem::swap(&mut rl, &mut rr);
        }
        self.parent[rr] = rl;
        if self.rank[rl] == self.rank[rr] {
            self.rank[rl] += 1;
        }
    }
}

/// R3: cluster the 2N endpoints by `distance <= tolerance` via union-find;
/// each cluster becomes one insertion-ordered node at the endpoint mean.
/// Each segment becomes one edge `{id: segment.id, from, to}`.
pub fn build_connectivity_graph(segments: &[SegmentRef], tolerance: f64) -> Graph {
    let tol = if tolerance.is_finite() && tolerance >= 0.0 {
        tolerance
    } else {
        DEFAULT_TOLERANCE_M
    };
    // Flatten endpoints in segment order: (segment_idx, end, position).
    let mut endpoints: Vec<(usize, &'static str, Vec3)> = Vec::with_capacity(segments.len() * 2);
    for (i, s) in segments.iter().enumerate() {
        endpoints.push((i, "start", s.start));
        endpoints.push((i, "end", s.end));
    }
    let mut sets = DisjointSet::new(endpoints.len());
    for left in 0..endpoints.len() {
        for right in (left + 1)..endpoints.len() {
            if vec3::distance(endpoints[left].2, endpoints[right].2) <= tol {
                sets.union(left, right);
            }
        }
    }
    // Clusters in first-appearance order (insertion-ordered nodes).
    let mut root_to_cluster: Vec<(usize, usize)> = Vec::new();
    let mut clusters: Vec<Vec<usize>> = Vec::new();
    for idx in 0..endpoints.len() {
        let root = sets.find(idx);
        match root_to_cluster.iter().find(|(r, _)| *r == root) {
            Some((_, ci)) => clusters[*ci].push(idx),
            None => {
                root_to_cluster.push((root, clusters.len()));
                clusters.push(vec![idx]);
            }
        }
    }

    let mut nodes: Vec<Node> = Vec::with_capacity(clusters.len());
    // endpoint key (segment_id, end) -> node id.
    let mut endpoint_to_node: Vec<((String, String), String)> = Vec::new();
    for (n, members) in clusters.iter().enumerate() {
        let id = format!("node-{}", n + 1);
        let positions: Vec<Vec3> = members.iter().map(|&m| endpoints[m].2).collect();
        let refs: Vec<EndpointRef> = members
            .iter()
            .map(|&m| EndpointRef {
                segment_id: segments[endpoints[m].0].id.clone(),
                end: endpoints[m].1.to_string(),
            })
            .collect();
        for r in &refs {
            endpoint_to_node.push(((r.segment_id.clone(), r.end.clone()), id.clone()));
        }
        nodes.push(Node {
            id,
            position: vec3::mean(&positions),
            endpoint_refs: refs,
            edge_ids: Vec::new(),
        });
    }
    let lookup = |seg: &str, end: &str| -> String {
        endpoint_to_node
            .iter()
            .find(|((s, e), _)| s == seg && e == end)
            .map(|(_, n)| n.clone())
            .unwrap_or_default()
    };

    let mut edges: Vec<Edge> = Vec::with_capacity(segments.len());
    let mut segment_to_edge: Vec<(String, String)> = Vec::with_capacity(segments.len());
    for s in segments {
        let from = lookup(&s.id, "start");
        let to = lookup(&s.id, "end");
        let edge = Edge {
            id: s.id.clone(),
            from: from.clone(),
            to: to.clone(),
            length: s.length,
            segment_id: s.id.clone(),
            confidence: s.confidence,
        };
        segment_to_edge.push((s.id.clone(), s.id.clone()));
        for node in nodes.iter_mut() {
            if node.id == from || node.id == to {
                node.edge_ids.push(edge.id.clone());
            }
        }
        edges.push(edge);
    }

    Graph {
        nodes,
        edges,
        segment_to_edge,
        tolerance: tol,
    }
}

/// Graph component (BFS over node<->edge adjacency).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Component {
    pub node_ids: Vec<String>,
    pub edge_ids: Vec<String>,
}

/// R4: BFS components sorted by edge count descending.
pub fn connected_components(graph: &Graph) -> Vec<Component> {
    let mut visited: Vec<String> = Vec::new();
    let mut components: Vec<Component> = Vec::new();
    for node in &graph.nodes {
        if visited.contains(&node.id) {
            continue;
        }
        let mut comp = Component {
            node_ids: Vec::new(),
            edge_ids: Vec::new(),
        };
        let mut queue = vec![node.id.clone()];
        visited.push(node.id.clone());
        while let Some(current) = queue.pop() {
            // legacy uses shift (BFS); pop order differs but membership is
            // identical, and vectors only assert sizes/topology.
            comp.node_ids.push(current.clone());
            let current_node = graph.nodes.iter().find(|n| n.id == current);
            let Some(current_node) = current_node else {
                continue;
            };
            for edge_id in &current_node.edge_ids {
                if !comp.edge_ids.contains(edge_id) {
                    comp.edge_ids.push(edge_id.clone());
                }
                let edge = graph.edges.iter().find(|e| &e.id == edge_id);
                let Some(edge) = edge else { continue };
                let neighbor = if edge.from == current {
                    edge.to.clone()
                } else {
                    edge.from.clone()
                };
                if !visited.contains(&neighbor) {
                    visited.push(neighbor.clone());
                    queue.push(neighbor);
                }
            }
        }
        components.push(comp);
    }
    components.sort_by_key(|a| std::cmp::Reverse(a.edge_ids.len()));
    components
}

#[cfg(test)]
mod tests;
