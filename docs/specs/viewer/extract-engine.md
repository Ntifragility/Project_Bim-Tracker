# viewer / extract-engine
Status: implemented
Branch: viewer/extract-engine        Owner folders: packages/viewer-core/, docs/specs/viewer/

## Goal
Extract the That Open viewer engine, coordinate frame conversion, and the web-ifc/fragments Vite asset plugin from `src/covillaf/` into `packages/viewer-core/` with 100% unchanged behavior; eliminate the `@covillaf` path alias in favour of workspace package `viewer-core`.

## Public interface
Exported from `viewer-core` (`packages/viewer-core/src/index.js`):
- `createCovillafEngine(container, options)` (and `createEngine(container, options)`)
- `createCoordinateFrame(fragments)`
- `appearanceStyleName(color)`

Exported from `viewer-core/vite-plugin` (`packages/viewer-core/src/vite-plugin.js`):
- `covillafWebIfc(options)` (and `viewerCoreWebIfc(options)`)

## Rules
- **R1: Behavioral Parity:** Scene initialization, IFC loader setup (`COORDINATE_TO_ORIGIN: true`, WASM path `/covillaf/web-ifc/`), fragments worker setup, raycasting with snapping and face normal calculation, selection highlighting, and appearance group coloring match `legacy/src/covillaf/engine.js` exactly.
- **R2: Coordinate Conversion:** Coordinate frame math (`toOriginal`, `toScene`) matches `legacy/src/covillaf/coordinates.js` exactly, converting between Z-up IFC original coords and Y-up Three.js scene coordinates using fragments `baseCoordinationMatrix`.
- **R3: Vite Asset Serving & Packaging:** The Vite plugin handles dev-server middleware for `/covillaf/web-ifc/*` and `/covillaf/fragments/worker.mjs`, and copies assets to the build output directory on `closeBundle`.
- **R4: Alias Removal:** Remove `@covillaf` alias from `conduit-takeoff/vite.config.js`. Both apps (`src/main.js` and `conduit-takeoff/src/main.js`) import directly from `viewer-core`.
- **R5: Dependency Boundaries:** `packages/viewer-core` depends only on `@thatopen/components`, `@thatopen/components-front`, `@thatopen/fragments`, `web-ifc`, and `three`. It does not import any product cores (`conduit-core`, `routing-core`, `tray-*`) or app UI code.

## Acceptance criteria
| Input / Action | Expected Result |
|---|---|
| Import `createCovillafEngine` from `viewer-core` in `src/main.js` | Resolves successfully, types/functions match legacy |
| Import `createCovillafEngine` from `viewer-core` in `conduit-takeoff/src/main.js` | Resolves successfully without `@covillaf` alias |
| `npm run build` | Builds `dist/` with tray viewer bundle and copied `/covillaf/` assets |
| `npm run build:conduit` | Builds `conduit-takeoff/dist/` with conduit bundle and copied `/covillaf/` assets |
| `npm test` | All 84 existing tests pass |

## Out of scope
- `viewport-core` Rust migration to `crates/` (Task 6.1b).
- Gesture splitting and auto-orbit toggle (Task 6.1b).
- Phase B viewer improvements (section planes, ghost isolate, undo, PNG export) (Tasks 6.3+).

## Parity reference
- `legacy/src/covillaf/engine.js`
- `legacy/src/covillaf/coordinates.js`
- `legacy/vite.config.js`
- `legacy/conduit-takeoff/vite.config.js`

## Open questions / [UNVERIFIED] items
- None.
