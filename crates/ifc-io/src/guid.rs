//! GUID-shape contract + injected determinism (spec R4).
//!
//! Randomness itself stays TS-side: `createIfcGuid` (crypto/Math.random)
//! and the conduit seeded counter are never ported. Rust takes a caller
//! injected `&dyn Fn() -> String` (owner-approved Q1 pattern) and only
//! checks the shape `^[0-3][0-9A-Za-z_$]{21}$` here.

/// IFC 22-char base64 alphabet (`IFC_GUID_ALPHABET` parity, both files).
pub const GUID_ALPHABET: &str = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";

/// Caller-injected GUID source (owner-approved determinism pattern).
pub type GuidFn = dyn Fn() -> String;

/// Check the IFC GUID shape: 22 chars, first in `0-3`, rest in the alphabet.
/// Legacy `createIfcGuid` output parity (tray `guid-shape` vector).
#[must_use]
pub fn is_guid_shape(guid: &str) -> bool {
    let mut chars = guid.chars();
    let first = match chars.next() {
        Some(c) => c,
        None => return false,
    };
    if !('0'..='3').contains(&first) {
        return false;
    }
    let mut len = 1;
    for c in chars {
        if !GUID_ALPHABET.contains(c) {
            return false;
        }
        len += 1;
    }
    len == 22
}

#[cfg(test)]
mod tests;
