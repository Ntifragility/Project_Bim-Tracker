//! Pure tag-integrity validation (spec R10).
//!
//! Direct port of `legacy/src/ifc/tag-validator.js`
//! (`validateTagIntegrity`): system tags may repeat, component IDs must
//! not; blank Excel tags and duplicates are errors; unmatched Excel/IFC
//! tags are non-blocking warnings.

use std::collections::BTreeMap;

/// One element carrying a tray tag (only the fields the validator reads).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ValidatedElement {
    pub local_id: u64,
    pub system_tag: String,
    pub component_id: String,
}

/// One Excel tag row (only the fields the validator reads).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ExcelTag {
    pub row_number: u64,
    pub tag: String,
}

/// A validation error (blocking).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidationError {
    pub code: &'static str,
    pub message: String,
}

/// A validation warning (non-blocking).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidationWarning {
    pub code: &'static str,
    pub message: String,
}

/// Validation report (legacy return-shape parity).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidationReport {
    pub valid: bool,
    pub errors: Vec<ValidationError>,
    pub warnings: Vec<ValidationWarning>,
    pub ifc_tag_count: usize,
    pub excel_tag_count: usize,
    pub matched_tag_count: usize,
}

fn normalize(tag: &str) -> String {
    tag.trim().to_lowercase()
}

/// Validate tag integrity (legacy `validateTagIntegrity` parity).
#[must_use]
pub fn validate_tag_integrity(
    elements: &[ValidatedElement],
    excel_tags: &[ExcelTag],
) -> ValidationReport {
    let mut errors: Vec<ValidationError> = Vec::new();
    let mut warnings: Vec<ValidationWarning> = Vec::new();

    let mut element_groups: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    let mut component_groups: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    for (i, el) in elements.iter().enumerate() {
        let sys = if el.system_tag.trim().is_empty() {
            normalize(&el.component_id)
        } else {
            normalize(&el.system_tag)
        };
        // legacy: elementGroups keyed by systemTag ?? tag; componentGroups by componentId.
        let _ = sys;
        let sys_key = {
            let s = el.system_tag.trim();
            if s.is_empty() {
                String::new()
            } else {
                normalize(s)
            }
        };
        if !sys_key.is_empty() {
            element_groups.entry(sys_key).or_default().push(i);
        }
        let comp = normalize(&el.component_id);
        if !comp.is_empty() {
            component_groups.entry(comp).or_default().push(i);
        }
    }

    for (key, items) in &component_groups {
        if items.len() < 2 {
            continue;
        }
        let first = &elements[items[0]];
        let shown = if first.component_id.trim().is_empty() {
            key.clone()
        } else {
            first.component_id.clone()
        };
        errors.push(ValidationError {
            code: "duplicate-component-id",
            message: format!(
                "Component ID \u{201c}{shown}\u{201d} is used by {} IFC elements.",
                items.len()
            ),
        });
    }

    let missing: Vec<&ValidatedElement> = elements
        .iter()
        .filter(|el| normalize(&el.component_id).is_empty())
        .collect();
    if !missing.is_empty() {
        errors.push(ValidationError {
            code: "missing-component-id",
            message: format!(
                "{} assigned element{} have no component ID.",
                missing.len(),
                if missing.len() == 1 { "" } else { "s" }
            ),
        });
    }

    let mut excel_groups: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    for (i, row) in excel_tags.iter().enumerate() {
        let n = normalize(&row.tag);
        if n.is_empty() {
            continue;
        }
        excel_groups.entry(n).or_default().push(i);
    }
    for (key, items) in &excel_groups {
        if items.len() < 2 {
            continue;
        }
        let shown = excel_tags[items[0]].tag.clone();
        let _ = key;
        errors.push(ValidationError {
            code: "duplicate-excel-tag",
            message: format!(
                "Tag \u{201c}{shown}\u{201d} appears in {} Excel rows.",
                items.len()
            ),
        });
    }

    let blank_rows = excel_tags
        .iter()
        .filter(|row| normalize(&row.tag).is_empty())
        .count();
    if blank_rows > 0 {
        errors.push(ValidationError {
            code: "blank-excel-tag",
            message: format!(
                "{blank_rows} Excel row{} have a blank tag.",
                if blank_rows == 1 { "" } else { "s" }
            ),
        });
    }

    let unassigned: Vec<&ExcelTag> = excel_tags
        .iter()
        .filter(|row| {
            let n = normalize(&row.tag);
            !n.is_empty() && !element_groups.contains_key(&n)
        })
        .collect();
    if !unassigned.is_empty() {
        warnings.push(ValidationWarning {
            code: "unassigned-excel-tags",
            message: format!(
                "{} Excel system tag{} are not assigned to IFC elements.",
                unassigned.len(),
                if unassigned.len() == 1 { "" } else { "s" }
            ),
        });
    }

    // missing-from-excel only applies when an Excel list was provided.
    if !excel_tags.is_empty() {
        let excel_keys: std::collections::BTreeSet<String> = excel_groups.keys().cloned().collect();
        let mut missing_from_excel = 0usize;
        for key in element_groups.keys() {
            if !excel_keys.contains(key) {
                missing_from_excel += 1;
            }
        }
        if missing_from_excel > 0 {
            warnings.push(ValidationWarning {
                code: "ifc-tags-missing-from-excel",
                message: format!(
                    "{missing_from_excel} IFC tray system{} are missing from Excel.",
                    if missing_from_excel == 1 { "" } else { "s" }
                ),
            });
        }
    }

    let matched = excel_tags
        .iter()
        .filter(|row| element_groups.contains_key(&normalize(&row.tag)))
        .count();

    ValidationReport {
        valid: errors.is_empty(),
        errors,
        warnings,
        ifc_tag_count: element_groups.len(),
        excel_tag_count: excel_tags.len(),
        matched_tag_count: matched,
    }
}

#[cfg(test)]
mod tests;
