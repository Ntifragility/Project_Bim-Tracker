# viewer / viewport
Status: implemented
Branch: viewer/viewport        Owner folders: crates/viewport-core/, packages/viewer-core/, docs/specs/viewer/

## Goal
Migrate `viewport-core` from `packages/viewport-core` to `crates/viewport-core` with per-instance state handle support; cease tracking committed `pkg/*.wasm` artifacts; split generic viewer gestures from conduit-specific tool policies; and integrate auto-orbit management (with toggle/events) and surface-pick normal into the `viewer-core` interface.

## Public interface
### Rust `crates/viewport-core` (C API)
- `viewport_create() -> *mut Controller`: Allocate a new per-instance viewport controller handle.
- `viewport_destroy(handle: *mut Controller)`: Free a controller handle.
- `viewport_pointer_down_instance(handle, button, x, y, time_ms, shift) -> Decision`
- `viewport_pointer_move_instance(handle, x, y, time_ms, camera_dist, vp_height) -> Decision`
- `viewport_pointer_up_instance(handle, x, y, time_ms, camera_dist, vp_height) -> Decision`
- Backward-compatible global calls (`viewport_pointer_down`, `viewport_pointer_move`, `viewport_pointer_up`, `viewport_set_mode`, `viewport_self_test`).

### TypeScript `viewer-core` (`packages/viewer-core/src/engine.js`)
- `engine.autoOrbit`:
  - `start(speed?: number)`: Activate auto-orbit.
  - `stop()`: Deactivate auto-orbit.
  - `toggle(speed?: number)`: Toggle auto-orbit on/off.
  - `isActive(): boolean`: Return current state.
  - `onChange(callback: (active: boolean) => void)`: Subscribe to state changes (e.g. user canvas interaction deactivation).
- `engine.pick(ndc, { snap?: boolean })`: Returns `{ point, snapped, normal }` where `normal` is the surface normal transformed to world space.
- `engine.viewport`: Generic viewport gesture integration.

## Rules
- **R1: Repository Layout & Workspace:** `viewport-core` moves to `crates/viewport-core/` and is a member of the root Cargo workspace `[workspace.members = ["crates/*", "bindings/*"]]`.
- **R2: Clean Build Output:** `pkg/` build output is ignored by git; wasm files are not committed to git.
- **R3: Per-Instance State:** The controller supports multiple instances without thread-local collision, returning opaque handles.
- **R4: Gesture Decoupling:** Generic navigation (orbit, pan, truck, click detection) lives in `viewport-core` / `viewer-core`. Conduit-specific states (`preserve_rubberband`, conduit point placement) remain decisions passed or handled by the tool.
- **R5: Auto-Orbit Management:** Auto-orbit logic is housed in `viewer-core` rather than ad-hoc loops in apps. Apps only wire their UI badges/toggles.

## Acceptance criteria
- `crates/viewport-core` compiles cleanly with tests passing (`cargo test -p viewport-core` / self-test).
- `npm test` passes all tests.
- `npm run build` and `npm run build:conduit` build without error.
- Auto-orbit can be toggled and automatically stops on user canvas pointer interaction.
- Surface normal is returned correctly on raycast hit.

## Out of scope
- Full replacement of That Open camera-controls.
- Section planes and clipping tools (Task 6.3+).

## Parity reference
- `legacy/packages/viewport-core/`
- `legacy/conduit-takeoff/src/viewport-controls.js`
- `legacy/src/main.js` auto-orbit loop.
