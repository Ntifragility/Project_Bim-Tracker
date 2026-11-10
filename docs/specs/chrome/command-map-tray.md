# Command map — tray viewer

Status: approved | Parent: `revit-chrome-design.md` (R1: ribbon owns commands).

Every row: old control id → new `{tab, group, size, command-id}`.
The tray adapter (`src/ui/tray-adapter.js`, new file in `app/tray-ribbon-chrome`)
maps each command-id to the existing handler function directly.
No `click()` forwarding. No `appendChild` moves.

**Command-id uniqueness note:** a command id identifies a logical action, not
a DOM node. The same id may appear in both a fixed tab and a contextual tab
(e.g. `tray.systems-highlight` appears in Systems tab AND in Modify | Tray
System). The framework creates independent `<button>` elements for each
occurrence. The adapter function reference is the same in both cases;
it must be idempotent.

---

## QAT — Quick Access Toolbar

Default items (icon-only, 24×24px click target, 16px icon, no label):

| Command id | Icon | Existing handler | Tooltip |
|---|---|---|---|
| `tray.export-mapping` | `export` | `unified-export.js` export tag mapping | "Export Tag Mapping" |
| `tray.batch-undo` | `tag-undo` | `tagging-panel.js` undo last batch | "Undo Last Batch" |
| `tray.batch-apply` | `tag-batch` | `tagging-panel.js` apply batch | "Apply Batch Tags" |

---

## Tab: Model (keytip: `M`)

### Group: Source

| Old id | Size | Command id | Icon | Keytip | Existing handler |
|---|---|---|---|---|---|
| `btn-load-sample` | big | `tray.open-sample` | `sample` | `MS` | `model-loader.js` load sample |
| `btn-upload` + `file-input` | big | `tray.open-ifc` | `open` | `MO` | file picker → load IFC |
| `btn-upload-excel` + `excel-file-input` | small | `tray.link-excel` | `link` | `ML` | excel link |

### Group: Export

| Old id | Size | Command id | Icon | Keytip | Existing handler |
|---|---|---|---|---|---|
| `btn-export-all-ifc` | big | `tray.export-all` | `export` | `ME` | `unified-export.js` combined export |

### Group: Views

Small-button rows, max 3 per row:

| Old id | Size | Command id | Icon | Keytip | Existing handler |
|---|---|---|---|---|---|
| `btn-reset-camera` | small | `tray.view-reset` | `reset-view` | `MVR` | camera reset |
| `btn-viewer-settings` | small | `tray.view-settings` | `settings` | `MVS` | settings panel toggle |
| `toggle-grid` | small | `tray.view-grid` | `views` | `MVG` | grid on/off |
| `toggle-wireframe` | small | `tray.view-wireframe` | `views` | `MVW` | wireframe toggle |
| `toggle-darkmode` | small | `tray.view-darkmode` | `theme` | `MVD` | canvas background toggle |
| `toggle-highlight-tagged-sidebar` | small | `tray.view-highlight-tagged` | `highlight` | `MVH` | highlight tagged trays |
| `toggle-floating-labels-sidebar` | small | `tray.view-floating-labels` | `tag` | `MVF` | 3D floating tags |

---

## Tab: Tag (keytip: `T`)

### Group: Batch

`tray.batch-apply` is the primary action (big). `tray.batch-preview` and
`tray.batch-undo` are supporting actions (small). This follows Revit
convention: the primary/commit action gets the big button.

| Old id | Size | Command id | Icon | Keytip | Existing handler |
|---|---|---|---|---|---|
| `btn-apply-batch-tags` | big | `tray.batch-apply` | `tag-batch` | `TA` | `tagging-panel.js` apply batch |
| `btn-preview-batch-tags` | small | `tray.batch-preview` | `tag` | `TP` | preview batch result |
| `btn-undo-batch-tags` | small | `tray.batch-undo` | `tag-undo` | `TU` | undo last batch |

### Group: Assign

| Old id | Size | Command id | Icon | Keytip | Existing handler |
|---|---|---|---|---|---|
| `btn-assign-tag` | big | `tray.assign-tag` | `tag` | `TAS` | assign system tag |
| `btn-add-tray-selection` | small | `tray.selection-add` | `system` | `TAA` | add current element |
| `btn-unassign-tag` | small | `tray.selection-unassign` | `tag-undo` | `TAU` | unassign selected |

### Group: Validate

Validation button in Tag tab; results display in right dock (see Displays).
App branch must NOT attempt to move `section#tag-validation-report`.

| Old id | Size | Command id | Icon | Keytip | Existing handler |
|---|---|---|---|---|---|
| `btn-validate-tags` | big | `tray.validate` | `validate` | `TV` | trigger tag validation report |
| `btn-highlight-system` | small | `tray.system-highlight` | `highlight` | `TVH` | highlight system |

---

## Tab: Systems (keytip: `S`)

### Group: Manager

| Old id | Size | Command id | Icon | Keytip | Existing handler |
|---|---|---|---|---|---|
| `btn-manager-check-continuity` | big | `tray.systems-continuity` | `continuity` | `SC` | continuity check |
| `btn-refresh-tray-systems` | small | `tray.systems-refresh` | `reset-view` | `SR` | refresh manager |
| `btn-manager-highlight` | small | `tray.systems-highlight` | `highlight` | `SH` | highlight selected system |
| `btn-manager-isolate` | small | `tray.systems-isolate` | `isolate` | `SI` | isolate selected system |
| `btn-manager-add-selection` | small | `tray.systems-add` | `system` | `SA` | add selection to system |
| `btn-manager-remove-selection` | small | `tray.systems-remove` | `SRM` | `tag-undo` | remove selection |
| `btn-manager-regenerate-sequence` | small | `tray.systems-regen` | `regen` | `SRG` | regenerate sequence |
| `btn-manager-rename` | small | `tray.systems-rename` | `metadata` | `SRN` | rename system |
| `btn-restore-all-deletions` | small | `tray.systems-restore` | `restore` | `SRS` | restore deletions |

### Group: Export

| Old id | Size | Command id | Icon | Keytip | Existing handler |
|---|---|---|---|---|---|
| `btn-export-tags` | small | `tray.export-mapping` | `export` | `SEM` | export tag mapping |
| `btn-export-tagged-ifc` | small | `tray.export-tagged-ifc` | `export` | `SET` | export tagged IFC |
| `btn-clear-continuity-colors` | small | `tray.systems-continuity-clear` | `color` | `SCC` | clear continuity colors |

---

## Tab: Edit (keytip: `E`)

Routing is in Edit (not a dedicated tab) because it is a secondary workflow.
R7 (≤ 2 clicks) is satisfied: switch to Edit → one more click per routing action.

### Group: Metadata

| Old id | Size | Command id | Icon | Keytip | Existing handler |
|---|---|---|---|---|---|
| `btn-stage-metadata` | big | `tray.meta-stage` | `metadata` | `EMS` | `safe-editor-panel.js` stage metadata |
| `btn-add-metadata-row` | small | `tray.meta-add-row` | `metadata` | `EMA` | add metadata row |
| `btn-copy-previous-metadata` | small | `tray.meta-copy-prev` | `metadata` | `EMC` | copy previous |

### Group: Edit

| Old id | Size | Command id | Icon | Keytip | Existing handler |
|---|---|---|---|---|---|
| `btn-stage-property-edit` | small | `tray.edit-stage-prop` | `metadata` | `EEP` | stage property change |
| `btn-stage-color-edit` | small | `tray.edit-stage-color` | `color` | `EEC` | stage color |
| `btn-clear-ifc-edits` | small | `tray.edit-clear` | `tag-undo` | `EEX` | clear pending edits |

### Group: Export

| Old id | Size | Command id | Icon | Keytip | Existing handler |
|---|---|---|---|---|---|
| `btn-export-edited-ifc` | big | `tray.edit-export-ifc` | `export` | `EEE` | export edited IFC |

### Group: Route

| Old id | Size | Command id | Icon | Keytip | Existing handler |
|---|---|---|---|---|---|
| `btn-build-routing-graph` | big | `tray.route-build` | `routing` | `ERB` | build routing graph |
| `btn-clear-routing-graph` | small | `tray.route-clear` | `tag-undo` | `ERC` | clear graph |
| `btn-route-start` | small | `tray.route-start` | `route-start` | `ERS` | set start node |
| `btn-route-end` | small | `tray.route-end` | `route-end` | `ERE` | set end node |
| `btn-calculate-route` | small | `tray.route-calc` | `routing` | `ERR` | calculate route |

---

## Contextual: Modify | Tray System (keytip: `CT`)

**Trigger:** `api.showContextual('modify-tray-system')` called in
`system-manager.js` when a tray system is selected.
**Dismiss:** `api.hideContextual()` called in `system-manager.js` when
selection clears.

### Group: Tray System Actions

Same adapter functions as the Systems tab entries — same handler reference,
independent button element.

| Command id | Size | Icon | Keytip | Existing handler |
|---|---|---|---|---|
| `tray.systems-highlight` | big | `highlight` | `CTH` | highlight system |
| `tray.systems-isolate` | big | `isolate` | `CTI` | isolate system |
| `tray.systems-continuity` | big | `continuity` | `CTC` | continuity check |

---

## Displays — stay in dock, never in RibbonDef

The following are **display widgets** (read-only state, lists, inputs that
belong in the properties dock). App branch must NOT add these to `RibbonDef`.

Left dock (`#sidebar`):
- `element-props-panel`, `multi-select-*`, `prop-*`, `prop-psets-container`

Right dock (`#excel-panel`):
- `loaded-models-container`, `loaded-models-list`
- Tray system manager subtree: list, filter/sort, components panel,
  continuity result body, deletions list
- `excel-data-table`, `excel-table-colgroup/header/body`
- `tag-validation-counts`, `tag-validation-issues` (validation results display)
- `batch-status`, `batch-preview-panel`, `batch-preview-list`
- `tray-selection-summary`, `tag-assignment-status`

Overlays (untouched):
- `tag-replace-dialog`, `loading-overlay`, `orbit-indicator`
