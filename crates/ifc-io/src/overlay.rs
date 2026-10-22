//! Conduit overlay READ path (spec R11, NEW BUILD).
//!
//! There is no legacy reader: `legacy/packages/conduit-core/src/ifc-exporter.js`
//! only writes overlays. The read contract comes from
//! `docs/specs/conduit/takeoff-overlay.md` lines 90-107: one
//! `IFCANNOTATION` + its `Pset_ConduitRun` -> one run; resolve the
//! `IFCPOLYLINE` -> `IFCCARTESIANPOINT` chain; read `Size/System/Length`
//! plus the stick-rule fields (`Elbow45/Elbow90/RiserLength/Couplings/
//! StickLength`, defaulting to 0 when absent in old files).

use crate::step::{find_data_terminator, unescape_step};

/// One conduit run rebuilt from an overlay file.
#[derive(Debug, Clone, PartialEq)]
pub struct OverlayRun {
    pub name: String,
    pub size: String,
    pub system: String,
    pub length_m: f64,
    pub elbow45: u32,
    pub elbow90: u32,
    pub riser_length_m: f64,
    pub couplings: u32,
    pub stick_length_m: f64,
    pub points: Vec<[f64; 3]>,
}

/// Overlay parse error.
#[derive(Debug, Clone, PartialEq)]
pub struct OverlayError {
    /// Human-readable reason (no legacy message to match; new build).
    pub message: String,
}

impl std::fmt::Display for OverlayError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for OverlayError {}

/// Parse an overlay STEP source into runs.
pub fn parse_conduit_overlay(source: &str) -> Result<Vec<OverlayRun>, OverlayError> {
    if find_data_terminator(source).is_none() {
        return Err(OverlayError {
            message: "DATA section terminator not found.".to_string(),
        });
    }
    // Index entities by id.
    let mut entities: std::collections::BTreeMap<u64, (String, String)> =
        std::collections::BTreeMap::new();
    for line in source.lines() {
        let t = line.trim();
        if !t.starts_with('#') {
            continue;
        }
        let id_end = match t[1..].find(|c: char| !c.is_ascii_digit()) {
            Some(i) => i + 1,
            None => continue,
        };
        let id: u64 = match t[1..id_end].parse() {
            Ok(id) => id,
            Err(_) => continue,
        };
        let rest = t[id_end..].trim_start();
        if !rest.starts_with('=') {
            continue;
        }
        let rest = rest[1..].trim_start();
        let paren = match rest.find('(') {
            Some(i) => i,
            None => continue,
        };
        entities.insert(
            id,
            (rest[..paren].to_uppercase(), rest[paren..].to_string()),
        );
    }

    let points_of = |id: u64| -> Option<[f64; 3]> {
        let (ty, args) = entities.get(&id)?;
        if ty != "IFCCARTESIANPOINT" {
            return None;
        }
        let inner = args.trim_start_matches('(').trim_end_matches([')', ';']);
        let nums: Vec<f64> = inner
            .split(',')
            .filter_map(|s| {
                let s = s.trim().trim_matches(|c| c == '(' || c == ')');
                s.parse::<f64>().ok()
            })
            .collect();
        if nums.len() >= 3 {
            Some([nums[0], nums[1], nums[2]])
        } else {
            None
        }
    };

    let refs_of = |id: u64| -> Vec<u64> {
        let Some((_, args)) = entities.get(&id) else {
            return Vec::new();
        };
        let mut out = Vec::new();
        let chars: Vec<char> = args.chars().collect();
        let mut i = 0;
        while i < chars.len() {
            if chars[i] == '#' {
                let mut j = i + 1;
                while j < chars.len() && chars[j].is_ascii_digit() {
                    j += 1;
                }
                if j > i + 1 {
                    if let Ok(v) = args[i + 1..j].parse::<u64>() {
                        out.push(v);
                    }
                }
                i = j;
            } else {
                i += 1;
            }
        }
        out
    };

    // pset_id -> {lower_name -> raw STEP value}
    let mut pset_values: std::collections::BTreeMap<
        u64,
        std::collections::BTreeMap<String, String>,
    > = std::collections::BTreeMap::new();
    for line in source.lines() {
        if !line.to_uppercase().contains("IFCPROPERTYSET") {
            continue;
        }
        let t = line.trim();
        if !t.starts_with('#') {
            continue;
        }
        let id_end = match t[1..].find(|c: char| !c.is_ascii_digit()) {
            Some(i) => i + 1,
            None => continue,
        };
        let Ok(pset_id) = t[1..id_end].parse::<u64>() else {
            continue;
        };
        // name check: must contain 'Pset_ConduitRun' quoted.
        if !contains_quoted_ci(t, "Pset_ConduitRun") {
            continue;
        }
        let mut values = std::collections::BTreeMap::new();
        for pid in refs_of(pset_id) {
            let Some((ty, args)) = entities.get(&pid) else {
                continue;
            };
            if ty != "IFCPROPERTYSINGLEVALUE" {
                continue;
            }
            if let Some((name, raw)) = single_value_parts(args) {
                values.insert(name.to_lowercase(), raw);
            }
        }
        pset_values.insert(pset_id, values);
    }

    let mut runs = Vec::new();
    for line in source.lines() {
        if !line.to_uppercase().contains("IFCRELDEFINESBYPROPERTIES") {
            continue;
        }
        let Some((elem_refs, pset_ref)) = relation_pair(line) else {
            continue;
        };
        let Some(values) = pset_values.get(&pset_ref) else {
            continue;
        };
        for annotation_id in elem_refs {
            let Some((ty, _)) = entities.get(&annotation_id) else {
                continue;
            };
            if ty != "IFCANNOTATION" {
                continue;
            }
            let poly_points = polyline_points(annotation_id, &entities, &points_of, &refs_of);
            let get_str = |k: &str| {
                values
                    .get(k)
                    .map(|raw| unescape_step(&unquote(raw)))
                    .unwrap_or_default()
            };
            let get_num = |k: &str| {
                values
                    .get(k)
                    .and_then(|raw| bare_number(raw))
                    .unwrap_or(0.0)
            };
            let get_int = |k: &str| get_num(k) as u32;
            runs.push(OverlayRun {
                name: annotation_name(annotation_id, &entities),
                size: get_str("size"),
                system: get_str("system"),
                length_m: get_num("length"),
                elbow45: get_int("elbow45"),
                elbow90: get_int("elbow90"),
                riser_length_m: get_num("riserlength"),
                couplings: get_int("couplings"),
                stick_length_m: {
                    let v = get_num("sticklength");
                    if v > 0.0 {
                        v
                    } else {
                        0.0
                    }
                },
                points: poly_points,
            });
        }
    }
    runs.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(runs)
}

fn contains_quoted_ci(line: &str, want: &str) -> bool {
    line.to_uppercase()
        .contains(&format!("'{want}'").to_uppercase())
}

fn unquote(raw: &str) -> String {
    let t = raw.trim();
    if t.len() >= 2 && t.starts_with('\'') && t.ends_with('\'') {
        t[1..t.len() - 1].to_string()
    } else {
        t.to_string()
    }
}

fn bare_number(raw: &str) -> Option<f64> {
    let t = raw.trim();
    // Inner literal from single_value_parts: either bare (`6.096`) or still
    // wrapped (`IFCLENGTHMEASURE(6.096)`) — accept both.
    if let Some(open) = t.find('(') {
        let inner = t[open + 1..].trim_end_matches(')').trim();
        inner.parse::<f64>().ok()
    } else {
        t.trim_matches('\'').parse::<f64>().ok()
    }
}

fn single_value_parts(args: &str) -> Option<(String, String)> {
    // IFCPROPERTYSINGLEVALUE('Name',$,TYPE(value),$)
    let mut quoted: Vec<String> = Vec::new();
    let chars: Vec<char> = args.chars().collect();
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
    let name = quoted.first()?.clone();
    // Raw value: the TYPE(inner) group after the name, returned as the full
    // `TYPE(inner)` literal so numeric readers (bare_number) keep the type
    // context and string readers (unquote) strip one quote layer.
    // `get_str` unquotes `'v'` -> `v`; `IFCLABEL('v')` must therefore arrive
    // here as `'v'` (inner), not `IFCLABEL('v')`.
    let after_name = args
        .find(&format!("'{name}'"))
        .or_else(|| args.find(&name))?;
    let rest = &args[after_name + name.len() + 2..];
    let type_start = rest.find(|c: char| c.is_ascii_alphabetic())?;
    let type_end = rest[type_start..].find('(')? + type_start;
    let inner_start = type_end + 1;
    let mut d = 1;
    let mut inner_end = None;
    for (k, c) in rest[inner_start..].char_indices() {
        if c == '(' {
            d += 1;
        } else if c == ')' {
            d -= 1;
            if d == 0 {
                inner_end = Some(inner_start + k);
                break;
            }
        }
    }
    let inner = inner_end.map(|e| rest[inner_start..e].to_string())?;
    Some((name, inner))
}

fn relation_pair(line: &str) -> Option<(Vec<u64>, u64)> {
    let args_start = line.find('(')?;
    let args = &line[args_start..];
    let bytes: Vec<char> = args.chars().collect();
    let mut groups: Vec<(usize, usize)> = Vec::new();
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
    let mut elem_refs = None;
    for (s, e) in &groups {
        let inner: String = bytes[*s + 1..*e].iter().collect();
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
    let last_hash = args.rfind('#')?;
    let mut j = last_hash + 1;
    while j < args.len() && args.as_bytes()[j].is_ascii_digit() {
        j += 1;
    }
    let pset_ref: u64 = args[last_hash + 1..j].parse().ok()?;
    elem_refs.map(|e| (e, pset_ref))
}

fn annotation_name(
    annotation_id: u64,
    entities: &std::collections::BTreeMap<u64, (String, String)>,
) -> String {
    let Some((_, args)) = entities.get(&annotation_id) else {
        return String::new();
    };
    // IFCANNOTATION('guid',#owner,'Name',...) -> third quoted string.
    let mut quoted: Vec<String> = Vec::new();
    let chars: Vec<char> = args.chars().collect();
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
    quoted
        .get(1)
        .cloned()
        .map(|s| unescape_step(&s))
        .unwrap_or_default()
}

fn polyline_points(
    annotation_id: u64,
    entities: &std::collections::BTreeMap<u64, (String, String)>,
    points_of: &dyn Fn(u64) -> Option<[f64; 3]>,
    refs_of: &dyn Fn(u64) -> Vec<u64>,
) -> Vec<[f64; 3]> {
    // annotation args: ...,#wcs,#prodShape,... -> find PRODUCTDEFINITIONSHAPE ref.
    let refs = refs_of(annotation_id);
    for r in refs {
        let Some((ty, _)) = entities.get(&r) else {
            continue;
        };
        if ty == "IFCPRODUCTDEFINITIONSHAPE" {
            for s in refs_of(r) {
                let Some((sty, _)) = entities.get(&s) else {
                    continue;
                };
                if sty == "IFCSHAPEREPRESENTATION" {
                    for rep in refs_of(s) {
                        let Some((rty, _)) = entities.get(&rep) else {
                            continue;
                        };
                        if rty == "IFCGEOMETRICCURVESET" || rty == "IFCPOLYLINE" {
                            let pts = poly_from(rep, entities, points_of, refs_of);
                            if !pts.is_empty() {
                                return pts;
                            }
                        }
                        if rty == "IFCGEOMETRICCURVESET" {
                            for sub in refs_of(rep) {
                                let pts = poly_from(sub, entities, points_of, refs_of);
                                if !pts.is_empty() {
                                    return pts;
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    Vec::new()
}

fn poly_from(
    id: u64,
    entities: &std::collections::BTreeMap<u64, (String, String)>,
    points_of: &dyn Fn(u64) -> Option<[f64; 3]>,
    refs_of: &dyn Fn(u64) -> Vec<u64>,
) -> Vec<[f64; 3]> {
    let Some((ty, _)) = entities.get(&id) else {
        return Vec::new();
    };
    if ty == "IFCPOLYLINE" {
        return refs_of(id).into_iter().filter_map(points_of).collect();
    }
    if ty == "IFCGEOMETRICCURVESET" {
        for sub in refs_of(id) {
            let pts = poly_from(sub, entities, points_of, refs_of);
            if !pts.is_empty() {
                return pts;
            }
        }
    }
    Vec::new()
}

#[cfg(test)]
mod tests;
