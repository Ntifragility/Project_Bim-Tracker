//! `guid-shape` vector as Rust tests (task 3.2, spec R4).

use super::*;

#[test]
fn guid_shape_valid() {
    assert!(is_guid_shape("0aaaaaaaaaaaaaaaaaaaaa"));
    assert!(is_guid_shape("3zzzzzzzzzzzzzzzzzzzzz"));
    assert!(is_guid_shape("1aB_$019AZaz_$019AZab1"));
}

#[test]
fn guid_shape_invalid() {
    assert!(!is_guid_shape("4aaaaaaaaaaaaaaaaaaaaa"));
    assert!(!is_guid_shape("0aaaaaaaaaaaaaaaaaaaa"));
    assert!(!is_guid_shape("0aaaaaaaaaaaaaaaaaaaaaa"));
    assert!(!is_guid_shape("0aaaaaaaaaaa!aaaaaaaaaa"));
    assert!(!is_guid_shape(""));
}

#[test]
fn guid_alphabet_parity() {
    assert_eq!(GUID_ALPHABET.len(), 64);
    assert!(GUID_ALPHABET.starts_with("0123456789"));
    assert!(GUID_ALPHABET.ends_with("_$"));
}
