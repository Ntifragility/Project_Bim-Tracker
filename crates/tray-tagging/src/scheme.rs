//! Tag scheme: normalize / format / parse / validate / allocate.
//!
//! Pure port of `legacy/src/tagging/tag-scheme.js` (124 lines).
//! Tags are unit-free strings. Default scheme `{prefix}{system}.{type}.{sequence}`
//! e.g. system `PT1`, element `PT1.01.01` (tray `01`, fitting `02`).

/// Per-kind default type codes (legacy `ELEMENT_KIND_OPTIONS`).
pub const DEFAULT_TRAY_CODE: &str = "01";
pub const DEFAULT_FITTING_CODE: &str = "02";
/// Maximum supported sequence width (legacy clamp 1-6).
pub const MAX_SEQUENCE_DIGITS: u32 = 6;
/// Scheme version stamped on every allocation (pattern v2: ElementTag = ComponentId).
pub const SCHEME_VERSION: &str = "2";

/// Raw (possibly untrimmed / string-typed) scheme input from the UI.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemeInput {
    pub prefix: String,
    pub system: String,
    pub separator: String,
    /// Passed as string from the UI; parsed as int here (legacy parity).
    pub sequence_digits_raw: String,
    pub start_sequence_raw: String,
    pub tray_code: String,
    pub fitting_code: String,
}

/// Normalized, validated scheme.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TypeCodes {
    pub tray: String,
    pub fitting: String,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagScheme {
    pub prefix: String,
    pub system: String,
    pub separator: String,
    pub sequence_digits: u32,
    pub start_sequence: u32,
    pub type_codes: TypeCodes,
}

fn clean_token(value: &str) -> String {
    value.trim().to_string()
}

fn parse_digits(raw: &str) -> u32 {
    match raw.trim().parse::<i64>() {
        Ok(n) if (1..=MAX_SEQUENCE_DIGITS as i64).contains(&n) => n as u32,
        _ => 2,
    }
}

fn parse_start(raw: &str) -> u32 {
    match raw.trim().parse::<i64>() {
        Ok(n) if n >= 1 => n as u32,
        _ => 1,
    }
}

/// R1: trim tokens; empty separator -> "."; digits int 1-6 else 2;
/// start >= 1 else 1; empty type codes fall back to 01/02.
pub fn normalize_tag_scheme(input: &SchemeInput) -> TagScheme {
    let sep = clean_token(&input.separator);
    TagScheme {
        prefix: clean_token(&input.prefix),
        system: clean_token(&input.system),
        separator: if sep.is_empty() { ".".to_string() } else { sep },
        sequence_digits: parse_digits(&input.sequence_digits_raw),
        start_sequence: parse_start(&input.start_sequence_raw),
        type_codes: TypeCodes {
            tray: {
                let t = clean_token(&input.tray_code);
                if t.is_empty() {
                    DEFAULT_TRAY_CODE.to_string()
                } else {
                    t
                }
            },
            fitting: {
                let f = clean_token(&input.fitting_code);
                if f.is_empty() {
                    DEFAULT_FITTING_CODE.to_string()
                } else {
                    f
                }
            },
        },
    }
}

/// R2: `prefix + system` concatenated, no separator.
pub fn get_system_tag(scheme: &TagScheme) -> String {
    format!("{}{}", scheme.prefix, scheme.system)
}

/// R3: join trimmed [system_tag, type_code, sequence_number] with separator.
pub fn format_element_tag(
    system_tag: &str,
    type_code: &str,
    sequence_number: &str,
    separator: &str,
) -> String {
    let sep = if separator.is_empty() { "." } else { separator };
    [
        clean_token(system_tag),
        clean_token(type_code),
        clean_token(sequence_number),
    ]
    .join(sep)
}

/// Parsed generated element tag.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedTag {
    pub system_tag: String,
    pub type_code: String,
    pub sequence_number: String,
    pub sequence: u32,
}

/// R4: split on the scheme separator; exactly 3 non-empty parts with an
/// all-digit third part, else `None`.
pub fn parse_generated_element_tag(value: &str, scheme: &TagScheme) -> Option<ParsedTag> {
    let cleaned = clean_token(value);
    let parts: Vec<&str> = cleaned.split(&scheme.separator).collect();
    if parts.len() != 3 {
        return None;
    }
    let (system_tag, type_code, sequence_number) = (parts[0], parts[1], parts[2]);
    if system_tag.is_empty() || type_code.is_empty() {
        return None;
    }
    if sequence_number.is_empty() || !sequence_number.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let sequence = sequence_number.parse::<u32>().ok()?;
    Some(ParsedTag {
        system_tag: system_tag.to_string(),
        type_code: type_code.to_string(),
        sequence_number: sequence_number.to_string(),
        sequence,
    })
}

/// Scheme validation outcome (legacy `validateTagScheme` shape).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemeValidation {
    pub valid: bool,
    pub errors: Vec<String>,
    pub scheme: TagScheme,
}

/// R5: verbatim legacy error strings.
pub fn validate_tag_scheme(input: &SchemeInput) -> SchemeValidation {
    let scheme = normalize_tag_scheme(input);
    let mut errors = Vec::new();
    if scheme.prefix.is_empty() {
        errors.push("Enter a tag prefix.".to_string());
    }
    if scheme.system.is_empty() {
        errors.push("Enter a system or run number.".to_string());
    }
    if scheme.prefix.contains(&scheme.separator) || scheme.system.contains(&scheme.separator) {
        errors.push(format!(
            "Prefix and system cannot contain the \u{201c}{}\u{201d} separator.",
            scheme.separator
        ));
    }
    if scheme.type_codes.tray == scheme.type_codes.fitting {
        errors.push("Tray and fitting type codes must be different.".to_string());
    }
    for (kind_label, code) in [
        ("cable tray", scheme.type_codes.tray.as_str()),
        ("cable fitting", scheme.type_codes.fitting.as_str()),
    ] {
        if code.is_empty() {
            errors.push(format!("Enter a type code for {kind_label}."));
        }
        if code.contains(&scheme.separator) {
            errors.push(format!(
                "Type code \u{201c}{code}\u{201d} cannot contain the separator."
            ));
        }
    }
    let valid = errors.is_empty();
    SchemeValidation {
        valid,
        errors,
        scheme,
    }
}

/// Minimal element identity for allocation (extra legacy fields ride along
/// unchanged via the generic `meta` passthrough in `TagAssignment::extra`).
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ElementRef {
    pub model_id: String,
    pub local_id: i64,
    pub system_tag_hint: String,
}

/// Existing assignment (only `element_tag`/`component_id` read, like legacy).
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExistingTag {
    pub element_tag: String,
    pub component_id: String,
}

/// Allocated tag assignment (legacy spread shape + v2 stamp + delete flag).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagAssignment {
    pub model_id: String,
    pub local_id: i64,
    pub system_tag: String,
    pub element_tag: String,
    pub component_id: String,
    pub element_kind: String,
    pub type_code: String,
    pub sequence_number: String,
    pub scheme_version: String,
    pub original_ifc_tag: String,
    pub delete: bool,
}

/// Allocation outcome.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AllocateResult {
    pub valid: bool,
    pub errors: Vec<String>,
    pub assignments: Vec<TagAssignment>,
    pub scheme: TagScheme,
}

/// R6-R8: validate scheme; require tray|fitting; reserve parsed sequences
/// matching system+type (case-insensitive); gap-append never reuse; overflow
/// past 10^digits - 1 fails with the verbatim error and no assignments.
pub fn allocate_element_tags(
    elements: &[ElementRef],
    element_kind: &str,
    scheme_input: &SchemeInput,
    existing: &[ExistingTag],
) -> AllocateResult {
    let validation = validate_tag_scheme(scheme_input);
    if !validation.valid {
        return AllocateResult {
            valid: false,
            errors: validation.errors,
            assignments: Vec::new(),
            scheme: validation.scheme,
        };
    }
    if element_kind != "tray" && element_kind != "fitting" {
        return AllocateResult {
            valid: false,
            errors: vec!["Choose Cable Tray or Cable Fitting before generating tags.".to_string()],
            assignments: Vec::new(),
            scheme: validation.scheme,
        };
    }
    let scheme = validation.scheme;
    let system_tag = get_system_tag(&scheme);
    let type_code = if element_kind == "tray" {
        scheme.type_codes.tray.clone()
    } else {
        scheme.type_codes.fitting.clone()
    };

    let mut reserved: Vec<u32> = Vec::new();
    for assignment in existing {
        let raw = if assignment.element_tag.is_empty() {
            &assignment.component_id
        } else {
            &assignment.element_tag
        };
        let Some(parsed) = parse_generated_element_tag(raw, &scheme) else {
            continue;
        };
        if !parsed.system_tag.eq_ignore_ascii_case(&system_tag) {
            continue;
        }
        if !parsed.type_code.eq_ignore_ascii_case(&type_code) {
            continue;
        }
        reserved.push(parsed.sequence);
    }

    let maximum: u64 = 10u64.pow(scheme.sequence_digits) - 1;
    let mut next_sequence: u64 = if reserved.is_empty() {
        scheme.start_sequence as u64
    } else {
        let top = reserved.iter().copied().max().unwrap_or(0);
        (scheme.start_sequence as u64).max(top as u64 + 1)
    };

    let mut assignments = Vec::with_capacity(elements.len());
    for element in elements {
        while reserved.contains(&(next_sequence as u32)) {
            next_sequence += 1;
        }
        if next_sequence > maximum {
            return AllocateResult {
                valid: false,
                errors: vec![format!(
                    "The {}-digit sequence is full. Increase the digit count before applying tags.",
                    scheme.sequence_digits
                )],
                assignments: Vec::new(),
                scheme,
            };
        }
        let sequence_number = format!(
            "{:0>width$}",
            next_sequence,
            width = scheme.sequence_digits as usize
        );
        let element_tag =
            format_element_tag(&system_tag, &type_code, &sequence_number, &scheme.separator);
        assignments.push(TagAssignment {
            model_id: element.model_id.clone(),
            local_id: element.local_id,
            system_tag: system_tag.clone(),
            element_tag: element_tag.clone(),
            component_id: element_tag,
            element_kind: element_kind.to_string(),
            type_code: type_code.clone(),
            sequence_number,
            scheme_version: SCHEME_VERSION.to_string(),
            original_ifc_tag: String::new(),
            delete: false,
        });
        reserved.push(next_sequence as u32);
        next_sequence += 1;
    }
    AllocateResult {
        valid: true,
        errors: Vec::new(),
        assignments,
        scheme,
    }
}

/// Returns true for the two supported kinds (R6 helper for callers).
pub fn is_supported_kind(element_kind: &str) -> bool {
    element_kind == "tray" || element_kind == "fitting"
}

#[cfg(test)]
mod tests;
