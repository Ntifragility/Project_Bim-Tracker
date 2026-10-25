//! `validator.json` (7) vectors as Rust tests.

use super::*;

fn element(system_tag: &str, component_id: &str) -> ValidElement {
    ValidElement {
        system_tag: system_tag.to_string(),
        tag: String::new(),
        component_id: component_id.to_string(),
    }
}

fn excel(row: u32, tag: &str) -> ExcelTag {
    ExcelTag {
        row_number: row,
        tag: tag.to_string(),
    }
}

fn codes(report: &IntegrityReport) -> Vec<&str> {
    report.errors.iter().map(|e| e.code.as_str()).collect()
}

fn wcodes(report: &IntegrityReport) -> Vec<&str> {
    report.warnings.iter().map(|w| w.code.as_str()).collect()
}

#[test]
fn vec_accept_unique_matched() {
    let r = validate_tag_integrity(&[element(" CT-001 ", "CT-001-C001")], &[excel(2, "ct-001")]);
    assert!(r.valid);
    assert!(r.errors.is_empty());
    assert!(r.warnings.is_empty());
    assert_eq!(
        r.counts,
        IntegrityCounts {
            ifc_tags: 1,
            excel_tags: 1,
            matched_tags: 1,
            errors: 0,
            warnings: 0,
        }
    );
}

#[test]
fn vec_duplicates_and_blanks() {
    let r = validate_tag_integrity(
        &[
            element("CT-001", "CT-001-C001"),
            element("ct-001", "ct-001-c001"),
        ],
        &[excel(2, "CT-001"), excel(3, " ct-001 "), excel(4, " ")],
    );
    assert!(!r.valid);
    assert_eq!(
        codes(&r),
        vec![
            "duplicate-component-id",
            "duplicate-excel-tag",
            "blank-excel-tag"
        ]
    );
    assert_eq!(
        r.counts,
        IntegrityCounts {
            ifc_tags: 1,
            excel_tags: 3,
            matched_tags: 2,
            errors: 3,
            warnings: 0,
        }
    );
}

#[test]
fn vec_duplicate_component_message() {
    let r = validate_tag_integrity(
        &[
            element("CT-001", "CT-001-C001"),
            element("ct-001", "ct-001-c001"),
        ],
        &[excel(2, "CT-001")],
    );
    assert!(!r.valid);
    assert_eq!(r.errors[0].code, "duplicate-component-id");
    assert!(r.errors[0].message.contains("used by 2 IFC elements"));
}

#[test]
fn vec_missing_component_id() {
    let r = validate_tag_integrity(&[element("SYS", "")], &[]);
    assert!(!r.valid);
    assert_eq!(codes(&r), vec!["missing-component-id"]);
}

#[test]
fn vec_unmatched_are_warnings() {
    let r = validate_tag_integrity(
        &[element("IFC-ONLY", "IFC-ONLY-C001")],
        &[excel(2, "EXCEL-ONLY")],
    );
    assert!(r.valid);
    assert_eq!(
        wcodes(&r),
        vec!["unassigned-excel-tags", "ifc-tags-missing-from-excel"]
    );
    assert_eq!(
        r.counts,
        IntegrityCounts {
            ifc_tags: 1,
            excel_tags: 1,
            matched_tags: 0,
            errors: 0,
            warnings: 2,
        }
    );
}

#[test]
fn vec_no_excel_list_ok() {
    let r = validate_tag_integrity(&[element("SYS-001", "SYS-001-C001")], &[]);
    assert!(r.valid);
    assert_eq!(
        r.counts,
        IntegrityCounts {
            ifc_tags: 1,
            excel_tags: 0,
            matched_tags: 0,
            errors: 0,
            warnings: 0,
        }
    );
}

#[test]
fn vec_empty_input_ok() {
    let r = validate_tag_integrity(&[], &[]);
    assert!(r.valid);
    assert_eq!(r.counts, IntegrityCounts::default());
}
