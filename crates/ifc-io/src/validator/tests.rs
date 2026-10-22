//! `validator.json` vectors as Rust tests (task 3.2, spec R10).

use super::*;

fn el(local_id: u64, system_tag: &str, component_id: &str) -> ValidatedElement {
    ValidatedElement {
        local_id,
        system_tag: system_tag.to_string(),
        component_id: component_id.to_string(),
    }
}

fn xl(row: u64, tag: &str) -> ExcelTag {
    ExcelTag {
        row_number: row,
        tag: tag.to_string(),
    }
}

#[test]
fn validator_accept_unique_matched() {
    let r = validate_tag_integrity(&[el(1, " CT-001 ", "CT-001-C001")], &[xl(2, "ct-001")]);
    assert!(r.valid);
    assert!(r.errors.is_empty() && r.warnings.is_empty());
    assert_eq!(
        (r.ifc_tag_count, r.excel_tag_count, r.matched_tag_count),
        (1, 1, 1)
    );
}

#[test]
fn validator_duplicates_and_blanks() {
    let r = validate_tag_integrity(
        &[
            el(1, "CT-001", "CT-001-C001"),
            el(2, "ct-001", "ct-001-c001"),
        ],
        &[xl(2, "CT-001"), xl(3, " ct-001 "), xl(4, " ")],
    );
    assert!(!r.valid);
    let mut codes: Vec<&str> = r.errors.iter().map(|e| e.code).collect();
    codes.sort();
    assert_eq!(
        codes,
        vec![
            "blank-excel-tag",
            "duplicate-component-id",
            "duplicate-excel-tag"
        ]
    );
}

#[test]
fn validator_duplicate_component_message() {
    let r = validate_tag_integrity(
        &[
            el(1, "CT-001", "CT-001-C001"),
            el(2, "ct-001", "ct-001-c001"),
        ],
        &[xl(2, "CT-001")],
    );
    assert_eq!(r.errors[0].code, "duplicate-component-id");
    assert!(r.errors[0].message.contains("used by 2 IFC elements"));
}

#[test]
fn validator_missing_component_id() {
    let r = validate_tag_integrity(&[el(1, "SYS", "")], &[]);
    assert!(!r.valid);
    assert!(r.errors.iter().any(|e| e.code == "missing-component-id"));
}

#[test]
fn validator_unmatched_are_warnings() {
    let r = validate_tag_integrity(
        &[el(1, "IFC-ONLY", "IFC-ONLY-C001")],
        &[xl(2, "EXCEL-ONLY")],
    );
    assert!(r.valid);
    let mut codes: Vec<&str> = r.warnings.iter().map(|w| w.code).collect();
    codes.sort();
    assert_eq!(
        codes,
        vec!["ifc-tags-missing-from-excel", "unassigned-excel-tags"]
    );
}

#[test]
fn validator_no_excel_ok() {
    let r = validate_tag_integrity(&[el(1, "SYS-001", "SYS-001-C001")], &[]);
    assert!(r.valid && r.warnings.is_empty());
    let r = validate_tag_integrity(&[], &[]);
    assert!(r.valid);
}
