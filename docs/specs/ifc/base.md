# ifc-io / shared IFC text layer + tray read/write + conduit overlay read (task 3.2)

Status: draft
Branch: `rust/ifc-io`
Owner folders: `crates/ifc-io/`, `spec/vectors/ifc/`, `docs/specs/ifc/`, `scripts/run-ifc-vectors.mjs`

## Goal

Provide the single pure-Rust home for the IFC text logic both product lines
share: STEP string escaping, entity-id scanning, export-name rules, and the
GUID-shape contract. Port the tray tag read/write logic (the only real IFC
port: `CCP_TAG` project tags + `CCP_TRAY_SYSTEM` assignments + the safe
editor's typed property/colour plan). Spec the conduit overlay **read**
path as new build (the writer stays TS-side; no legacy reader exists).

Overlap answer (ARCHITECTURE section 2, rule 2 `[UNVERIFIED]` — now
resolved): tray and conduit share **zero** parsing code (different regexes,
different psets, different GUID schemes), so a shared *parser* is not
justified. What is shared and justifies one crate: the STEP text primitives
(escape, entity scan, terminator, guid-shape), the export-name rules, and the
typed-value table. Product-specific pset logic lives in product modules
inside this crate (`tray_tags`, `overlay`) — never imported across product
cores (ARCHITECTURE rule 4; enforced because product cores depend on
`ifc-io`, never on each other).

## Public interface

All types are plain data; all functions are pure (no I/O, no globals, no
`Math.random`/`Date.now`). GUIDs come from a caller-injected function
(owner-approved Q1 pattern).

```rust
// step (shared STEP text primitives)
pub fn escape_step(value: &str) -> String        // ' -> ''
pub fn unescape_step(value: &str) -> String      // '' -> '
pub fn entity_ids(source: &str) -> Vec<u64>     // every #id on its own line
pub fn find_data_terminator(source: &str) -> Option<usize>
pub enum StepError { TerminatorNotFound, ... }
// guid (owner-approved injected determinism)
pub type GuidFn = dyn Fn() -> String;
pub fn is_guid_shape(guid: &str) -> bool        // ^[0-3][0-9A-Za-z_$]{21}$
// naming (shared export-name rules)
pub fn tagged_name(source_name: &str) -> String  // *.ifc -> *_tagged.ifc
pub fn edited_name(source_name: &str) -> String  // *.ifc -> *_edited.ifc
// value (shared typed-value table, safe-editor parity)
pub enum IfcValueType { Label, Text, Identifier, Boolean, Integer, Real, Date, DateTime }
pub fn format_typed_value(value_type: IfcValueType, value: &str) -> Result<String, StepError>
pub fn is_writable_pset(name: &str) -> bool      // BIM_TRACKER_EDIT | COSAPI_*
// tray_tags (tray read/write port)
pub struct TagAssignment { pub local_id: u64, pub tag: String, ... }
pub struct TrayAssignment { pub local_id: u64, pub system_tag: String, pub component_id: String, ... }
pub fn extract_project_tags(source: &str, pset: &str, name: &str) -> Vec<(u64, String, u64)>
pub fn extract_tray_assignments(source: &str) -> Vec<TrayAssignment>
pub enum EditOp { UpdateProperty { property_id: u64, value: String }, CreateProperty {...}, ... }
pub fn plan_project_tag(...) -> Vec<EditOp>      // no string splicing; TS applies text
// validator (pure grouping, tag-validator.js parity)
pub fn validate_tag_integrity(...) -> ValidationReport
// overlay (conduit overlay READ — new build, no legacy parity)
pub struct OverlayRun { pub name: String, pub size: String, pub system: String, pub length_m: f64, pub points: Vec<[f64; 3]>, ... }
pub fn parse_conduit_overlay(source: &str) -> Result<Vec<OverlayRun>, StepError>
```

## Rules

R1: Metres internally (`f64`, IFC Z-up); STEP text is the only string I/O.
R2: `escape_step` doubles every `'`; `unescape_step` halves every `''`
(legacy `escapeStepString`/`unescapeStepString` parity, both files).
R3: `entity_ids` matches `^\s*#(\d+)\s*=` per line (legacy `getEntityIds`
parity); `find_data_terminator` matches `/ENDSEC\s*;\s*END-ISO-10303-21\s*;$/`
and returns `None` (never throws across the boundary) when absent.
R4: `is_guid_shape` pins `^[0-3][0-9A-Za-z_$]{21}$` (legacy `createIfcGuid`
alphabet `'0-9A-Za-z_$'` + 128-bit range parity; tray `ifc-io.json`
`guid-shape` vector). Randomness itself stays TS-side.
R5: `tagged_name`/`edited_name`: `*.ifc` (any case) replaces the suffix with
`_tagged.ifc`/`_edited.ifc`; anything else appends it (legacy
`taggedIfcFileName`/`editedIfcFileName` parity, default `'model.ifc'`).
R6: `format_typed_value` table (legacy `formatTypedValue` parity):
Label/Text/Identifier quote+escape; Boolean accepts
`true/yes/1/.t.` → `.T.`, `false/no/0/.f.` → `.F.`, else `Err`; Integer
`/^[+-]?\d+$/`; Real finite (`Number.isInteger → "N."` else `String(n)`);
Date `/^\d{4}-\d{2}-\d{2}$/` quoted; DateTime ISO-with-optional-offset
quoted; unknown type → `Err`.
R7: `is_writable_pset` pins `/^(?:BIM_TRACKER_EDIT|COSAPI_[A-Z0-9_]+)$/i`
(legacy `CUSTOM_PROPERTY_SET_PATTERN` parity). New properties in any other
pset are rejected; updates to existing properties are allowed in any pset.
R8: `extract_project_tags` is case-insensitive on pset + property names,
matches only `IFCPROPERTYSINGLEVALUE` with a quoted-string value, and follows
`IFCRELDEFINESBYPROPERTIES((...) → #pset)` (legacy
`extractProjectTagsFromIfc` parity).
R9: `extract_tray_assignments` reads the `CCP_TRAY_SYSTEM` set; `elementTag`
defaults to `componentId` when empty; entries with all three of
`systemTag/componentId/elementTag` empty are skipped (legacy
`extractTraySystemAssignmentsFromIfc` parity).
R10: `validate_tag_integrity`: system tags may repeat, component IDs must
not; blank Excel tags and duplicates are errors; unmatched Excel/IFC tags
are warnings (legacy `tag-validator.js` parity, tray `validator.json`).
R11: `parse_conduit_overlay` (new build, no legacy parity): one
`IFCANNOTATION` + its `Pset_ConduitRun` → one `OverlayRun`; resolves the
`IFCPOLYLINE` → `IFCCARTESIANPOINT` chain; reads `Size/System/Length` plus
the `takeoff-overlay.md` fields (`Elbow45/Elbow90/RiserLength/Couplings/
StickLength`, defaulting to 0 when absent for old overlay files).

## Acceptance criteria

Stored as `spec/vectors/ifc/*.json`, run against legacy JS via
`node scripts/run-ifc-vectors.mjs` where a legacy function exists and
against this crate via `cargo test`:

| File | Cases | Covers |
|---|---|---|
| `spec/vectors/ifc/step.json` | ~10 | escape/unescape round-trip (incl. quotes), entity-id scan, terminator found/missing |
| `spec/vectors/ifc/naming.json` | ~6 | tagged/edited names (suffix case, no-ext, default) |
| `spec/vectors/ifc/value.json` | ~14 | typed-value table (each type incl. throw cases), writable-pset gate |
| `spec/vectors/ifc/tags.json` | ~8 | project-tag + tray-assignment extraction (incl. case-insensitivity, empty-skip) |
| `spec/vectors/ifc/validator.json` | 7 | reuses tray `validator.json` expectations |
| `spec/vectors/ifc/overlay_read.json` | ~6 | NEW BUILD: annotation→run parse, polyline→points, old-file defaults; `rustOnly` (no legacy reader) |

~50 cases total.

## Out of scope

- STEP full-text rendering and entity-id allocation (TS-side; pinned
`jsOnly` in tray `ifc-io.json` and conduit `io.json`).
- Colour/style entities (`IFCCOLOURRGB`/`IFCSTYLEDITEM` chains stay
TS-side; the colour *plan* — hex validation, transparency clamp — is R6/R7).
- Overlay *write* (`exportOverlayIfc` stays TS-side, conduit `io.json`).
- `IfcGUID` randomness, `Date.now` timestamps, command-stack/marker/SHA/CSV
(conduit `io.json`, all `jsOnly`).
- `ifc-extractor.js` (three + live model I/O, TS adapter per 2.2 Q3).

## Parity reference

- `legacy/src/ifc/ifc-tag-exporter.js` (397 lines) + `legacy/src/ifc/ifc-safe-editor.js` (383 lines).
- `legacy/src/ifc/tag-validator.js` (98 lines) + `legacy/packages/conduit-core/src/ifc-exporter.js` (171 lines, write path only).
- Vectors: `spec/vectors/tray/ifc-io.json` (25 cases, jsOnly shape pins), `spec/vectors/conduit/io.json` (12 cases, jsOnly), `spec/vectors/tray/validator.json` (7 cases).
- Specs: `docs/specs/tray/vectors.md` R9, `docs/specs/conduit/vectors.md` R8-R9 + `takeoff-overlay.md` lines 90-107 (overlay field contract).

## Open questions

None. GUID determinism via injected guid fn **APPROVED by owner
2026-10-22** (conduit Q1, tray Q1). Shared-vs-split overlap resolved by this
spec: one crate, shared text layer + product modules.
