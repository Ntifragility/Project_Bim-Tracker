//! `step.json` vectors as Rust tests (task 3.2, spec R2-R3).

use super::*;

#[test]
fn step_escape_basic() {
    assert_eq!(escape_step("O'Brien"), "O''Brien");
}

#[test]
fn step_escape_empty_noop_multi() {
    assert_eq!(escape_step(""), "");
    assert_eq!(escape_step("plain"), "plain");
    assert_eq!(escape_step("a'b'c"), "a''b''c");
}

#[test]
fn step_unescape() {
    assert_eq!(unescape_step("O''Brien"), "O'Brien");
    assert_eq!(unescape_step("a''b''c"), "a'b'c");
}

#[test]
fn step_entity_ids() {
    let src = "ISO-10303-21;\n#1=IFCPROJECT('x');\n   #10 = IFCBUILDINGELEMENTPART('y');\n#42=IFCSITE($);\nENDSEC;\nEND-ISO-10303-21;\n";
    assert_eq!(entity_ids(src), vec![1, 10, 42]);
    assert!(entity_ids("ISO-10303-21;\nHEADER;\nENDSEC;\nEND-ISO-10303-21;\n").is_empty());
}

#[test]
fn step_terminator() {
    assert!(
        find_data_terminator("DATA;\n#1=IFCPROJECT('x');\nENDSEC;\nEND-ISO-10303-21;\n").is_some()
    );
    assert!(find_data_terminator("DATA;\n#1=IFCPROJECT('x');\n").is_none());
}
