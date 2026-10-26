# tray / safe-ifc-editor: Safe IFC Editor and manual metadata (task 7.4)

Status: approved (owner D-rulings 2026-10-25; finalized 2026-10-26 on spec/safe-editor-final)
Branch: `app/safe-ifc-editor`
Owner rulings applied: **D6** 7.1 done (merged PR #32 — Properties Panel lives at `src/ui/properties-panel.js`, Q1 closed); **D7a** 8.1 gate waits for 7.4 (Q3 closed); colour-entity allocation **stays TS-side permanently** (Q2 closed — `jsOnly` boundary, matches `takeoff-io.md` R7 + closeout §C).
Owner folders: `src/ifc/ifc-safe-editor.*` + its UI modules (never `src/main.js`),
`docs/specs/tray/`

## 1. Overview

Safe IFC Editor enables editing properties and appearance styles directly on
IFC models without corrupting original geometric representations or breaking
STEP file encoding. Ported last: it reuses `ifc-io` (3.2) and must wait for
7.1 (UI separation) — the Properties Panel and export triggers must be clean
modules before this wires into them.

## 2. Dependencies

- **Task 3.2 (`rust/ifc-io`)**: STEP primitives (`escape_step`,
  `entity_ids`, `find_data_terminator`), export naming (`edited_name`),
  typed-value table (`format_typed_value`, `is_writable_pset`). All
  implemented and tested in `crates/ifc-io/src/{step,naming,value}.rs`.
- **Task 7.1 (`app/split-main-js`)**: properties-panel, safe-editor panel,
  model loader as separate modules under `src/ui/`.
  **Settled 2026-10-26: 7.1 done (PR #32 merged, `src/main.js` 153 lines, `src/ui/properties-panel.js` ~620 lines, D6).**
- **Task 5.1 (`tray-tagging`)**: assignment state + validator feed the editor's
  integrity checks; editor never reimplements them.

## 3. Scope & Rules

1. **Non-destructive**: edits never overwrite the original IFC file in-place;
   export always uses the `-edited.ifc` suffix convention (`edited_name` in
   `ifc-io`, legacy `editedIfcFileName` parity: `*.ifc` → `*_edited.ifc`,
   anything else appends; default `model.ifc`).
2. **Strict property whitelist**:
   - Only NEW properties inside whitelisted sets (`BIM_TRACKER_EDIT` or
     `COSAPI_[A-Z0-9_]+`, case-insensitive — `is_writable_pset` parity).
     Updates to EXISTING properties are allowed in any pset.
   - Typed values per `format_typed_value` parity: `IFCLABEL`, `IFCTEXT`,
     `IFCIDENTIFIER`, `IFCBOOLEAN`, `IFCINTEGER`, `IFCREAL`, `IFCDATE`,
     `IFCDATETIME`. Unknown type → `Err`, never a panic.
3. **Appearance styling**: updates `IFCSTYLEDITEM` / `IFCSURFACESTYLE` chains to
   apply custom colours to mapped representations safely (direct items and
   `IfcMappedItem` sources). Colour/style entity-id allocation stays TS-side
   (`jsOnly` boundary); the colour *plan* (hex validation, transparency clamp)
   follows `ifc-io` value-table rules.
4. **Wasm bridge contract (target)** — `ifc-io` Wasm exposes text-plan
   functions; TS applies the splice (STEP full-text rendering stays TS-side):
   ```ts
   interface PropertyEdit {
     expressId: number;
     propertySetName: string;
     propertyName: string;
     value: string | number | boolean;
     valueType: string;
   }

   interface AppearanceEdit {
     expressId: number;
     colorHex: string;
   }

    function applySafeEdits(
      sourceBytes: Uint8Array,
      edits: { propertyEdits?: PropertyEdit[]; colorEdits?: AppearanceEdit[] }
    ): { bytes: Uint8Array; applied: number[]; skipped: number[] };
    ```
   Until `ifc-io` Wasm reaches binary parity, calls delegate to the current TS
   implementation `applySafeIfcEdits` in `src/ifc/ifc-safe-editor.js`.

## 4. UI integration

- In the tray viewer, when an element is selected, the Properties Panel allows
  adding or editing metadata fields (whitelist + type table enforced; rejected
  edits explain why, they never silently drop).
- On "Export Edited IFC", the editor generates the unified edited IFC download
  (`-edited.ifc` suffix, source file byte-identical).
- Geometry is never touched: only `IFCPROPERTYSINGLEVALUE` values and style
  chains change; representation items keep their entity ids.

## 5. Acceptance criteria

| Input / Action | Expected result |
|---|---|
| Edit an existing property value | new value in the correct pset, valid STEP, geometry unchanged |
| Add a property to `BIM_TRACKER_EDIT` / `COSAPI_*` | created, typed correctly (`IfcLabel(.T.)` etc. per value table) |
| Add a property to any other pset | rejected with whitelist error |
| Set an appearance colour | direct + mapped items recoloured, items restorable |
| Export | file named `*_edited.ifc`, source file byte-identical |
| `npm test` + `npm run build` | green |

## 6. Parity reference

- `legacy/src/ifc/ifc-safe-editor.js` (383 lines: `decodeIfc`,
  `escapeStepString`/`unescapeStepString`, `findDataTerminator`,
  `entityIndex`, `parsePropertyModel`, `formatTypedValue`,
  `shapeItemsForElement` incl. `IfcMappedItem` walk, `updateExistingStyles`,
  `editedIfcFileName`, `applySafeIfcEdits`).
- `crates/ifc-io` (plan side): `step`, `naming.edited_name`, `value`
  (`format_typed_value`, `is_writable_pset`); vectors `spec/vectors/ifc/
  {step,naming,value}.json`.

## 7. Open questions — resolved by owner 2026-10-25
1. 7.1 done (PR #32 merged) — Properties Panel at `src/ui/properties-panel.js` confirmed. CLOSED.
2. Colour-entity allocation stays TS-side permanently (`jsOnly`). CLOSED.
3. 8.1 gate waits for 7.4 (D7a). CLOSED.
