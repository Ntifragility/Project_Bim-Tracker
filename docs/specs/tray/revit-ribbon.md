# tray / revit-ribbon shell + global ESC (task: app/tray-revit-ribbon)

Status: implemented (branch `app/tray-revit-ribbon`).
Owner files: `index.html`, `src/style.css`, `src/ui/viewer-chrome.js`,
`src/ui/escape-handler.js` (new), this spec. Nothing else is touched
(no `src/main.js`, no other `src/ui/*`, no Rust, no CI).

## Goal

Revit-style ribbon shell for the tray viewer (tray has no top bar, so the
ribbon is a top container) using ONLY existing tools/buttons — no new
commands — plus one global ESC handler. Tray layout before: full-bleed
canvas (`#viewer-container`) + left floating sidebar (tabs Models / Controls
/ Routing / Loaded via `.sidebar-tab-btn[data-tab-target]`, sections
`section.control-group[data-sidebar-panel]`) + right excel panel
(`#excel-panel`, Tray Systems, starts collapsed) + context menu + replace
dialog + loading overlay. Thin coordinator `src/main.js` (163 lines) calls
`chrome.setupSidebarTabs/guardOverlays`, selection/tagging/systems/excel/
editing/model-loader/menu wiring, then `chrome.wireChromeControls`.

## No-new-commands rule

The ribbon creates zero controls. `setupRibbonShell()` (in `viewer-chrome.js`,
called at the end of `wireChromeControls()` so every feature module has
wired its listeners first) MOVES existing subtrees with `appendChild` —
never clones, never `innerHTML`. Moved nodes keep their ids AND their
listeners. The one-line integrator callsite lives in `main.js`-owned code
and is NOT added here (see Wiring below).

## Id-mapping table (where each control lives after the move)

Ribbon container: `div#ribbon` + `div#options-bar-slot` (empty reservation,
new DOM) + 4 `.ribbon-tab` tab-switch buttons (the ONLY new buttons; they
switch ribbon panels and create no commands). Every other id below
pre-exists.

| Ribbon tab | Slot | Moved subtree (whole, ids preserved) | Key ids inside |
|---|---|---|---|
| Model | `model-load` | `section[data-sidebar-panel="models"]` MINUS the excel-link row (whole section moves; excel row re-moves below) | `btn-load-sample`, `btn-upload` + `file-input`, `btn-export-all-ifc` |
| Model | `model-view` | `section[data-sidebar-panel="controls"]` (whole) | `btn-reset-camera`, `btn-viewer-settings` + `viewer-settings-panel` (`selection-highlight-color/hex`), `toggle-grid`, `toggle-wireframe`, `toggle-darkmode`, `toggle-highlight-tagged-sidebar`, `toggle-floating-labels-sidebar` |
| Tag | `tag-batch` | `.tagging-mode-tabs` + `section#batch-tagging-pane` | `tagging-tab-assign`, `tagging-tab-manage` (switch reuses `setTaggingMode`), `batch-prefix/system/element-kind/tray-code/fitting-code/start-sequence/sequence-digits`, `batch-pattern-example`, `btn-preview-batch-tags`, `btn-apply-batch-tags`, `batch-status`, `batch-preview-panel` + `batch-preview-list`, `batch-replace-conflicts(-row)`, `btn-undo-batch-tags` |
| Tag | `tag-assign` | `section#tag-management-pane` | `system-tag-input` (+`system-tag-suggestions`), `tag-assignment-status`, `tray-selection-summary`, `tag-assignment-summary`, `btn-assign-tag`, `btn-highlight-system`, `btn-export-tags`, `btn-export-tagged-ifc`, `btn-add-tray-selection`, `btn-unassign-tag`, `btn-validate-tags` |
| Systems | `systems-validation` | `section#tag-validation-report` only | `tag-validation-badge/counts/issues` (+ `btn-validate-tags` lives in Tag tab and unhides it) |
| Edit-Export | `edit-metadata` | `.ifc-edit-panel` subtree (whole) | `metadata-pset(-suggestions)`, `metadata-rows`, `btn-add-metadata-row`, `btn-copy-previous-metadata`, `btn-stage-metadata`, `ifc-edit-pset/property/value`, `btn-stage-property-edit`, `ifc-edit-color/transparency`, `btn-stage-color-edit`, `ifc-edit-status/count/pending-list`, `btn-clear-ifc-edits`, `btn-export-edited-ifc` |
| Edit-Export | `edit-routing` | `section[data-sidebar-panel="routing"]` (whole, routing-controller reads by id) | `routing-tolerance`, `btn-build-routing-graph`, `btn-clear-routing-graph`, `btn-route-start/end`, `btn-calculate-route`, `routing-status/summary` |
| Edit-Export | `edit-export` | excel-link row (re-moved out of models section) | `btn-upload-excel`, `excel-file-input` (beside the other export/import controls) |

Untouched (never moved, never restyled structurally): `viewer-context-menu`
(+ `context-focus-item/isolate-item/color-control/show-all`),
`tag-replace-dialog` (+ `tag-replace-message/cancel/confirm`),
`loading-overlay` (+ `loader-title/status/progress`), `orbit-indicator`.

Left dock (`#sidebar`): keeps sidebar header/nav/collapse/footer + the
`element-props-group` display (`element-props-panel`, `multi-select-*`,
`prop-*`, `prop-psets-container`) only. Nav tabs keep their
`setupSidebarTabs` wiring (moved sections are still in the
`section.control-group[data-sidebar-panel]` query set — tab clicks find
them wherever they live; no CSS `display:none !important` was removed).
Right dock (`#excel-panel`): keeps the loaded-models section
(`loaded-models-container/list`), the full tray-system manager subtree
(`tray-system-manager-summary`, filter/sort/list, components, continuity
+ `btn-clear-continuity-colors`, deletions + `btn-restore-all-deletions`,
manager actions), the highlight/labels toolbars
(`toggle-highlight-tagged`, `tagged-highlight-color/hex/count`,
`toggle-floating-labels`), `tray-selection-summary` row context, the
`excel-only-field` nav fields, and the excel table container
(`excel-data-table`, colgroup/header/body) + placeholder. Displays stay
docked; only command inputs move up.

## ESC chain (`src/ui/escape-handler.js`, `initEscapeHandler(ctx, dom, api)`)

Capture-phase document listener; each press dismisses ONE layer and
returns. Legacy bubble-phase listeners without `stopPropagation`
(`context-menu.js:175-176`, `helpers.js:73-80`) then see an already-hidden
target and no-op — no double handling. `Do NOT edit` those files (rule).

1. **Typing guard**: focus in `input/textarea/select/[contenteditable]` →
   blur only (checkboxes — grid/wireframe/dark/labels — never toggled).
   Exception: open `tagReplaceDialog` still closes via its Cancel path.
2. **Dialogs, front-to-back**: `tagReplaceDialog` (Cancel click → pending
   promise resolves `false`) → `viewerContextMenu`
   (`api.closeViewerContextMenu()`) → `viewerSettingsPanel`
   (`hidden=true`, `aria-expanded=false`) → `batchPreviewPanel`
   (`api.clearBatchPreview()`) / `tagValidationReport` (`hidden=true`).
   Loading overlay is NEVER dismissible (checked via inline style +
   computed style; ESC during load is a no-op).
3. Tray has no draw tool → nothing to cancel (step kept as explicit no-op).
4. Non-empty selection (`api.getSelectedModelIdMap/countModelIdMapItems`,
   fallback `selectedIfcElement/traySelection`) or `isolationActive` →
   `highlighter.clear('select')` → `selection.js:368-389` onClear fan-out
   (nulls `activeModel/selectedIfcElement/currentSelectionMap`, clears
   `traySelection`, `clearBatchPreview`, `clearElementProperties`).
5. `ctx.selectedTraySystemTag` set with no viewer selection → clear tag
   highlight state (`''` + `updateTagAssignmentUi()` refresh).
6. Otherwise no-op. NEVER ESC-cleared: sidebar tabs,
   `tagging-tab-assign/manage` (+ `setTaggingMode` state), checkboxes,
   staged edits/batches (preview hide keeps assignments).

## Wiring (integrator callsite — NOT in this branch)

`main.js` is owned by another task. The follow-up `fix/*` branch or owner
adds ONE line after `menu.wireContextMenu()` in `src/main.js`:

```js
import { initEscapeHandler } from './ui/escape-handler.js';
// ...
const menu = initContextMenu(ctx, dom, api);
menu.wireContextMenu();
initEscapeHandler(ctx, dom, api); // tray global ESC chain (revit-ribbon)
```

Order matters: ESC calls `api.closeViewerContextMenu`, registered by
`wireContextMenu()`. State this clearly in the PR.

## Acceptance

- [ ] `index.html` diff adds ONLY `div#ribbon` (+ brand/tabs/panels/slots),
  `div#options-bar-slot`, and a comment; zero existing ids moved/renamed.
- [ ] Every id in the mapping table resolves exactly once after
  `setupRibbonShell()` (no duplicates — moves, not clones).
- [ ] Sidebar tab clicks still toggle their (moved) panels; tagging tabs
  still call `setTaggingMode('assign'|'manage')` (existing listeners).
- [ ] No new buttons/commands: `git diff` on `index.html` shows no new
  `input`/`select` elements and only the 4 ribbon tab-switch buttons (which
  create no commands — they toggle ribbon panels).
- [ ] ESC chain: typing blur → replace → menu → settings → preview/report
  → selection clear → system-tag clear → no-op; overlay never dismisses;
  sidebar/tagging tabs + checkboxes untouched (open questions below list
  any `[UNVERIFIED]` item, e.g. live-browser ESC order — no DOM runner in
  repo, verified by code audit + `node --check`).
- [ ] DoD gate: `cargo fmt --check`, `cargo clippy --workspace
  --all-targets -- -D warnings`, `cargo test --workspace`, `npm test`,
  `npm run build`, `npm run build:conduit`,
  `python3 scripts/check-boundaries.py`.

## Open questions

- [UNVERIFIED] Live-browser ESC ordering vs the two legacy listeners
  (capture-first design says one-layer-per-press; needs a manual pass once
  the integrator wires the callsite).
- Owner decision: keep or remove the now-mostly-empty sidebar nav tabs
  (kept working by design; hiding them is a follow-up `app/*` choice).
- `options-bar-slot` is reserved and empty; conduit parity may populate it
  later.
