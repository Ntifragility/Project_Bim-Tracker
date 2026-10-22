//! `value.json` vectors as Rust tests (task 3.2, spec R6-R7).

use super::*;

#[test]
fn value_strings() {
    assert_eq!(
        format_typed_value(IfcValueType::Label, "Ready's").unwrap(),
        "'Ready''s'"
    );
    assert_eq!(
        format_typed_value(IfcValueType::Text, "plain").unwrap(),
        "'plain'"
    );
    assert_eq!(
        format_typed_value(IfcValueType::Identifier, "03.02.015").unwrap(),
        "'03.02.015'"
    );
}

#[test]
fn value_boolean() {
    assert_eq!(
        format_typed_value(IfcValueType::Boolean, "yes").unwrap(),
        ".T."
    );
    assert_eq!(
        format_typed_value(IfcValueType::Boolean, ".f.").unwrap(),
        ".F."
    );
    assert!(format_typed_value(IfcValueType::Boolean, "maybe").is_err());
}

#[test]
fn value_integer() {
    assert_eq!(
        format_typed_value(IfcValueType::Integer, "-12").unwrap(),
        "-12"
    );
    assert!(format_typed_value(IfcValueType::Integer, "abc").is_err());
}

#[test]
fn value_real() {
    assert_eq!(
        format_typed_value(IfcValueType::Real, "35.0").unwrap(),
        "35."
    );
    assert_eq!(
        format_typed_value(IfcValueType::Real, "35.5").unwrap(),
        "35.5"
    );
    assert!(format_typed_value(IfcValueType::Real, "abc").is_err());
}

#[test]
fn value_date_datetime() {
    assert_eq!(
        format_typed_value(IfcValueType::Date, "2026-08-15").unwrap(),
        "'2026-08-15'"
    );
    assert!(format_typed_value(IfcValueType::Date, "15-08-2026").is_err());
    assert_eq!(
        format_typed_value(IfcValueType::DateTime, "2026-08-15T10:00").unwrap(),
        "'2026-08-15T10:00'"
    );
}

#[test]
fn value_unknown_type() {
    assert!(parse_value_type("IFCWALL").is_err());
}

#[test]
fn value_pset_gate() {
    assert!(is_writable_pset("BIM_TRACKER_EDIT"));
    assert!(is_writable_pset("COSAPI_CONSTRUCTION"));
    assert!(is_writable_pset("cosapi_x1"));
    assert!(!is_writable_pset("Pset_X"));
}
