# tray / split-main-js
Status: implemented (2026-10-25: full split landed; `src/main.js` 4,559 → 153 lines)
Branch: app/split-main-js        Owner folders: src/ui/, src/main.js, docs/specs/tray/

## Goal
Deconstruct the monolithic `src/main.js` (4,600+ lines) into modular UI feature components under `src/ui/`, each responsible for a distinct interaction domain (model loading, property inspection, tagging, system management, excel linkage, safe editor, context menu), while keeping `src/main.js` as a concise app bootstrap orchestrator.

## Feature Modules (all landed)
1. **`src/ui/state.js`** (legacy, kept): Previous flat state module — superseded by `context.js` for new code; `main.js` re-exports it for the previous flat import surface.
2. **`src/ui/context.js`** (new): `createAppContext()` — engine handles, models, selection, appearance, tagging, batch and toggle state (49 keys).
3. **`src/ui/dom.js`** (new): All `getElementById` lookups in one place.
4. **`src/ui/helpers.js`** (new): Loader controls, `formatBytes`, `normalizeHexColor`, assignment keys, `requestTagReplacement`, `readElementIdentity`.
5. **`src/ui/ifc-types.js`** (new): `IFC_TYPE_MAP` + `getModernIfcTypeName` + pset type codes.
6. **`src/ui/model-loader.js`** (new, ~490 lines): file/sample/`?ifc=` loading, models list, fit, wireframe; `api.setWireframe` registered on the coordinator.
7. **`src/ui/properties-panel.js`** (new, ~620 lines): inspector, psets/quantities, multi-select, `CCP_TRAY_SYSTEM` sync.
8. **`src/ui/selection.js`** (new, ~420 lines): highlighter events, map helpers, zoom/orbit, member highlight/isolate.
9. **`src/ui/appearance.js`** (new): highlight color, appearance maps, continuity groups, tagged-tray highlight, floating labels, toggle wiring.
9. **`src/ui/context-menu.js`** (new, ~190 lines): Right-click canvas context menu (focus, isolate, hide, appearance color, show all).
10. **`src/ui/excel-panel.js`** (new, ~410 lines): Excel file import, sheet selection, column mapping, and linkage validation.
11. **`src/ui/tagging-panel.js`** (new, ~720 lines): Batch tag assignment, element classification, and scheme sequence allocation.
12. **`src/ui/system-manager.js`** (new, ~845 lines): Tray system grouping, appearance colors, tag register view, and summary generation.
13. **`src/ui/editing.js`** (new, ~320 lines): Metadata rows, staged property/color edits, unified-export wrapper.
14. **`src/ui/viewer-chrome.js`** (new, ~220 lines): Sidebar/tabs/settings, grid/wireframe/dark toggles, auto-orbit, resize, overlay guard, hidden-model picker exclusion.

Cross-module calls (68 `api.*`) all resolve to a registered helper — verified by a static check in the PR.
`src/main.js` (153 lines) wires the 10 modules in dependency order and returns `{ ctx, api }`.

## Rules
- **R1: Zero Regressions:** UI DOM element IDs, event handlers, and user flows behave identically to legacy `src/main.js` — with two deliberate crash fixes below (both were `ReferenceError` on click, never a working flow).
- **R2: Clean Separation:** Feature modules do not create duplicate engine instances; they receive the shared engine and state.
- **R3: Test & Build Integrity:** `npm test` and `npm run build` must continue to pass without error.

## Deliberate behavior changes (7.1; both fix click-time crashes)
- **FIX-1 `summaryRows` (tagging-panel.js export handler):** the monolith (and `legacy/src/main.js:4590`) built the Summary sheet inline; the current tree calls `exportTagMapping(rows, summaryRows, …)` with `summaryRows` never defined → `ReferenceError` on Export. The split exports the register with `[]` summary until 7.3 restores the Summary sheet from `getTraySystemSummaries()`. Owner-visible: export no longer crashes, Summary sheet temporarily absent.
- **FIX-2 `grid` (viewer-chrome.js toggle):** the monolith referenced a file-scope `grid` no module ever defined → `ReferenceError` on every grid toggle (pre-existing in `legacy/src/main.js:3276`). The split resolves the grid from `OBC.Grids` list for this world and no-ops when absent.

## Open questions / [UNVERIFIED]
- **Q1 (pre-existing quirk, preserved verbatim):** the combined-properties view calls `collectModernPropertySets(itemData)` with a single argument, so `groups` is `undefined` and the `.set` inside throws per element; the per-element try/catch keeps the legacy outcome (warn + skip, panel shows the capped/empty note). Real fix (pass a `Map`) belongs to 7.4 or a `fix/` follow-up — not changed here per R1.
- **Q2 (scope):** `apps/tray-viewer/` is still a scaffold README; the live app remains `src/main.js` + `index.html`. Moving the entry under `apps/` is a separate `app/*` task (7.1 spec owns `src/`, not `apps/`).
- **Q3 (smoke):** no headless browser in CI/workspace — browser boot of the coordinator verified statically (build + 68/68 `api.*` resolution + syntax checks). First manual `?ifc=/fixtures/survey-box.ifc` pass owed on review.

## Acceptance criteria
- `src/main.js` is reduced from 4,600+ lines to a clean coordinator. → **153 lines.**
- All 89 tests pass under `npm test`. → **92/92 pass** (suite grew since the spec was written).
- `npm run build` (tray viewer) and `npm run build:conduit` build cleanly. → **both green** + `check-boundaries.py` OK.
