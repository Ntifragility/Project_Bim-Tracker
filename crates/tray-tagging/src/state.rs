//! Assignment state: saved map + pending overlay + single-level batch undo.
//!
//! Pure model of the legacy `tagAssignments: Map` (`ctx`) + `existingProjectTags`
//! per loaded model. Key = `(model_id, local_id)`. Effective = saved map
//! overlaid by pending map; `delete: true` removes the key. Batch apply
//! snapshots `{key, previous-or-null}` per touched key (single level);
//! undo restores/deletes per snapshot and clears it.

use crate::scheme::TagAssignment;

/// Saved (IFC) assignment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SavedAssignment {
    pub model_id: String,
    pub model_name: String,
    pub local_id: i64,
    pub system_tag: String,
    pub element_tag: String,
    pub component_id: String,
    pub element_kind: String,
    pub type_code: String,
    pub sequence_number: String,
    pub scheme_version: String,
    pub original_ifc_tag: String,
    pub global_id: String,
    pub name: String,
    pub ifc_type: String,
}

/// Pending edit: `assignment.delete == true` means pending deletion.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingEdit {
    pub assignment: TagAssignment,
}

/// Saved-or-pending merged view. `source` is `"ifc"` or `"pending"`;
/// `was_saved` marks a pending edit over an existing saved tag (Modified).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EffectiveElement {
    pub model_id: String,
    pub model_name: String,
    pub local_id: i64,
    pub system_tag: String,
    pub element_tag: String,
    pub component_id: String,
    pub element_kind: String,
    pub type_code: String,
    pub sequence_number: String,
    pub scheme_version: String,
    pub original_ifc_tag: String,
    pub global_id: String,
    pub name: String,
    pub ifc_type: String,
    pub source: String,
    pub was_saved: bool,
}

/// Batch snapshot entry: previous pending value (or None) per touched key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BatchSnapshot {
    pub key: String,
    pub previous: Option<TagAssignment>,
}

/// Assignment key (legacy `getAssignmentKey` parity: `modelId:localId`).
pub fn assignment_key(model_id: &str, local_id: i64) -> String {
    format!("{model_id}:{local_id}")
}

fn saved_to_effective(saved: &SavedAssignment) -> EffectiveElement {
    EffectiveElement {
        model_id: saved.model_id.clone(),
        model_name: saved.model_name.clone(),
        local_id: saved.local_id,
        system_tag: saved.system_tag.clone(),
        element_tag: saved.element_tag.clone(),
        component_id: saved.component_id.clone(),
        element_kind: saved.element_kind.clone(),
        type_code: saved.type_code.clone(),
        sequence_number: saved.sequence_number.clone(),
        scheme_version: saved.scheme_version.clone(),
        original_ifc_tag: saved.original_ifc_tag.clone(),
        global_id: saved.global_id.clone(),
        name: saved.name.clone(),
        ifc_type: saved.ifc_type.clone(),
        source: "ifc".to_string(),
        was_saved: false,
    }
}

fn pending_to_effective(pending: &TagAssignment, was_saved: bool) -> EffectiveElement {
    EffectiveElement {
        model_id: pending.model_id.clone(),
        model_name: String::new(),
        local_id: pending.local_id,
        system_tag: pending.system_tag.clone(),
        element_tag: pending.element_tag.clone(),
        component_id: pending.component_id.clone(),
        element_kind: pending.element_kind.clone(),
        type_code: pending.type_code.clone(),
        sequence_number: pending.sequence_number.clone(),
        scheme_version: pending.scheme_version.clone(),
        original_ifc_tag: pending.original_ifc_tag.clone(),
        global_id: String::new(),
        name: String::new(),
        ifc_type: String::new(),
        source: "pending".to_string(),
        was_saved,
    }
}

/// R12: effective = saved map overlaid by pending map; pending `delete`
/// removes the key. Insertion order: saved first, then pending-only keys.
pub fn effective_assignments(
    saved: &[SavedAssignment],
    pending: &[PendingEdit],
) -> Vec<EffectiveElement> {
    use std::collections::HashMap;
    let mut saved_keys: HashMap<String, &SavedAssignment> = HashMap::new();
    let mut order: Vec<String> = Vec::new();
    for s in saved {
        let key = assignment_key(&s.model_id, s.local_id);
        if !saved_keys.contains_key(&key) {
            order.push(key.clone());
        }
        saved_keys.insert(key, s);
    }
    let mut pending_map: HashMap<String, &PendingEdit> = HashMap::new();
    for p in pending {
        let a = &p.assignment;
        let key = assignment_key(&a.model_id, a.local_id);
        if !saved_keys.contains_key(&key) && !pending_map.contains_key(&key) {
            order.push(key.clone());
        }
        pending_map.insert(key, p);
    }
    let mut out = Vec::new();
    for key in order {
        if let Some(p) = pending_map.get(&key) {
            if p.assignment.delete {
                continue;
            }
            let was_saved = saved_keys.contains_key(&key);
            out.push(pending_to_effective(&p.assignment, was_saved));
        } else if let Some(s) = saved_keys.get(&key) {
            out.push(saved_to_effective(s));
        }
    }
    out
}

/// R12: batch apply snapshots `{key, previous-or-null}` per touched key
/// (single level — overwrites any previous snapshot).
pub fn apply_batch(
    pending: &mut Vec<PendingEdit>,
    snapshot: &mut Vec<BatchSnapshot>,
    batch: Vec<TagAssignment>,
) {
    snapshot.clear();
    for assignment in batch {
        let key = assignment_key(&assignment.model_id, assignment.local_id);
        let previous = pending
            .iter()
            .find(|p| assignment_key(&p.assignment.model_id, p.assignment.local_id) == key)
            .map(|p| p.assignment.clone());
        snapshot.push(BatchSnapshot { key, previous });
        if let Some(slot) = pending.iter_mut().find(|p| {
            assignment_key(&p.assignment.model_id, p.assignment.local_id)
                == assignment_key(&assignment.model_id, assignment.local_id)
        }) {
            slot.assignment = assignment;
        } else {
            pending.push(PendingEdit { assignment });
        }
    }
}

/// R12: undo restores/deletes per snapshot, clears it, returns entry count.
/// Pending-deletion restore = drop the pending entry.
pub fn undo_batch(pending: &mut Vec<PendingEdit>, snapshot: &mut Vec<BatchSnapshot>) -> usize {
    let count = snapshot.len();
    for entry in snapshot.iter() {
        pending
            .retain(|p| assignment_key(&p.assignment.model_id, p.assignment.local_id) != entry.key);
        if let Some(prev) = &entry.previous {
            pending.push(PendingEdit {
                assignment: prev.clone(),
            });
        }
    }
    snapshot.clear();
    count
}

/// R12: preview conflict = existing effective/IFC tag non-empty AND
/// case-insensitively different from the generated `component_id`.
/// Returns the conflicting previous tag, if any.
pub fn preview_conflict(
    effective: &[EffectiveElement],
    model_id: &str,
    local_id: i64,
    generated_component_id: &str,
) -> Option<String> {
    let found = effective
        .iter()
        .find(|e| e.model_id == model_id && e.local_id == local_id)?;
    let prev = if found.element_tag.is_empty() {
        &found.component_id
    } else {
        &found.element_tag
    };
    if prev.is_empty() || prev.eq_ignore_ascii_case(generated_component_id) {
        return None;
    }
    Some(prev.clone())
}

#[cfg(test)]
mod tests;
