//! Export file-name rules (spec R5).
//!
//! Parity with legacy `taggedIfcFileName` / `editedIfcFileName`
//! (tray `tagged-filename` / `edited-filename` vectors).

/// `*.ifc` (any case) -> `*_tagged.ifc`; anything else gets the suffix appended.
#[must_use]
pub fn tagged_name(source_name: &str) -> String {
    tagged_like(source_name, "_tagged.ifc")
}

/// `*.ifc` (any case) -> `*_edited.ifc`; anything else gets the suffix appended.
#[must_use]
pub fn edited_name(source_name: &str) -> String {
    tagged_like(source_name, "_edited.ifc")
}

fn tagged_like(source_name: &str, suffix: &str) -> String {
    let name = if source_name.is_empty() {
        "model.ifc"
    } else {
        source_name
    };
    if name.len() >= 4 && name[name.len() - 4..].eq_ignore_ascii_case(".ifc") {
        format!("{}{}", &name[..name.len() - 4], suffix)
    } else {
        format!("{name}{suffix}")
    }
}

#[cfg(test)]
mod tests;
