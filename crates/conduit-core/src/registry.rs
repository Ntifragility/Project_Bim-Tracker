//! Diameter registry seed (task 4.1, spec R10).
//!
//! Direct port of the pure data in
//! `legacy/packages/conduit-core/src/config.js` (`DEFAULT_DIAMETERS`,
//! `DIAMETER_PALETTE`) and the stateless lookups in
//! `legacy/packages/conduit-core/src/diameter-registry.js`
//! (`getAll/getById/getByLabel/getSelected default/getColor/add-sort`).
//! Listeners, `Date.now`/`Math.random` ids, and selection state stay
//! TS-side (conduit `io.json` R8).

/// One trade-size entry.
#[derive(Debug, Clone, PartialEq)]
pub struct Diameter {
    pub id: String,
    pub label: String,
    pub mm: f64,
    pub color: String,
}

/// Default stick length in metres (10 ft = 3.048 m, legacy parity).
pub const DEFAULT_STICK_LENGTH_M: f64 = 3.048;

/// Trade-size colour palette (legacy `DIAMETER_PALETTE` parity, index-mapped).
pub const DIAMETER_PALETTE: [&str; 10] = [
    "#f59e0b", "#3b82f6", "#10b981", "#ec4899", "#8b5cf6", "#06b6d4", "#f97316", "#14b8a6",
    "#eab308", "#6366f1",
];

/// Alias kept for readability at use sites.
pub const PALETTE: [&str; 10] = DIAMETER_PALETTE;

/// Unknown-label colour fallback (legacy `getColor` parity).
pub const UNKNOWN_COLOR: &str = "#f59e0b";

/// Default trade sizes (legacy `DEFAULT_DIAMETERS` parity, ascending mm).
#[must_use]
pub fn default_diameters() -> Vec<Diameter> {
    let seed = [
        ("½\"", 12.7),
        ("¾\"", 19.05),
        ("1\"", 25.4),
        ("1¼\"", 31.75),
        ("1½\"", 38.1),
        ("2\"", 50.8),
        ("2½\"", 63.5),
        ("3\"", 76.2),
        ("4\"", 101.6),
    ];
    seed.iter()
        .enumerate()
        .map(|(i, (label, mm))| Diameter {
            id: format!("diam-{}", i + 1),
            label: label.to_string(),
            mm: *mm,
            color: PALETTE[i % PALETTE.len()].to_string(),
        })
        .collect()
}

/// Default selected label (legacy parity: `¾"` when present).
pub const DEFAULT_SELECTED_LABEL: &str = "¾\"";

/// Look up by id or label (legacy `getById`/`getByLabel` parity).
#[must_use]
pub fn find_diameter<'a>(list: &'a [Diameter], label_or_id: &str) -> Option<&'a Diameter> {
    list.iter()
        .find(|d| d.id == label_or_id || d.label == label_or_id)
}

/// Colour for a label or id, falling back to [`UNKNOWN_COLOR`]
/// (legacy `getColor` parity).
#[must_use]
pub fn registry_color<'a>(list: &'a [Diameter], label_or_id: &str) -> &'a str {
    find_diameter(list, label_or_id)
        .map(|d| d.color.as_str())
        .unwrap_or(UNKNOWN_COLOR)
}

/// Sort by mm ascending (legacy `add` sort parity).
pub fn sort_diameters(list: &mut [Diameter]) {
    list.sort_by(|a, b| a.mm.partial_cmp(&b.mm).unwrap_or(std::cmp::Ordering::Equal));
}

/// Palette colour for an index (legacy `DIAMETER_PALETTE[i % len]` parity).
#[must_use]
pub fn palette_color(index: usize) -> &'static str {
    PALETTE[index % PALETTE.len()]
}

#[cfg(test)]
mod tests;
