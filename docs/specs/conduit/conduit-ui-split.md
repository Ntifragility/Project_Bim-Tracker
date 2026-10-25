# conduit / conduit-ui-split
Status: approved (owner D6 re-open, 2026-10-25; spec written 2026-10-25)
Branch: spec/conduit-ui-split        Owner folders: docs/specs/conduit/
Code landing: app/conduit-ui-split (follows this spec; owned folders: conduit-takeoff/src/ui/, conduit-takeoff/src/main.js)

## Goal
Deconstruct the monolithic `conduit-takeoff/src/main.js` (897 lines + 6 support files, 2,323 lines total) into modular UI feature components under `conduit-takeoff/src/ui/`, each responsible for a distinct interaction domain (model load, draw toolbar, runs list, summary, project I/O, top bar, chrome), while keeping `conduit-takeoff/src/main.js` as a concise app bootstrap orchestrator. Mirrors the 7.1 tray split (`docs/specs/tray/split-main-js.md`: 4,559 → 153 lines, 14 modules).

## Current tree (verified 2026-10-25 on origin/main@54597c7)
- `conduit-takeoff/src/main.js` — 897 lines: appState, els DOM table (~70 ids), downloadFile/loading helpers, diameter picker, runs list, summary, init() + 35 event listeners, project I/O + CSV/IFC export wiring.
- `drawing-tool.js` (979) — stays: the canvas drawing state machine (not UI chrome).
- `mep-hud.js` (160), `properties-panel.js` (149), `surface-picker.js` (35), `viewport-controls.js` (103) — stay: already modular, keep as leaves.
- Existing tests: `packages/conduit-core/test/*.test.js` (snap, fitting, BOM, modules) — UI has no dedicated test dir; core tests must keep passing.

## Feature modules (to build in app/conduit-ui-split)
1. **`conduit-takeoff/src/ui/dom.js`** (new): all `getElementById`/`querySelectorAll` lookups in one place (~70 ids: viewer, sidebar, model/draw/top-bar/summary/footer panels).
2. **`conduit-takeoff/src/ui/state.js`** (new): `createConduitState()` — sourceModel, settings (stick 3.048 m, waste, unit), network/commandStack/diameterRegistry/markerStore, selectedRunId.
3. **`conduit-takeoff/src/ui/model-load.js`** (new, ~150 lines): file/`?ifc=` loading, SHA-256 integrity, schema detect, progress overlay, `fitCameraToModel`, view presets (fit/top/front/right).
4. **`conduit-takeoff/src/ui/draw-toolbar.js`** (new, ~150 lines): draw-mode/ortho/perp toggles, undo/redo wiring, diameter picker render, vertical step controls, active-run info, top-bar diameter/elevation/system/workplane/autoriser controls.
5. **`conduit-takeoff/src/ui/runs-list.js`** (new, ~80 lines): `renderRunsList` — per-run rows, length/sticks/segments, select/delete, count badge.
6. **`conduit-takeoff/src/ui/summary.js`** (new, ~70 lines): `renderSummary` — BOM-by-size table, waste factor input, totals.
7. **`conduit-takeoff/src/ui/project-io.js`** (new, ~120 lines): save/load project JSON (`serializeProject`/`deserializeProject` + hash verify), CSV export (`exportCompleteCsv`), IFC overlay export (`exportOverlayIfc`), keyboard shortcuts.
8. **`conduit-takeoff/src/ui/viewer-chrome.js`** (new, ~80 lines): sidebar tabs/toggle, loading overlay show/hide, status text, cursor coords, init() engine bootstrap + `onStateChange` fan-out.
9. **`conduit-takeoff/src/main.js`** (rewrite, target ~120 lines): wires the 7 modules in dependency order, exposes `window.__drawingTool` (kept: HUD/diagnostics compat).

## Public interface
- Each module exports `createXxx({ state, els, engine, drawingTool, ... }) -> api`.
- Cross-module calls go through a single `coordinator` object (same `api.*` pattern as 7.1: static check that every `api.*` resolves).
- `window.__drawingTool` preserved (conduit HUD + external diagnostics use it).

## Rules
- **R1: Zero regressions.** DOM ids, event handlers (35 listeners), user flows identical. No rule/logic changes — all calculations stay in `@conduit-core` / `drawing-tool.js`.
- **R2: Clean separation.** Modules receive shared engine/state/drawingTool; no duplicate engine instances.
- **R3: Test & build integrity.** `npm test` 92/92 + `npm run build:conduit` + `npm run build` + `check-boundaries.py` stay green.
- **R4: No core imports.** UI modules never import `crates/*` or `bindings/*` directly; only `@conduit-core`, `viewer-core`, `excel-io` (per ARCH §2 rule 7).

## Acceptance criteria
| Check | Expected |
|---|---|
| `conduit-takeoff/src/main.js` coordinator | ≤ 150 lines |
| New modules under `conduit-takeoff/src/ui/` | 8 files, each owning one domain above |
| `api.*` cross-module refs | 100% resolve (static check in PR) |
| `npm test` | 92/92 pass |
| `npm run build` + `npm run build:conduit` | both green |
| `scripts/check-boundaries.py` | OK |
| `window.__drawingTool` | present after boot |

## Out of scope
- No changes to `drawing-tool.js` state machine, `mep-hud.js`, `surface-picker.js`, `viewport-controls.js`, `properties-panel.js` (already modular).
- No 4.6 wasm switch (separate `rust/conduit-wasm` lane); UI keeps importing `@conduit-core`.
- No new features; rubber-band-while-orbiting preserved verbatim.

## Parity reference
- Legacy file: `conduit-takeoff/src/main.js` (897 lines on origin/main@54597c7).
- 7.1 precedent: `docs/specs/tray/split-main-js.md` (R1–R3, FIX-1/FIX-2 pattern, 68/68 `api.*` check).
- No legacy-JS test pins UI behavior (conduit UI has no test dir); parity is build + listener-count + manual `?ifc=` smoke.

## Open questions / [UNVERIFIED]
- **Q1:** `properties-panel.js` (149 lines, conduit) vs tray `src/ui/properties-panel.js` (~620 lines) — overlap/duplication intentionally NOT unified here; a shared viewer panel (if any) belongs to `viewer/*`.
- **Q2:** keyboard-shortcut list (inside `init()`) moves to `project-io.js` — verify no shortcut is dropped via listener count (35) in the landing PR.
