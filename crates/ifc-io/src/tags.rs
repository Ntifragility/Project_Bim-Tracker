//! Tray tag read + edit planning (spec R8-R9).
//!
//! Ports the pure decision logic of
//! `legacy/src/ifc/ifc-tag-exporter.js`: project-tag extraction
//! (`extractProjectTagsFromIfc`), tray-assignment extraction
//! (`extractTraySystemAssignmentsFromIfc`), and the create/update/skip
//! decisions of `addProjectTagsToIfc` / `addTraySystemAssignmentsToIfc`.
//!
//! STEP text splicing stays TS-side: this module returns [`TagEditOp`]
//! plans; the TS layer renders `#id=...` lines.

use crate::step::unescape_step;
use std::collections::BTreeMap;

/// One extracted project tag: `(local_id, tag, property_id)`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectTag {
    pub local_id: u64,
    pub tag: String,
    pub property_id: u64,
}

/// One extracted tray-system assignment (legacy field parity).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TrayAssignment {
    pub local_id: u64,
    pub system_tag: String,
    pub element_tag: String,
    pub component_id: String,
    pub element_kind: String,
    pub type_code: String,
    pub sequence_number: String,
    pub scheme_version: String,
    pub original_ifc_tag: String,
}

/// Planned tag edit (no STEP splicing; TS renders text).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TagEditOp {
    /// Update an existing property value in place.
    UpdateProperty { property_id: u64, value: String },
    /// Create a new property (+pset+relation when no set exists yet).
    CreateProperty {
        local_id: u64,
        property_name: String,
        value: String,
    },
    /// Skip with a legacy-parity reason string.
    Skip { reason: &'static str },
}

/// Case-insensitive property match on one DATA line.
fn line_defines_property(line: &str, name: &str) -> Option<(u64, String)> {
    let t = line.trim();
    if !t.starts_with('#') {
        return None;
    }
    let upper = t.to_uppercase();
    if !upper.contains("IFCPROPERTYSINGLEVALUE") {
        return None;
    }
    let id_end = t[1..].find(|c: char| !c.is_ascii_digit()).map(|i| i + 1)?;
    let id: u64 = t[1..id_end].parse().ok()?;
    // name is the first quoted string of the property call.
    let args = t.find('(')?;
    let first_quote = t[args..].find('\'')? + args;
    let inner: String = t[first_quote + 1..]
        .chars()
        .take_while(|c| *c != '\'')
        .collect();
    // handle '' escapes by scanning properly
    let mut raw = String::new();
    let mut chars = t[first_quote + 1..].chars();
    while let Some(c) = chars.next() {
        if c == '\'' {
            if chars.clone().next() == Some('\'') {
                raw.push('\'');
                chars.next();
            } else {
                break;
            }
        } else {
            raw.push(c);
        }
    }
    let _ = inner;
    if raw.to_lowercase() != name.to_lowercase() {
        return None;
    }
    // value is the third quoted string (after name + description).
    let rest = &t[first_quote + 1 + raw.len() + 2..];
    // find IFCLABEL('...') style value: last quoted string before final `,$);`
    let value = last_quoted(rest)
        .as_deref()
        .map(unescape_step)
        .unwrap_or_default();
    Some((id, value))
}

fn last_quoted(text: &str) -> Option<String> {
    let mut best: Option<String> = None;
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '\'' {
            let mut raw = String::new();
            i += 1;
            while i < chars.len() {
                if chars[i] == '\'' {
                    if i + 1 < chars.len() && chars[i + 1] == '\'' {
                        raw.push('\'');
                        i += 2;
                    } else {
                        i += 1;
                        break;
                    }
                } else {
                    raw.push(chars[i]);
                    i += 1;
                }
            }
            best = Some(raw);
        } else {
            i += 1;
        }
    }
    best
}

/// Extract project tags: `(local_id, tag, property_id)` for every element
/// linked through `IFCRELDEFINESBYPROPERTIES` to the named pset.
/// Legacy `extractProjectTagsFromIfc` parity (R8).
#[must_use]
pub fn extract_project_tags(source: &str, pset_name: &str, property_name: &str) -> Vec<ProjectTag> {
    let mut props: BTreeMap<u64, String> = BTreeMap::new();
    let mut psets: BTreeMap<u64, u64> = BTreeMap::new(); // pset_id -> property_id
    for line in source.lines() {
        if let Some((id, value)) = line_defines_property(line, property_name) {
            props.insert(id, value);
        }
        if let Some(pset_id) = line_defines_pset(line, pset_name) {
            // property refs are (#a,#b,...) at the end of the pset line.
            if let Some(refs) = refs_in_parens(line) {
                if let Some(pid) = refs.into_iter().find(|id| props.contains_key(id)) {
                    psets.insert(pset_id, pid);
                }
            }
        }
    }
    let mut out = Vec::new();
    for line in source.lines() {
        let upper = line.to_uppercase();
        if !upper.contains("IFCRELDEFINESBYPROPERTIES") {
            continue;
        }
        let (elem_refs, pset_ref) = match split_relation(line) {
            Some(v) => v,
            None => continue,
        };
        let Some(prop_id) = psets.get(&pset_ref).copied() else {
            continue;
        };
        let Some(tag) = props.get(&prop_id).cloned() else {
            continue;
        };
        for local_id in elem_refs {
            out.push(ProjectTag {
                local_id,
                tag: tag.clone(),
                property_id: prop_id,
            });
        }
    }
    out.sort_by_key(|t| (t.local_id, t.property_id));
    out
}

fn line_defines_pset(line: &str, pset_name: &str) -> Option<u64> {
    let t = line.trim();
    if !t.starts_with('#') {
        return None;
    }
    if !t.to_uppercase().contains("IFCPROPERTYSET") {
        return None;
    }
    let id_end = t[1..].find(|c: char| !c.is_ascii_digit()).map(|i| i + 1)?;
    let id: u64 = t[1..id_end].parse().ok()?;
    // pset name is the third quoted string; legacy matches any quoted
    // occurrence case-insensitively, so scan all quoted strings.
    let mut found = false;
    let chars: Vec<char> = t.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '\'' {
            let mut raw = String::new();
            i += 1;
            while i < chars.len() {
                if chars[i] == '\'' {
                    if i + 1 < chars.len() && chars[i + 1] == '\'' {
                        raw.push('\'');
                        i += 2;
                    } else {
                        i += 1;
                        break;
                    }
                } else {
                    raw.push(chars[i]);
                    i += 1;
                }
            }
            if raw.to_lowercase() == pset_name.to_lowercase() {
                found = true;
            }
        } else {
            i += 1;
        }
    }
    found.then_some(id)
}

fn refs_in_parens(line: &str) -> Option<Vec<u64>> {
    let start = line.rfind('(')?;
    let end = line.rfind(')')?;
    if end < start {
        return None;
    }
    let mut out = Vec::new();
    for m in line[start..end].split(|c: char| !c.is_ascii_digit()) {
        if m.is_empty() {
            continue;
        }
        // only refs prefixed by '#'
        out.push(m.parse::<u64>().ok()?);
    }
    Some(out)
}

/// Split `IFCRELDEFINESBYPROPERTIES(...,(#a,#b),#pset)` into
/// `(element_refs, pset_ref)`. Element refs must be `#`-prefixed.
fn split_relation(line: &str) -> Option<(Vec<u64>, u64)> {
    let args_start = line.find('(')?;
    let args = &line[args_start..];
    // element list is the first (...) pair containing '#'
    let mut groups: Vec<(usize, usize)> = Vec::new();
    let bytes: Vec<char> = args.chars().collect();
    let mut stack: Vec<usize> = Vec::new();
    for (i, c) in bytes.iter().enumerate() {
        if *c == '(' {
            stack.push(i);
        } else if *c == ')' {
            if let Some(s) = stack.pop() {
                groups.push((s, i));
            }
        }
    }
    let mut elem_refs: Option<Vec<u64>> = None;
    for (s, e) in &groups {
        let inner: String = bytes[*s + 1..*e].iter().collect();
        // The element list is a group whose *own* text (excluding any nested
        // groups) holds `#` refs. The outer relation group also contains the
        // trailing pset ref, so skip groups with nested parens.
        if inner.contains('#') && !inner.contains('(') {
            let mut ids = Vec::new();
            let ic: Vec<char> = inner.chars().collect();
            let mut i = 0;
            while i < ic.len() {
                if ic[i] == '#' {
                    let mut j = i + 1;
                    while j < ic.len() && ic[j].is_ascii_digit() {
                        j += 1;
                    }
                    if j > i + 1 {
                        if let Ok(id) = inner[i + 1..j].parse::<u64>() {
                            ids.push(id);
                        }
                    }
                    i = j;
                } else {
                    i += 1;
                }
            }
            elem_refs = Some(ids);
            break;
        }
    }
    // pset ref is the last #id after the element group.
    let after_elem = elem_refs.as_ref().map(|_| ()).is_some();
    let _ = after_elem;
    let last_hash = args.rfind('#')?;
    let mut j = last_hash + 1;
    while j < args.len() && args.as_bytes()[j].is_ascii_digit() {
        j += 1;
    }
    let pset_ref: u64 = args[last_hash + 1..j].parse().ok()?;
    elem_refs.map(|e| (e, pset_ref))
}

/// Extract tray-system assignments (`CCP_TRAY_SYSTEM`).
/// Legacy `extractTraySystemAssignmentsFromIfc` parity (R9).
#[must_use]
pub fn extract_tray_assignments(source: &str) -> Vec<TrayAssignment> {
    // Collect every (pset_id -> {lower_name -> (value, property_id)}).
    let mut prop_names: BTreeMap<u64, (String, String)> = BTreeMap::new(); // prop_id -> (name, value)
    for line in source.lines() {
        if let Some((id, name, value)) = line_defines_any_property(line) {
            prop_names.insert(id, (name, value));
        }
    }
    let mut out = Vec::new();
    // Find CCP_TRAY_SYSTEM psets and their element links.
    let mut tray_psets: BTreeMap<u64, Vec<u64>> = BTreeMap::new(); // pset_id -> prop_ids
    for line in source.lines() {
        if let Some(pset_id) = line_defines_pset(line, "CCP_TRAY_SYSTEM") {
            if let Some(refs) = refs_in_parens(line) {
                tray_psets.insert(pset_id, refs);
            }
        }
    }
    for line in source.lines() {
        if !line.to_uppercase().contains("IFCRELDEFINESBYPROPERTIES") {
            continue;
        }
        let Some((elem_refs, pset_ref)) = split_relation(line) else {
            continue;
        };
        let Some(prop_ids) = tray_psets.get(&pset_ref) else {
            continue;
        };
        let mut values: BTreeMap<String, String> = BTreeMap::new();
        for pid in prop_ids {
            if let Some((name, value)) = prop_names.get(pid) {
                values.insert(name.to_lowercase(), value.clone());
            }
        }
        let get = |k: &str| values.get(k).cloned().unwrap_or_default();
        let system_tag = get("systemtag");
        let component_id = get("componentid");
        let mut element_tag = get("elementtag");
        if element_tag.is_empty() {
            element_tag.clone_from(&component_id);
        }
        if system_tag.is_empty() && component_id.is_empty() && element_tag.is_empty() {
            continue;
        }
        for local_id in elem_refs {
            out.push(TrayAssignment {
                local_id,
                system_tag: system_tag.clone(),
                element_tag: element_tag.clone(),
                component_id: component_id.clone(),
                element_kind: get("elementkind"),
                type_code: get("typecode"),
                sequence_number: get("sequencenumber"),
                scheme_version: get("schemeversion"),
                original_ifc_tag: get("originalifctag"),
            });
        }
    }
    out.sort_by_key(|t| t.local_id);
    out
}

fn line_defines_any_property(line: &str) -> Option<(u64, String, String)> {
    let t = line.trim();
    if !t.starts_with('#') {
        return None;
    }
    if !t.to_uppercase().contains("IFCPROPERTYSINGLEVALUE") {
        return None;
    }
    let id_end = t[1..].find(|c: char| !c.is_ascii_digit()).map(|i| i + 1)?;
    let id: u64 = t[1..id_end].parse().ok()?;
    let args = t.find('(')?;
    // first quoted string = name
    let mut quoted: Vec<String> = Vec::new();
    let chars: Vec<char> = t[args..].chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '\'' {
            let mut raw = String::new();
            i += 1;
            while i < chars.len() {
                if chars[i] == '\'' {
                    if i + 1 < chars.len() && chars[i + 1] == '\'' {
                        raw.push('\'');
                        i += 2;
                    } else {
                        i += 1;
                        break;
                    }
                } else {
                    raw.push(chars[i]);
                    i += 1;
                }
            }
            quoted.push(raw);
        } else {
            i += 1;
        }
    }
    let name = quoted.first().cloned().unwrap_or_default();
    let value = quoted.get(1).cloned().unwrap_or_default();
    Some((id, name, unescape_step(&value)))
}

/// Plan a project-tag edit (legacy `addProjectTagsToIfc` decision parity).
/// `known_ids` are the entity ids present in the source; `existing` the
/// current tags; `next_id` the allocator cursor (TS owns allocation).
#[must_use]
pub fn plan_project_tag(
    local_id: u64,
    tag: &str,
    known_ids: &[u64],
    existing: &[ProjectTag],
    _next_id: u64,
) -> TagEditOp {
    if !known_ids.contains(&local_id) {
        return TagEditOp::Skip {
            reason: "element-not-found-in-source-ifc",
        };
    }
    if tag.trim().is_empty() {
        return TagEditOp::Skip {
            reason: "empty-tag",
        };
    }
    if let Some(current) = existing.iter().find(|t| t.local_id == local_id) {
        return TagEditOp::UpdateProperty {
            property_id: current.property_id,
            value: tag.trim().to_string(),
        };
    }
    TagEditOp::CreateProperty {
        local_id,
        property_name: "Tag".to_string(),
        value: tag.trim().to_string(),
    }
}

/// Next free entity id suggestion (TS owns the real allocator; this only
/// mirrors the `max+1` cursor rule for plan tests).
#[must_use]
pub fn next_free_id(known_ids: &[u64], next_id: u64) -> u64 {
    let max = known_ids.iter().copied().max().unwrap_or(0);
    next_id.max(max + 1)
}

#[cfg(test)]
mod tests;
