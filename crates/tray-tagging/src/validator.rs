//! Integrity validator: duplicate / missing / unmatched tag checks.
//!
//! Pure port of `legacy/src/ifc/tag-validator.js` (98 lines).
//! R10: normalization is trim + lowercase everywhere.
//! Errors block (`valid: false`); warnings never block.

/// Element view for validation.
#[derive(Debug, Clone, Default)]
pub struct ValidElement {
    pub system_tag: String,
    pub tag: String,
    pub component_id: String,
}

/// Excel row reference.
#[derive(Debug, Clone, Default)]
pub struct ExcelTag {
    pub row_number: u32,
    pub tag: String,
}

/// One integrity issue (error or warning).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IntegrityIssue {
    pub code: String,
    pub tag: String,
    pub message: String,
}

/// Counters (legacy `counts` shape).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct IntegrityCounts {
    pub ifc_tags: usize,
    pub excel_tags: usize,
    pub matched_tags: usize,
    pub errors: usize,
    pub warnings: usize,
}

/// Validation report.
#[derive(Debug, Clone)]
pub struct IntegrityReport {
    pub valid: bool,
    pub errors: Vec<IntegrityIssue>,
    pub warnings: Vec<IntegrityIssue>,
    pub counts: IntegrityCounts,
}

fn normalize_tag(value: &str) -> String {
    value.trim().to_lowercase()
}

fn plural(n: usize, singular: &str, plural_word: &str) -> String {
    if n == 1 {
        singular.to_string()
    } else {
        plural_word.to_string()
    }
}

/// R10-R11: duplicates, blanks, missing component ids (errors);
/// unassigned Excel tags + IFC systems missing from Excel (warnings).
pub fn validate_tag_integrity(elements: &[ValidElement], excel: &[ExcelTag]) -> IntegrityReport {
    let mut errors: Vec<IntegrityIssue> = Vec::new();
    let mut warnings: Vec<IntegrityIssue> = Vec::new();

    // Element groups key on systemTag ?? tag; component groups on componentId.
    use std::collections::HashMap;
    let mut element_groups: HashMap<String, Vec<usize>> = HashMap::new();
    for (i, item) in elements.iter().enumerate() {
        let key = if item.system_tag.is_empty() {
            item.tag.clone()
        } else {
            item.system_tag.clone()
        };
        let norm = normalize_tag(&key);
        if norm.is_empty() {
            continue;
        }
        element_groups.entry(norm).or_default().push(i);
    }
    let mut component_groups: HashMap<String, Vec<usize>> = HashMap::new();
    for (i, item) in elements.iter().enumerate() {
        let norm = normalize_tag(&item.component_id);
        if norm.is_empty() {
            continue;
        }
        component_groups.entry(norm).or_default().push(i);
    }
    let mut excel_groups: HashMap<String, Vec<usize>> = HashMap::new();
    for (i, item) in excel.iter().enumerate() {
        let norm = normalize_tag(&item.tag);
        if norm.is_empty() {
            continue;
        }
        excel_groups.entry(norm).or_default().push(i);
    }
    let blank_excel: Vec<&ExcelTag> = excel
        .iter()
        .filter(|t| normalize_tag(&t.tag).is_empty())
        .collect();

    for idxs in component_groups.values() {
        if idxs.len() < 2 {
            continue;
        }
        let tag = elements[idxs[0]].component_id.clone();
        errors.push(IntegrityIssue {
            code: "duplicate-component-id".to_string(),
            tag: tag.clone(),
            message: format!(
                "Component ID \u{201c}{tag}\u{201d} is used by {} IFC elements.",
                idxs.len()
            ),
        });
    }

    let missing: Vec<&ValidElement> = elements
        .iter()
        .filter(|e| normalize_tag(&e.component_id).is_empty())
        .collect();
    if !missing.is_empty() {
        errors.push(IntegrityIssue {
            code: "missing-component-id".to_string(),
            tag: String::new(),
            message: format!(
                "{} assigned {} have no component ID.",
                missing.len(),
                plural(missing.len(), "element", "elements")
            ),
        });
    }

    // Deterministic order: sort duplicate groups by first row number.
    let mut dup_excel: Vec<(&String, &Vec<usize>)> =
        excel_groups.iter().filter(|(_, v)| v.len() >= 2).collect();
    dup_excel.sort_by_key(|(_, v)| excel[v[0]].row_number);
    for (_, idxs) in dup_excel {
        let tag = excel[idxs[0]].tag.clone();
        errors.push(IntegrityIssue {
            code: "duplicate-excel-tag".to_string(),
            tag: tag.clone(),
            message: format!(
                "Tag \u{201c}{tag}\u{201d} appears in {} Excel rows.",
                idxs.len()
            ),
        });
    }

    if !blank_excel.is_empty() {
        errors.push(IntegrityIssue {
            code: "blank-excel-tag".to_string(),
            tag: String::new(),
            message: format!(
                "{} Excel {} have a blank tag.",
                blank_excel.len(),
                plural(blank_excel.len(), "row", "rows")
            ),
        });
    }

    let unassigned: Vec<&ExcelTag> = excel
        .iter()
        .filter(|t| {
            let norm = normalize_tag(&t.tag);
            !norm.is_empty() && !element_groups.contains_key(&norm)
        })
        .collect();
    if !unassigned.is_empty() {
        warnings.push(IntegrityIssue {
            code: "unassigned-excel-tags".to_string(),
            tag: String::new(),
            message: format!(
                "{} Excel system {} not assigned to IFC elements.",
                unassigned.len(),
                plural(unassigned.len(), "tag is", "tags are")
            ),
        });
    }

    // Unique systems in first-seen order (legacy `elementGroups.values()[0]`).
    let mut seen_keys: Vec<String> = Vec::new();
    let mut ordered: Vec<&ValidElement> = Vec::new();
    for item in elements {
        let key = if item.system_tag.is_empty() {
            item.tag.clone()
        } else {
            item.system_tag.clone()
        };
        let norm = normalize_tag(&key);
        if norm.is_empty() || seen_keys.contains(&norm) {
            continue;
        }
        seen_keys.push(norm);
        ordered.push(item);
    }

    let missing_from_excel: Vec<&&ValidElement> = if excel.is_empty() {
        Vec::new()
    } else {
        ordered
            .iter()
            .filter(|item| {
                let key = if item.system_tag.is_empty() {
                    &item.tag
                } else {
                    &item.system_tag
                };
                let norm = normalize_tag(key);
                !norm.is_empty() && !excel_groups.contains_key(&norm)
            })
            .collect()
    };
    if !missing_from_excel.is_empty() {
        warnings.push(IntegrityIssue {
            code: "ifc-tags-missing-from-excel".to_string(),
            tag: String::new(),
            message: format!(
                "{} IFC tray {} missing from Excel.",
                missing_from_excel.len(),
                plural(missing_from_excel.len(), "system is", "systems are")
            ),
        });
    }

    let matched = excel
        .iter()
        .filter(|t| element_groups.contains_key(&normalize_tag(&t.tag)))
        .count();

    let counts = IntegrityCounts {
        ifc_tags: element_groups.len(),
        excel_tags: excel.len(),
        matched_tags: matched,
        errors: errors.len(),
        warnings: warnings.len(),
    };
    let valid = errors.is_empty();
    IntegrityReport {
        valid,
        errors,
        warnings,
        counts,
    }
}

#[cfg(test)]
mod tests;
