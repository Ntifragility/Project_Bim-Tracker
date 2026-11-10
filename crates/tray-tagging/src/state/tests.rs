//! Assignment-state + row-builder tests (new vectors for
//! `spec/vectors/tray/tagging-state.json`, added by task 5.1).

use super::super::scheme::TagAssignment;
use super::super::state::*;

fn saved(model: &str, local: i64, system: &str, tag: &str) -> SavedAssignment {
    SavedAssignment {
        model_id: model.to_string(),
        model_name: format!("{model}.ifc"),
        local_id: local,
        system_tag: system.to_string(),
        element_tag: tag.to_string(),
        component_id: tag.to_string(),
        element_kind: "tray".to_string(),
        type_code: "01".to_string(),
        sequence_number: String::new(),
        scheme_version: "2".to_string(),
        original_ifc_tag: String::new(),
        global_id: String::new(),
        name: String::new(),
        ifc_type: String::new(),
    }
}

fn assign(model: &str, local: i64, system: &str, tag: &str) -> TagAssignment {
    TagAssignment {
        model_id: model.to_string(),
        local_id: local,
        system_tag: system.to_string(),
        element_tag: tag.to_string(),
        component_id: tag.to_string(),
        element_kind: "tray".to_string(),
        type_code: "01".to_string(),
        sequence_number: String::new(),
        scheme_version: "2".to_string(),
        original_ifc_tag: String::new(),
        delete: false,
    }
}

#[test]
fn state_effective_overlay_pending_modify() {
    let saved_list = vec![saved("m1", 1, "PT1", "PT1.01.01")];
    let pending = vec![PendingEdit {
        assignment: assign("m1", 1, "PT1", "PT1.01.09"),
    }];
    let eff = effective_assignments(&saved_list, &pending);
    assert_eq!(eff.len(), 1);
    assert_eq!(eff[0].element_tag, "PT1.01.09");
    assert_eq!(eff[0].source, "pending");
    assert!(eff[0].was_saved);
}

#[test]
fn state_pending_delete_removes_key() {
    let saved_list = vec![
        saved("m1", 1, "PT1", "PT1.01.01"),
        saved("m1", 2, "PT1", "PT1.01.02"),
    ];
    let mut del = assign("m1", 1, "PT1", "PT1.01.01");
    del.delete = true;
    let pending = vec![PendingEdit { assignment: del }];
    let eff = effective_assignments(&saved_list, &pending);
    assert_eq!(eff.len(), 1);
    assert_eq!(eff[0].local_id, 2);
}

#[test]
fn state_batch_apply_and_undo() {
    let mut pending: Vec<PendingEdit> = Vec::new();
    let mut snapshot: Vec<BatchSnapshot> = Vec::new();
    apply_batch(
        &mut pending,
        &mut snapshot,
        vec![
            assign("m1", 1, "PT1", "PT1.01.01"),
            assign("m1", 2, "PT1", "PT1.01.02"),
        ],
    );
    assert_eq!(pending.len(), 2);
    assert_eq!(snapshot.len(), 2);
    assert!(snapshot.iter().all(|s| s.previous.is_none()));
    // Second batch overwrites the snapshot (single level).
    apply_batch(
        &mut pending,
        &mut snapshot,
        vec![assign("m1", 1, "PT1", "PT1.01.05")],
    );
    assert_eq!(snapshot.len(), 1);
    assert_eq!(
        snapshot[0].previous.as_ref().unwrap().element_tag,
        "PT1.01.01"
    );
    let restored = undo_batch(&mut pending, &mut snapshot);
    assert_eq!(restored, 1);
    assert!(snapshot.is_empty());
    let tags: Vec<&str> = pending
        .iter()
        .map(|p| p.assignment.element_tag.as_str())
        .collect();
    assert!(tags.contains(&"PT1.01.01"));
    assert!(tags.contains(&"PT1.01.02"));
}

#[test]
fn state_preview_conflict() {
    let eff = vec![EffectiveElement {
        model_id: "m1".to_string(),
        model_name: String::new(),
        local_id: 7,
        system_tag: "PT9".to_string(),
        element_tag: "PT9.01.01".to_string(),
        component_id: "PT9.01.01".to_string(),
        element_kind: "tray".to_string(),
        type_code: "01".to_string(),
        sequence_number: String::new(),
        scheme_version: "2".to_string(),
        original_ifc_tag: String::new(),
        global_id: String::new(),
        name: String::new(),
        ifc_type: String::new(),
        source: "ifc".to_string(),
        was_saved: false,
    }];
    // Same tag (case-insensitive) -> no conflict.
    assert!(preview_conflict(&eff, "m1", 7, "pt9.01.01").is_none());
    // Different tag -> conflict with the previous tag.
    assert_eq!(
        preview_conflict(&eff, "m1", 7, "PT1.01.01").as_deref(),
        Some("PT9.01.01")
    );
    // Unknown element -> no conflict.
    assert!(preview_conflict(&eff, "m1", 99, "PT1.01.01").is_none());
}
