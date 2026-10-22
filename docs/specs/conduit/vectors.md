# Conduit / vectors (task 2.1)

Status: implemented (vectors) — Rust crates land in Phase 3/4
Branch: `spec/vectors-conduit`
Owner folders: `spec/vectors/conduit/`, `docs/specs/conduit/`, `scripts/run-conduit-vectors.mjs`

## Goal

Pin every pure, deterministic behaviour of the legacy conduit JS engine as
golden JSON vectors. The same vectors run against legacy JS today (proving
they describe real behaviour) and against the Rust crates in Phase 3/4
(proving parity). A feature is done when the vectors pass in Rust
(ARCHITECTURE section 6).

## Files

| File | Cases | Legacy source |
|---|---|---|
| `spec/vectors/conduit/snap.json` | 22 | `snap-engine.js`, `snap.js`: vec3, closestPointOnSegment, snapToNodes/Segments, snapPolarAngle, snapOrtho3D, raycastElevationPlane, SnapEngine.resolve |
| `spec/vectors/conduit/fitting.json` | 11 | `fitting-solver.js`: NEC bend table, bend angle, elbow fillet, run-bend analysis (NEC 360°), auto-riser |
| `spec/vectors/conduit/takeoff.json` | 20 | `network.js`, `takeoff.js`, `geometry.js`, `snap.js`: network CRUD, per-run sticks, diameter/system grouping, ortho, reload round-trip |
| `spec/vectors/conduit/bom.json` | 6 | `bom-calculator.js`: FFD stick optimizer, detailed hardware BOM, NEC/pull-box rules |
| `spec/vectors/conduit/units.json` | 18 | `coordinate-utils.js`, `config.js`, `diameter-registry.js`: UNIT_TABLE, unit resolve/convert, trade-size parse, default diameters, stick length |
| `spec/vectors/conduit/io.json` | 12 | `command-stack.js`, `marker-model.js`, `project-io.js`, `csv-export.js`, `ifc-exporter.js`: shape-pinned TS-side behaviour (jsOnly) |

89 cases total, all passing against legacy JS via
`node scripts/run-conduit-vectors.mjs`.

## Rules

R1: All quantities are metres internally; imperial values (10 ft sticks,
NEC inches, trade-size strings) are normalized at the TS/wasm edge.
R2: Takeoff (`takeoff.json`) is minimal: per-run `{length, sticks, points}`,
bySize `{runs, length, sticks}`, totals `{runs, length, sticks}`. No
elbow/riser/coupling fields — conduit is bent on site (see `takeoff.js`
header). Hardware counts live in `bom.json`.
R3: `sticks = ceil(length / stickLength)` per run, summed — never
`ceil(total / stick)` (`per-run-sticks-sum`).
R4: NEC bend radius table (Chapter 9, Table 2) is exact data:
½"→0.1016, ¾"→0.1143, 1"→0.146, 1¼"→0.1841, 1½"→0.2095, 2"→0.2413,
2½"→0.2667, 3"→0.3302, 3½"→0.381, 4"→0.4064 (metres).
R5: Unknown trade sizes fall back to 0.1143 (legacy behaviour, pinned).
R6: NEC 360° rule: cumulative bends > 360° (or run > 30.48 m) ⇒ pull box.
R7: FFD bin packing uses kerf 0.003 m; waste reported per stick to 3 decimals.
R8: `sizeToMillimetres` does NOT parse unicode fractions (½/¾ → NaN);
the TS edge normalizes labels first.
R9: Rust-pure boundary (owner-approved): CommandStack (closures),
MarkerStore (Date.now/random ids), SHA-256 (WebCrypto), CSV/IFC text
rendering, STEP GUIDs stay TypeScript-side. `io.json` pins their shape
only and is `jsOnly` — never ported to Rust.

## Out of scope

- CSV/IFC full-text golden files (timestamps/GUIDs vary; shape asserted only).
- `formatLength`/`formatFileSize` (presentation, TS-only).
- UI state: command-stack listeners, marker ids, registry subscribe.

## Parity reference

`legacy/packages/conduit-core/test/*.test.js` (55 tests) and
`docs/specs/conduit/takeoff-overlay.md`. The Python overlay spec's
elbow/riser/coupling takeoff rules are SUPERSEDED for the JS engine by R2
above; the overlay Pset fields (`Elbow45`, `Elbow90`, `RiserLength`,
`Couplings`, `StickLength`) remain the `ifc-io` (3.2) contract for reading
old overlay files, not the takeoff computation.

## Open questions

1. GUID determinism: Rust `ifc-io` will take an injected guid function —
**APPROVED by owner 2026-10-22.**
2. `spec/vectors/geom/` does not exist yet; `vec3`/`closestPointOnSegment`/
unit vectors are duplicated here and in tray 2.2 until `geom-core` (3.1)
deduplicates them. **APPROVED by owner 2026-10-22** (cleanup in 3.1).
