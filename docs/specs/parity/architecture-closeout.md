# Architecture close-out: `ARCHITECTURE.md` deltas to fold in (owner merges)

Status: approved deltas (owner D-rulings 2026-10-25 applied 2026-10-26 on spec/parity-final). This branch (`spec/parity-final`, from `spec/arch-parity-closeout`) may not edit `ARCHITECTURE.md` itself (high-risk per `AGENTS.md`). Each item below is an
exact delta for the owner (or an `infra/*` branch) to apply. All statements were
verified against `origin/main` (`23079d3`) in this worktree.

Skipped deliberately (active lanes own them): `docs/specs/conduit/conduit-wasm.md`
(lane `rust/conduit-wasm` live in `wt-conduit-wasm`), `tagging.md` / `routing.md`
promotion (lane `spec/tray-tagging-spec` rewriting both in `wt-tray-specs`),
`docs/TASKS.md` 7.1–7.3 re-open (lane `spec/parallel-docs-v03` already re-opened
in `wt-parallel-docs`).

## A. Section 2 module map — add `viewport-core` side branch

Current diagram omits the built crate. Proposed diagram:

```
 apps/tray-viewer        apps/conduit-takeoff            (TS, UI only)
        |                        |
        +------ packages/viewer-core (TS) ------+        shared by both apps
        |              |                         |
        |     crates/viewport-core (Rust)        |        gesture policy; viewer-core only
        |              |                         |
 bindings/tray-wasm  bindings/conduit-wasm            (Rust, thin wasm-bindgen layer)
        |                        |
 crates/tray-tagging     crates/conduit-core              (Rust, product cores)
 crates/tray-routing
        |                        |
        +------- crates/ifc-io --+                        (Rust base, IFC text read/write helpers)
        +------- crates/geom-core                         (Rust base, vectors, transforms, units)

 packages/excel-io  (TS, optional plugin; used only by apps; no core depends on it)
```

Dependency rules: rule 6 already covers viewer-core → viewport-core. Add to the
rule list (matches `scripts/check-boundaries.py` `ALLOWED_PATH_DEPS` on main):

- `viewport-core` depends on nothing in this repo.
- `tray-wasm` depends on `tray-tagging` + `tray-routing` only.
- `tray-routing` depends on `geom-core` only (no `ifc-io` edge today).

Repository layout (section 2): already lists `viewport-core/` under `crates/` —
no change needed.

## B. Section 2 module table — stale rows to correct

| Row | Current text | Correction |
|---|---|---|
| `conduit-core` | lists `csv-export, project-io` as crate sub-modules | Wrong after 4.5: CSV text rendering, project JSON serialize, SHA-256, marker/command-stack closures+ids, overlay STEP write stay TS-side (`docs/specs/conduit/takeoff-io.md` R7, `io.json` jsOnly). Crate owns network, history model, registry seed, snap (+`find_snap`), fitting, BOM, takeoff. |
| `viewport-core` | "`packages/viewport-core` on branch `feature/revit-viewport-controls` … Move it to `crates/viewport-core`; do not commit `pkg/*.wasm`; `thread_local` … prefer per-instance handles **[UNVERIFIED]**" | All resolved on main: moved to `crates/viewport-core`, per-instance `viewport_create`/`viewport_destroy` + `viewport_instance_*` in `crates/viewport-core/src/c_api.rs`, auto-orbit + pick normal in `viewer-core` interface (see D). `[UNVERIFIED]` closes. |
| `ifc-io` | tray/conduit overlap `[UNVERIFIED]` (section 2 rule 2 + section 10) | Resolved by `docs/specs/ifc/base.md:16-24`: zero shared parsing code; one crate justified by shared STEP primitives + naming + typed-value table; product pset logic in product modules. Close both `[UNVERIFIED]` markers. |
| `tray-routing` | extractor row exists ("routing extractor (stays TypeScript)") | Keep, and add the Wasm data-contract sentence already in `docs/specs/tray/vectors.md` R9: graph crosses Wasm as arrays/typed arrays, never JS `Map`s. |

## C. Section 3 boundary contract — freeze what 4.5 decided

Append (verbatim from `docs/specs/conduit/takeoff-io.md:37-68`, already
owner-approved):

- Rust: `find_snap(net, point, tolerance_m)` — nodes-first, short-circuit,
  dangling-ref skip (unreachable after `validate_network`).
- TS-side, pinned `jsOnly` in `spec/vectors/conduit/io.json`: `serializeProject`/
  `deserializeProject`, `computeSha256`/`verifySourceHash`, all CSV renderers,
  `exportOverlayIfc` (STEP text + `Date.now` + seeded GUIDs), marker-store
  ids/listeners, command-stack closures/listeners.
- Tray boundary (from `docs/specs/tray/vectors.md` R9): `createIfcGuid`
  (random), STEP text rendering, entity-id sequencing, colour/style entities stay
  TS-side; `ifc-io.json` pins shape only. `ifc-extractor.js` and
  `routing-controller.js` stay TS-side.
- Safe Editor Wasm contract target (`docs/specs/tray/safe-ifc-editor.md`):
  `applySafeEdits(sourceBytes, {propertyEdits, colorEdits})`; TS
  `src/ifc/ifc-safe-editor.js` remains the implementation until `ifc-io` Wasm
  reaches binary parity.

## D. Section 5 engine — freeze the built Phase A+B interface

Phase A done; Phase B partially done. Replace the Phase A paragraphs ("move …
here with unchanged behaviour") with the as-built interface on main:

- `packages/viewer-core/src/index.js`: `createEngine` (= `createCovillafEngine`),
  `createCoordinateFrame`, `appearanceStyleName`; `viewer-core/vite-plugin`:
  `covillafWebIfc` (= `viewerCoreWebIfc`).
- `engine.pick(ndc, {snap})` returns `{point, snapped, normal}` (world-space
  normal); `engine.autoOrbit.{start,stop,toggle,isActive,onChange}` (app keeps
  badge/toggle only, stops on canvas pointer); `engine.clipper.{createPlane,
  deletePlane,deleteAll,toggle,pickHonorsPlanes}`; `engine.isolation.
  {ghostIsolate,hardIsolate,resetIsolation,isGhostActive}` (ghost = 15% opacity,
  depthWrite off); `engine.exportPng.{capturePng,downloadPng}`.
- Specs (all `Status: done/implemented` on main): `extract-engine.md`,
  `viewport.md`, `smoke-tests.md`, `section-planes.md`, `ghost-isolate.md`,
  `view-export-png.md`. Smoke fixture: `public/fixtures/survey-box.ifc` + `?ifc=`.
- Still open in Phase B backlog (`docs/covillaf-next.md` items with no spec on
  main): undo for colour/visibility, frame cap, low-res-while-moving,
  WebGL-context-loss notice, assembly-select/select-similar, IFC-coord public
  API. List them explicitly so Phase B cannot be called complete by accident.

## E. Section 9 hygiene — non-history actions still pending on main

- Root `P22115-CC-2140-07-05_Cable_Tray*.sharedparameters.txt` files are still
  tracked (verified `git ls-tree origin/main`). `git rm` them (normal commit, no
  history rewrite). History rewrite itself stays owner decision (section 11 Q2).
- `legacy/packages/viewport-core/pkg/viewport_core.wasm` is still tracked;
  remove build output from git (`.gitignore` already covers `**/pkg/`).
- Duplicate docs: `docs/ARCHITECTURE-PARALLEL-AGENTS.md` vs `docs/CLaude_*`
  variants + `docs/claims/README.md` churn live in lane `spec/parallel-docs-v03`;
  do not touch here.

## F. Section 11 open questions — resolved by owner 2026-10-25
- Q2 (history rewrite): **no rewrite** (D5: `git rm` normal commit only).
- Q4 (parity reference data): `survey-box.ifc` covers the small public IFC; recorded conduit project file **waived** (D7b) — synthetic fixture governs gate check 9.
- Couplings formula: **BOM `max(0,sticks-1)`** governs (D1). Python overlay `ceil+elbows` superseded.
- NEC Table 2: **truncated at 4″ pinned** (D2); sizes above borrow the 4″ row, documented.
- 100 ft / 30.48 m pull limit: **kept as legacy heuristic, never labeled NEC** (D3).
- Routing frame: **IFC Z-up f64 confirmed**, conversion in TS adapter (D4).
- P22115 removal: **`git rm`, no rewrite** (D5).
- 7.1–7.3: **7.1 done, 7.2 re-opened todo, 7.3 verified done** (D6, PR #33 merged).
- 8.1 deps: **include 7.4** (D7a); 7.2 code landing + 7.4 port precede the gate.
- Resolved since v0.1 (close): unit policy (metres), excel bridge (frozen),
  tray/conduit `ifc-io` overlap (one crate, `ifc/base.md`), GUID determinism
  (injected fn), `vec` duplication (cleaned in 3.1), extractor contract (TS
  adapter, Z-up declared in 5.2 spec).

## G. `docs/TASKS.md` tightening (proposed, not applied — not my owned folder)

- 4.6 acceptance: `conduit-wasm` exports + `apps/conduit-takeoff` flag switch;
  vectors reused (network 23 + snap 24 + takeoff-io 6 + fitting 15 + bom 8).
- 5.3 acceptance: `tray-wasm` exports + `apps/tray-viewer` flag switch; vectors
  tagging 33 + validator 7 + routing 26 (`ifc-io.json` jsOnly, never ported).
- 8.1 deps: add 7.4 → `4.6, 5.3, 6.2, 7.1, 7.2, 7.4` (D7a decided; apply in the gate PR).
- 7.4 deps `3.2, 7.1` stand (7.1 merged PR #32, D6).
