# tray / split-main-js
Status: implemented
Branch: app/split-main-js        Owner folders: src/ui/, src/main.js, docs/specs/tray/

## Goal
Deconstruct the monolithic `src/main.js` (4,600+ lines) into modular UI feature components under `src/ui/`, each responsible for a distinct interaction domain (model loading, property inspection, tagging, system management, excel linkage, safe editor, context menu), while keeping `src/main.js` as a concise app bootstrap orchestrator.

## Feature Modules
1. **`src/ui/state.js`**: Centralized reactive state store for active models, loaded models list, selection maps, Excel data, color mappings, and pending edits.
2. **`src/ui/model-loader.js`**: Handles file inputs, drag-and-drop, sample model loading, deep-link (`?ifc=`), and loading progress display.
3. **`src/ui/properties-panel.js`**: Extracts IFC attributes, properties, and relations, rendering them in the inspector table with category formatting.
4. **`src/ui/context-menu.js`**: Right-click canvas context menu (focus, isolate, hide, appearance color, show all).
5. **`src/ui/excel-panel.js`**: Excel file import, sheet selection, column mapping, and linkage validation.
6. **`src/ui/tagging-panel.js`**: Batch tag assignment, element classification, and scheme sequence allocation.
7. **`src/ui/system-manager.js`**: Tray system grouping, appearance colors, tag register view, and summary generation.

## Rules
- **R1: Zero Regressions:** UI DOM element IDs, event handlers, and user flows behave identically to legacy `src/main.js`.
- **R2: Clean Separation:** Feature modules do not create duplicate engine instances; they receive the shared engine and state.
- **R3: Test & Build Integrity:** `npm test` and `npm run build` must continue to pass without error.

## Acceptance criteria
- `src/main.js` is reduced from 4,600+ lines to a clean coordinator.
- All 89 tests pass under `npm test`.
- `npm run build` (tray viewer) and `npm run build:conduit` build cleanly.
