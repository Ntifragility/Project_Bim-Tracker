# Camera pivot on selection (deferred to orbit-start)

## Goal

Clicking an element must never move the camera. The orbit pivot for the
selected element is stored on highlight and applied only when the user begins
a rotate gesture, so plain click selection is visually stable while the first
orbit drag still rotates around the selected element.

## Rules

1. **No camera mutation inside `onHighlight`.** The tray selection handler
   (`src/ui/selection.js`) and the conduit highlight binding
   (`conduit-takeoff/src/drawing-tool.js`) must not call `setOrbitPoint` (or
   any other camera move) while handling a highlight event. They store the
   selection center as a pending pivot and update only the pivot marker.
2. **Pivot applies on orbit-start only.** A single `controlstart` listener per
   app (same subscribe-once pattern as
   `packages/viewer-core/src/engine.js:445`) checks the started gesture via
   `controls.currentAction` against the camera-controls rotate bits
   (`ROTATE`, `TOUCH_ROTATE`, `TOUCH_DOLLY_ROTATE`, `TOUCH_ZOOM_ROTATE`). The
   pending pivot is applied with `setOrbitPoint` only for rotate gestures,
   then cleared; pan/truck/dolly starts leave it pending.
3. **Explicit Focus and placement gestures are unchanged.**
   `zoomToElementInModel` / `fitToSphere` (explicit Focus path), conduit
   `armPivot` (shift+middle user-placed pivot), the right-drag /
   shift+middle orbit branch in `handlePointerDown`, and `hidePivot`
   re-application on pointer-up keep their immediate `placePivot` behavior.
   `zoomToSelection` stays `false` in both apps.

## Acceptance

- Click 5 scattered elements: camera `position` delta is 0 and the orbit
  target is unchanged after every click (only the pending pivot updates).
- On the next rotate-gesture `controlstart`, `setOrbitPoint` fires exactly
  once with the last selection center; subsequent starts fire zero times.
- Non-rotate `controlstart` (truck/pan) fires zero `setOrbitPoint` calls and
  leaves the pending pivot intact.
- Headless verification: throwaway harnesses (mocked BoundingBoxer/controls)
  asserting store-on-click, apply-once-on-rotate, and scattered-click
  stability. Harnesses live in `/tmp`, not the repo.
