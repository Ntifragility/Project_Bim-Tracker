# viewer / perf-budget
Status: approved (spec written 2026-10-26; code todo)
Branch: spec/viewer-gaps        Owner folders: docs/specs/viewer/, packages/viewer-core/, spec/vectors/viewer/
From: `docs/covillaf-next.md` §Next ¶4 ("Frame cap, lower resolution while the camera moves, and a reload notice if the browser loses the WebGL context").

## Goal
Keep the viewer interactive on large plant models: cap frame rate, drop render resolution while the camera moves, and surface a reload notice (with one-click recovery) when the browser loses the WebGL context. Pure viewer policy; no product logic.

## Public interface (added to `viewer-core` engine)
```ts
engine.perf: {
  setFrameCap(fps: number | 0 /*0=uncapped*/): void
  setMoveDegrade(opts: { enabled: boolean, scale?: number /*0.25–1, default 0.5 */ }): void
  getStats(): { fps: number, degraded: boolean, contextLost: boolean }
  onContextLost(cb: () => void): () => void   // + default banner UI if container has [data-gl-notice]
}
```
- Context loss: listen `webglcontextlost` on the renderer canvas → `preventDefault()`, show notice, `onContextLost` fire; `webglcontextrestored` → re-init render targets, hide notice, resume loop.

## Rules
- **R1:** Defaults: cap 60, degrade on, scale 0.5. Degrade restores full res ≤300 ms after camera idle.
- **R2:** Degrade never drops picking: `pick()` always raycasts at full-res depth (re-render pick pass if degraded).
- **R3:** Stats are best-effort (EMA over 30 frames); never gate logic on exact fps in tests — assert degrade on/off transitions + notice visibility.
- **R4:** Stock-first: check That Open / Three `setPixelRatio`, `setSize`, `powerPreference`, existing context handlers before custom code (ARCH §5).

## Acceptance criteria (vectors: `spec/vectors/viewer/perf.json`, headless-safe math)
| Case | Check |
|---|---|
| cap-60 | `setFrameCap(60)` → two rAF within <33 ms coalesce to 1 render |
| degrade-on-move | camera start → `degraded=true`, pixelRatio == base×0.5; idle 300 ms → `degraded=false` |
| pick-while-degraded | `pick()` hit accuracy unchanged vs full-res (same NDC → same element) |
| context-lost | dispatch `webglcontextlost` → notice visible + cb fired; `restored` → notice hidden, loop resumes |

## Out of scope
- PNG export (done, `view-export-png.md`), section planes (done), auto-orbit.
- Real GPU bench in CI — vectors assert policy transitions, not frame times.

## Parity reference
- New feature track (D5/Phase B); no legacy counterpart. Baseline: current `engine.js` has no perf API (verified 2026-10-26: no `frameCap|low-res|webglcontextlost` in `packages/viewer-core/src/`).

## Open questions — none (defaults are the spec; tune in code PR).
