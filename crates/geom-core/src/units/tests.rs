//! `units.json` acceptance vectors as Rust tests (task 3.1, spec R9).

use super::*;

#[test]
fn units_table_factors() {
    assert_eq!(Unit::Metre.factor_to_metres(), 1.0);
    assert_eq!(Unit::Metre.label(), "m");
    assert_eq!(Unit::Millimetre.factor_to_metres(), 0.001);
    assert_eq!(Unit::Millimetre.label(), "mm");
    assert_eq!(Unit::Centimetre.factor_to_metres(), 0.01);
    assert_eq!(Unit::Centimetre.label(), "cm");
    assert_eq!(Unit::Foot.factor_to_metres(), 0.3048);
    assert_eq!(Unit::Foot.label(), "ft");
    assert_eq!(Unit::Inch.factor_to_metres(), 0.0254);
    assert_eq!(Unit::Inch.label(), "in");
}

#[test]
fn units_resolve_standard() {
    assert_eq!(resolve_unit("METRE"), Some(Unit::Metre));
    assert_eq!(resolve_unit("FOOT"), Some(Unit::Foot));
    assert_eq!(resolve_unit("MILLIMETRE"), Some(Unit::Millimetre));
    assert_eq!(resolve_unit("INCH"), Some(Unit::Inch));
}

#[test]
fn units_resolve_dotted_ifc() {
    let u = resolve_unit(".MILLI.METRE.").expect("dotted IFC resolves");
    assert_eq!(u, Unit::Millimetre);
    assert!((u.factor_to_metres() - 0.001).abs() <= 1e-12);
}

#[test]
fn units_resolve_case_insensitive() {
    assert!(resolve_unit("metre").is_some());
    assert!(resolve_unit("Foot").is_some());
}

#[test]
fn units_resolve_unknown_null() {
    assert_eq!(resolve_unit("FATHOM"), None);
    assert_eq!(resolve_unit(""), None);
}

#[test]
fn units_convert() {
    assert!((convert_length(1.0, Unit::Metre, Unit::Foot) - 3.280839895013123).abs() <= 1e-9);
    assert!((convert_length(10.0, Unit::Foot, Unit::Metre) - 3.048).abs() <= 1e-9);
    assert!((convert_length(25.4, Unit::Millimetre, Unit::Inch) - 1.0).abs() <= 1e-9);
    // Identity: same unit converts exactly.
    assert_eq!(convert_length(42.0, Unit::Metre, Unit::Metre), 42.0);
}

#[test]
fn units_convert_unknown_throws() {
    let err = convert_length_named(1.0, "FATHOM", "METRE").expect_err("unknown unit errors");
    assert!(err.to_string().contains("Unknown unit"), "{err}");
}

#[test]
fn units_from_to_metres() {
    assert!((from_metres(3.048, Unit::Foot) - 10.0).abs() <= 1e-9);
    assert!((to_metres(10.0, Unit::Foot) - 3.048).abs() <= 1e-9);
}

#[test]
fn units_constants() {
    assert_eq!(DEFAULT_STICK_LENGTH_M, 3.048);
    assert_eq!(MIN_SEGMENT_LENGTH_M, 0.001);
    assert_eq!(VERTEX_MERGE_TOLERANCE_M, 0.001);
}
