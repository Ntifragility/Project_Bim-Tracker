# Review reference 12345

Keep these items for later discussion; do not remove them yet.

## Currently unused

- `sendMeasurementToExcel()` is exported but not called.
- The generic `addProjectTagsToIfc()` / `extractProjectTagsFromIfc()` workflow is not used by the live application.
- `src/assets/hero.png`, `src/assets/vite.svg`, and `src/assets/javascript.svg` are unreferenced.
- The local `public/web-ifc.wasm` and `public/web-ifc-mt.wasm` files are bypassed by the current remote WebIFC configuration.

## Limited practical value

- The Basic House sample does not demonstrate cable-tray routing or tagging.
- Auto-orbit is decorative and has no way to be restarted from the interface.
- Wireframe mode has limited value for the primary workflow.
- The dark-mode toggle may be unnecessary for an internal dark-first application.
- The `?ifc=` deep-link loader is primarily developer-facing.

## Useful but awkward or overlapping

- The live Excel bridge reconnects automatically without visible connection controls or status.
- The newer batch tag workflow overlaps with older manual tag controls.
- Workbook upload and the live Excel bridge provide two different Excel integration paths.
- Tag-system continuity checking depends on first building the routing graph, but that dependency is not obvious in the interface.

## Core capabilities to retain

- IFC loading and inspection.
- Batch tagging.
- Tagged IFC export.
- Mapping export.
- Tray-system management.
- Continuity diagnostics.
- Route calculation.
