//! Register/summary row tests (new vectors for
//! `spec/vectors/tray/tagging-state.json`, added by task 5.1).

use super::super::rows::*;
use super::super::state::EffectiveElement;

fn eff(
    model: &str,
    local: i64,
    system: &str,
    tag: &str,
    kind: &str,
    source: &str,
) -> EffectiveElement {
    EffectiveElement {
        model_id: model.to_string(),
        model_name: format!("{model}.ifc"),
        local_id: local,
        system_tag: system.to_string(),
        element_tag: tag.to_string(),
        component_id: tag.to_string(),
        element_kind: kind.to_string(),
        type_code: String::new(),
        sequence_number: String::new(),
        scheme_version: "2".to_string(),
        original_ifc_tag: String::new(),
        global_id: String::new(),
        name: String::new(),
        ifc_type: String::new(),
        source: source.to_string(),
        was_saved: false,
    }
}

#[test]
fn rows_register_sorted() {
    let list = vec![
        eff("m1", 3, "PT2", "PT2.01.01", "tray", "pending"),
        eff("m1", 1, "PT1", "PT1.01.02", "tray", "ifc"),
        eff("m1", 2, "PT1", "PT1.01.01", "fitting", "ifc"),
    ];
    let rows = build_register_rows(&list);
    let tags: Vec<&str> = rows.iter().map(|r| r.element_tag.as_str()).collect();
    assert_eq!(tags, vec!["PT1.01.01", "PT1.01.02", "PT2.01.01"]);
    assert_eq!(rows[0].source, "ifc");
    assert_eq!(rows[2].source, "pending");
}

#[test]
fn rows_summary_counts() {
    let list = vec![
        eff("m1", 1, "PT1", "PT1.01.01", "tray", "ifc"),
        eff("m1", 2, "PT1", "PT1.01.02", "tray", "pending"),
        eff("m2", 5, "PT2", "PT2.02.01", "fitting", "ifc"),
    ];
    let rows = build_summary_rows(&list);
    let get = |group: &str, key: &str| -> usize {
        rows.iter()
            .find(|r| r.group == group && r.key == key)
            .map(|r| r.count)
            .unwrap_or(0)
    };
    assert_eq!(get("system", "PT1"), 2);
    assert_eq!(get("system", "PT2"), 1);
    assert_eq!(get("kind", "tray"), 2);
    assert_eq!(get("kind", "fitting"), 1);
    assert_eq!(get("model", "m1.ifc"), 2);
    assert_eq!(get("model", "m2.ifc"), 1);
    assert_eq!(get("source", "ifc"), 2);
    assert_eq!(get("source", "pending"), 1);
}
