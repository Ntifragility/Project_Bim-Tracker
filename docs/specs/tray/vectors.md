# Tray / vectors (task 2.2)

Status: implemented (vectors) — Rust crates land in Phase 3/5
Branch: `spec/vectors-tray`
Owner folders: `spec/vectors/tray/`, `docs/specs/tray/`, `scripts/run-tray-vectors.mjs`

## Goal

Pin every pure, deterministic behaviour of the legacy tray JS engine as
golden JSON vectors. The same vectors run against legacy JS today (proving
they describe real behaviour) and against the Rust crates in Phase 3/5
(proving parity). A feature is done when the vectors pass in Rust
(ARCHITECTURE section 6).

## Files

| File | Cases | Legacy source |
|---|---|---|
| `spec/vectors/tray/tagging.json` | 33 | `src/tagging/tag-scheme.js`, `src/tagging/element-classifier.js` |
| `spec/vectors/tray/validator.json` | 7 | `src/ifc/tag-validator.js` |
| `spec/vectors/tray/routing.json` | 26 | `packages/routing-core/src/*.js` (vector, centerline, graph, diagnostics, pathfinding) |
| `spec/vectors/tray/ifc-io.json` | 25 | `src/ifc/ifc-tag-exporter.js`, `src/ifc/ifc-safe-editor.js` (jsOnly, shape-only) |

91 cases total, all passing against legacy JS via
`node scripts/run-tray-vectors.mjs`.

## Rules

R1: All quantities are metres internally; tags are unit-free strings.
R2: Tag allocation sequences are independent per element kind (tray `01`
vs fitting `02`); new assignments append after the highest reserved
sequence, never reusing gaps; matching of existing assignments is
case-insensitive and scoped to the same system tag + type code.
R3: Allocation overflow (sequence exceeds `10^digits - 1`) returns
`valid: false` with a "sequence is full" error and no assignments.
R4: The classifier is conservative: standard IFC classes
(`IfcCableCarrierSegment` -> tray, `IfcCableCarrierFitting` /
`IfcCableFitting` -> fitting) score 1.0; EN/ES name heuristics score
0.72; ambiguous (both or neither) returns `kind: null` and must be
assigned explicitly by the user.
R5: Validation: system tags may repeat, component IDs must not;
blank Excel tags and duplicates are errors; unmatched Excel/IFC tags
are non-blocking warnings.
R6: Centerline uses PCA power iteration (32 steps, seed axis
`(1, 0.73, 0.37)` normalized); `confidence` is longitudinal variance /
total variance; fewer than 2 vertices -> `insufficient-vertices`;
zero-length -> `centerline-too-short`.
R7: Graph clustering uses `tolerance` (default 0.1 m); diagnostics flags
dangling (degree 1), ambiguous (degree > 4), low-confidence edges
(`confidence < 0.65` default, missing confidence counts as 1.0).
R8: Shortest path is Dijkstra over physical `length`; unknown nodes ->
`unknown-node`, disconnected -> `disconnected`.
R9: Rust-pure boundary (owner-approved): `createIfcGuid` (random),
STEP text rendering, entity-id sequencing, color/style entities stay
TS-side (ifc-io text layer / viewer-core). `ifc-io.json` pins their
shape only and is `jsOnly` — never ported to Rust. Only shape-stable
facts asserted: property/pset names, deterministic entity ids on the
`#1/#10` fixtures, error messages. `ifc-extractor.js` (three + live
model I/O) and `routing-controller.js` (DOM + scene) stay TS-side per
ARCHITECTURE section 2 and are covered at most by `jsOnly` shape cases.

## Out of scope

- Full STEP golden files (GUIDs vary; shape asserted only).
- `routing-controller.js` DOM/overlay behaviour (TS UI wiring).
- Excel Tag Register / Summary sheet rendering (excel-io, task 7.3).
- Safe-editor UI panels; assignment saved/pending/undo state machines
  in `src/main.js` (task 7.1/7.4 port them, reusing these vectors).

## Parity reference

`legacy/packages/routing-core/test/*.test.js` (19 tests covering
tag-scheme, tag-validator, routing-core, ifc-tag-exporter,
ifc-extractor) plus `docs/specs/tray/tagging.md` and
`docs/specs/tray/routing.md`. Legacy `SystemTag-C001` component-ID
shape remains readable via scheme v2 (`ComponentId == ElementTag`).

## Open questions

1. GUID determinism: Rust `ifc-io` will take an injected guid function —
**APPROVED by owner 2026-10-22.**
2. `vec` helpers are duplicated here and in conduit `snap.json` until
`geom-core` (3.1) deduplicates them. **APPROVED by owner 2026-10-22**
(cleanup in 3.1).
3. Extractor contract: TS adapter passes plain vertex arrays across
Wasm; coordinate frame (IFC Z-up, f64) declared in 3.1/5.2 specs.
**APPROVED by owner 2026-10-22.**
