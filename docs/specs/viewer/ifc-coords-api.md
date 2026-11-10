# viewer / ifc-coords-api
Status: approved (spec written 2026-10-26; code todo)
Branch: spec/viewer-gaps        Owner folders: docs/specs/viewer/, packages/viewer-core/, spec/vectors/viewer/
From: `docs/covillaf-next.md` §After ¶3 ("Lengths and positions in IFC coordinates (Z-up, double precision), converted to the scene only when drawing").

## Goal
Publish IFC-coordinate (Z-up, f64 metres, original placement chain) positions/lengths in the `viewer-core` public API. Scene conversion (Y-up, origin-shifted) happens only at draw time. This is the contract the Rust cores already assume (D4); the viewer finally exposes it.

## Public interface (extends existing `coordinates.js`)
```ts
engine.coordinates: {
  toScene(original: Vec3) => Vec3            // exists — keep
  toOriginal(scene: Vec3) => Vec3            // exists — keep
  lengthOriginal(a: Vec3_scene, b: Vec3_scene): number   // metres, via toOriginal both ends
  formatIfc(p: Vec3_orig): { x, y, z }       // f64 passthrough + fixed-3 display helper
  frame(): { up: 'Z', units: 'm', originShift: Vec3 }   // self-describing, assertable in tests
}
```
- `originShift` = the first-file offset the page applies today (kept, now explicit and readable).

## Rules
- **R1:** IFC Z-up f64 is canonical (D4/ARCH §3). `toScene`/`toOriginal` are exact inverses (roundtrip ≤1e-9 m — already smoke-tested).
- **R2:** `pick()` results gain an `original` field (`{point_scene, point_original}`) without breaking the existing `{point, snapped, normal}` shape.
- **R3:** No product imports: coordinates stay in `viewer-core`, frame owned by it (ARCH rule 6).
- **R4:** Display rounding only in `formatIfc`; all stored/passed values stay f64.

## Acceptance criteria (extends existing smoke tests + `spec/vectors/viewer/ifc-coords.json`)
| Case | Check |
|---|---|
| roundtrip | existing `createCoordinateFrame` test keeps passing (≤1e-9 m) |
| length | `lengthOriginal` on a 10 ft stick scene pair → 3.048 m ±1e-6 |
| frame-self-desc | `frame()` → `{up:'Z', units:'m', originShift:[x,y,z]}` |
| pick-original | `pick()` returns `original` consistent with `toOriginal(point)` |

## Out of scope
- Changing the origin-shift behavior itself (kept, just explicit).
- Rust-side changes (cores already Z-up; this is the viewer catching up).

## Parity reference
- Existing: `packages/viewer-core/src/coordinates.js` (`toScene`/`toOriginal`), smoke test `createCoordinateFrame roundtrips` (passing).
- New: `lengthOriginal`, `formatIfc`, `frame()`, `pick().original`.

## Open questions — none.
