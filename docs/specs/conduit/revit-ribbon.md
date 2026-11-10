# conduit / revit-ribbon
Status: draft (branch `app/conduit-revit-ribbon`)
Owner folders: `conduit-takeoff/index.html`, `conduit-takeoff/src/style.css`,
`conduit-takeoff/src/ui/viewer-chrome.js`, `conduit-takeoff/src/ui/draw-toolbar.js`,
`conduit-takeoff/src/ui/model-load.js`, `conduit-takeoff/src/ui/project-io.js`
Code landing: `app/conduit-revit-ribbon` (this branch; owned files only —
`conduit-takeoff/src/main.js` call order untouched, `draw-toolbar.js` handlers
untouched, Rust/CI/AGENTS.md untouched)

## Goal
Give conduit-takeoff a Revit-style ribbon using ONLY existing tools/buttons
(no new commands), plus a global ESC key with a documented precedence chain.
The old left sidebar becomes a dock; the persistent top options bar moves
verbatim into the ribbon's contextual slot; ribbon tab clicks forward to the
existing handlers via a thin shim in `viewer-chrome.js`.

## Non-goals
- No new commands, tools, or calculations. Every ribbon proxy forwards
  (`.click()` / focus) to an existing handler.
- No id removed or renamed. `collectEls()` (`dom.js`) keeps resolving.
- No change to `main.js` wiring order, `drawing-tool.js` state machine,
  `mep-hud.js`, sticky prefs (workplane, autoRiser, diameter, elevation), or
  the status bar.

## Panel mapping (old panel → ribbon tab → ribbon group)

| Old location (id) | Ribbon tab | Ribbon group | Forwarding |
|---|---|---|---|
| Sidebar Model: `btn-open-ifc` (+`file-input`, `model-info/*`) | Model | Source | proxy `data-forward="btn-open-ifc"` → `.click()` (opens file dialog) |
| Sidebar Model: `btn-fit-view`, `btn-view-top`, `btn-view-front`, `btn-view-right` | Model | Views | proxy → `.click()` on each |
| Sidebar Draw: `btn-draw-mode`, `btn-ortho`, `btn-perp`, `btn-undo`, `btn-redo` | Trace | Tools | proxy → `.click()`; `.active`/disabled mirrored back via MutationObserver + queueMicrotask sync |
| Sidebar Draw: `btn-finish-run`, `btn-cancel-run`, `btn-add-vert-up`, `btn-add-vert-down` (+`input-vertical-len` stays in dock) | Trace | Run | proxy → `.click()` on each |
| Options bar (moved verbatim into `#ribbon-contextual`): `top-diameter-select`, `top-elevation-input`, `btn-pick-elevation`, `top-system-select`, `btn-toggle-workplane`, `btn-toggle-autoriser`, `top-active-run-summary` (+`top-run-length`, `top-run-sticks`, `top-btn-finish`, `top-btn-cancel`) | Contextual (always visible under the active tab) | Size / Middle Elevation / System / Grid / run summary | same DOM nodes, same ids, same handlers (draw-toolbar `wireDrawControls` untouched) |
| Sidebar Draw: `diameter-list` | Trace (dock panel, not ribbon) | — | unchanged in dock |
| Sidebar Draw: `active-run-info`, `active-run-actions`, `vertical-step-controls`, `run-list`, `runs-count-badge` | Trace/Quantities (dock panels) | — | unchanged in dock |
| Sidebar Summary: `waste-factor-input`, `summary-table-container` | Quantities (dock panel; ribbon shows hint text only) | Takeoff (hint, no proxy) | unchanged in dock |
| Sidebar footer: `btn-load-project` (+`project-file-input`), `btn-save`, `btn-export-csv`, `btn-export-ifc` | Project | Project | proxy → `.click()` on each |

Rule: **no new commands.** The ribbon contains only `.ribbon-proxy`
buttons with `data-forward="<existing id>"`, tab buttons that mirror dock
state, and one static hint span. No proxy introduces a handler, a
calculation, or a state flag.

## ESC precedence chain (`project-io.js` `handleEscape`, exposed on return + `api`)

Global `window keydown` listener. Drive-by fix: the old `INPUT`-only guard
is widened to `INPUT/TEXTAREA/SELECT`; Escape inside a field routes through
the chain (step 1), other shortcuts stay inert while typing.

1. **Typing guard** — `api.isHudTyping()` (MEP HUD `isInputActive()` OR focus
   in `INPUT/TEXTAREA/SELECT`) → `blur()` only, return `'typing'`. Nothing
   else runs. (HUD's own input keeps its `stopPropagation` + Enter/Esc
   handling; `mep-hud.js` untouched.)
2. **Cancel in-progress** — `activePoints.length > 0` → `cancelCurrentRun()`
   + `updateUndoRedoButtons`, return `'cancel-run'` (highlighter `select`
   clear preserved); else `isPickElevationActive` → `false` + remove
   `.active` from `btn-pick-elevation` + status text, return `'cancel-pick'`.
3. **Clear selection** — `state.selectedRunId != null` → `null` on both
   `state` and `drawingTool` + `renderRuns` + `renderRunsList`, return
   `'clear-selection'`. (`api.renderSummary` not needed: selection carries no
   quantities.)
4. **Stand down trace tools** — `isDrawingMode/isOrthoActive/
   isPerpendicularActive = false` + remove 3 `.active` + `updateUndoRedoButtons`
   + status text `"Trace off: look around. Click Trace to place pipe"`,
   return `'stand-down'`. Sidebar tabs and sticky prefs (workplane,
   autoRiser, diameter, elevation) are never touched.

Handler returns the outcome string (`'typing' | 'cancel-run' |
'cancel-pick' | 'clear-selection' | 'stand-down'`) for tests.

## Acceptance criteria

Every old button reachable in ≤ 2 clicks (ribbon tab + proxy, or dock as before):

| Check | Expected |
|---|---|
| Ribbon tabs | Model / Trace / Quantities / Project; click sets `.active` + panel, focuses matching dock panel (Project leaves dock alone) |
| Dock tabs | clicking a dock tab syncs the ribbon to the matching tab |
| All proxies | `data-forward` target exists, is enabled-gated, mirrors `.active`/disabled; click produces the same state change as clicking the target |
| Options bar | all 13 ids survive inside `#ribbon-contextual`; handlers (diameter/elevation/pick/system/workplane/autoriser/finish/cancel) unchanged |
| No id removed/renamed | `git show HEAD:index.html` ids ⊆ new ids; only added: `ribbon`, `ribbon-contextual` |
| No new commands | no new `addEventListener` with a state mutation except tab-mirror + forward + ESC chain; boundary check OK |
| ESC matrix | typing→blur only · points>0→cancel · pick→off · selection→null+rerender · else stand-down (3 flags false, 3 `.active` removed, tabs/prefs untouched) |
| `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace` | green |
| `npm test`, `npm run build`, `npm run build:conduit`, `python3 scripts/check-boundaries.py` | green |

## Open questions / [UNVERIFIED]
- Q1: ribbon `Run` group proxies `btn-finish-run`/`btn-cancel-run`, which are
  `hidden` until a run starts — proxy clicks forward harmlessly (hidden
  buttons still receive `.click()`), but should proxies hide in sync? Left
  as-is (no new behavior); revisit if user testing says otherwise.
- Q2: `model-load.js` auto-switches the dock to Draw after load
  (`[data-tab-target="draw"]` click) — that listener now also syncs the
  ribbon to Trace via the shim; intended, flag if not.
