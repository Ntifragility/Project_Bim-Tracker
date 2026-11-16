# viewer / revizto-tools

Status: implemented (branch `viewer/revizto-visibility`)
Owner folders: `packages/viewer-core/`, `packages/ribbon-chrome/`, `src/ui/`, `conduit-takeoff/src/`

## Goal
Deliver Revizto-parity 3D viewport inspection tools (`HIDE <-> UNHIDE`, `ISOLATE <-> UNISOLATE`, `SECTION / CUT <-> UNCUT` with Plane & Box modes, and the 5-mode `RULER` with live unit & color switching) uniformly across both Tray Viewer and Conduit Takeoff, including first-class support for drawn 3D conduit runs.

## Public Interfaces (`packages/viewer-core`)
- **`engine.visibility`** (`visibility-controller.js`)
  - `hideSelection(targetMap?): Promise<number>`
  - `unhideAll(): Promise<void>`
  - `getHiddenCount(): number`
  - `getHiddenElements(): Record<string, number[]>`
  - `registerExternalAdapter(id, adapter)` / `notifySelectionChange()`
  - `onVisibilityChange(cb)` / `onStateChange(cb)` / `getState()`
- **`engine.isolation`** (`visibility-controller.js` composer)
  - `isolate(targetMap?, { mode?: 'hard' | 'ghost' }): Promise<void>`
  - `hardIsolate(targetMap?): Promise<void>`
  - `ghostIsolate(targetMap?): Promise<void>`
  - `setIsolationMode('hard' | 'ghost'): Promise<void>`
  - `unisolate(): Promise<void>` / `resetIsolation(): Promise<void>`
  - `isIsolationActive(): boolean` / `isGhostActive(): boolean`
- **`engine.section`** (`section-controller.js`)
  - `setMode('plane' | 'box')`, `toggleCut(preferredMode?)`, `activate()`, `uncut()`, `clear()`, `newCut(targetMap?)`, `cutPreset('top' | 'bottom' | 'front' | 'back' | 'left' | 'right')`, `cutAtNdc(ndc)`, `flipActivePlane()`, `setGizmoVisible(bool)`, `getActivePlanes()`, `getState()`, `onStateChange(cb)`
  - `registerClippedObject(obj3d)` / `unregisterClippedObject(obj3d)`
- **`engine.ruler`** (`ruler-controller.js` + `min-distance-solver.js`)
  - `activate(mode?)`, `deactivate()`, `toggle(mode?)`, `setMode('laser' | 'p2p' | 'min-distance' | 'elevation' | 'angle')`, `setVariant('regular' | 'chain')`, `setUnit('m' | 'mm' | 'cm' | 'ft' | 'in' | 'ft-in')`, `setColor(hex)`, `setShowAxes(bool)`, `startNew()`, `cancelPending()`, `deleteMeasurement(id)`, `clearAll()`, `getMeasurements()`, `getState()`, `onStateChange(cb)`
  - `registerPickSource(obj3d, resolver?)`

## Rules
- **R1 (Visibility Composition):** `visible(id) = (!isolationActive || ghost || inIsolated) && !inHidden`. `Hide`/`Unhide` and `Isolate`/`Unisolate` compose without clobbering each other.
- **R2 (Conduit Parity):** Drawn conduit runs registered via external adapters participate in Hide, Isolate (Hard & Ghost), Section clipping planes, Ruler snapping, and Min-Distance clearance checks alongside IFC elements.
- **R3 (Unmodified That Open):** Uses `@thatopen/components` `Clipper`, `Hider`, `BoundingBoxer` without patching library code (`localClippingPlanes = true` keeps section boxes, handles, and ruler visuals unclipped).
- **R4 (Section Pick Filtering):** `engine.pick(ndc, opts)` rejects geometry clipped by any active Section Plane or Section Box plane.
- **R5 (Camera & Pointer Precedence):** Section handle drags claim the pointer cleanly; active Ruler leaves orbit/pan/zoom intact while pausing Conduit Trace clicks; `Esc` steps back cleanly without discarding sticky views.
