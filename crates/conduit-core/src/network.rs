//! Conduit network: nodes in original IFC coordinates (metres, Z-up) and runs
//! as ordered node-id lists (task 4.1, spec `docs/specs/conduit/network.md`).
//!
//! Direct port of `legacy/packages/conduit-core/src/network.js` minus id
//! allocation state: every edit returns a new [`Network`] (clone-on-write,
//! legacy parity). Ids are `n{next_id}` / `r{next_id}`; the caller owns the
//! counter (injected determinism, owner-approved Q1 pattern).

/// Network file version (legacy `NETWORK_VERSION` parity).
pub const NETWORK_VERSION: u32 = 1;

/// One node in original IFC coordinates (metres, Z-up).
#[derive(Debug, Clone, PartialEq)]
pub struct Node {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

/// One conduit run: ordered node ids plus display metadata.
#[derive(Debug, Clone, PartialEq)]
pub struct Run {
    pub id: String,
    pub name: String,
    pub size: String,
    pub system: String,
    pub node_ids: Vec<String>,
}

/// The network state (legacy `createNetwork` shape parity).
#[derive(Debug, Clone, PartialEq)]
pub struct Network {
    pub version: u32,
    pub stick_length: f64,
    pub nodes: Vec<Node>,
    pub runs: Vec<Run>,
    pub next_id: u64,
}

/// Network error (legacy throw-message parity).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NetError {
    /// Human-readable reason, mirroring the legacy throw text.
    pub message: String,
}

impl std::fmt::Display for NetError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for NetError {}

fn err(message: impl Into<String>) -> NetError {
    NetError {
        message: message.into(),
    }
}

/// Create an empty network (legacy `createNetwork` parity).
#[must_use]
pub fn create_network(stick_length: f64) -> Network {
    Network {
        version: NETWORK_VERSION,
        stick_length,
        nodes: Vec::new(),
        runs: Vec::new(),
        next_id: 1,
    }
}

fn node_by_id(net: &Network, node_id: &str) -> Option<usize> {
    net.nodes.iter().position(|n| n.id == node_id)
}

fn run_by_id(net: &Network, run_id: &str) -> Option<usize> {
    net.runs.iter().position(|r| r.id == run_id)
}

fn take_id(net: &mut Network, prefix: char) -> String {
    let id = format!("{prefix}{}", net.next_id);
    net.next_id += 1;
    id
}

/// Add a node (legacy `addNode` parity). Returns the new network + node id.
#[must_use]
pub fn add_node(net: &Network, x: f64, y: f64, z: f64) -> (Network, String) {
    let mut next = net.clone();
    let id = take_id(&mut next, 'n');
    next.nodes.push(Node {
        id: id.clone(),
        x,
        y,
        z,
    });
    (next, id)
}

/// Start a run from an existing node (legacy `startRun` parity).
pub fn start_run(
    net: &Network,
    size: &str,
    system: &str,
    name: &str,
    first_node: &str,
) -> Result<(Network, String), NetError> {
    if node_by_id(net, first_node).is_none() {
        return Err(err(format!("Unknown node {first_node}.")));
    }
    let mut next = net.clone();
    let id = take_id(&mut next, 'r');
    let run_name = if name.is_empty() {
        id.to_uppercase()
    } else {
        name.to_string()
    };
    next.runs.push(Run {
        id: id.clone(),
        name: run_name,
        size: size.to_string(),
        system: system.to_string(),
        node_ids: vec![first_node.to_string()],
    });
    Ok((next, id))
}

/// Append a node to a run. Appending the current last node is a no-op
/// returning the network unchanged (legacy parity).
pub fn append_to_run(net: &Network, run_id: &str, node_id: &str) -> Result<Network, NetError> {
    let run_idx = run_by_id(net, run_id).ok_or_else(|| err(format!("Unknown run {run_id}.")))?;
    if node_by_id(net, node_id).is_none() {
        return Err(err(format!("Unknown node {node_id}.")));
    }
    if net.runs[run_idx]
        .node_ids
        .last()
        .is_some_and(|l| l == node_id)
    {
        return Ok(net.clone());
    }
    let mut next = net.clone();
    next.runs[run_idx].node_ids.push(node_id.to_string());
    Ok(next)
}

/// Insert a node into segment `index` of a run (legacy `splitSegment` parity).
pub fn split_segment(
    net: &Network,
    run_id: &str,
    index: usize,
    x: f64,
    y: f64,
    z: f64,
) -> Result<(Network, String), NetError> {
    let run_idx = run_by_id(net, run_id)
        .ok_or_else(|| err(format!("Run {run_id} has no segment {index}.")))?;
    if index >= net.runs[run_idx].node_ids.len().saturating_sub(1) {
        return Err(err(format!("Run {run_id} has no segment {index}.")));
    }
    let (mut next, node_id) = add_node(net, x, y, z);
    let idx = run_by_id(&next, run_id).expect("run survives clone");
    next.runs[idx].node_ids.insert(index + 1, node_id.clone());
    Ok((next, node_id))
}

fn prune_orphan_nodes(net: &mut Network) {
    let mut used = std::collections::BTreeSet::new();
    for run in &net.runs {
        for id in &run.node_ids {
            used.insert(id.clone());
        }
    }
    net.nodes.retain(|n| used.contains(&n.id));
}

/// Remove the last point of a run; an emptied run is deleted; orphans pruned
/// (legacy `removeLastPoint` parity).
#[must_use]
pub fn remove_last_point(net: &Network, run_id: &str) -> Network {
    let Some(run_idx) = run_by_id(net, run_id) else {
        return net.clone();
    };
    let mut next = net.clone();
    next.runs[run_idx].node_ids.pop();
    if next.runs[run_idx].node_ids.is_empty() {
        next.runs.remove(run_idx);
    }
    prune_orphan_nodes(&mut next);
    next
}

/// Delete a run and prune orphans (legacy `deleteRun` parity).
#[must_use]
pub fn delete_run(net: &Network, run_id: &str) -> Network {
    let mut next = net.clone();
    next.runs.retain(|r| r.id != run_id);
    prune_orphan_nodes(&mut next);
    next
}

/// Drop runs with fewer than two points (legacy `dropIncompleteRuns` parity).
#[must_use]
pub fn drop_incomplete_runs(net: &Network) -> Network {
    let mut next = net.clone();
    next.runs.retain(|r| r.node_ids.len() >= 2);
    prune_orphan_nodes(&mut next);
    next
}

/// Update run metadata (legacy `updateRun` parity; unknown runs are a no-op
/// returning the network unchanged).
#[must_use]
pub fn update_run(
    net: &Network,
    run_id: &str,
    name: Option<&str>,
    size: Option<&str>,
    system: Option<&str>,
) -> Network {
    let Some(run_idx) = run_by_id(net, run_id) else {
        return net.clone();
    };
    let mut next = net.clone();
    if let Some(name) = name {
        next.runs[run_idx].name = name.to_string();
    }
    if let Some(size) = size {
        next.runs[run_idx].size = size.to_string();
    }
    if let Some(system) = system {
        next.runs[run_idx].system = system.to_string();
    }
    next
}

/// Set the stick length (legacy `setStickLength` parity; rejects
/// non-positive values).
pub fn set_stick_length(net: &Network, stick_length: f64) -> Result<Network, NetError> {
    if stick_length <= 0.0 {
        return Err(err("Stick length must be positive."));
    }
    let mut next = net.clone();
    next.stick_length = stick_length;
    Ok(next)
}

/// Validate a network file (legacy `validateNetwork` parity): version 1,
/// frame/units tags, finite coordinates, dangling refs rejected, and the
/// `nextId` cursor becomes `max(provided, maxNumericId + 1)`.
pub fn validate_network(data: &NetworkFile) -> Result<Network, NetError> {
    if data.version != NETWORK_VERSION {
        return Err(err(format!(
            "Unsupported conduit file version {}.",
            data.version
        )));
    }
    if data.frame != "ifc-original" || data.units != "m" {
        return Err(err(
            "Conduit file must be in original IFC coordinates, metres.",
        ));
    }
    let mut ids = std::collections::BTreeSet::new();
    for node in &data.nodes {
        if !(node.x.is_finite() && node.y.is_finite() && node.z.is_finite()) {
            return Err(err(format!("Node {} has invalid coordinates.", node.id)));
        }
        ids.insert(node.id.clone());
    }
    for run in &data.runs {
        for node_id in &run.node_ids {
            if !ids.contains(node_id) {
                return Err(err(format!(
                    "Run {} points to missing node {}.",
                    run.id, node_id
                )));
            }
        }
    }
    let mut numeric_max: Option<u64> = None;
    for id in ids.iter().chain(data.runs.iter().map(|r| &r.id)) {
        if let Some(num) = id
            .get(1..)
            .and_then(|s| s.parse::<u64>().ok())
            .filter(|_| id.starts_with(['n', 'r']))
        {
            numeric_max = Some(numeric_max.map_or(num, |m: u64| m.max(num)));
        }
    }
    let cursor = data.next_id.max(numeric_max.map_or(1, |m| m + 1));
    Ok(Network {
        version: data.version,
        stick_length: data.stick_length,
        nodes: data.nodes.clone(),
        runs: data.runs.clone(),
        next_id: cursor,
    })
}

/// Serde-free file shape for [`validate_network`] (TS owns JSON parsing).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct NetworkFile {
    pub version: u32,
    pub frame: String,
    pub units: String,
    pub stick_length: f64,
    pub nodes: Vec<Node>,
    pub runs: Vec<Run>,
    pub next_id: u64,
}

#[cfg(test)]
mod tests;
