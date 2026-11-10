# Command map — tray viewer

Status: draft | Parent: `revit-chrome-design.md` (R1: ribbon owns commands).
Every row: old control id → new `{tab, group, size, command}`. Adapter calls
the existing handler directly; no `click()` forwarding, no DOM moves.

## Tab: Model

| Old id | Group | Size | Command | Existing handler |
|---|---|---|---|---|
| `btn-load-sample` | Source | big | `tray.open-sample` | `model-loader.js` load sample |
| `btn-upload` (+`file-input`) | Source | big | `tray.open-ifc` | file picker → load IFC |
| `btn-export-all-ifc` | Export | big | `tray.export-all-ifc` | `unified-export.js` combined export |
| `btn-reset-camera` | Views | small | `tray.view-reset` | camera reset |
| `btn-viewer-settings` | Views | small | `tray.view-settings` | settings panel toggle |
| `toggle-grid` | Views | small | `tray.view-grid` | grid on/off (checkbox state) |
| `toggle-wireframe` | Views | small | `tray.view-wireframe` | wireframe toggle |
| `toggle-darkmode` | Views | small | `tray.view-darkmode` | canvas background toggle |
| `toggle-highlight-tagged-sidebar` | Views | small | `tray.view-highlight-tagged` | highlight tagged trays |
| `toggle-floating-labels-sidebar` | Views | small | `tray.view-floating-labels` | 3D floating tags |
| `btn-upload-excel` (+`excel-file-input`) | Source | small | `tray.link-excel` | excel link |

## Tab: Tag

| Old id | Group | Size | Command | Existing handler |
|---|---|---|---|---|
| `btn-preview-batch-tags` | Batch | small | `tray.batch-preview` | `tagging-panel.js` preview |
| `btn-apply-batch-tags` | Batch | big | `tray.batch-apply` | apply batch tags |
| `btn-undo-batch-tags` | Batch | small | `tray.batch-undo` | undo last batch |
| `btn-assign-tag` | Assign | big | `tray.assign-tag` | assign system tag |
| `btn-add-tray-selection` | Assign | small | `tray.selection-add` | add current element |
| `btn-unassign-tag` | Assign | small | `tray.selection-unassign` | unassign selected |
| `btn-highlight-system` | System | small | `tray.system-highlight` | highlight system |
| `btn-validate-tags` | Validate | small | `tray.validate` | tag validation report |

## Tab: Systems

| Old id | Group | Size | Command | Existing handler |
|---|---|---|---|---|
| `btn-refresh-tray-systems` | Manager | small | `tray.systems-refresh` | refresh manager |
| `btn-manager-highlight` | Manager | small | `tray.systems-highlight` | highlight selected system |
| `btn-manager-isolate` | Manager | small | `tray.systems-isolate` | isolate selected system |
| `btn-manager-add-selection` | Manager | small | `tray.systems-add` | add selection to system |
| `btn-manager-remove-selection` | Manager | small | `tray.systems-remove` | remove selection |
| `btn-manager-check-continuity` | Continuity | big | `tray.systems-continuity` | continuity check |
| `btn-clear-continuity-colors` | Continuity | small | `tray.systems-continuity-clear` | clear colors |
| `btn-manager-regenerate-sequence` | Manager | small | `tray.systems-regen` | regenerate sequence |
| `btn-manager-rename` | Manager | small | `tray.systems-rename` | rename system |
| `btn-restore-all-deletions` | Manager | small | `tray.systems-restore` | restore deletions |
| `btn-export-tags` | Export | small | `tray.export-mapping` | export mapping |
| `btn-export-tagged-ifc` | Export | small | `tray.export-tagged-ifc` | export tagged IFC |

## Tab: Edit

| Old id | Group | Size | Command | Existing handler |
|---|---|---|---|---|
| `btn-add-metadata-row` | Metadata | small | `tray.meta-add-row` | `safe-editor-panel.js` |
| `btn-copy-previous-metadata` | Metadata | small | `tray.meta-copy-prev` | copy previous |
| `btn-stage-metadata` | Metadata | big | `tray.meta-stage` | stage metadata |
| `btn-stage-property-edit` | Edit | small | `tray.edit-stage-prop` | stage property change |
| `btn-stage-color-edit` | Edit | small | `tray.edit-stage-color` | stage color |
| `btn-clear-ifc-edits` | Edit | small | `tray.edit-clear` | clear pending |
| `btn-export-edited-ifc` | Export | big | `tray.edit-export-ifc` | export edited IFC |
| `btn-build-routing-graph` | Routing | big | `tray.route-build` | build routing graph |
| `btn-clear-routing-graph` | Routing | small | `tray.route-clear` | clear graph |
| `btn-route-start` | Routing | small | `tray.route-start` | set start |
| `btn-route-end` | Routing | small | `tray.route-end` | set end |
| `btn-calculate-route` | Routing | small | `tray.route-calc` | calculate route |

## Contextual: Modify | Tray System (selection-driven)

Shown when a tray system is selected. Commands: `tray.systems-highlight`,
`tray.systems-isolate`, `tray.systems-continuity` (same adapters, new host).

## Displays (stay in dock, not commands)

`element-props-panel` family, `loaded-models-list`, tray-system list /
components / continuity body / deletions, `excel-data-table`, context menu,
replace dialog, loading overlay, `orbit-indicator`, status bar (new).
