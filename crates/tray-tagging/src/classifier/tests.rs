//! `classifyTaggableElement` vectors (10) as Rust tests.

use super::*;

fn el(ifc_type: &str, name: &str) -> ElementRef {
    ElementRef {
        name: name.to_string(),
        ifc_type: ifc_type.to_string(),
        ..Default::default()
    }
}

#[test]
fn vec_classify_ifc_tray_class() {
    let c = classify_taggable_element(&el("IfcCableCarrierSegment", ""));
    assert_eq!(c.kind.as_deref(), Some("tray"));
    assert_eq!(c.confidence, 1.0);
}

#[test]
fn vec_classify_ifc_fitting_class() {
    let c = classify_taggable_element(&el("IfcCableCarrierFitting", ""));
    assert_eq!(c.kind.as_deref(), Some("fitting"));
    assert_eq!(c.confidence, 1.0);
}

#[test]
fn vec_classify_ifc_cable_fitting() {
    let c = classify_taggable_element(&el("IFCCableFitting", ""));
    assert_eq!(c.kind.as_deref(), Some("fitting"));
    assert_eq!(c.confidence, 1.0);
}

#[test]
fn vec_classify_tray_by_name() {
    let c = classify_taggable_element(&el("IfcBuildingElementPart", "Cable Tray Run"));
    assert_eq!(c.kind.as_deref(), Some("tray"));
    assert_eq!(c.confidence, 0.72);
}

#[test]
fn vec_classify_fitting_by_name() {
    let c = classify_taggable_element(&el("IfcBuildingElementPart", "Elbow fitting"));
    assert_eq!(c.kind.as_deref(), Some("fitting"));
    assert_eq!(c.confidence, 0.72);
}

#[test]
fn vec_classify_spanish_tray() {
    let c = classify_taggable_element(&el("X", "Bandeja de cables"));
    assert_eq!(c.kind.as_deref(), Some("tray"));
    assert_eq!(c.confidence, 0.72);
}

#[test]
fn vec_classify_spanish_fitting() {
    let c = classify_taggable_element(&el("X", "Codo 90"));
    assert_eq!(c.kind.as_deref(), Some("fitting"));
    assert_eq!(c.confidence, 0.72);
}

#[test]
fn vec_classify_reducer_fitting() {
    let c = classify_taggable_element(&el("X", "Reducer 100x50"));
    assert_eq!(c.kind.as_deref(), Some("fitting"));
    assert_eq!(c.confidence, 0.72);
}

#[test]
fn vec_classify_ambiguous_returns_null() {
    let c = classify_taggable_element(&el("IfcBuildingElementPart", "Cable Tray with Fittings"));
    assert_eq!(c.kind, None);
    assert_eq!(c.confidence, 0.0);
}

#[test]
fn vec_classify_unknown_returns_null() {
    let c = classify_taggable_element(&el("IfcValve", ""));
    assert_eq!(c.kind, None);
    assert_eq!(c.confidence, 0.0);
}
