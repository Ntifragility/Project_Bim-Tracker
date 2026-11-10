# Command map — conduit takeoff

Status: approved | Parent: `revit-chrome-design.md` (R1: ribbon owns commands).

Every row: old control id → new `{tab, group, size, command-id}`.
The conduit adapter (`conduit-takeoff/src/ui/conduit-adapter.js`) maps each
command-id to the existing handler directly. No `data-forward` clicks.

**Waste-factor field:** `waste-factor-input` is a numeric `<input>`, not a
button. It stays in the Quantities dock panel (display, not moved to ribbon).
The Quantities ribbon tab shows a static hint text only. This is consistent
with Revit's approach of keeping numeric input fields in properties panels.

**Run-summary displays:** `top-active-run-summary`, `top-run-length`,
`top-run-sticks`, `active-run-info`, `runs-count-badge`, `run-list`
stay in the dock. The `Modify | Run` contextual tab hosts only interactive
controls (selects, inputs, buttons). Displays never move to the ribbon.

---

## QAT (Quick Access Toolbar)

| Command id | Icon | Existing handler |
|---|---|---|
| `conduit.proj-save` | `save` | `project-io.js` save project |
| `conduit.trace-undo` | `undo` | `draw-toolbar.js` undo point |
| `conduit.trace-redo` | `redo` | `draw-toolbar.js` redo point |

---

## Tab: Model

### Group: Source

| Old id | Size | Command id | Icon | Existing handler |
|---|---|---|---|---|
| `btn-open-ifc` + `file-input` | big | `conduit.open-ifc` | `open` | `model-load.js` open dialog |

### Group: Views

| Old id | Size | Command id | Icon | Existing handler |
|---|---|---|---|---|
| `btn-fit-view` | small | `conduit.view-fit` | `reset-view` | fit to view |
| `btn-view-top` | small | `conduit.view-top` | `camera-top` | top view |
| `btn-view-front` | small | `conduit.view-front` | `camera-front` | front view |
| `btn-view-right` | small | `conduit.view-right` | `camera-right` | right view |

---

## Tab: Trace

### Group: Tools

| Old id | Size | Command id | Icon | Existing handler |
|---|---|---|---|---|
| `btn-draw-mode` | big | `conduit.trace-draw` | `trace` | `draw-toolbar.js` draw mode |
| `btn-ortho` | small | `conduit.trace-ortho` | `ortho` | ortho toggle |
| `btn-perp` | small | `conduit.trace-perp` | `perp` | perpendicular toggle |
| `btn-undo` | small | `conduit.trace-undo` | `undo` | undo point |
| `btn-redo` | small | `conduit.trace-redo` | `redo` | redo point |

### Group: Run

`conduit.run-finish` is the **primary** of a split button;
`conduit.run-cancel` is the companion (`splitWith: 'conduit.run-cancel'`).

| Old id | Size | Command id | Icon | splitWith | Existing handler |
|---|---|---|---|---|---|
| `btn-finish-run` | big (primary) | `conduit.run-finish` | `finish` | `conduit.run-cancel` | finish run |
| `btn-cancel-run` | split companion | `conduit.run-cancel` | `cancel` | — | cancel run |
| `btn-add-vert-up` | small | `conduit.run-vert-up` | `vert-up` | — | vertical step up |
| `btn-add-vert-down` | small | `conduit.run-vert-down` | `vert-down` | — | vertical step down |

---

## Tab: Quantities

### Group: Takeoff

No ribbon commands. Waste-factor input, summary table, and run list stay in
the dock panel. The ribbon panel displays a static hint:

> "Waste %, summary and runs live in the dock panel ▶"

This is a `RibbonGroup` with no `items` — the framework renders only the
group caption. The hint text is a static `<span>` added by the app branch
inside the group's DOM slot (not a `Command` or `InputField`).

---

## Tab: Project

### Group: Project

| Old id | Size | Command id | Icon | Existing handler |
|---|---|---|---|---|
| `btn-load-project` + `project-file-input` | big | `conduit.proj-load` | `open` | `project-io.js` load |
| `btn-save` | big | `conduit.proj-save` | `save` | save project |

### Group: Export

| Old id | Size | Command id | Icon | Existing handler |
|---|---|---|---|---|
| `btn-export-csv` | small | `conduit.proj-csv` | `csv` | CSV export |
| `btn-export-ifc` | small | `conduit.proj-ifc` | `export` | overlay IFC export |

---

## Contextual: Modify | Run (tool-driven)

**Trigger:** `api.showContextual('modify-run')` called from:
1. `draw-toolbar.js` when draw mode activates (`btn-draw-mode` pressed).
2. `project-io.js` when a run is selected (`state.selectedRunId != null`).

**Dismiss:** `api.hideContextual()` called from:
1. `draw-toolbar.js` on `cancelCurrentRun()`.
2. `project-io.js` when run selection clears (`state.selectedRunId = null`).

This tab replaces the always-visible `#ribbon-contextual` options bar.
Same controls, same handlers — now hidden unless a run is active or selected.

### Group: Size

Uses `InputField` (kind: 'input', inputType: 'select').

| Old id | Kind | Command/Field id | Icon | Handler |
|---|---|---|---|---|
| `top-diameter-select` | InputField (select) | `conduit.opt-diameter` | `diameter` | `draw-toolbar.js` diameter |

### Group: Elevation

| Old id | Kind | Command/Field id | Icon | Handler |
|---|---|---|---|---|
| `top-elevation-input` | InputField (number) | `conduit.opt-elevation` | `elevation` | elevation value |
| `btn-pick-elevation` | Command (small) | `conduit.opt-pick-elev` | `pick` | pick elevation from model |

### Group: System

| Old id | Kind | Command/Field id | Icon | Handler |
|---|---|---|---|---|
| `top-system-select` | InputField (select) | `conduit.opt-system` | `run` | system select |

### Group: Grid

| Old id | Kind | Command/Field id | Icon | Handler |
|---|---|---|---|---|
| `btn-toggle-workplane` | Command (small) | `conduit.opt-workplane` | `workplane` | workplane toggle |
| `btn-toggle-autoriser` | Command (small) | `conduit.opt-autoriser` | `autoriser` | auto-riser toggle |

---

## Displays (stay in dock — not commands, not moved)

- `diameter-list` (dock — Trace panel)
- `active-run-info`, `active-run-actions`, `vertical-step-controls` (dock)
- `run-list`, `runs-count-badge` (dock — Quantities panel)
- `waste-factor-input`, `summary-table-container` (dock — Quantities panel)
- `model-info` (dock — Model panel)
- `status-text`, `cursor-coords` (status bar, managed by framework slot)
- `loading-overlay` (overlay)
- `top-active-run-summary`, `top-run-length`, `top-run-sticks` (dock, not contextual tab)
