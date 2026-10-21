# Spec: Safe IFC Editor and Manual Metadata (Task 7.4)

## 1. Overview
Safe IFC Editor enables editing properties and appearance styles directly on IFC models without corrupting original geometric representations or breaking STEP file encoding.

## 2. Dependencies
- **Task 3.2 (`rust/ifc-io`)**: Low-level parsing and rewriting of IFC STEP physical files in Rust/Wasm.
- **Task 7.1 (`app/split-main-js`)**: Clean UI separation of model inspection, property editing dialogs, and export triggers.

## 3. Scope & Rules
1. **Non-destructive**: Edits never overwrite the original IFC file in-place; export always uses the `-edited.ifc` suffix convention (`editedIfcFileName`).
2. **Strict Property Whitelist**:
   - Only edits properties inside whitelisted sets (`BIM_TRACKER_EDIT` or `COSAPI_[A-Z0-9_]+`).
   - Standard value types supported: `IFCLABEL`, `IFCTEXT`, `IFCIDENTIFIER`, `IFCBOOLEAN`, `IFCINTEGER`, `IFCREAL`, `IFCDATE`, `IFCDATETIME`.
3. **Appearance Styling**:
   - Updates `IFCSTYLEDITEM` and `IFCSURFACESTYLE` to apply custom colors to IFC mapped representations safely.
4. **Wasm Bridge Contract (Target)**:
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

## 4. UI Integration
- In the tray viewer, when an element is selected, the Properties Panel allows adding or editing metadata fields.
- On "Export Edited IFC", `applySafeIfcEdits` generates the unified edited IFC download.
- Currently powered by `src/ifc/ifc-safe-editor.js`; once Task 3.2 is published, calls delegate to the Rust/Wasm implementation with exact binary parity.
