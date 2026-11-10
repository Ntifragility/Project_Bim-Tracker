# Command map — conduit takeoff

Status: draft | Parent: `revit-chrome-design.md` (R1: ribbon owns commands).
Every row: old control id → new `{tab, group, size, command}`. Adapter calls
the existing handler directly; no `data-forward` clicks.

## Tab: Model

| Old id | Group | Size | Command | Existing handler |
|---|---|---|---|---|
| `btn-open-ifc` (+`file-input`) | Source | big | `conduit.open-ifc` | `model-load.js` open dialog |
| `btn-fit-view` | Views | small | `conduit.view-fit` | fit to view |
| `btn-view-top` | Views | small | `conduit.view-top` | top view |
| `btn-view-front` | Views | small | `conduit.view-front` | front view |
| `btn-view-right` | Views | small | `conduit.view-right` | right view |

## Tab: Trace

| Old id | Group | Size | Command | Existing handler |
|---|---|---|---|---|
| `btn-draw-mode` | Tools | big | `conduit.trace-draw` | `draw-toolbar.js` draw mode |
| `btn-ortho` | Tools | small | `conduit.trace-ortho` | ortho toggle |
| `btn-perp` | Tools | small | `conduit.trace-perp` | perpendicular toggle |
| `btn-undo` | Tools | small | `conduit.trace-undo` | undo point |
| `btn-redo` | Tools | small | `conduit.trace-redo` | redo point |
| `btn-finish-run` | Run | big (split w/ cancel) | `conduit.run-finish` | finish run |
| `btn-cancel-run` | Run | split | `conduit.run-cancel` | cancel run |
| `btn-add-vert-up` | Run | small | `conduit.run-vert-up` | vertical up |
| `btn-add-vert-down` | Run | small | `conduit.run-vert-down` | vertical down |
| `top-diameter-select` | Size (contextual) | small | `conduit.opt-diameter` | diameter select |
| `top-elevation-input` | Elevation (contextual) | small | `conduit.opt-elevation` | elevation input |
| `btn-pick-elevation` | Elevation (contextual) | small | `conduit.opt-pick-elev` | pick elevation |
| `top-system-select` | System (contextual) | small | `conduit.opt-system` | system select |
| `btn-toggle-workplane` | Grid (contextual) | small | `conduit.opt-workplane` | workplane toggle |
| `btn-toggle-autoriser` | Grid (contextual) | small | `conduit.opt-autoriser` | auto-riser toggle |

## Tab: Quantities

| Old id | Group | Size | Command | Existing handler |
|---|---|---|---|---|
| `waste-factor-input` | Takeoff | small | `conduit.qty-waste` | waste factor |
| (summary table — display) | Takeoff | — | — | stays in dock |

## Tab: Project

| Old id | Group | Size | Command | Existing handler |
|---|---|---|---|---|
| `btn-load-project` (+`project-file-input`) | Project | big | `conduit.proj-load` | `project-io.js` load |
| `btn-save` | Project | big | `conduit.proj-save` | save project |
| `btn-export-csv` | Export | small | `conduit.proj-csv` | CSV export |
| `btn-export-ifc` | Export | small | `conduit.proj-ifc` | overlay IFC export |

## Contextual: Modify | Run (tool-driven)

Shown while a run is being traced or a run is selected. Hosts: diameter,
elevation, pick, system, workplane, autoriser, finish/cancel, vertical
step, run length/sticks summary. This replaces the always-visible
`#ribbon-contextual` options bar — same controls, visibility-gated.

## QAT (default)

`conduit.proj-save`, `conduit.trace-undo`, `conduit.trace-redo`.

## Displays (stay in dock, not commands)

`diameter-list`, `active-run-info`, run list, `runs-count-badge`,
`summary-table-container`, `model-info`, status bar (`status-text`,
`cursor-coords`), loading overlay.
