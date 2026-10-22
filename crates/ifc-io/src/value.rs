//! Shared typed-value table + writable-pset gate (spec R6-R7).
//!
//! Parity with legacy `formatTypedValue` and `CUSTOM_PROPERTY_SET_PATTERN`
//! in `legacy/src/ifc/ifc-safe-editor.js`.

use crate::step::escape_step;

/// Editable IFC value types (legacy `EDITABLE_IFC_VALUE_TYPES` parity).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IfcValueType {
    Label,
    Text,
    Identifier,
    Boolean,
    Integer,
    Real,
    Date,
    DateTime,
}

/// Typed-value formatting error (legacy throw-message parity).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValueError {
    /// Human-readable reason, mirroring the legacy throw text.
    pub message: String,
}

impl std::fmt::Display for ValueError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for ValueError {}

fn err(message: String) -> ValueError {
    ValueError { message }
}

/// Parse a value-type name (case-insensitive) to [`IfcValueType`].
pub fn parse_value_type(name: &str) -> Result<IfcValueType, ValueError> {
    match name.to_uppercase().as_str() {
        "IFCLABEL" => Ok(IfcValueType::Label),
        "IFCTEXT" => Ok(IfcValueType::Text),
        "IFCIDENTIFIER" => Ok(IfcValueType::Identifier),
        "IFCBOOLEAN" => Ok(IfcValueType::Boolean),
        "IFCINTEGER" => Ok(IfcValueType::Integer),
        "IFCREAL" => Ok(IfcValueType::Real),
        "IFCDATE" => Ok(IfcValueType::Date),
        "IFCDATETIME" => Ok(IfcValueType::DateTime),
        other => Err(err(format!(
            "IFC value type {other} is not supported by the safe editor."
        ))),
    }
}

/// Format a value for STEP text (legacy `formatTypedValue` parity).
/// Returns the *inner* literal: quoted for string/date types, bare for
/// boolean/integer/real.
pub fn format_typed_value(value_type: IfcValueType, value: &str) -> Result<String, ValueError> {
    let text = value.trim();
    match value_type {
        IfcValueType::Label | IfcValueType::Text | IfcValueType::Identifier => {
            Ok(format!("'{}'", escape_step(value)))
        }
        IfcValueType::Boolean => {
            if matches!(text.to_lowercase().as_str(), "true" | "yes" | "1" | ".t.") {
                Ok(".T.".to_string())
            } else if matches!(text.to_lowercase().as_str(), "false" | "no" | "0" | ".f.") {
                Ok(".F.".to_string())
            } else {
                Err(err(format!("\"{value}\" is not a valid IFC Boolean.")))
            }
        }
        IfcValueType::Integer => {
            let ok = !text.is_empty()
                && text
                    .strip_prefix(['+', '-'])
                    .unwrap_or(text)
                    .chars()
                    .all(|c| c.is_ascii_digit())
                && text
                    .strip_prefix(['+', '-'])
                    .unwrap_or(text)
                    .chars()
                    .any(|c| c.is_ascii_digit());
            if ok {
                Ok(text.to_string())
            } else {
                Err(err(format!("\"{value}\" is not a valid IFC integer.")))
            }
        }
        IfcValueType::Real => match text.parse::<f64>() {
            Ok(n) if n.is_finite() => {
                if n.fract() == 0.0 {
                    Ok(format!("{n:.0}."))
                } else {
                    Ok(format!("{n}"))
                }
            }
            _ => Err(err(format!("\"{value}\" is not a valid IFC real number."))),
        },
        IfcValueType::Date => {
            if is_date(text) {
                Ok(format!("'{text}'"))
            } else {
                Err(err(format!(
                    "\"{value}\" is not a valid IFC date (YYYY-MM-DD)."
                )))
            }
        }
        IfcValueType::DateTime => {
            if is_datetime(text) {
                Ok(format!("'{text}'"))
            } else {
                Err(err(format!("\"{value}\" is not a valid IFC date-time.")))
            }
        }
    }
}

fn is_date(text: &str) -> bool {
    let b = text.as_bytes();
    b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && b[0..4].iter().all(|c| c.is_ascii_digit())
        && b[5..7].iter().all(|c| c.is_ascii_digit())
        && b[8..10].iter().all(|c| c.is_ascii_digit())
}

fn is_datetime(text: &str) -> bool {
    let (date, rest) = match text.find('T') {
        Some(i) => (&text[..i], &text[i + 1..]),
        None => return false,
    };
    if !is_date(date) || rest.len() < 5 {
        return false;
    }
    let t = rest.as_bytes();
    if !(t[0..2].iter().all(|c| c.is_ascii_digit())
        && t[2] == b':'
        && t[3..5].iter().all(|c| c.is_ascii_digit()))
    {
        return false;
    }
    let mut tail = &rest[5..];
    if let Some(stripped) = tail.strip_prefix(':') {
        if stripped.len() < 2 || !stripped.as_bytes()[0..2].iter().all(|c| c.is_ascii_digit()) {
            return false;
        }
        tail = &stripped[2..];
    }
    tail.is_empty()
        || tail == "Z"
        || ((tail.starts_with('+') || tail.starts_with('-'))
            && tail.len() == 6
            && tail.as_bytes()[1..3].iter().all(|c| c.is_ascii_digit())
            && tail.as_bytes()[3] == b':'
            && tail.as_bytes()[4..6].iter().all(|c| c.is_ascii_digit()))
}

/// New properties may only be created in these psets (legacy
/// `CUSTOM_PROPERTY_SET_PATTERN` parity: `/^(?:BIM_TRACKER_EDIT|COSAPI_[A-Z0-9_]+)$/i`).
#[must_use]
pub fn is_writable_pset(name: &str) -> bool {
    if name.eq_ignore_ascii_case("BIM_TRACKER_EDIT") {
        return true;
    }
    let mut parts = name.split('_');
    match (parts.next(), parts.next()) {
        (Some(prefix), Some(_)) if prefix.eq_ignore_ascii_case("COSAPI") => name
            ["COSAPI".len() + 1..]
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_'),
        _ => false,
    }
}

#[cfg(test)]
mod tests;
