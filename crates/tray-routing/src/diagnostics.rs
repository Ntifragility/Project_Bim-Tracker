//! Graph diagnostics: dangling / ambiguous / low-confidence / components.
//!
//! Pure port of `legacy/packages/routing-core/src/diagnostics.js` (29 lines).

use crate::graph::{connected_components, Component, Graph};

/// Default minimum segment confidence (spec R5).
pub const DEFAULT_MINIMUM_CONFIDENCE: f64 = 0.65;

/// Diagnosis outcome.
#[derive(Debug, Clone)]
pub struct Diagnosis {
    pub segment_count: usize,
    pub node_count: usize,
    pub component_count: usize,
    pub components: Vec<Component>,
    pub dangling_nodes: Vec<String>,
    pub ambiguous_nodes: Vec<String>,
    pub low_confidence_edges: Vec<String>,
    pub is_connected: bool,
}

/// R5 + R7: dangling = degree 1; ambiguous = degree > 4; low-confidence =
/// `(confidence ?? 1) < threshold`; report, never auto-merge.
pub fn diagnose_graph(graph: &Graph, minimum_confidence: f64) -> Diagnosis {
    let threshold = if minimum_confidence.is_finite() {
        minimum_confidence
    } else {
        DEFAULT_MINIMUM_CONFIDENCE
    };
    let components = connected_components(graph);
    let mut dangling: Vec<String> = Vec::new();
    let mut ambiguous: Vec<String> = Vec::new();
    for node in &graph.nodes {
        if node.edge_ids.len() == 1 {
            dangling.push(node.id.clone());
        }
        if node.edge_ids.len() > 4 {
            ambiguous.push(node.id.clone());
        }
    }
    dangling.sort();
    ambiguous.sort();
    let mut low: Vec<String> = Vec::new();
    for edge in &graph.edges {
        if edge.confidence.unwrap_or(1.0) < threshold {
            low.push(edge.id.clone());
        }
    }
    // Legacy preserves edge insertion order; keep it (no sort).
    let is_connected = components.len() <= 1;
    Diagnosis {
        segment_count: graph.edges.len(),
        node_count: graph.nodes.len(),
        component_count: components.len(),
        components,
        dangling_nodes: dangling,
        ambiguous_nodes: ambiguous,
        low_confidence_edges: low,
        is_connected,
    }
}
