//! Shared STEP text primitives (spec R2-R3).
//!
//! Ports the module-private helpers duplicated in
//! `legacy/src/ifc/ifc-tag-exporter.js` and
//! `legacy/src/ifc/ifc-safe-editor.js` (`escapeStepString`,
//! `unescapeStepString`, `decodeIfc`, `getEntityIds`,
//! `findDataTerminator`).
//!
//! `decodeIfc` (bytes -> str) stays TS-side: the wasm boundary passes
//! strings; this crate never touches raw bytes.

/// Escape a STEP string value: `'` -> `''`.
/// Legacy `escapeStepString` parity (both IFC files).
#[must_use]
pub fn escape_step(value: &str) -> String {
    value.replace('\'', "''")
}

/// Unescape a STEP string value: `''` -> `'`.
/// Legacy `unescapeStepString` parity (both IFC files).
#[must_use]
pub fn unescape_step(value: &str) -> String {
    value.replace("''", "'")
}

/// Scan `#id =` entity ids, one per DATA line, ascending by first sight.
/// Legacy `getEntityIds` parity (`/^\s*#(\d+)\s*=/gm`).
#[must_use]
pub fn entity_ids(source: &str) -> Vec<u64> {
    let mut ids = Vec::new();
    for line in source.lines() {
        let t = line.trim_start();
        if !t.starts_with('#') {
            continue;
        }
        let digits: String = t[1..].chars().take_while(char::is_ascii_digit).collect();
        if digits.is_empty() {
            continue;
        }
        let rest = &t[1 + digits.len()..];
        if rest.trim_start().starts_with('=') {
            if let Ok(id) = digits.parse::<u64>() {
                ids.push(id);
            }
        }
    }
    ids
}

/// Byte index of the `ENDSEC; END-ISO-10303-21;` terminator, or `None`.
/// Legacy `findDataTerminator` parity (which throws; Rust returns `None`).
#[must_use]
pub fn find_data_terminator(source: &str) -> Option<usize> {
    let bytes = source.as_bytes();
    let tail = b"ENDSEC";
    // Scan for the last ENDSEC that is followed only by the file footer.
    let mut pos = 0usize;
    let mut found = None;
    while let Some(rel) = find_subslice(&bytes[pos..], tail) {
        let abs = pos + rel;
        let after = &source[abs + tail.len()..];
        let after_trim = after.trim_start_matches([';', ' ', '\t', '\r', '\n']);
        if after_trim.to_uppercase().starts_with("END-ISO-10303-21") {
            found = Some(abs);
        }
        pos = abs + tail.len();
    }
    found
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|w| w.eq_ignore_ascii_case(needle))
}

#[cfg(test)]
mod tests;
