//! Tag Register + Summary row builders (pure data; `.xlsx` bytes stay in
//! `excel-io` / the app, task 7.3).

use crate::state::EffectiveElement;

/// One Tag Register row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RegisterRow {
    pub system_tag: String,
    pub element_tag: String,
    pub component_id: String,
    pub element_kind: String,
    pub type_code: String,
    pub sequence_number: String,
    pub model_name: String,
    pub local_id: i64,
    pub source: String,
}

/// One Summary row: aggregate count for a (group, key) pair.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SummaryRow {
    pub group: String,
    pub key: String,
    pub count: usize,
}

/// R13: register rows from effective assignments only (pending + saved,
/// minus deletions — the caller passes the already-merged list), sorted by
/// `(system_tag.lower, component_id.lower)`; `source` = `pending|ifc`.
pub fn build_register_rows(effective: &[EffectiveElement]) -> Vec<RegisterRow> {
    let mut rows: Vec<RegisterRow> = effective
        .iter()
        .map(|e| RegisterRow {
            system_tag: e.system_tag.clone(),
            element_tag: e.element_tag.clone(),
            component_id: e.component_id.clone(),
            element_kind: e.element_kind.clone(),
            type_code: e.type_code.clone(),
            sequence_number: e.sequence_number.clone(),
            model_name: e.model_name.clone(),
            local_id: e.local_id,
            source: e.source.clone(),
        })
        .collect();
    rows.sort_by(|a, b| {
        a.system_tag
            .to_lowercase()
            .cmp(&b.system_tag.to_lowercase())
            .then(
                a.component_id
                    .to_lowercase()
                    .cmp(&b.component_id.to_lowercase()),
            )
    });
    rows
}

/// R13: summary aggregates counts by system, kind, model, and source state.
pub fn build_summary_rows(effective: &[EffectiveElement]) -> Vec<SummaryRow> {
    use std::collections::BTreeMap;
    let mut by_system: BTreeMap<String, usize> = BTreeMap::new();
    let mut by_kind: BTreeMap<String, usize> = BTreeMap::new();
    let mut by_model: BTreeMap<String, usize> = BTreeMap::new();
    let mut by_source: BTreeMap<String, usize> = BTreeMap::new();
    for e in effective {
        *by_system.entry(e.system_tag.clone()).or_default() += 1;
        *by_kind.entry(e.element_kind.clone()).or_default() += 1;
        *by_model.entry(e.model_name.clone()).or_default() += 1;
        *by_source.entry(e.source.clone()).or_default() += 1;
    }
    let mut rows = Vec::new();
    for (key, count) in by_system {
        rows.push(SummaryRow {
            group: "system".to_string(),
            key,
            count,
        });
    }
    for (key, count) in by_kind {
        rows.push(SummaryRow {
            group: "kind".to_string(),
            key,
            count,
        });
    }
    for (key, count) in by_model {
        rows.push(SummaryRow {
            group: "model".to_string(),
            key,
            count,
        });
    }
    for (key, count) in by_source {
        rows.push(SummaryRow {
            group: "source".to_string(),
            key,
            count,
        });
    }
    rows
}

#[cfg(test)]
mod tests;
