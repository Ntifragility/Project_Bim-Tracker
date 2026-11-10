//! `tagging.json` (33) + `validator.json` (7) vectors as Rust tests (task 5.1).

use super::*;

fn scheme_input(
    prefix: &str,
    system: &str,
    separator: &str,
    digits: &str,
    start: &str,
    tray: &str,
    fitting: &str,
) -> SchemeInput {
    SchemeInput {
        prefix: prefix.to_string(),
        system: system.to_string(),
        separator: separator.to_string(),
        sequence_digits_raw: digits.to_string(),
        start_sequence_raw: start.to_string(),
        tray_code: tray.to_string(),
        fitting_code: fitting.to_string(),
    }
}

fn std_scheme() -> SchemeInput {
    scheme_input("PT", "1", ".", "2", "1", "01", "02")
}

fn elem(local_id: i64) -> ElementRef {
    ElementRef {
        model_id: String::new(),
        local_id,
        system_tag_hint: String::new(),
    }
}

#[test]
fn vec_get_system_tag() {
    let s = normalize_tag_scheme(&scheme_input("PT", "1", "", "", "", "", ""));
    assert_eq!(get_system_tag(&s), "PT1");
}

#[test]
fn vec_format_element_tag() {
    assert_eq!(format_element_tag("PT1", "01", "03", "."), "PT1.01.03");
}

#[test]
fn vec_format_custom_separator() {
    assert_eq!(format_element_tag("S", "T", "7", "-"), "S-T-7");
}

#[test]
fn vec_parse_generated_tag() {
    let s = normalize_tag_scheme(&std_scheme());
    let p = parse_generated_element_tag("PT1.02.14", &s).unwrap();
    assert_eq!(p.system_tag, "PT1");
    assert_eq!(p.type_code, "02");
    assert_eq!(p.sequence_number, "14");
    assert_eq!(p.sequence, 14);
}

#[test]
fn vec_parse_wrong_parts() {
    let s = normalize_tag_scheme(&std_scheme());
    assert!(parse_generated_element_tag("PT1.01", &s).is_none());
}

#[test]
fn vec_parse_non_numeric_sequence() {
    let s = normalize_tag_scheme(&std_scheme());
    assert!(parse_generated_element_tag("PT1.01.XX", &s).is_none());
}

#[test]
fn vec_normalize_trims_and_defaults() {
    let s = normalize_tag_scheme(&scheme_input(" PT ", "1", "-", "3", "", "", ""));
    assert_eq!(s.prefix, "PT");
    assert_eq!(s.system, "1");
    assert_eq!(s.separator, "-");
    assert_eq!(s.sequence_digits, 3);
    assert_eq!(s.start_sequence, 1);
    assert_eq!(s.type_codes.tray, "01");
    assert_eq!(s.type_codes.fitting, "02");
}

#[test]
fn vec_normalize_clamps_digits() {
    let s = normalize_tag_scheme(&scheme_input("P", "1", "", "0", "", "", ""));
    assert_eq!(s.sequence_digits, 2);
}

#[test]
fn vec_normalize_clamps_digits_high() {
    let s = normalize_tag_scheme(&scheme_input("P", "1", "", "7", "", "", ""));
    assert_eq!(s.sequence_digits, 2);
}

#[test]
fn vec_normalize_default_type_codes() {
    let s = normalize_tag_scheme(&SchemeInput::default());
    assert_eq!(s.type_codes.tray, "01");
    assert_eq!(s.type_codes.fitting, "02");
    assert_eq!(s.separator, ".");
    assert_eq!(s.sequence_digits, 2);
    assert_eq!(s.start_sequence, 1);
}

#[test]
fn vec_validate_ok() {
    let v = validate_tag_scheme(&std_scheme());
    assert!(v.valid);
    assert!(v.errors.is_empty());
}

#[test]
fn vec_validate_blank_prefix() {
    let v = validate_tag_scheme(&scheme_input("", "1", ".", "2", "", "01", "02"));
    assert!(!v.valid);
    assert_eq!(v.errors, vec!["Enter a tag prefix.".to_string()]);
}

#[test]
fn vec_validate_separator_in_prefix() {
    let v = validate_tag_scheme(&scheme_input("P.T", "1", ".", "", "", "01", "02"));
    assert!(!v.valid);
    assert!(v.errors.iter().any(|e| e.contains("cannot contain the")));
}

#[test]
fn vec_validate_duplicate_type_codes() {
    let v = validate_tag_scheme(&scheme_input("P", "1", ".", "", "", "01", "01"));
    assert!(!v.valid);
    assert!(v.errors.iter().any(|e| e.contains("must be different")));
}

fn existing(tags: &[&str]) -> Vec<ExistingTag> {
    tags.iter()
        .map(|t| ExistingTag {
            element_tag: String::new(),
            component_id: t.to_string(),
        })
        .collect()
}

fn tags_of(r: &AllocateResult) -> Vec<String> {
    r.assignments
        .iter()
        .map(|a| a.element_tag.clone())
        .collect()
}

#[test]
fn vec_allocate_tray_sequence() {
    let r = allocate_element_tags(&[elem(1), elem(2), elem(3)], "tray", &std_scheme(), &[]);
    assert!(r.valid);
    assert_eq!(tags_of(&r), vec!["PT1.01.01", "PT1.01.02", "PT1.01.03"]);
    assert!(r.assignments.iter().all(|a| a.scheme_version == "2"));
    assert!(r
        .assignments
        .iter()
        .all(|a| a.component_id == a.element_tag));
}

#[test]
fn vec_allocate_fitting_independent_sequence() {
    let r = allocate_element_tags(&[elem(4), elem(5)], "fitting", &std_scheme(), &[]);
    assert!(r.valid);
    assert_eq!(tags_of(&r), vec!["PT1.02.01", "PT1.02.02"]);
}

#[test]
fn vec_allocate_appends_after_gap() {
    let r = allocate_element_tags(
        &[elem(3)],
        "tray",
        &std_scheme(),
        &existing(&["PT1.01.01", "PT1.01.03"]),
    );
    assert!(r.valid);
    assert_eq!(tags_of(&r), vec!["PT1.01.04"]);
}

#[test]
fn vec_allocate_ignores_other_system() {
    let r = allocate_element_tags(
        &[elem(1)],
        "tray",
        &std_scheme(),
        &existing(&["OTHER.01.05"]),
    );
    assert!(r.valid);
    assert_eq!(tags_of(&r), vec!["PT1.01.01"]);
}

#[test]
fn vec_allocate_ignores_other_type() {
    let r = allocate_element_tags(&[elem(1)], "tray", &std_scheme(), &existing(&["PT1.02.05"]));
    assert!(r.valid);
    assert_eq!(tags_of(&r), vec!["PT1.01.01"]);
}

#[test]
fn vec_allocate_matches_case_insensitive() {
    let r = allocate_element_tags(&[elem(1)], "tray", &std_scheme(), &existing(&["pt1.01.02"]));
    assert!(r.valid);
    assert_eq!(tags_of(&r), vec!["PT1.01.03"]);
}

#[test]
fn vec_allocate_after_high_reserved() {
    let r = allocate_element_tags(
        &[elem(1), elem(2)],
        "fitting",
        &std_scheme(),
        &existing(&["PT1.02.05"]),
    );
    assert!(r.valid);
    assert_eq!(tags_of(&r), vec!["PT1.02.06", "PT1.02.07"]);
}

#[test]
fn vec_allocate_sequence_overflow() {
    let scheme = scheme_input("PT", "1", ".", "2", "99", "01", "02");
    let r = allocate_element_tags(&[elem(100)], "tray", &scheme, &existing(&["PT1.01.99"]));
    assert!(!r.valid);
    assert!(r.assignments.is_empty());
    assert!(r.errors.iter().any(|e| e.contains("sequence is full")));
}

#[test]
fn vec_allocate_unknown_kind() {
    let r = allocate_element_tags(&[elem(1)], "duct", &std_scheme(), &[]);
    assert!(!r.valid);
    assert!(r.assignments.is_empty());
    assert!(r
        .errors
        .iter()
        .any(|e| e.contains("Cable Tray or Cable Fitting")));
}
