# tray-tagging / scheme + classifier + validator + assignment state (task 5.1)

Status: implemented (2026-10-25: 5.1 landed, 46/46 Rust tests + 40 vectors green)
Branch: `rust/tray-tagging`
Owner folders: `crates/tray-tagging/`, `spec/vectors/tray/tagging.json`, `spec/vectors/tray/tagging-state.json`, `spec/vectors/tray/validator.json`, `docs/specs/tray/tagging.md`

## Goal

Port the pure tray-tagging domain to Rust: tag-scheme normalize/format/parse/
validate/allocate, the conservative element classifier, the integrity
validator, and the saved/pending/undo assignment-state model plus Tag
Register / Summary row builders. Everything with DOM, Three.js, live IFC
model I/O, STEP text writing, GUID randomness, or `.xlsx` bytes stays
TS-side.

## Public interface

All types plain data; all functions pure (no I/O, no globals, no
`Date.now`/`Math.random`). Tags are unit-free strings. Metres N/A.

```rust
// scheme
pub struct TypeCodes { pub tray: String, pub fitting: String }
pub struct TagScheme { pub prefix: String, pub system: String, pub separator: String,
  pub sequence_digits: u32, pub start_sequence: u32, pub type_codes: TypeCodes }
pub fn normalize_tag_scheme(input: &SchemeInput) -> TagScheme
pub fn get_system_tag(scheme: &TagScheme) -> String
pub fn format_element_tag(system_tag: &str, type_code: &str, sequence_number: &str, separator: &str) -> String
pub struct ParsedTag { pub system_tag: String, pub type_code: String,
  pub sequence_number: String, pub sequence: u32 }
pub fn parse_generated_element_tag(value: &str, scheme: &TagScheme) -> Option<ParsedTag>
pub struct SchemeValidation { pub valid: bool, pub errors: Vec<String>, pub scheme: TagScheme }
pub fn validate_tag_scheme(input: &SchemeInput) -> SchemeValidation
pub struct ElementRef { pub model_id: String, pub local_id: i64, pub global_id: String,
  pub name: String, pub ifc_type: String, pub object_type: String, pub family: String, pub category: String }
pub struct TagAssignment { pub model_id: String, pub local_id: i64, pub system_tag: String,
  pub element_tag: String, pub component_id: String, pub element_kind: String,
  pub type_code: String, pub sequence_number: String, pub scheme_version: String,
  pub original_ifc_tag: String, pub delete: bool }
pub struct AllocateResult { pub valid: bool, pub errors: Vec<String>,
  pub assignments: Vec<TagAssignment>, pub scheme: TagScheme }
pub fn allocate_element_tags(elements: &[ElementRef], element_kind: &str,
  scheme: &TagScheme, existing: &[ExistingTag]) -> AllocateResult

// classifier
pub struct Classification { pub kind: Option<String>, pub confidence: f64, pub evidence: String }
pub fn classify_taggable_element(el: &ElementRef) -> Classification

// validator
pub struct ExcelTag { pub row_number: u32, pub tag: String }
pub struct IntegrityIssue { pub code: String, pub tag: String, pub message: String }
pub struct IntegrityCounts { pub ifc_tags: usize, pub excel_tags: usize,
  pub matched_tags: usize, pub errors: usize, pub warnings: usize }
pub struct IntegrityReport { pub valid: bool, pub errors: Vec<IntegrityIssue>,
  pub warnings: Vec<IntegrityIssue>, pub counts: IntegrityCounts }
pub fn validate_tag_integrity(elements: &[EffectiveElement], excel: &[ExcelTag]) -> IntegrityReport

// assignment state (pure model of legacy main.js tagAssignments + existingProjectTags)
pub struct SavedAssignment { pub model_id: String, pub local_id: i64, pub system_tag: String,
  pub element_tag: String, pub component_id: String, pub element_kind: String,
  pub type_code: String, pub sequence_number: String, pub scheme_version: String }
pub struct PendingEdit { pub assignment: TagAssignment }  // delete=true means pending deletion
pub fn effective_assignments(saved: &[SavedAssignment], pending: &[PendingEdit]) -> Vec<EffectiveElement>
pub struct BatchSnapshot { pub key: String, pub previous: Option<TagAssignment> }
pub fn apply_batch(pending: &mut Vec<PendingEdit>, snapshot: &mut Vec<BatchSnapshot>,
  batch: Vec<TagAssignment>)  // single-level: overwrites previous snapshot
pub fn undo_batch(pending: &mut Vec<PendingEdit>, snapshot: &mut Vec<BatchSnapshot>) -> usize

// register rows (pure data; .xlsx bytes stay in excel-io / app)
pub struct RegisterRow { pub system_tag: String, pub element_tag: String, pub component_id: String,
  pub element_kind: String, pub type_code: String, pub sequence_number: String,
  pub model_name: String, pub local_id: i64, pub source: String }
pub fn build_register_rows(effective: &[EffectiveElement]) -> Vec<RegisterRow>
pub struct SummaryRow { pub group: String, pub key: String, pub count: usize }
pub fn build_summary_rows(effective: &[EffectiveElement]) -> Vec<SummaryRow>
```

`EffectiveElement` = saved-or-pending merged view with `source: "ifc" | "pending"`,
`was_saved: bool` (pending edit over an existing saved tag = Modified).

## Rules

R1: `normalize_tag_scheme`: trim prefix/system/separator/type-codes;
empty separator defaults to `"."`; `sequence_digits` parses as int,
valid 1–6 else `2`; `start_sequence` parses as int, `>= 1` else `1`;
empty type codes fall back to tray `"01"` / fitting `"02"`.
R2: `get_system_tag` = `prefix + system` (concatenated, no separator).
R3: `format_element_tag` joins trimmed `[system_tag, type_code,
sequence_number]` with separator (default `"."`).
R4: `parse_generated_element_tag` splits on the scheme separator; must
yield exactly 3 non-empty parts with the third all-digits, else `None`.
Returns `{system_tag, type_code, sequence_number, sequence: int}`.
R5: `validate_tag_scheme` errors verbatim (legacy parity):
`Enter a tag prefix.` / `Enter a system or run number.` / `Prefix and
system cannot contain the “{sep}” separator.` / `Tray and fitting type
codes must be different.` / `Enter a type code for cable tray|fitting.` /
`Type code “{code}” cannot contain the separator.` Valid iff no errors.
R6: `allocate_element_tags`: invalid scheme returns `{valid:false,
errors, assignments:[]}`; unknown `elementKind` (not `tray|fitting`)
returns `valid:false`, error `Choose Cable Tray or Cable Fitting before
generating tags.`, no assignments.
R7: Reserved sequences = parsed `elementTag || componentId` of existing
assignments whose system tag AND type code both match
case-insensitively; unparsable entries ignored. Sequences independent
per kind. Next = reserved non-empty ? `max(start, max+1)` : `start`;
skip already-reserved values (gap-append, never reuse); overflow past
`10^digits - 1` returns `valid:false`, error `The {d}-digit sequence is
full. Increase the digit count before applying tags.`, no assignments.
R8: Each assignment spreads the input element plus `systemTag`,
`elementTag`, `componentId = elementTag`, `elementKind`, `typeCode`,
zero-padded `sequenceNumber`, `schemeVersion: "2"`.
R9: Classifier order (legacy parity): IFC class first —
`ifccablecarrierfitting|ifccablefitting` → fitting @1.0
(`Standard IFC fitting class`); `ifccablecarriersegment` → tray @1.0
(`Standard IFC cable-carrier segment class`). Else EN/ES name
heuristics: fitting-only match → fitting @0.72
(`Element name or property indicates a fitting`); tray-only → tray
@0.72 (`... tray segment`); both or neither → `kind:null` @0
(`Element metadata contains both tray and fitting terms` /
`No reliable tray/fitting indicator found`). User must assign
`null` cases explicitly.
R10: Validator normalization is trim + lowercase everywhere.
Element groups key on `systemTag ?? tag`; component groups on
`componentId`; Excel groups on `tag`; blank Excel tags excluded from
grouping but reported. System tags may repeat; component IDs must not.
R11: Validator errors (blocking, `valid=false`): `duplicate-component-id`
(`Component ID “{tag}” is used by {n} IFC elements.`) /
`missing-component-id` (`{n} assigned element(s) have no component ID.`)
/ `duplicate-excel-tag` (`Tag “{tag}” appears in {n} Excel rows.`) /
`blank-excel-tag` (`{n} Excel row(s) have a blank tag.`). Warnings
(non-blocking): `unassigned-excel-tags` (`{n} Excel system tag(s) are
not assigned to IFC elements.`) / `ifc-tags-missing-from-excel`
(`{n} IFC tray system(s) are missing from Excel.`, only checked when
Excel list non-empty). Counts: `ifcTags` = unique systems,
`excelTags` = rows, `matchedTags` = Excel rows whose tag matches a
system, `errors`/`warnings` = issue counts.
R12: Assignment state: key = `(modelId, localId)`. Effective =
saved map overlaid by pending map; pending `delete:true` removes the
key. Preview conflict = existing effective/IFC tag non-empty AND
case-insensitively different from generated `componentId`. Batch apply
snapshots `{key, previous-or-null}` per touched key (single level,
overwrites prior snapshot); undo restores/deletes per snapshot and
clears it. Pending-deletion restore = drop the pending entry.
R13: Register rows built from effective assignments only (pending +
saved, minus deletions), sorted by `(systemTag.lower, componentId.lower)`;
`source` = `pending|ifc`. Summary aggregates counts by system, kind,
model, and source state. `.xlsx` serialization stays in `excel-io`.
R14: GUID randomness, STEP text rendering, entity-id sequencing,
colour/style entities, `ifc-extractor.js` (Three.js), and
`routing-controller.js` (DOM/scene) never enter this crate.

## Acceptance criteria

Covered by `spec/vectors/tray/tagging.json` (33) +
`spec/vectors/tray/validator.json` (7) +
`spec/vectors/tray/tagging-state.json` (6, added by this task); all pass in
Rust (`cargo test -p tray-tagging`: 46/46) and against legacy JS
(`node scripts/run-tray-vectors.mjs`, tagging + validator suites green).

| Case | Input | Expected |
|---|---|---|
| get-system-tag | prefix `PT`, system `1` | `PT1` |
| format / custom separator | `PT1,01,03` / `S-T-7` | joined string |
| parse ok / wrong parts / non-numeric | `PT1.02.14` / `PT1.01` / `PT1.01.XX` | struct / `null` / `null` |
| normalize trims/defaults, digit clamps 0/7 | vectors `normalize-*` | defaults `2`, `01/02`, `.`, `1` |
| validate ok / blank prefix / sep-in-prefix / dup codes | vectors `validate-*` | verbatim errors |
| allocate tray/fitting/gap/other-system/other-type/case-insensitive/high-reserved/overflow/unknown-kind | vectors `allocate-*` | exact tag lists + errors |
| classify IFC classes / EN+ES names / ambiguous / unknown | vectors `classify-*` | kind + 1.0/0.72/0 |
| validator duplicates/blanks/missing/unmatched/empty | vectors `validator.json` all 7 | codes + counts |
| effective overlay + pending delete + batch undo | `tagging-state.json` state-* | merged list, restore count 1 |
| register/summary rows | `tagging-state.json` rows-* | sorted order + group counts |

## Out of scope

- STEP text read/write, GUIDs, entity-id allocation (`ifc-io`, TS-side
per `vectors.md` R9; `ifc-io.json` stays `jsOnly`).
- `ifc-extractor.js` (Three.js + live model) and `routing-controller.js`
(DOM/scene/overlay) — stay TS adapters.
- Excel Tag Register / Summary workbook bytes (`packages/excel-io`,
task 7.3); this crate returns row data only.
- Safe-editor property panels and colour UI (task 7.4).
- Full STEP golden files (GUIDs vary; shape asserted only).

## Parity reference

- `legacy/src/tagging/tag-scheme.js` (124 lines) + `element-classifier.js` (32)
- `legacy/src/ifc/tag-validator.js` (98)
- `legacy/src/ifc/ifc-tag-exporter.js` (397: `CCP_TRAY_SYSTEM` write,
native `Tag` allowlist, `_tagged.ifc` naming — read path already in `ifc-io`)
- `legacy/src/main.js`: `tagAssignments` map, `getEffectiveTaggedElements`,
`findSystemMembers`, batch preview/apply/undo (`lastBatchSnapshot`),
pending deletions, `getExcelTagsForValidation` + `runTagValidation`
- Tests: `legacy/packages/routing-core/test/tag-scheme.test.js`,
`tag-validator.test.js`; vectors: `spec/vectors/tray/tagging.json`,
`validator.json`, runner `scripts/run-tray-vectors.mjs`.

## Open questions — resolved by 5.1 (2026-10-25)

1. Register/Summary sort: `(systemTag.lower, componentId.lower)` (verified
   against `getTraySystemSummaries` ordering + export row order). Column order
   pinned by `excel-io/base.md` (7.3). CLOSED.
2. Multi-model key: Rust takes opaque `model_id: String`; TS edge owns the
   `modelId`/`uuid` alias resolution (assignment_key = `modelId:localId`).
   CLOSED.
3. `originalIfcTag`: carried through assignments and effective view; Register
   column owned by `excel-io/base.md`. CLOSED.
