//! `tray-wasm`: thin wasm-bindgen layer over `tray-tagging` + `tray-routing`
//! (task 5.3).
//!
//! Rule R1: parse -> call core -> serialize. No logic lives here.
//! Errors are plain `{code, message}` JSON objects, never panics.
//! Frame: IFC Z-up f64 in, TS extractor owns the conversion (R3/D4).

use tray_routing::{
    build_connectivity_graph, connected_components, derive_centerline, diagnose_graph,
    shortest_path, Edge, Graph, SegmentRef, Vec3,
};
use tray_tagging::{
    allocate_element_tags, apply_batch, build_register_rows, build_summary_rows,
    classify_taggable_element, effective_assignments, normalize_tag_scheme, preview_conflict,
    undo_batch, validate_tag_integrity, BatchSnapshot, EffectiveElement, ElementRef as TagElem,
    ExcelTag, ExistingTag, PendingEdit, SavedAssignment, SchemeInput, ValidElement,
};
use wasm_bindgen::prelude::*;

/// Error envelope: `{code, message}`.
fn err(code: &str, message: impl Into<String>) -> String {
    serde_json::json!({"code": code, "message": message.into()}).to_string()
}

fn ok<T: serde::Serialize>(v: &T) -> String {
    serde_json::to_string(v).unwrap_or_else(|e| err("E_SCHEMA", e.to_string()))
}

/// Health check: crate versions + capability list.
#[wasm_bindgen]
pub fn tray_wasm_version() -> String {
    "tray-wasm 5.3 (tagging/routing)".to_string()
}

// ---- tagging (5.1) ----

fn parse_scheme(v: &serde_json::Value) -> SchemeInput {
    let get = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
    let tc = v.get("typeCodes");
    SchemeInput {
        prefix: get("prefix"),
        system: get("system"),
        separator: get("separator"),
        sequence_digits_raw: v
            .get("sequenceDigits")
            .map(|x| {
                if let Some(s) = x.as_str() {
                    s.to_string()
                } else {
                    x.to_string()
                }
            })
            .unwrap_or_default(),
        start_sequence_raw: v
            .get("startSequence")
            .map(|x| {
                if let Some(s) = x.as_str() {
                    s.to_string()
                } else {
                    x.to_string()
                }
            })
            .unwrap_or_default(),
        tray_code: tc
            .and_then(|t| t.get("tray"))
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
        fitting_code: tc
            .and_then(|t| t.get("fitting"))
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
    }
}

fn parse_tag_elem(v: &serde_json::Value) -> TagElem {
    TagElem {
        model_id: v
            .get("modelId")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
        local_id: v.get("localId").and_then(|x| x.as_i64()).unwrap_or(0),
        system_tag_hint: String::new(),
    }
}

/// Format a tag: `{systemTag, typeCode, sequenceNumber, separator?}`.
#[wasm_bindgen]
pub fn tagging_format(input_json: &str) -> String {
    let v: serde_json::Value = match serde_json::from_str(input_json) {
        Ok(x) => x,
        Err(e) => return err("E_SCHEMA", e.to_string()),
    };
    let get = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("");
    ok(&serde_json::json!({
        "tag": tray_tagging::format_element_tag(
            get("systemTag"), get("typeCode"), get("sequenceNumber"), get("separator"),
        )
    }))
}

/// Normalize a scheme input; returns the normalized scheme.
#[wasm_bindgen]
pub fn tagging_normalize(scheme_json: &str) -> String {
    let v: serde_json::Value = match serde_json::from_str(scheme_json) {
        Ok(x) => x,
        Err(e) => return err("E_SCHEMA", e.to_string()),
    };
    ok(&normalize_tag_scheme(&parse_scheme(&v)))
}

/// Validate a scheme; returns `{valid, errors, scheme}`.
#[wasm_bindgen]
pub fn tagging_validate(scheme_json: &str) -> String {
    let v: serde_json::Value = match serde_json::from_str(scheme_json) {
        Ok(x) => x,
        Err(e) => return err("E_SCHEMA", e.to_string()),
    };
    ok(&tray_tagging::validate_tag_scheme(&parse_scheme(&v)))
}

/// Allocate tags: `{elements, elementKind, scheme, existingAssignments?}`.
#[wasm_bindgen]
pub fn tagging_allocate(input_json: &str) -> String {
    let v: serde_json::Value = match serde_json::from_str(input_json) {
        Ok(x) => x,
        Err(e) => return err("E_SCHEMA", e.to_string()),
    };
    let elements: Vec<TagElem> = v
        .get("elements")
        .and_then(|e| e.as_array())
        .map(|arr| arr.iter().map(parse_tag_elem).collect())
        .unwrap_or_default();
    let kind = v.get("elementKind").and_then(|x| x.as_str()).unwrap_or("");
    let scheme = parse_scheme(v.get("scheme").unwrap_or(&serde_json::Value::Null));
    let existing: Vec<ExistingTag> = v
        .get("existingAssignments")
        .and_then(|e| e.as_array())
        .map(|arr| {
            arr.iter()
                .map(|a| ExistingTag {
                    element_tag: a
                        .get("elementTag")
                        .and_then(|x| x.as_str())
                        .unwrap_or("")
                        .to_string(),
                    component_id: a
                        .get("componentId")
                        .and_then(|x| x.as_str())
                        .unwrap_or("")
                        .to_string(),
                })
                .collect()
        })
        .unwrap_or_default();
    ok(&allocate_element_tags(&elements, kind, &scheme, &existing))
}

/// Classify one element; ambiguous/unknown -> `{kind: null}`.
#[wasm_bindgen]
pub fn tagging_classify(element_json: &str) -> String {
    let v: serde_json::Value = match serde_json::from_str(element_json) {
        Ok(x) => x,
        Err(e) => return err("E_SCHEMA", e.to_string()),
    };
    let el = v.get("element").unwrap_or(&v);
    let get = |k: &str| el.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
    // legacy reads type OR category for the class check, name/type/objectType/
    // family/category for the text heuristics.
    let class_src = {
        let t = el.get("type").and_then(|x| x.as_str()).unwrap_or("");
        let c = el.get("category").and_then(|x| x.as_str()).unwrap_or("");
        if !t.is_empty() {
            t.to_string()
        } else {
            c.to_string()
        }
    };
    ok(&classify_taggable_element(&tray_tagging::ClassifyElement {
        name: get("name"),
        ifc_type: class_src.clone(),
        object_type: get("objectType"),
        family: get("family"),
        category: el
            .get("category")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
    }))
}

/// Validate integrity: `{elements, excelTags?}`.
#[wasm_bindgen]
pub fn tagging_validate_integrity(input_json: &str) -> String {
    let v: serde_json::Value = match serde_json::from_str(input_json) {
        Ok(x) => x,
        Err(e) => return err("E_SCHEMA", e.to_string()),
    };
    let elements: Vec<ValidElement> = v
        .get("elements")
        .and_then(|e| e.as_array())
        .map(|arr| {
            arr.iter()
                .map(|e| ValidElement {
                    system_tag: e
                        .get("systemTag")
                        .and_then(|x| x.as_str())
                        .unwrap_or("")
                        .to_string(),
                    tag: e
                        .get("tag")
                        .and_then(|x| x.as_str())
                        .unwrap_or("")
                        .to_string(),
                    component_id: e
                        .get("componentId")
                        .and_then(|x| x.as_str())
                        .unwrap_or("")
                        .to_string(),
                })
                .collect()
        })
        .unwrap_or_default();
    let excel: Vec<ExcelTag> = v
        .get("excelTags")
        .and_then(|e| e.as_array())
        .map(|arr| {
            arr.iter()
                .map(|e| ExcelTag {
                    row_number: e.get("rowNumber").and_then(|x| x.as_u64()).unwrap_or(0) as u32,
                    tag: e
                        .get("tag")
                        .and_then(|x| x.as_str())
                        .unwrap_or("")
                        .to_string(),
                })
                .collect()
        })
        .unwrap_or_default();
    ok(&validate_tag_integrity(&elements, &excel))
}

// ---- assignment state (pure model of tagAssignments) ----

fn parse_saved(v: &serde_json::Value) -> SavedAssignment {
    let get = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
    SavedAssignment {
        model_id: get("modelId"),
        model_name: v
            .get("modelName")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
        local_id: v.get("localId").and_then(|x| x.as_i64()).unwrap_or(0),
        system_tag: get("systemTag"),
        element_tag: get("elementTag"),
        component_id: get("componentId"),
        element_kind: get("elementKind"),
        type_code: get("typeCode"),
        sequence_number: get("sequenceNumber"),
        scheme_version: get("schemeVersion"),
        original_ifc_tag: get("originalIfcTag"),
        global_id: get("globalId"),
        name: get("name"),
        ifc_type: get("ifcType"),
    }
}

/// Effective view: `{saved[], pending[]}` -> merged list.
#[wasm_bindgen]
pub fn state_effective(input_json: &str) -> String {
    let v: serde_json::Value = match serde_json::from_str(input_json) {
        Ok(x) => x,
        Err(e) => return err("E_SCHEMA", e.to_string()),
    };
    let saved: Vec<SavedAssignment> = v
        .get("saved")
        .and_then(|s| s.as_array())
        .map(|arr| arr.iter().map(parse_saved).collect())
        .unwrap_or_default();
    let pending: Vec<PendingEdit> = v
        .get("pending")
        .and_then(|s| s.as_array())
        .map(|arr| {
            arr.iter()
                .map(|p| {
                    let a = p.get("assignment").unwrap_or(p);
                    let get = |k: &str| a.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
                    PendingEdit {
                        assignment: tray_tagging::TagAssignment {
                            model_id: get("modelId"),
                            local_id: a.get("localId").and_then(|x| x.as_i64()).unwrap_or(0),
                            system_tag: get("systemTag"),
                            element_tag: get("elementTag"),
                            component_id: get("componentId"),
                            element_kind: get("elementKind"),
                            type_code: get("typeCode"),
                            sequence_number: get("sequenceNumber"),
                            scheme_version: get("schemeVersion"),
                            original_ifc_tag: get("originalIfcTag"),
                            delete: a.get("delete").and_then(|x| x.as_bool()).unwrap_or(false),
                        },
                    }
                })
                .collect()
        })
        .unwrap_or_default();
    ok(&effective_assignments(&saved, &pending))
}

/// Batch apply: `{pending[], batch[]}` -> `{pending, snapshot, count}`.
#[wasm_bindgen]
pub fn state_apply_batch(input_json: &str) -> String {
    let v: serde_json::Value = match serde_json::from_str(input_json) {
        Ok(x) => x,
        Err(e) => return err("E_SCHEMA", e.to_string()),
    };
    // Reuse state_effective parsing for pending; batch items are assignments.
    let pending: Vec<PendingEdit> = v
        .get("pending")
        .and_then(|s| s.as_array())
        .map(|arr| {
            arr.iter()
                .map(|p| {
                    let a = p.get("assignment").unwrap_or(p);
                    parse_pending(a)
                })
                .collect()
        })
        .unwrap_or_default();
    let batch: Vec<tray_tagging::TagAssignment> = v
        .get("batch")
        .and_then(|s| s.as_array())
        .map(|arr| arr.iter().map(parse_assignment).collect())
        .unwrap_or_default();
    let mut pending = pending;
    let mut snapshot: Vec<BatchSnapshot> = Vec::new();
    apply_batch(&mut pending, &mut snapshot, batch);
    serde_json::json!({"pending": pending, "snapshot": snapshot, "count": pending.len()})
        .to_string()
}

fn parse_assignment(a: &serde_json::Value) -> tray_tagging::TagAssignment {
    let get = |k: &str| a.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
    tray_tagging::TagAssignment {
        model_id: get("modelId"),
        local_id: a.get("localId").and_then(|x| x.as_i64()).unwrap_or(0),
        system_tag: get("systemTag"),
        element_tag: get("elementTag"),
        component_id: get("componentId"),
        element_kind: get("elementKind"),
        type_code: get("typeCode"),
        sequence_number: get("sequenceNumber"),
        scheme_version: get("schemeVersion"),
        original_ifc_tag: get("originalIfcTag"),
        delete: a.get("delete").and_then(|x| x.as_bool()).unwrap_or(false),
    }
}

fn parse_pending(a: &serde_json::Value) -> PendingEdit {
    PendingEdit {
        assignment: parse_assignment(a),
    }
}

/// Batch undo: `{pending[], snapshot[]}` -> `{pending, restored}`.
#[wasm_bindgen]
pub fn state_undo_batch(input_json: &str) -> String {
    let v: serde_json::Value = match serde_json::from_str(input_json) {
        Ok(x) => x,
        Err(e) => return err("E_SCHEMA", e.to_string()),
    };
    let mut pending: Vec<PendingEdit> = v
        .get("pending")
        .and_then(|s| s.as_array())
        .map(|arr| {
            arr.iter()
                .map(|p| parse_pending(p.get("assignment").unwrap_or(p)))
                .collect()
        })
        .unwrap_or_default();
    // Snapshot entries are {key, previous|null}; key recomputed on parse.
    let mut snapshot: Vec<BatchSnapshot> = Vec::new();
    if let Some(arr) = v.get("snapshot").and_then(|s| s.as_array()) {
        for e in arr {
            let key = e
                .get("key")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string();
            let previous = e.get("previous").and_then(|p| {
                if p.is_null() {
                    None
                } else {
                    Some(parse_assignment(p))
                }
            });
            snapshot.push(BatchSnapshot { key, previous });
        }
    }
    let restored = undo_batch(&mut pending, &mut snapshot);
    serde_json::json!({"pending": pending, "snapshot": snapshot, "restored": restored}).to_string()
}

/// Preview conflict: `{effective[], modelId, localId, generated}` -> `{conflict|null}`.
#[wasm_bindgen]
pub fn state_preview_conflict(input_json: &str) -> String {
    let v: serde_json::Value = match serde_json::from_str(input_json) {
        Ok(x) => x,
        Err(e) => return err("E_SCHEMA", e.to_string()),
    };
    let effective: Vec<EffectiveElement> = v
        .get("effective")
        .and_then(|s| s.as_array())
        .map(|arr| arr.iter().map(parse_effective).collect())
        .unwrap_or_default();
    let model_id = v.get("modelId").and_then(|x| x.as_str()).unwrap_or("");
    let local_id = v.get("localId").and_then(|x| x.as_i64()).unwrap_or(0);
    let generated = v.get("generated").and_then(|x| x.as_str()).unwrap_or("");
    let c = preview_conflict(&effective, model_id, local_id, generated);
    serde_json::json!({"conflict": c}).to_string()
}

fn parse_effective(e: &serde_json::Value) -> EffectiveElement {
    let get = |k: &str| e.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
    EffectiveElement {
        model_id: get("modelId"),
        model_name: get("modelName"),
        local_id: e.get("localId").and_then(|x| x.as_i64()).unwrap_or(0),
        system_tag: get("systemTag"),
        element_tag: get("elementTag"),
        component_id: get("componentId"),
        element_kind: get("elementKind"),
        type_code: get("typeCode"),
        sequence_number: get("sequenceNumber"),
        scheme_version: get("schemeVersion"),
        original_ifc_tag: get("originalIfcTag"),
        global_id: get("globalId"),
        name: get("name"),
        ifc_type: get("ifcType"),
        source: get("source"),
        was_saved: e.get("wasSaved").and_then(|x| x.as_bool()).unwrap_or(false),
    }
}

/// Register + summary rows: `{effective[]}` -> `{register[], summary[]}`.
#[wasm_bindgen]
pub fn rows_build(input_json: &str) -> String {
    let v: serde_json::Value = match serde_json::from_str(input_json) {
        Ok(x) => x,
        Err(e) => return err("E_SCHEMA", e.to_string()),
    };
    let effective: Vec<EffectiveElement> = v
        .get("effective")
        .and_then(|s| s.as_array())
        .map(|arr| arr.iter().map(parse_effective).collect())
        .unwrap_or_default();
    let register = build_register_rows(&effective);
    let summary = build_summary_rows(&effective);
    serde_json::json!({"register": register, "summary": summary}).to_string()
}

// ---- routing (5.2) ----

fn parse_v3(p: &serde_json::Value) -> Result<Vec3, String> {
    let x = p.get("x").and_then(|v| v.as_f64());
    let y = p.get("y").and_then(|v| v.as_f64());
    let z = p.get("z").and_then(|v| v.as_f64());
    match (x, y, z) {
        (Some(x), Some(y), Some(z)) => Ok(Vec3::new(x, y, z)),
        _ => Err("point needs numeric x/y/z".to_string()),
    }
}

fn parse_seg(s: &serde_json::Value) -> Result<SegmentRef, String> {
    Ok(SegmentRef {
        id: s
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        start: parse_v3(s.get("start").ok_or("segment needs start")?)?,
        end: parse_v3(s.get("end").ok_or("segment needs end")?)?,
        length: s.get("length").and_then(|v| v.as_f64()).unwrap_or(0.0),
        confidence: s.get("confidence").and_then(|v| v.as_f64()),
    })
}

/// Centerline: `{points[], minimumLength?}` (metres Z-up).
#[wasm_bindgen]
pub fn routing_centerline(input_json: &str) -> String {
    let v: serde_json::Value = match serde_json::from_str(input_json) {
        Ok(x) => x,
        Err(e) => return err("E_SCHEMA", e.to_string()),
    };
    let pts: Vec<serde_json::Value> = v
        .get("points")
        .and_then(|p| p.as_array())
        .cloned()
        .unwrap_or_default();
    let mut out = Vec::with_capacity(pts.len());
    for p in &pts {
        match parse_v3(p) {
            Ok(q) => out.push(q),
            Err(m) => return err("E_SCHEMA", m),
        }
    }
    let min_len = v
        .get("minimumLength")
        .and_then(|x| x.as_f64())
        .unwrap_or(1e-4);
    ok(&derive_centerline(&out, min_len))
}

fn parse_graph(v: &serde_json::Value) -> Result<Graph, String> {
    let segs: Vec<SegmentRef> = v
        .get("segments")
        .and_then(|s| s.as_array())
        .map(|arr| arr.iter().map(parse_seg).collect::<Result<Vec<_>, _>>())
        .unwrap_or(Ok(Vec::new()))?;
    let tol = v.get("tolerance").and_then(|x| x.as_f64()).unwrap_or(0.1);
    Ok(build_connectivity_graph(&segs, tol))
}

/// Build graph: `{segments[], tolerance?}` — segments cross as arrays.
#[wasm_bindgen]
pub fn routing_build_graph(input_json: &str) -> String {
    let v: serde_json::Value = match serde_json::from_str(input_json) {
        Ok(x) => x,
        Err(e) => return err("E_SCHEMA", e.to_string()),
    };
    match parse_graph(&v) {
        Ok(g) => ok(&WireGraph::from(&g)),
        Err(m) => err("E_SCHEMA", m),
    }
}

/// Wire graph: nodes/edges/component lists (no Maps).
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WireGraph {
    nodes: Vec<WireNode>,
    edges: Vec<WireEdge>,
    segment_to_edge: Vec<(String, String)>,
    tolerance: f64,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WireNode {
    id: String,
    position: Vec3,
    endpoint_refs: Vec<tray_routing::EndpointRef>,
    edge_ids: Vec<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WireEdge {
    id: String,
    from: String,
    to: String,
    length: f64,
    segment_id: String,
    confidence: Option<f64>,
}

impl WireGraph {
    fn from(g: &Graph) -> Self {
        WireGraph {
            nodes: g
                .nodes
                .iter()
                .map(|n| WireNode {
                    id: n.id.clone(),
                    position: n.position,
                    endpoint_refs: n.endpoint_refs.clone(),
                    edge_ids: n.edge_ids.clone(),
                })
                .collect(),
            edges: g
                .edges
                .iter()
                .map(|e| WireEdge {
                    id: e.id.clone(),
                    from: e.from.clone(),
                    to: e.to.clone(),
                    length: e.length,
                    segment_id: e.segment_id.clone(),
                    confidence: e.confidence,
                })
                .collect(),
            segment_to_edge: g.segment_to_edge.clone(),
            tolerance: g.tolerance,
        }
    }
}

/// Components: `{graph}` (graph as produced by routing_build_graph).
#[wasm_bindgen]
pub fn routing_components(graph_json: &str) -> String {
    match parse_wire_graph(graph_json) {
        Ok(g) => ok(&connected_components(&g)),
        Err(m) => err("E_SCHEMA", m),
    }
}

fn parse_wire_graph(s: &str) -> Result<Graph, String> {
    let v: serde_json::Value =
        serde_json::from_str(s).map_err(|e| format!("invalid graph JSON: {e}"))?;
    let nodes: Vec<tray_routing::Node> = v
        .get("nodes")
        .and_then(|n| n.as_array())
        .map(|arr| {
            arr.iter()
                .map(|n| {
                    Ok(tray_routing::Node {
                        id: n
                            .get("id")
                            .and_then(|x| x.as_str())
                            .unwrap_or("")
                            .to_string(),
                        position: parse_v3(n.get("position").ok_or("node needs position")?)?,
                        endpoint_refs: n
                            .get("endpointRefs")
                            .and_then(|e| e.as_array())
                            .map(|refs| {
                                refs.iter()
                                    .map(|r| tray_routing::EndpointRef {
                                        segment_id: r
                                            .get("segmentId")
                                            .and_then(|x| x.as_str())
                                            .unwrap_or("")
                                            .to_string(),
                                        end: r
                                            .get("end")
                                            .and_then(|x| x.as_str())
                                            .unwrap_or("")
                                            .to_string(),
                                    })
                                    .collect()
                            })
                            .unwrap_or_default(),
                        edge_ids: n
                            .get("edgeIds")
                            .and_then(|e| e.as_array())
                            .map(|ids| {
                                ids.iter()
                                    .filter_map(|x| x.as_str().map(|s| s.to_string()))
                                    .collect()
                            })
                            .unwrap_or_default(),
                    })
                })
                .collect::<Result<Vec<_>, String>>()
        })
        .unwrap_or(Ok(Vec::new()))?;
    let edges: Vec<Edge> = v
        .get("edges")
        .and_then(|n| n.as_array())
        .map(|arr| {
            arr.iter()
                .map(|e| Edge {
                    id: e
                        .get("id")
                        .and_then(|x| x.as_str())
                        .unwrap_or("")
                        .to_string(),
                    from: e
                        .get("from")
                        .and_then(|x| x.as_str())
                        .unwrap_or("")
                        .to_string(),
                    to: e
                        .get("to")
                        .and_then(|x| x.as_str())
                        .unwrap_or("")
                        .to_string(),
                    length: e.get("length").and_then(|x| x.as_f64()).unwrap_or(0.0),
                    segment_id: e
                        .get("segmentId")
                        .and_then(|x| x.as_str())
                        .unwrap_or("")
                        .to_string(),
                    confidence: e.get("confidence").and_then(|x| x.as_f64()),
                })
                .collect()
        })
        .unwrap_or_default();
    let segment_to_edge: Vec<(String, String)> = v
        .get("segment_to_edge")
        .and_then(|n| n.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|p| {
                    Some((
                        p.get(0)?.as_str()?.to_string(),
                        p.get(1)?.as_str()?.to_string(),
                    ))
                })
                .collect()
        })
        .unwrap_or_default();
    let tolerance = v.get("tolerance").and_then(|x| x.as_f64()).unwrap_or(0.1);
    Ok(Graph {
        nodes,
        edges,
        segment_to_edge,
        tolerance,
    })
}

/// Diagnose: `{graph, minimumConfidence?}`.
#[wasm_bindgen]
pub fn routing_diagnose(input_json: &str) -> String {
    let v: serde_json::Value = match serde_json::from_str(input_json) {
        Ok(x) => x,
        Err(e) => return err("E_SCHEMA", e.to_string()),
    };
    let g = match v.get("graph").map(|g| parse_wire_graph(&g.to_string())) {
        Some(Ok(g)) => g,
        Some(Err(m)) => return err("E_SCHEMA", m),
        None => match parse_graph(&v) {
            Ok(g) => g,
            Err(m) => return err("E_SCHEMA", m),
        },
    };
    let min_conf = v
        .get("minimumConfidence")
        .and_then(|x| x.as_f64())
        .unwrap_or(0.65);
    let d = diagnose_graph(&g, min_conf);
    ok(&WireDiagnosis::from(&d))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WireDiagnosis {
    segment_count: usize,
    node_count: usize,
    component_count: usize,
    component_edge_sizes: Vec<usize>,
    dangling_nodes: Vec<String>,
    ambiguous_nodes: Vec<String>,
    low_confidence_edges: Vec<String>,
    is_connected: bool,
}

impl WireDiagnosis {
    fn from(d: &tray_routing::Diagnosis) -> Self {
        WireDiagnosis {
            segment_count: d.segment_count,
            node_count: d.node_count,
            component_count: d.component_count,
            component_edge_sizes: d.components.iter().map(|c| c.edge_ids.len()).collect(),
            dangling_nodes: d.dangling_nodes.clone(),
            ambiguous_nodes: d.ambiguous_nodes.clone(),
            low_confidence_edges: d.low_confidence_edges.clone(),
            is_connected: d.is_connected,
        }
    }
}

/// Shortest path: `{graph, from, to, excludeEdgeIds?}` — `from`/`to` accept
/// `edge-start:<id>` / `edge-end:<id>` refs like the legacy runner.
#[wasm_bindgen]
pub fn routing_shortest_path(input_json: &str) -> String {
    let v: serde_json::Value = match serde_json::from_str(input_json) {
        Ok(x) => x,
        Err(e) => return err("E_SCHEMA", e.to_string()),
    };
    let g = match v.get("graph").map(|g| parse_wire_graph(&g.to_string())) {
        Some(Ok(g)) => g,
        Some(Err(m)) => return err("E_SCHEMA", m),
        None => match parse_graph(&v) {
            Ok(g) => g,
            Err(m) => return err("E_SCHEMA", m),
        },
    };
    let resolve = |r: &str| -> String {
        if let Some((kind, id)) = r.split_once(':') {
            if let Some(e) = g.edges.iter().find(|e| e.id == id) {
                return if kind == "edge-start" {
                    e.from.clone()
                } else {
                    e.to.clone()
                };
            }
        }
        r.to_string()
    };
    let from = resolve(v.get("from").and_then(|x| x.as_str()).unwrap_or(""));
    let to = resolve(v.get("to").and_then(|x| x.as_str()).unwrap_or(""));
    let exclude: Vec<String> = v
        .get("excludeEdgeIds")
        .and_then(|e| e.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();
    let p = shortest_path(&g, &from, &to, &exclude);
    ok(&WirePath::from(&p))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WirePath {
    found: bool,
    reason: String,
    node_ids: Vec<String>,
    edge_ids: Vec<String>,
    length: Option<f64>,
}

impl WirePath {
    fn from(p: &tray_routing::Path) -> Self {
        WirePath {
            found: p.found,
            reason: p.reason.clone(),
            node_ids: p.node_ids.clone(),
            edge_ids: p.edge_ids.clone(),
            length: if p.length.is_finite() {
                Some(p.length)
            } else {
                None
            },
        }
    }
}
