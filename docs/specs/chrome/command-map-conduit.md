# Command map — conduit takeoff

Status: approved | Parent: `revit-chrome-design.md` (R1: ribbon owns commands).

Every row: old control id → new `{tab, group, size, command-id}`.
The conduit adapter (`conduit-takeoff/src/ui/conduit-adapter.js`, new file in
`app/conduit-ribbon-chrome`) maps each command-id to the existing handler
directly. No `data-forward` clicks. No MutationObserver mirrors.

**Waste-factor field (`waste-factor-input`)** is a numeric `<input>`, not a
button. It stays in the Quantities dock panel. It is NOT modelled as an
`InputField` or `Command` in `RibbonDef`. The Quantities ribbon tab shows a
static hint text only. This matches Revit's convention: numeric parameter
fields belong in Properties palettes, not the ribbon.

**Run-summary displays** (`top-active-run-summary`, `top-run-length`,
`top-run-sticks`, `active-run-info`, `runs-count-badge`, `run-list`) stay in
the dock. The `Modify | Run` contextual tab hosts only interactive controls
(selects, number inputs, action buttons). Display text never moves to ribbon.

---

## QAT — Quick Access Toolbar (keytip prefix `Q`)

| Command id | Icon | Keytip | Existing handler | Tooltip |
|---|---|---|---|---|
| `conduit.proj-save` | `save` | `QS` | `project-io.js` save | "Save Project" |
| `conduit.trace-undo` | `undo` | `QU` | `draw-toolbar.js` undo point | "Undo" |
| `conduit.trace-redo` | `redo` | `QR` | `draw-toolbar.js` redo point | "Redo" |

---

## Tab: Model (keytip: `M`)

### Group: Source

| Old id | Size | Command id | Icon | Keytip | Existing handler |
|---|---|---|---|---|---|
| `btn-open-ifc` + `file-input` | big | `conduit.open-ifc` | `open` | `MO` | `model-load.js` open dialog |

### Group: Views

| Old id | Size | Command id | Icon | Keytip | Existing handler |
|---|---|---|---|---|---|
| `btn-fit-view` | small | `conduit.view-fit` | `reset-view` | `MVF` | fit to view |
| `btn-view-top` | small | `conduit.view-top` | `camera-top` | `MVT` | top view |
| `btn-view-front` | small | `conduit.view-front` | `camera-front` | `MVR` | front view |
| `btn-view-right` | small | `conduit.view-right` | `camera-right` | `MVG` | right view |

---

## Tab: Trace (keytip: `T`)

### Group: Tools

| Old id | Size | Command id | Icon | Keytip | Existing handler |
|---|---|---|---|---|---|
| `btn-draw-mode` | big | `conduit.trace-draw` | `trace` | `TD` | `draw-toolbar.js` draw mode |
| `btn-ortho` | small | `conduit.trace-ortho` | `ortho` | `TO` | ortho toggle |
| `btn-perp` | small | `conduit.trace-perp` | `perp` | `TP` | perpendicular toggle |
| `btn-undo` | small | `conduit.trace-undo` | `undo` | `TU` | undo point |
| `btn-redo` | small | `conduit.trace-redo` | `redo` | `TR` | redo point |

### Group: Run

`conduit.run-finish` is the **primary** of a split button. `conduit.run-cancel`
is its companion (`splitWith: 'conduit.run-cancel'` on the primary).
The framework renders them as one compound control (see §2.7 of design spec).
`conduit.run-cancel` must NOT set `splitWith` itself.

| Old id | Size | Command id | Icon | Keytip | splitWith | Existing handler |
|---|---|---|---|---|---|---|
| `btn-finish-run` | big (primary) | `conduit.run-finish` | `finish` | `TRF` | `conduit.run-cancel` | `draw-toolbar.js` finish run |
| `btn-cancel-run` | split companion | `conduit.run-cancel` | `cancel` | `TRC` | — | cancel run |
| `btn-add-vert-up` | small | `conduit.run-vert-up` | `vert-up` | `TVU` | — | add vertical step up |
| `btn-add-vert-down` | small | `conduit.run-vert-down` | `vert-down` | `TVD` | — | add vertical step down |

---

## Tab: Quantities (keytip: `Q`)

### Group: Takeoff

No ribbon commands. Waste-factor input, summary table, and run list remain in
the dock panel. The ribbon panel displays a static informational hint only.

The app branch adds a `<span class="rc-hint">` inside the group's DOM slot.
This is NOT a `Command` or `InputField` in `RibbonDef` — it is a plain HTML
element added by the app after `createRibbon()` returns. The group is declared
in `RibbonDef` with an empty `items: []` to get the group caption rendered;
the app then appends the hint span into the group container by id.

Hint text: `"Waste %, summary and runs live in the dock panel ▶"`

---

## Tab: Project (keytip: `P`)

### Group: Project

| Old id | Size | Command id | Icon | Keytip | Existing handler |
|---|---|---|---|---|---|
| `btn-load-project` + `project-file-input` | big | `conduit.proj-load` | `open` | `PO` | `project-io.js` load |
| `btn-save` | big | `conduit.proj-save` | `save` | `PS` | save project |

### Group: Export

| Old id | Size | Command id | Icon | Keytip | Existing handler |
|---|---|---|---|---|---|
| `btn-export-csv` | small | `conduit.proj-csv` | `csv` | `PEC` | CSV export |
| `btn-export-ifc` | small | `conduit.proj-ifc` | `export` | `PEI` | overlay IFC export |

---

## Contextual: Modify | Run (keytip: `CR`)

Replaces the always-visible `#ribbon-contextual` options bar.
Same controls, same handlers — now hidden unless actively in use.

**Trigger:** `api.showContextual('modify-run')` called from:
1. `draw-toolbar.js` — when draw mode activates (`btn-draw-mode` pressed/toggled on).
2. `project-io.js` — when `state.selectedRunId` becomes non-null (run selected).

**Dismiss:** `api.hideContextual()` called from:
1. `draw-toolbar.js` — on `cancelCurrentRun()`.
2. `project-io.js` — when `state.selectedRunId` is set to `null`.

Controls inside this contextual tab use `InputField` (kind: 'input') where
the original was a `<select>` or `<input type="number">`. The framework renders
the HTML element; `onChange` wires to the existing handler. The existing
element's `id` is re-used in the `InputField.id` field so CSS and test
selectors continue to work.

### Group: Size

| Old id | Kind | Field/Command id | inputType | Icon | Keytip | Handler |
|---|---|---|---|---|---|---|
| `top-diameter-select` | InputField | `conduit.opt-diameter` | `select` | `diameter` | `CRS` | `draw-toolbar.js` diameter change |

Options for the select are populated dynamically from `diameter-list` data,
same as today. The adapter's `options` callback reads the current diameter
registry and returns `{ value, label }[]`.

### Group: Elevation

| Old id | Kind | Field/Command id | inputType / size | Icon | Keytip | Handler |
|---|---|---|---|---|---|---|
| `top-elevation-input` | InputField | `conduit.opt-elevation` | `number` | `elevation` | `CRE` | elevation value change |
| `btn-pick-elevation` | Command (small) | `conduit.opt-pick-elev` | — | `pick` | `CRP` | pick elevation from model |

Elevation input: `min` / `max` / `step` left undefined (free numeric entry,
same as the existing `<input type="number">` with no constraints).

### Group: System

| Old id | Kind | Field/Command id | inputType | Icon | Keytip | Handler |
|---|---|---|---|---|---|---|
| `top-system-select` | InputField | `conduit.opt-system` | `select` | `run` | `CRSY` | system select |

### Group: Grid

| Old id | Kind | Field/Command id | size | Icon | Keytip | Handler |
|---|---|---|---|---|---|---|
| `btn-toggle-workplane` | Command | `conduit.opt-workplane` | small | `workplane` | `CRW` | workplane toggle |
| `btn-toggle-autoriser` | Command | `conduit.opt-autoriser` | small | `autoriser` | `CRA` | auto-riser toggle |

---

## Displays — stay in dock, never in RibbonDef

The following stay in the dock panels exactly as today.
App branch must NOT add these to `RibbonDef`:

Trace dock panel:
- `diameter-list` (read-only list of available sizes)
- `active-run-info`, `active-run-actions`
- `vertical-step-controls` (the `input-vertical-len` field)
- `run-list`, `runs-count-badge`

Quantities dock panel:
- `waste-factor-input` (numeric input — stays in dock)
- `summary-table-container`

Model dock panel:
- `model-info`

Status bar (managed by framework `setStatus` calls from adapter):
- `status-text` (backend mode)
- `cursor-coords`

Contextual panel display (NOT moved to ribbon):
- `top-active-run-summary`, `top-run-length`, `top-run-sticks`
  — these informational spans stay in the dock's active-run-info section,
  not in the `Modify | Run` contextual tab.

Overlays (untouched):
- `loading-overlay`
