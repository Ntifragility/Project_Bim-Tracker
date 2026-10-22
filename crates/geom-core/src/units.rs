//! Unit conversion: IFC unit spellings <-> metres.
//!
//! Ports the pure subset of `legacy/packages/conduit-core/src/config.js`
//! (`UNIT_TABLE`, stick/merge constants) and
//! `legacy/packages/conduit-core/src/coordinate-utils.js`
//! (`resolveUnit`, `convertLength`, `fromMetres`, `toMetres`).
//!
//! Out of scope (stays TS-side or moves to conduit-core): `formatLength`,
//! `formatFileSize` (presentation), `sizeToMillimetres` (trade-size parsing),
//! `DEFAULT_DIAMETERS` + registry selection state.

/// Length unit. Factor converts the unit to metres.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Unit {
    Metre,
    Meter,
    Millimetre,
    Millimeter,
    Centimetre,
    Centimeter,
    Foot,
    Inch,
}

/// Error for unknown unit names / failed conversions.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnknownUnit {
    /// The offending unit string, as passed in.
    pub name: String,
}

impl std::fmt::Display for UnknownUnit {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Unknown unit: {}", self.name)
    }
}

impl std::error::Error for UnknownUnit {}

/// Default stick length in metres (10 ft = 3.048 m).
/// Legacy `DEFAULT_STICK_LENGTH_M` parity.
pub const DEFAULT_STICK_LENGTH_M: f64 = 3.048;

/// Minimum segment length in metres (below this a segment is rejected).
/// Legacy `MIN_SEGMENT_LENGTH_M` parity.
pub const MIN_SEGMENT_LENGTH_M: f64 = 0.001;

/// Vertex merge tolerance in metres.
/// Legacy `VERTEX_MERGE_TOLERANCE_M` parity.
pub const VERTEX_MERGE_TOLERANCE_M: f64 = 0.001;

impl Unit {
    /// Conversion factor to metres (legacy `UNIT_TABLE` parity).
    #[must_use]
    pub const fn factor_to_metres(self) -> f64 {
        match self {
            Unit::Metre | Unit::Meter => 1.0,
            Unit::Millimetre | Unit::Millimeter => 0.001,
            Unit::Centimetre | Unit::Centimeter => 0.01,
            Unit::Foot => 0.3048,
            Unit::Inch => 0.0254,
        }
    }

    /// Short label (legacy `UNIT_TABLE` `label` parity).
    #[must_use]
    pub const fn label(self) -> &'static str {
        match self {
            Unit::Metre | Unit::Meter => "m",
            Unit::Millimetre | Unit::Millimeter => "mm",
            Unit::Centimetre | Unit::Centimeter => "cm",
            Unit::Foot => "ft",
            Unit::Inch => "in",
        }
    }

    /// Canonical key (legacy `UNIT_TABLE` key parity).
    #[must_use]
    pub const fn key(self) -> &'static str {
        match self {
            Unit::Metre => "METRE",
            Unit::Meter => "METER",
            Unit::Millimetre => "MILLIMETRE",
            Unit::Millimeter => "MILLIMETER",
            Unit::Centimetre => "CENTIMETRE",
            Unit::Centimeter => "CENTIMETER",
            Unit::Foot => "FOOT",
            Unit::Inch => "INCH",
        }
    }

    /// All units in `UNIT_TABLE` insertion order.
    pub const ALL: [Unit; 8] = [
        Unit::Metre,
        Unit::Meter,
        Unit::Millimetre,
        Unit::Millimeter,
        Unit::Centimetre,
        Unit::Centimeter,
        Unit::Foot,
        Unit::Inch,
    ];
}

/// Resolve an IFC unit string (e.g. `"METRE"`, `"FOOT"`, `".MILLI.METRE."`)
/// to a [`Unit`]. Returns `None` for unrecognised input.
///
/// Normalises by stripping dots/whitespace and upper-casing, tries an exact
/// match, then falls back to substring matching (so `".MILLI.METRE."`
/// resolves to [`Unit::Millimetre`]). Legacy `resolveUnit` parity (spec R9).
#[must_use]
pub fn resolve_unit(name: &str) -> Option<Unit> {
    if name.is_empty() {
        return None;
    }
    let key: String = name
        .chars()
        .filter(|c| *c != '.' && !c.is_whitespace())
        .collect::<String>()
        .to_uppercase();
    if key.is_empty() {
        return None;
    }
    Unit::ALL
        .into_iter()
        .find(|unit| key == unit.key())
        .or_else(|| Unit::ALL.into_iter().find(|unit| key.contains(unit.key())))
}

/// Convert `value` from `from` to `to`.
///
/// Identical units are the identity. Never panics (spec R9).
#[must_use]
pub fn convert_length(value: f64, from: Unit, to: Unit) -> f64 {
    value * from.factor_to_metres() / to.factor_to_metres()
}

/// Resolve both unit names, then convert. `Err` on unknown names (spec R9).
pub fn convert_length_named(value: f64, from: &str, to: &str) -> Result<f64, UnknownUnit> {
    let from_unit = resolve_unit(from).ok_or_else(|| UnknownUnit {
        name: from.to_string(),
    })?;
    let to_unit = resolve_unit(to).ok_or_else(|| UnknownUnit {
        name: to.to_string(),
    })?;
    Ok(convert_length(value, from_unit, to_unit))
}

/// Convert a value in metres to the target unit.
#[must_use]
pub fn from_metres(value_m: f64, to: Unit) -> f64 {
    convert_length(value_m, Unit::Metre, to)
}

/// Convert a value from some unit to metres.
#[must_use]
pub fn to_metres(value: f64, from: Unit) -> f64 {
    convert_length(value, from, Unit::Metre)
}

#[cfg(test)]
mod tests;
