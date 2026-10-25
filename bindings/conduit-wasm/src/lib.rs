//! `conduit-wasm`: thin wasm-bindgen layer over `conduit-core` (task 4.6).
//!
//! Rule R1: parse -> call core -> serialize. No logic lives here; any
//! behavior fix lands in `conduit-core` + vectors first. Errors are plain
//! `{code, message}` JSON objects, never panics (ARCH section 3).
//! D-rulings baked in via the core: D1 couplings, D2 truncated NEC,
//! D3 legacy-labeled pull boxes.

use conduit_core::{
    analyze_run_bends, bend_angle, compute_detailed_bom, compute_run_takeoff, compute_takeoff,
    default_diameters, find_diameter, find_snap, history_execute, history_redo, history_undo,
    nec_bend_radius_m, optimize_stick_cutting, solve_auto_riser, solve_elbow, BomOptions, History,
    NecQuery, Network, NetworkFile, SnapConfig, Vec3,
};
use wasm_bindgen::prelude::*;

/// Error envelope: `{code, message}`.
fn err(code: &str, message: impl Into<String>) -> String {
    serde_json::json!({"code": code, "message": message.into()}).to_string()
}

fn parse_network(net_json: &str) -> Result<Network, String> {
    let file: NetworkFile =
        serde_json::from_str(net_json).map_err(|e| err("E_SCHEMA", e.to_string()))?;
    conduit_core::validate_network(&file).map_err(|e| err("E_NETWORK", e.message))
}

/// Structural parse for queries that tolerate dangling refs by design
/// (R6: `find_snap` skips unresolvable pairs; strict `validate_network`
/// would reject them before the core ever sees them).
fn parse_network_lenient(net_json: &str) -> Result<Network, String> {
    let file: NetworkFile =
        serde_json::from_str(net_json).map_err(|e| err("E_SCHEMA", e.to_string()))?;
    if file.version != conduit_core::NETWORK_VERSION {
        return Err(err(
            "E_NETWORK",
            format!("Unsupported conduit file version {}.", file.version),
        ));
    }
    if file.frame != "ifc-original" || file.units != "m" {
        return Err(err(
            "E_NETWORK",
            "Conduit file must be in original IFC coordinates, metres.",
        ));
    }
    for node in &file.nodes {
        if !(node.x.is_finite() && node.y.is_finite() && node.z.is_finite()) {
            return Err(err(
                "E_NETWORK",
                format!("Node {} has invalid coordinates.", node.id),
            ));
        }
    }
    Ok(Network {
        version: file.version,
        stick_length: file.stick_length,
        nodes: file.nodes,
        runs: file.runs,
        next_id: file.next_id,
    })
}

fn parse_vec3(value: &serde_json::Value) -> Result<Vec3, String> {
    let x = value.get("x").and_then(|v| v.as_f64());
    let y = value.get("y").and_then(|v| v.as_f64());
    let z = value.get("z").and_then(|v| v.as_f64());
    match (x, y, z) {
        (Some(x), Some(y), Some(z)) => Ok(Vec3::new(x, y, z)),
        _ => Err(err("E_SCHEMA", "point needs numeric x/y/z")),
    }
}

/// Health check: conduit-core version + capability list.
#[wasm_bindgen]
pub fn conduit_wasm_version() -> String {
    "conduit-wasm 4.6 (network/snap/fitting/bom/takeoff/history/registry)".to_string()
}

// ---- network ----

/// Validate a network file JSON; `{ok:true}` or `{code,message}`.
#[wasm_bindgen]
pub fn network_validate(net_json: &str) -> String {
    match parse_network(net_json) {
        Ok(_) => serde_json::json!({"ok": true}).to_string(),
        Err(e) => e,
    }
}

/// Full takeoff for a network file JSON.
#[wasm_bindgen]
pub fn network_takeoff(net_json: &str) -> String {
    match parse_network(net_json) {
        Ok(net) => serde_json::to_string(&compute_takeoff(&net))
            .unwrap_or_else(|e| err("E_SCHEMA", e.to_string())),
        Err(e) => e,
    }
}

/// Takeoff for a single run.
#[wasm_bindgen]
pub fn network_run_takeoff(net_json: &str, run_id: &str) -> String {
    match parse_network(net_json) {
        Ok(net) => serde_json::to_string(&compute_run_takeoff(&net, run_id))
            .unwrap_or_else(|e| err("E_SCHEMA", e.to_string())),
        Err(e) => e,
    }
}

/// One mutation op per call. `op_json`: `{op, ...params}`; ids come from the
/// network's own `next_id` cursor (deterministic, caller-owned).
#[wasm_bindgen]
pub fn network_mutate(op_json: &str, net_json: &str) -> String {
    let op: serde_json::Value = serde_json::from_str(op_json).unwrap_or(serde_json::Value::Null);
    let net = match parse_network(net_json) {
        Ok(n) => n,
        Err(e) => return e,
    };
    let name = op.get("op").and_then(|v| v.as_str()).unwrap_or("");
    let out: Result<Network, String> = (|| {
        match name {
            "add_node" => {
                let p = op.get("point").ok_or("add_node needs point")?;
                let pt = parse_vec3(p).map_err(|_| "add_node needs numeric point")?;
                Ok(conduit_core::add_node(&net, pt.x, pt.y, pt.z).0)
            }
            "start_run" => {
                let first = op
                    .get("first_node")
                    .and_then(|v| v.as_str())
                    .ok_or("start_run needs first_node")?;
                let size = op.get("size").and_then(|v| v.as_str()).unwrap_or("");
                let system = op.get("system").and_then(|v| v.as_str()).unwrap_or("");
                let rname = op.get("name").and_then(|v| v.as_str()).unwrap_or("");
                conduit_core::start_run(&net, size, system, rname, first)
                    .map(|(n, _)| n)
                    .map_err(|e| e.message)
            }
            "append_to_run" => {
                let run = op
                    .get("run_id")
                    .and_then(|v| v.as_str())
                    .ok_or("append_to_run needs run_id")?;
                let node = op
                    .get("node_id")
                    .and_then(|v| v.as_str())
                    .ok_or("append_to_run needs node_id")?;
                conduit_core::append_to_run(&net, run, node).map_err(|e| e.message)
            }
            "delete_run" => {
                let run = op
                    .get("run_id")
                    .and_then(|v| v.as_str())
                    .ok_or("delete_run needs run_id")?;
                Ok(conduit_core::delete_run(&net, run))
            }
            "remove_last_point" => {
                let run = op
                    .get("run_id")
                    .and_then(|v| v.as_str())
                    .ok_or("remove_last_point needs run_id")?;
                Ok(conduit_core::remove_last_point(&net, run))
            }
            "split_segment" => {
                let run = op
                    .get("run_id")
                    .and_then(|v| v.as_str())
                    .ok_or("split_segment needs run_id")?;
                let index = op
                    .get("index")
                    .and_then(|v| v.as_u64())
                    .ok_or("split_segment needs index")? as usize;
                let p = op.get("point").ok_or("split_segment needs point")?;
                let pt = parse_vec3(p).map_err(|_| "split_segment needs numeric point")?;
                conduit_core::split_segment(&net, run, index, pt.x, pt.y, pt.z)
                    .map(|(n, _)| n)
                    .map_err(|e| e.message)
            }
            "drop_incomplete" => Ok(conduit_core::drop_incomplete_runs(&net)),
            "update_run" => {
                let run = op
                    .get("run_id")
                    .and_then(|v| v.as_str())
                    .ok_or("update_run needs run_id")?;
                // Option passthrough; absent keys leave the field unchanged.
                let size = op.get("size").and_then(|v| v.as_str());
                let system = op.get("system").and_then(|v| v.as_str());
                let rname = op.get("name").and_then(|v| v.as_str());
                Ok(conduit_core::update_run(&net, run, rname, size, system))
            }
            "set_stick" => {
                let len = op
                    .get("stick_length")
                    .and_then(|v| v.as_f64())
                    .ok_or("set_stick needs stick_length")?;
                conduit_core::set_stick_length(&net, len).map_err(|e| e.message)
            }
            _ => Err(format!("unknown op: {name}")),
        }
    })();
    match out {
        Ok(n) => serde_json::to_string(&conduit_core::network_to_file(&n))
            .unwrap_or_else(|e| err("E_SCHEMA", e.to_string())),
        Err(message) => err("E_NETWORK", message),
    }
}

// ---- snap ----

/// Network-bound snap query (nodes-first, 4.5 `find_snap`).
#[wasm_bindgen]
pub fn snap_find(net_json: &str, point_json: &str, tolerance_m: f64) -> String {
    if !tolerance_m.is_finite() || tolerance_m < 0.0 {
        return err("E_RANGE", "tolerance_m must be finite and >= 0");
    }
    let net = match parse_network_lenient(net_json) {
        Ok(n) => n,
        Err(e) => return e,
    };
    let point: serde_json::Value = match serde_json::from_str(point_json) {
        Ok(p) => p,
        Err(e) => return err("E_SCHEMA", e.to_string()),
    };
    let pt = match parse_vec3(&point) {
        Ok(p) => p,
        Err(e) => return e,
    };
    match find_snap(&net, pt, tolerance_m) {
        Some(hit) => serde_json::to_string(&hit).unwrap_or_else(|e| err("E_SCHEMA", e.to_string())),
        None => "null".to_string(),
    }
}

/// Point-level snap over explicit node/segment candidates + config.
#[wasm_bindgen]
pub fn snap_point(candidates_json: &str, query_json: &str, config_json: &str) -> String {
    let cand: serde_json::Value = match serde_json::from_str(candidates_json) {
        Ok(c) => c,
        Err(e) => return err("E_SCHEMA", e.to_string()),
    };
    let query: serde_json::Value = match serde_json::from_str(query_json) {
        Ok(q) => q,
        Err(e) => return err("E_SCHEMA", e.to_string()),
    };
    let config: SnapConfig = serde_json::from_str(config_json).unwrap_or_default();
    let q = match parse_vec3(&query) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let nodes: Vec<conduit_core::SnapNode> = cand
        .get("nodes")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|n| {
                    Some(conduit_core::SnapNode {
                        id: n.get("id")?.as_str()?.to_string(),
                        point: parse_vec3(n.get("point")?).ok()?,
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    conduit_core::snap_to_nodes(q, &nodes, config.tolerance_m)
        .map(|c| serde_json::to_string(&c).unwrap_or_else(|e| err("E_SCHEMA", e.to_string())))
        .unwrap_or_else(|| "null".to_string())
}

// ---- fitting ----

/// Elbow solve from three corner points + radius + arc segments.
#[wasm_bindgen]
pub fn fitting_elbow(
    p1_json: &str,
    corner_json: &str,
    p2_json: &str,
    radius_m: f64,
    arc_segments: usize,
) -> String {
    if !radius_m.is_finite() || radius_m <= 0.0 {
        return err("E_RANGE", "radius_m must be finite and > 0");
    }
    let parse = |s: &str| -> Result<Vec3, String> {
        let v: serde_json::Value =
            serde_json::from_str(s).map_err(|e| err("E_SCHEMA", e.to_string()))?;
        parse_vec3(&v)
    };
    let (p1, corner, p2) = match (parse(p1_json), parse(corner_json), parse(p2_json)) {
        (Ok(a), Ok(b), Ok(c)) => (a, b, c),
        _ => return err("E_SCHEMA", "p1/corner/p2 need numeric x/y/z"),
    };
    let sol = solve_elbow(p1, corner, p2, radius_m, arc_segments);
    serde_json::to_string(&sol).unwrap_or_else(|e| err("E_SCHEMA", e.to_string()))
}

/// Bend angle between three points (degrees 0..180).
#[wasm_bindgen]
pub fn fitting_bend_angle(p1_json: &str, corner_json: &str, p2_json: &str) -> String {
    let parse = |s: &str| -> Result<Vec3, String> {
        let v: serde_json::Value =
            serde_json::from_str(s).map_err(|e| err("E_SCHEMA", e.to_string()))?;
        parse_vec3(&v)
    };
    match (parse(p1_json), parse(corner_json), parse(p2_json)) {
        (Ok(a), Ok(b), Ok(c)) => serde_json::json!({"angle_deg": bend_angle(a, b, c)}).to_string(),
        _ => err("E_SCHEMA", "p1/corner/p2 need numeric x/y/z"),
    }
}

/// Run-bend analysis over a polyline.
#[wasm_bindgen]
pub fn fitting_run_bends(points_json: &str) -> String {
    let pts: Vec<serde_json::Value> = match serde_json::from_str(points_json) {
        Ok(p) => p,
        Err(e) => return err("E_SCHEMA", e.to_string()),
    };
    let mut out = Vec::with_capacity(pts.len());
    for p in &pts {
        match parse_vec3(p) {
            Ok(v) => out.push(v),
            Err(e) => return e,
        }
    }
    let r = analyze_run_bends(&out);
    serde_json::to_string(&r).unwrap_or_else(|e| err("E_SCHEMA", e.to_string()))
}

/// NEC bend-radius lookup: `{"trade_size":"..."}` or `{"mm":...}`.
/// Unknown labels fall back to the 3/4" row (core parity); the row is
/// returned so callers can detect the fallback via the label.
#[wasm_bindgen]
pub fn fitting_nec_lookup(query_json: &str) -> String {
    let q: serde_json::Value = match serde_json::from_str(query_json) {
        Ok(v) => v,
        Err(e) => return err("E_SCHEMA", e.to_string()),
    };
    let query = if let Some(mm) = q.get("mm").and_then(|v| v.as_f64()) {
        NecQuery::Mm(mm)
    } else if let Some(t) = q.get("trade_size").and_then(|v| v.as_str()) {
        NecQuery::TradeSize(t.to_string())
    } else {
        return err("E_SCHEMA", "query needs trade_size or mm");
    };
    let radius = nec_bend_radius_m(&query);
    serde_json::json!({"radius_m": radius}).to_string()
}

/// Auto-riser solver.
#[wasm_bindgen]
pub fn fitting_auto_riser(start_json: &str, target_elevation: f64, up_axis_y: bool) -> String {
    if !target_elevation.is_finite() {
        return err("E_RANGE", "target_elevation must be finite");
    }
    let v: serde_json::Value = match serde_json::from_str(start_json) {
        Ok(x) => x,
        Err(e) => return err("E_SCHEMA", e.to_string()),
    };
    let start = match parse_vec3(&v) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let r = solve_auto_riser(start, target_elevation, up_axis_y);
    serde_json::to_string(&r).unwrap_or_else(|e| err("E_SCHEMA", e.to_string()))
}

// ---- bom ----

/// Detailed BOM for a network + options JSON.
#[wasm_bindgen]
pub fn bom_detailed(net_json: &str, opts_json: &str) -> String {
    let net = match parse_network(net_json) {
        Ok(n) => n,
        Err(e) => return e,
    };
    let opts: BomOptions = match serde_json::from_str(opts_json) {
        Ok(o) => o,
        Err(e) => return err("E_SCHEMA", e.to_string()),
    };
    let r = compute_detailed_bom(&net, &opts);
    serde_json::to_string(&r).unwrap_or_else(|e| err("E_SCHEMA", e.to_string()))
}

/// First-fit-decreasing stick optimizer.
#[wasm_bindgen]
pub fn bom_optimize(cuts_json: &str, stock_m: f64, kerf_m: f64) -> String {
    if !stock_m.is_finite() || stock_m <= 0.0 {
        return err("E_RANGE", "stock_m must be finite and > 0");
    }
    if !kerf_m.is_finite() || kerf_m < 0.0 {
        return err("E_RANGE", "kerf_m must be finite and >= 0");
    }
    let cuts: Vec<f64> = match serde_json::from_str(cuts_json) {
        Ok(c) => c,
        Err(e) => return err("E_SCHEMA", e.to_string()),
    };
    let r = optimize_stick_cutting(&cuts, stock_m, kerf_m);
    serde_json::to_string(&r).unwrap_or_else(|e| err("E_SCHEMA", e.to_string()))
}

// ---- history + registry ----

/// Pure history transitions: ops `execute {label}` / `undo` / `redo` /
/// `clear` / `with_depth {max_depth}` (Q1 vocabulary, fixed at landing).
#[wasm_bindgen]
pub fn history_step(hist_json: &str, op: &str, payload_json: &str) -> String {
    let hist: History = match serde_json::from_str(hist_json) {
        Ok(h) => h,
        Err(e) => return err("E_SCHEMA", e.to_string()),
    };
    let payload: serde_json::Value =
        serde_json::from_str(payload_json).unwrap_or(serde_json::Value::Null);
    match op {
        "execute" => {
            let label = payload
                .get("label")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let next = history_execute(&hist, label.clone());
            serde_json::json!({"history": next, "label": label}).to_string()
        }
        "undo" => {
            let (next, label) = history_undo(&hist);
            serde_json::json!({"history": next, "label": label}).to_string()
        }
        "redo" => {
            let (next, label) = history_redo(&hist);
            serde_json::json!({"history": next, "label": label}).to_string()
        }
        "clear" => {
            let next = conduit_core::history_clear(&hist);
            serde_json::json!({"history": next}).to_string()
        }
        "with_depth" => {
            let depth = payload
                .get("max_depth")
                .and_then(|v| v.as_u64())
                .unwrap_or(200) as usize;
            serde_json::json!({"history": History::with_depth(depth)}).to_string()
        }
        _ => err("E_SCHEMA", format!("unknown history op: {op}")),
    }
}

/// Default diameter registry (palette + 3/4" default, core parity).
#[wasm_bindgen]
pub fn registry_list() -> String {
    serde_json::to_string(&default_diameters()).unwrap_or_else(|e| err("E_SCHEMA", e.to_string()))
}

/// Diameter lookup by label or id; null when unknown.
#[wasm_bindgen]
pub fn registry_find(label_or_id: &str) -> String {
    let list = default_diameters();
    match find_diameter(&list, label_or_id) {
        Some(d) => serde_json::to_string(d).unwrap_or_else(|e| err("E_SCHEMA", e.to_string())),
        None => "null".to_string(),
    }
}

/// Bulk run-polyline export as flat XYZ triplets (`Float64Array`-ready).
/// Returns `{points: number[], counts: number[]}` — one count per run.
#[wasm_bindgen]
pub fn network_run_points(net_json: &str) -> String {
    let net = match parse_network(net_json) {
        Ok(n) => n,
        Err(e) => return e,
    };
    let mut flat: Vec<f64> = Vec::new();
    let mut counts: Vec<usize> = Vec::new();
    for run in &net.runs {
        let mut n = 0;
        for node_id in &run.node_ids {
            if let Some(node) = net.nodes.iter().find(|x| &x.id == node_id) {
                flat.extend_from_slice(&[node.x, node.y, node.z]);
                n += 1;
            }
        }
        counts.push(n);
    }
    serde_json::json!({"points": flat, "counts": counts}).to_string()
}

#[cfg(test)]
mod tests {
    #[test]
    fn scaffold_compiles() {}
}
