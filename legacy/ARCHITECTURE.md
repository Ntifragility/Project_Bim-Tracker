# ARCHITECTURE: BIM Tracker rewrite (Rust cores + TypeScript viewer)

Status: **draft v0.1**, 2026-10-19. Derived from `BIM-Tracker_Architecture_Review.md` and the owner's decisions below.
Anything marked **[ASSUMPTION]** was decided by the reviewer and can be changed by the owner. Anything marked **[UNVERIFIED]** was not read in the review and must be checked inside the relevant spec.

---

## 1. Goals and decisions

Product goals (unchanged): an IFC viewer with (1) **QTO / tagging of cable trays** and (2) **QTO / tagging / drawing of conduit pipes**.

| # | Owner decision | Consequence |
|---|---|---|
| D1 | Rewrite the whole code; it must be modular | Full rewrite, executed incrementally behind frozen legacy code (section 7) |
| D2 | Rust everywhere possible | All logic cores in Rust, compiled to WebAssembly. See D2 limits below |
| D3 | Rewrite only what is already done | No new features in the rewrite, except the engine-improvement track (D5) |
| D4 | An `.xlsx` file is always present, but Excel is not core | Excel I/O is an optional package, installable later; cores never depend on it |
| D5 | Wants an improved engine based on That Open | `viewer-core` = additive layer over **unmodified** That Open libraries (section 5) |
| D6 | Everything public | Public-repo hygiene rules (section 9) |
| D7 | Local branches: reviewer decides | Push as backup, then fold into the legacy baseline (section 7, phase 0) |

**Limits of "Rust everywhere" [ASSUMPTION]:** the browser UI, the 3D viewer (That Open + Three.js) and the Vite apps stay **TypeScript**. They are JavaScript libraries and cannot be replaced by Rust without rewriting That Open itself. `web-ifc` (C++/Wasm) stays the IFC loader/geometry engine. Rust owns every rule, calculation, graph and data transform; TypeScript owns drawing, input and glue.

---

## 1b. Scope of the rewrite (owner decisions, 2026-10-19; source: `docs/review-12345.md`)

**In scope (already built):** IFC loading and inspection; batch tagging; tagged IFC export; mapping export; tray-system management; continuity diagnostics; route calculation; Safe IFC Editor (default in scope, **ported last**); `?ifc=` deep link (used for smoke tests); conduit snap, fittings, HUD/properties, BOM, takeoff, CSV/IFC overlay export; viewport controls; **auto-orbit** (kept; moves to `viewer-core`, app keeps only its toggle/badge; the review notes it cannot be restarted from the UI, so the spec adds a toggle); Excel workbook upload and mapping export through `excel-io` (later). **Kept for your decision (ported last, optional):** wireframe mode (to `viewer-core`), dark-mode toggle (app UI), Basic House sample (to `samples/`); you decide later whether to keep each.

**Not ported** (stay in `legacy/` until the parity gate, then deleted): `sendMeasurementToExcel()`, the generic `addProjectTagsToIfc` / `extractProjectTagsFromIfc` workflow, unreferenced assets (`hero.png`, `vite.svg`, `javascript.svg`), unused `public/web-ifc*.wasm`, the **live Excel bridge** (`excel-ifc-bridge/`, `src/viewer-socket.js`: **frozen**, implemented later), and `ThatOpenEngine/` (moved out).

"Not ported" does not mean "delete now": nothing in the review list is removed before its decision is recorded.

---

## 2. Module map

Three product modules plus shared bases. Dependency direction is **downward only**.

```
 apps/tray-viewer        apps/conduit-takeoff            (TS, UI only)
        |                        |
        +------ packages/viewer-core (TS) ------+        shared by both apps
        |                        |
 bindings/tray-wasm      bindings/conduit-wasm            (Rust, thin wasm-bindgen layer)
        |                        |
 crates/tray-tagging     crates/conduit-core              (Rust, product cores)
 crates/tray-routing
        |                        |
        +------- crates/ifc-io --+                        (Rust base, IFC text read/write helpers)
        +------- crates/geom-core                         (Rust base, vectors, transforms, units)

 packages/excel-io  (TS, optional plugin; used only by apps; no core depends on it)
```

### Dependency rules (enforced, see section 8)
1. `geom-core` depends on nothing in this repo.
2. `ifc-io` may depend on `geom-core` only. **[ASSUMPTION]** a shared IFC base crate is justified because both tray (`src/ifc/*`) and conduit (`ifc-exporter.js`) write IFC; **[UNVERIFIED]** whether their logic really overlaps. If not, split it per module in the spec.
3. Product cores (`tray-tagging`, `tray-routing`, `conduit-core`) depend only on `geom-core` / `ifc-io`. They must not depend on each other, on the DOM, Three.js or any viewer code.
4. **Tray and conduit never import each other.**
5. `bindings/*` depend only on their own cores and expose plain data types.
6. `viewer-core` depends on That Open / Three.js and on its own internal crate `viewport-core` only. It must not depend on product cores or apps.
7. Apps may depend on `viewer-core`, bindings and `excel-io`; apps never contain business rules.
8. `excel-io` depends on nothing in this repo and is never imported by a core or binding.

### Repository layout
```
Cargo.toml                workspace for crates/ and bindings/
package.json              npm workspaces: packages/*, apps/*
crates/
  geom-core/  ifc-io/  conduit-core/  tray-tagging/  tray-routing/  viewport-core/
bindings/
  conduit-wasm/  tray-wasm/
packages/
  viewer-core/  excel-io/
apps/
  tray-viewer/  conduit-takeoff/
spec/
  vectors/<module>/*.json      golden test vectors (shared by Rust and legacy JS)
docs/specs/<module>/*.md       feature specs (section 6)
legacy/                        frozen copy of the current JS (reference only, deleted after parity)
samples/                       small public test IFC/xlsx only
ARCHITECTURE.md  AGENTS.md  README.md
.github/workflows/ci.yml
```

### What belongs in each module (from the current code, by file name)
Internal sub-module splits follow the existing file names; contents of most files were **[UNVERIFIED]**.

| Module | Rust crate sub-modules | Source in legacy |
|---|---|---|
| `geom-core` | vector, transform, units, coordinate frames (scene <-> IFC, Z-up, f64) | `routing-core/vector.js`, `conduit-core/geometry.js`, `coordinate-utils.js`, `src/covillaf/coordinates.js` (math part) |
| `ifc-io` | safe property/tag/colour edits, tag extraction, export naming | `src/ifc/ifc-safe-editor.js`, `ifc-tag-exporter.js`, `conduit-core/ifc-exporter.js` |
| `tray-tagging` | scheme/allocation, classifier, validator | `src/tagging/*`, `src/ifc/tag-validator.js` |
| `tray-routing` | centerline, graph, pathfinding, diagnostics, continuity check | `packages/routing-core/src/*`, `src/routing/*` (non-UI part) |
| `conduit-core` | network, command-stack, diameter-registry, marker-model, snap, fitting (NEC bends), bom (stick optimizer), takeoff, csv-export, project-io | `packages/conduit-core/src/*` + four unmerged feature branches |
| `viewport-core` | pointer/gesture policy (orbit, pan, pivot orbit, click vs drag); used only by `viewer-core` | **already Rust**: `packages/viewport-core` on branch `feature/revit-viewport-controls` (controller.rs + C API) |
| routing extractor (stays TypeScript) | reads the loaded model, builds plain vertex arrays; imports Three.js, so it cannot be a core | `src/routing/ifc-extractor.js` |

---

## 3. Boundary contract between Rust and TypeScript

- Rust crates are **pure**: no I/O, no globals, no time, no randomness. Same input gives same output (needed for golden tests).
- Bindings expose a small set of functions taking and returning plain data (serde-JSON objects for small payloads; `Float64Array`/`Uint32Array` for bulk geometry such as graph nodes or segments).
- Numbers are `f64`. Positions are in **original IFC coordinates (metres, Z-up)**; conversion to the Three.js scene (Y-up, origin-shifted) happens only in `viewer-core`'s coordinate frame. **Decided by the owner:** metres internally; imperial units (feet, inches, 10 ft sticks = 3.048 m, NEC tables) are constants converted at the edges and declared in each spec.
- Errors are returned as typed results (`Result<T, E>` -> a JS object with `code` and `message`), never thrown as panics. Panics are bugs.
- Each binding crate has one public JS entry point and a generated `.d.ts`. Apps import only that entry point.
- Measure before optimizing: no unsafe, SIMD or threads without a profile showing the need.

---

## 4. Apps

`apps/tray-viewer` and `apps/conduit-takeoff` become **thin TypeScript UIs**: panels, input handling, rendering overlays with Three.js. The current `src/main.js` (4,645 lines, one 4,350-line `initApp()`) is split into feature modules inside the app: loader, property panel, tagging panel, system manager, Excel linking panel, safe-editor panel, routing panel. Every rule it contains moves to a Rust core; what remains is UI wiring. **Rewriting the UI itself in Rust is out of scope.**

The existing 67 tests plus the four conduit branches' tests (snap, fitting, BOM) define the behaviour to preserve.

---

## 5. Engine: `packages/viewer-core` (improved engine based on That Open)

Decision **[ASSUMPTION]**: build the "improved engine" as a **layer on top of the unmodified That Open libraries**, not as a fork.

- Pin exact versions of `@thatopen/components`, `components-front`, `fragments`, `web-ifc`, `three`. Upgrades are their own branch with the compatibility tests below.
- No patches to library code. If a library change is unavoidable, use a documented patch file (`patch-package`) and open an upstream issue/PR. Licenses: That Open and Three.js are MIT; `web-ifc` is MPL-2.0 (relevant only if its own files are modified). Not legal advice.
- One factory, `createEngine(container, options)`, returning a **stable interface** that hides That Open types from the apps: `loadIfc`, `selection` (get/set/events), `highlight/paint`, `hide/isolate/ghost`, `pick(ndc, {snap})`, `camera` (focus, views), `coordinates` (`toScene` / `toOriginal`), `overlay` (add/remove Three.js groups), `dispose`.
- Phase A (parity): move the current `src/covillaf/engine.js` + `coordinates.js` + the duplicated Vite asset plugin here with unchanged behaviour. Both apps use it; the `@covillaf` alias disappears.
- Phase A also takes the generic navigation work from `feature/revit-viewport-controls`: orbit/pan gestures (`viewport-core`), the surface-pick **normal** added to `pick()`, and the auto-orbit currently living in the tray app's `src/main.js`. Conduit-specific decisions (place point, sample elevation, keep the rubber-band while orbiting) stay in conduit.
- Phase B (improvements, separate specs, **the only new-feature track**), from the owner's own `docs/covillaf-next.md`:
  - section planes / section box honoured by picking (stock `Clipper` to be evaluated first)
  - assembly selection that stops at the spatial container; select-similar by IFC class
  - ghost isolate (chosen system solid, rest faint)
  - frame cap, lower resolution while the camera moves, WebGL context-loss notice
  - undo for colour and visibility
  - PNG export of the current view at a chosen size
  - IFC-coordinate (Z-up, double precision) positions/lengths in the public API
- Before writing any custom feature, check whether the installed stock classes already cover it: `Clipper`, `Hider`, `Classifier`, `LengthMeasurement` / `AreaMeasurement` / `VolumeMeasurement`, `SnapResolvers`, `VertexPicker`. Fit **[UNVERIFIED]**.
- Compatibility tests: smoke tests that load a small public IFC and check selection, hide and paint through the `viewer-core` interface, so a That Open upgrade that breaks behaviour is caught by CI.

Naming note: the folder currently called `ThatOpenEngine/` is **COVILLAF SIMULATE** (structural analysis), not the That Open Engine. The improved engine is `viewer-core`.

### SIMULATE decision [ASSUMPTION]
Move `ThatOpenEngine/` to its own repository (or `archive/` branch) in phase 0 and remove it from this repo. It already declares that it consumes the COVILLAF 3D viewer "by alias, never duplicated", so it becomes a future third consumer of `viewer-core`.

### Excel decision (D4)
`packages/excel-io` wraps SheetJS/xlsx behind a tiny interface (read sheet -> rows, write tag register). It is installed and imported by apps only; cores receive plain arrays. The live Python `excel-ifc-bridge` and its client `src/viewer-socket.js` are **frozen** (owner decision): not ported, not deleted, implemented later. Re-evaluate the `xlsx@0.18.5` dependency (known advisories) when `excel-io` is built.

---

## 6. Spec-driven workflow

Order: **architecture (this file) -> module spec -> feature spec -> tests -> code.**

Feature spec template (`docs/specs/<module>/<feature>.md`):

```
# <module> / <feature>
Status: draft | approved | implemented
Branch: rust/<crate>-<feature>        Owner folders: <list>
## Goal (1-3 sentences)
## Public interface (function names, input/output types)
## Rules (numbered, testable: e.g. "R3: bends over 360 degrees between pull points are rejected")
## Acceptance criteria (table of concrete input -> expected output; become spec/vectors/*.json)
## Out of scope
## Parity reference (legacy file + legacy test names this replaces)
## Open questions / [UNVERIFIED] items
```

Rules:
- One spec = one branch = one agent. A spec lists the only folders its branch may edit.
- **Golden vectors:** the acceptance table is stored as JSON in `spec/vectors/<module>/`. The same vectors run against the legacy JS (proving they describe real behaviour) and the Rust crate (proving parity). A feature is done when the vectors pass in Rust.
- Specs are updated in the same branch as the code that changes the behaviour.

---

## 7. Migration plan (rewrite without a big bang)

The legacy JS is **frozen, not deleted**, until the parity gate passes. Each work package below is sized for one agent and one branch.

| Phase | Work packages (branch prefix) | Depends on | Parallel? |
|---|---|---|---|
| **0 Stabilize** | `fix/main-build` (remove duplicate `highlighter`/`hider` in `src/main.js`); `infra/ci-baseline` (npm test + both builds); push local branches `feature/revit-viewport-controls`, `integration/revit-conduit` as backup; merge snap, fitting, HUD, BOM branches into `main` one by one (only overlap: one line in `conduit-core/src/index.js`); tag `legacy-js-v0`; move `ThatOpenEngine/` out; remove tracked `__pycache__`, `.nwc`, `.log.html`, root `.md` notes to `docs/` or `samples/` | none | `fix/` first, then the rest |
| **1 Scaffold** | `infra/workspaces` (Cargo + npm workspaces, `legacy/` folder, empty crates, empty bindings); `infra/ci-rust` (fmt, clippy, test, wasm build, boundary check); `docs/agents` (AGENTS.md, spec template) | 0 | yes |
| **2 Vectors** | `spec/vectors-conduit`, `spec/vectors-tray`: derive golden vectors from the 67+ existing tests and the branch tests | 0 | yes (2 agents) |
| **3 Base crates** | `rust/geom-core`; `rust/ifc-io` | 1, 2 | yes |
| **4 Conduit** | `rust/conduit-network` -> `rust/conduit-snap`, `rust/conduit-fitting`, `rust/conduit-bom` (parallel after network), then `rust/conduit-takeoff-io`; `bindings/conduit-wasm`; switch `apps/conduit-takeoff` to the wasm binding behind a flag | 3 | snap/fitting/bom in parallel |
| **5 Tray** | `rust/tray-tagging`, `rust/tray-routing`; `bindings/tray-wasm`; switch `apps/tray-viewer` behind a flag | 3 | tagging and routing in parallel |
| **6 Viewer** | `viewer/extract-engine` (parity), then Phase B improvement specs, each its own branch | 1 | independent of 4-5 |
| **7 Apps** | `app/split-main-js` (feature modules), `app/conduit-ui-split`, `packages/excel-io` | 1 (+4/5 as they land) | per app |
| **8 Parity gate** | checklist below passes -> delete `legacy/` | 4,5,6,7 | no |

**Parity gate:** all golden vectors pass in Rust; both apps build and pass the smoke test on a public sample IFC; tag export/import round-trips match legacy output on the sample; conduit takeoff CSV/IFC output equals legacy on a recorded project file; no `legacy/` imports remain.

Parallel agents run in **separate git worktrees** (`git worktree add ../wt-<name> -b <branch>`). Two agents never edit the same file at once; shared-file changes (e.g. workspace config) are their own small branch merged first.

---

## 8. Enforcement (rules without tools are only suggestions)

| Rule | Tool |
|---|---|
| Crate dependency directions | Cargo.toml dependencies (the compiler is the boundary) + `cargo deny` / a CI script that fails on forbidden edges |
| TS package/app boundaries | `dependency-cruiser` or `eslint-plugin-boundaries` config mirroring section 2 |
| Core purity (no I/O, no DOM) | crates do not depend on `web-sys`/`js-sys`; only `bindings/*` do |
| Formatting / lint | `cargo fmt --check`, `cargo clippy -D warnings`, ESLint + Prettier |
| Behaviour parity | `cargo test` runs `spec/vectors`; legacy JS runs the same vectors until deletion |
| Build health | CI on every pull request: Rust tests, `wasm-pack build`, `npm test`, both app builds. Merging is blocked when red |

Every phase-0 failure seen in the review (the broken `main` build) is caught by this CI.

---

## 9. Public-repository hygiene (D6)

- No real project files: remove `P22115-CC-2140-07-05*` `.nwc`/`.log.html`/shared-parameter files from the tree; only small, synthetic or explicitly permitted samples in `samples/`. Rewriting git history is a separate, deliberate decision (files already pushed remain in history).
- No personal email addresses, machine inventories or client names in docs, logbooks or commit metadata. Use a project identity for commits.
- Keep `.gitignore` for `*.ifc` (models may contain sensitive data).
- Record dependency licenses in `docs/licenses.md` (`web-ifc` MPL-2.0 noted).

---

## 10. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Full rewrite stalls or regresses behaviour | Legacy frozen and runnable; golden vectors; parity gate; flags to switch per module |
| "Rust everywhere" hits browser limits | Cores in Rust/Wasm, viewer and UI in TypeScript (section 1) |
| Rust IFC handling is immature | Keep `web-ifc` for loading/geometry; Rust only for tag/property data logic. Re-check `legacy` approach in the `ifc-io` spec **[UNVERIFIED]** |
| Wasm size or call overhead | Bulk data as typed arrays; measure before optimizing |
| Agents collide | Worktrees, one spec per branch, folder ownership in AGENTS.md |
| Spec drift | Spec updated in the same branch as behaviour changes; vectors in CI |
| Time cost of a full rewrite | Order by dependency and risk; conduit first because its logic is already pure and tested |

## 11. Open questions for the owner
1. ~~Unit policy~~ Resolved by the owner (2026-10-19): metres internally; imperial values are constants converted at the edges.
2. History rewrite for already-pushed sample files: yes/no?
3. ~~Python `excel-ifc-bridge`~~ Resolved by the owner: frozen, implemented later.
4. Parity reference data: can a recorded conduit project file and a small public IFC be provided for the smoke tests?

---

## 12. Existing docs and what they add (move all five into `docs/`)

**Keep every old `.md` file; delete none.** Move them into `docs/` with their original names and content unchanged (history and evidence). The living versions are the files under `docs/specs/`; once a spec is approved, add one line at the top of its original: "Superseded by docs/specs/<module>/<file>.md". The other root notes (`EXcel_IFC_Bridge.md`, `FLOATING_TAGS_IMPLEMENTATION_PLAN.md`, `ideas_pending.md`, `conduit-overlay-spec.md`) are also moved into `docs/`, not deleted.

- **`routing-architecture.md`** -> baseline for `docs/specs/tray/routing.md`. The extractor imports Three.js, so it stays a TypeScript adapter that passes plain vertex arrays to `tray-routing`. Its data contract uses JS `Map`s: use arrays/typed arrays across Wasm. The spec must declare the coordinate frame (legacy likely works in scene space, Y-up; this architecture uses IFC Z-up) and units (default tolerance 100 mm = 0.1 m). Keep the principal-axis confidence rule and "report, don't silently connect".
- **`tagging-architecture.md`** -> baseline for `docs/specs/tray/tagging.md`. The saved/pending/undo assignment state currently lives in `src/main.js` (e.g. `lastBatchSnapshot`); it becomes a state module in `tray-tagging`. Keep legacy `SystemTag-C001` parsing and scheme v2 (`ElementTag` = `ComponentId`) as vectors. Rust produces the Tag Register and Summary rows; `excel-io` only writes the file.
- **`revizto-validation.md`** -> evidence for routing vectors (122 leaf segments out of 134 parts; tolerance table 100/500/1000 mm; route #3192 to #3702 = 13.71 m at 1000 mm). The real IFC stays out of git, so public CI uses a small synthetic IFC with the same structure; the real numbers are a local regression check.
- **`covillaf-next.md`** -> the viewer Phase B backlog (section 5).
- **`review-12345.md`** -> source of section 1b. Its line about a "remote WebIFC configuration" is outdated: wasm is served locally through `/covillaf/web-ifc/`.
- **`viewport-core` (existing Rust crate)**: branch `feature/revit-viewport-controls` already contains `packages/viewport-core` (controller.rs ~419 lines, C API, test script). Move it to `crates/viewport-core`; do not commit build output (`pkg/*.wasm` is committed today); the C API keeps global `thread_local` state, so prefer per-instance handles **[UNVERIFIED]**; split generic gestures (viewer) from conduit tool decisions (conduit).
