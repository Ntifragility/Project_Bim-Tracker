# TASKS: claim board

How to use (see `AGENTS.md`, "Parallel work"): claim ONE task by writing your agent name in **Owner** and setting **Status** to `in progress`; commit that one-line change to `main` before starting. Never start a task someone else owns. Statuses: `todo`, `in progress`, `review`, `done`, `blocked` (explain in `NOTES.md`).
Phases and dependencies come from `ARCHITECTURE.md` section 7. Only one agent at a time on `infra/*` tasks.

## Phase 0: Stabilize (single agent, in order)
| ID | Task | Branch | Depends on | Owner | Status |
|---|---|---|---|---|---|
| 0.1 | Fix duplicate `highlighter`/`hider` declarations in `src/main.js`; `npm run build` must pass | `fix/main-build` | none | opencode | in progress |
| 0.2 | CI baseline: `npm test`, `npm run build`, `npm run build:conduit` on every PR | `infra/ci-baseline` | 0.1 | | todo |
| 0.3 | Merge `feature/revit-snap-engine` into `main` | `infra/merge-snap` | 0.2 | | todo |
| 0.4 | Merge `feature/revit-fitting-solver` into `main` | `infra/merge-fitting` | 0.3 | | todo |
| 0.5 | Merge `feature/revit-mep-hud` into `main` | `infra/merge-hud` | 0.4 | | todo |
| 0.6 | Merge `feature/revit-bom-export` into `main` | `infra/merge-bom` | 0.5 | | todo |
| 0.7 | Merge `feature/revit-viewport-controls` into `main`; inspect what it changes in `engine.js` | `infra/merge-viewport` | 0.6 | | todo |
| 0.8 | Tag `legacy-js-v0`; move `ThatOpenEngine/` out of the repo | `infra/legacy-baseline` | 0.7 | | todo |
| 0.9 | Repo hygiene: untrack `__pycache__`, `.nwc`, `.log.html`; move root notes to `docs/`; samples to `samples/`. Do NOT delete items listed in `docs/review-12345.md` | `infra/hygiene` | 0.8 | | todo |
| 0.10 | Move (never delete) the five existing docs and the root notes into `docs/`, originals unchanged (routing and tagging also copied to `docs/specs/tray/` as baselines); add `ARCHITECTURE.md`, `AGENTS.md`, `docs/TASKS.md`, the review file | `infra/docs-move` | 0.9 | | todo |

## Phase 1: Scaffold (single agent; shared root files)
| ID | Task | Branch | Depends on | Owner | Status |
|---|---|---|---|---|---|
| 1.1 | Cargo + npm workspaces with glob members; `legacy/` folder; empty crates, bindings, packages, apps | `infra/workspaces` | 0.9 | | todo |
| 1.2 | Rust CI (fmt, clippy, test, wasm build) + boundary check | `infra/ci-rust` | 1.1 | | todo |

## Phase 2: Golden vectors (parallel: conduit and tray)
| ID | Task | Branch | Depends on | Owner | Status |
|---|---|---|---|---|---|
| 2.1 | Conduit vectors from existing and branch tests (snap, fitting, BOM, takeoff) | `spec/vectors-conduit` | 1.1 | | todo |
| 2.2 | Tray vectors from the 67 existing tests (tagging, validator, routing) | `spec/vectors-tray` | 1.1 | | todo |

## Phase 3: Base crates (parallel)
| ID | Task | Branch | Depends on | Owner | Status |
|---|---|---|---|---|---|
| 3.1 | `geom-core` (vector, transform, units in metres, coordinate frames) | `rust/geom-core` | 2.1, 2.2 | | todo |
| 3.2 | `ifc-io` (safe edits, tag extraction, export naming); first confirm tray/conduit overlap in its spec | `rust/ifc-io` | 3.1 | | todo |

## Phase 4: Conduit
| ID | Task | Branch | Depends on | Owner | Status |
|---|---|---|---|---|---|
| 4.1 | `conduit-core` network, command stack, registries | `rust/conduit-network` | 3.1 | | todo |
| 4.2 | Snap engine | `rust/conduit-snap` | 4.1 | | todo |
| 4.3 | Fitting solver (NEC bends) | `rust/conduit-fitting` | 4.1 | | todo |
| 4.4 | BOM and stick optimizer | `rust/conduit-bom` | 4.1 | | todo |
| 4.5 | Takeoff, CSV export, project I/O | `rust/conduit-takeoff-io` | 4.2, 4.3, 4.4 | | todo |
| 4.6 | `conduit-wasm` binding; switch `apps/conduit-takeoff` behind a flag | `rust/conduit-wasm` | 4.5 | | todo |

## Phase 5: Tray
| ID | Task | Branch | Depends on | Owner | Status |
|---|---|---|---|---|---|
| 5.1 | `tray-tagging` (scheme, classifier, validator, assignment state: saved/pending/undo, register rows) | `rust/tray-tagging` | 3.1, 3.2 | | todo |
| 5.2 | `tray-routing` (centerline, graph, pathfinding, continuity) | `rust/tray-routing` | 3.1 | | todo |
| 5.3 | `tray-wasm` binding; switch `apps/tray-viewer` behind a flag | `rust/tray-wasm` | 5.1, 5.2 | | todo |

## Phase 6: Viewer (independent of 4 and 5)
| ID | Task | Branch | Depends on | Owner | Status |
|---|---|---|---|---|---|
| 6.1 | `viewer-core`: extract engine, coordinates and Vite asset plugin with unchanged behaviour; remove `@covillaf` alias | `viewer/extract-engine` | 1.1 | | todo |
| 6.1b | Move Rust `viewport-core` (from 0.7) to `crates/viewport-core`; stop committing `pkg/`; per-instance state; split generic gestures from conduit tool decisions; add auto-orbit (with toggle) and surface-pick normal to the viewer-core interface | `viewer/viewport` | 6.1 | | todo |
| 6.2 | Compatibility smoke tests on a public sample IFC (use the `?ifc=` deep link) | `viewer/smoke-tests` | 6.1 | | todo |
| 6.3+ | Improvement specs (section planes, ghost isolate, undo, PNG export, ...), one branch each | `viewer/<topic>` | 6.2 | | todo |

## Phase 7: Apps
| ID | Task | Branch | Depends on | Owner | Status |
|---|---|---|---|---|---|
| 7.1 | Split `src/main.js` into feature modules (tray app) | `app/split-main-js` | 1.1 | | todo |
| 7.2 | Split conduit app UI modules | `app/conduit-ui-split` | 1.1 | | todo |
| 7.3 | `packages/excel-io` optional package (workbook upload, mapping export). The live Excel bridge stays frozen | `app/excel-io` | 7.1 | | todo |
| 7.4 | Safe IFC Editor and manual metadata (port last) | `app/safe-ifc-editor` | 3.2, 7.1 | | todo |
| 7.5 | Optional UI items kept for owner's decision: wireframe (viewer-core), dark-mode toggle (app UI), Basic House sample (`samples/`) | `app/optional-ui` | 6.1, 7.1 | | todo |

## Phase 8: Parity gate
| ID | Task | Branch | Depends on | Owner | Status |
|---|---|---|---|---|---|
| 8.1 | Run parity checklist (`ARCHITECTURE.md` section 7); delete `legacy/` | `infra/remove-legacy` | 4.6, 5.3, 6.2, 7.1, 7.2 | | todo |
