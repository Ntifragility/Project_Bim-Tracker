//! Conservative element classifier.
//!
//! Pure port of `legacy/src/tagging/element-classifier.js` (32 lines).
//! IFC class first, then EN/ES name heuristics; ambiguous or unknown
//! elements return `kind: None` so the user assigns them explicitly.

/// Classification outcome.
#[derive(Debug, Clone, PartialEq)]
pub struct Classification {
    pub kind: Option<String>,
    pub confidence: f64,
    pub evidence: String,
}

/// Minimal element metadata for classification.
#[derive(Debug, Clone, Default)]
pub struct ElementRef {
    pub name: String,
    pub ifc_type: String,
    pub object_type: String,
    pub family: String,
    pub category: String,
}

fn is_word_char(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

/// Case-insensitive whole-word search (legacy `\b...\b` + `i` parity for the
/// ASCII metadata this classifier sees). `pattern` holds lowercase
/// space-separated alternatives; `multi` allows internal runs of whitespace.
fn word_hit(haystack_lower: &str, alternatives: &[&str]) -> bool {
    let hay = haystack_lower.as_bytes();
    for alt in alternatives {
        let needle = alt.as_bytes();
        if needle.is_empty() || needle.len() > hay.len() {
            continue;
        }
        let mut i = 0;
        while i + needle.len() <= hay.len() {
            if &hay[i..i + needle.len()] == needle {
                let left_ok = i == 0 || !is_word_char(hay[i - 1]);
                let right_ok =
                    i + needle.len() == hay.len() || !is_word_char(hay[i + needle.len()]);
                if left_ok && right_ok {
                    return true;
                }
            }
            i += 1;
        }
    }
    false
}

const FITTING_WORDS: &[&str] = &[
    "fitting",
    "fittings",
    "elbow",
    "bend",
    "tee",
    "junction",
    "reducer",
    "transition",
    "curva",
    "codo",
    "derivacion",
    "derivación",
];

fn tray_hit(haystack_lower: &str) -> bool {
    if word_hit(haystack_lower, &["segmento"]) {
        return true;
    }
    if word_hit(haystack_lower, &["tray", "bandeja"]) {
        return true;
    }
    // "cable tray" / "tray segment" phrases plus Spanish "bandeja de cable(s)".
    let h = haystack_lower;
    let has_cable_tray = h.contains("cable") && h.contains("tray")
        || h.contains("bandeja") && (h.contains("cable") || h.contains("cables"));
    let has_tray_segment = h.contains("tray") && h.contains("segment");
    has_cable_tray || has_tray_segment
}

/// R9: IFC class first, then name heuristics; both/neither -> None.
pub fn classify_taggable_element(el: &ElementRef) -> Classification {
    let class = format!("{} {}", el.ifc_type, el.category).to_lowercase();
    if class.contains("ifccablecarrierfitting") || class.contains("ifccablefitting") {
        return Classification {
            kind: Some("fitting".to_string()),
            confidence: 1.0,
            evidence: "Standard IFC fitting class".to_string(),
        };
    }
    if class.contains("ifccablecarriersegment") {
        return Classification {
            kind: Some("tray".to_string()),
            confidence: 1.0,
            evidence: "Standard IFC cable-carrier segment class".to_string(),
        };
    }

    let text = format!(
        "{} {} {} {} {}",
        el.name, el.ifc_type, el.object_type, el.family, el.category
    )
    .to_lowercase();
    let fitting_match = word_hit(&text, FITTING_WORDS);
    let tray_match = tray_hit(&text);
    if fitting_match && !tray_match {
        return Classification {
            kind: Some("fitting".to_string()),
            confidence: 0.72,
            evidence: "Element name or property indicates a fitting".to_string(),
        };
    }
    if tray_match && !fitting_match {
        return Classification {
            kind: Some("tray".to_string()),
            confidence: 0.72,
            evidence: "Element name or property indicates a tray segment".to_string(),
        };
    }
    Classification {
        kind: None,
        confidence: 0.0,
        evidence: if fitting_match && tray_match {
            "Element metadata contains both tray and fitting terms".to_string()
        } else {
            "No reliable tray/fitting indicator found".to_string()
        },
    }
}

#[cfg(test)]
mod tests;
