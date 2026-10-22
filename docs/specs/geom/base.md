# geom-core / base geometry (task 3.1)

Status: draft
Branch: `rust/geom-core`
Owner folders: `crates/geom-core/`, `spec/vectors/geom/`, `docs/specs/geom/`, `scripts/run-geom-vectors.mjs`

## Goal

Provide the single pure-Rust home for every geometric primitive the product
cores share: 3D vectors, segment queries, unit conversion, and the
scene <-> IFC coordinate frame. Tray 2.2 and conduit 2.1 duplicated
`vec3`/`closestPointOnSegment`/unit helpers; this crate deduplicates them
(owner-approved cleanup, see conduit `vectors.md` Q2 and tray `vectors.md` Q2).

## Public interface

All types are plain data (`f64` metres, IFC Z-up); all functions are pure
(no I/O, no globals, no panics on expected errors — `Result` instead).

```rust
// vec3
pub struct Vec3 { pub x: f64, pub y: f64, pub z: f64 }
pub fn add(a: Vec3, b: Vec3) -> Vec3
pub fn sub(a: Vec3, b: Vec3) -> Vec3
pub fn scale(a: Vec3, s: f64) -> Vec3
pub fn dot(a: Vec3, b: Vec3) -> f64
pub fn cross(a: Vec3, b: Vec3) -> Vec3
pub fn length(a: Vec3) -> f64
pub fn length_sq(a: Vec3) -> f64
pub fn distance(a: Vec3, b: Vec3) -> f64
pub fn normalize(a: Vec3) -> Vec3        // zero/degenerate -> ZERO
pub fn mean(points: &[Vec3]) -> Vec3    // empty -> ZERO
// segment
pub struct ClosestPoint { pub point: Vec3, pub t: f64, pub distance: f64 }
pub fn closest_on_segment(p: Vec3, a: Vec3, b: Vec3) -> ClosestPoint
pub fn angle_between(a: Vec3, b: Vec3) -> f64        // degrees, 0..180
pub fn constrain_ortho(from: Vec3, to: Vec3, plan_angle_deg: f64) -> Vec3
pub fn plan_angle_of(a: Vec3, b: Vec3) -> f64        // degrees, about Z
pub fn is_vertical(a: Vec3, b: Vec3, tolerance_deg: f64) -> bool
// units
pub enum Unit { Metre, Meter, Millimetre, Millimeter, Centimetre, Centimeter, Foot, Inch }
pub fn resolve_unit(name: &str) -> Option<Unit>     // IFC spellings, dotted/case-insensitive
pub fn convert_length(value: f64, from: Unit, to: Unit) -> f64
pub fn from_metres(value_m: f64, to: Unit) -> f64
pub fn to_metres(value: f64, from: Unit) -> f64
pub const DEFAULT_STICK_LENGTH_M: f64 = 3.048;      // 10 ft
pub const MIN_SEGMENT_LENGTH_M: f64 = 0.001;        // 1 mm
pub const VERTEX_MERGE_TOLERANCE_M: f64 = 0.001;    // 1 mm
// frames
pub struct Mat4 { pub m: [f64; 16] }                // row-major; identity = no shift
pub fn to_scene(original: Vec3, base: &Mat4) -> Vec3
pub fn to_original(scene: Vec3, base: &Mat4) -> Option<Vec3>  // None when base is singular
```

## Rules

R1: Metres internally, always. Imperial values (10 ft sticks, NEC inches,
trade-size strings, IFC unit spellings) convert at the TS/wasm edge.
R2: IFC frame is Z-up `f64`; the Three.js scene frame (Y-up, origin-shifted)
conversion is a pure `Mat4` multiply here — Three.js itself stays TS-side.
R3: `normalize` returns `ZERO` for zero/degenerate input (legacy parity:
routing `vector.js` uses `magnitude > 0`; conduit `snap-engine.js` and
`fitting-solver.js` use `len > 1e-7` — all three map sub-epsilon to zero).
R4: `closest_on_segment` clamps `t` to `0..1`; a degenerate segment
(`a == b`) returns `t = 0`, `point = a` (legacy `geometry.js:22-28` parity).
R5: `angle_between` clamps the cosine to `[-1, 1]` and returns `0.0` when
either input is zero-length (legacy `geometry.js:13-19` parity).
R6: `constrain_ortho` keeps the dominant axis; ties resolve to X then Z
(`indexOf(max)` parity, legacy `geometry.js:35-46`). A rotated plan grid
(`plan_angle_deg != 0`) rotates the displacement into grid axes, constrains,
then rotates back. Vertical wins return `{from.x, from.y, to.z}`.
R7: `plan_angle_of` returns `atan2(dy, dx)` in degrees, `0.0` when the plan
projection is below `1e-9` m (legacy `geometry.js:49-53` parity).
R8: `is_vertical` is `|dz| / len >= cos(tolerance_deg)` in degrees, `false`
for zero-length segments (legacy `geometry.js:56-61` parity).
R9: `resolve_unit` strips dots/whitespace, upper-cases, then matches exactly;
failing that, it substring-matches (`".MILLI.METRE."` -> `MILLIMETRE`);
anything else -> `None` (legacy `coordinate-utils.js:8-19` parity).
`convert_length` between identical units is the identity; unknown units are a
`Result::Err`, never a panic.
R10: `to_scene` / `to_original` compose the coordination base matrix with the
axis swap `(x, y, z)_ifc = (x, -z, y)_three` (legacy `coordinates.js`
parity, verified against real three.js r184). `to_original` inverts `base`
(Gauss-Jordan); a singular matrix returns `None`.

## Acceptance criteria

Stored as `spec/vectors/geom/*.json`, run against legacy JS via
`node scripts/run-geom-vectors.mjs` and against this crate via `cargo test`:

| File | Cases | Covers |
|---|---|---|
| `spec/vectors/geom/vec.json` | 24 | add/sub/scale/dot/cross/length/length_sq/distance/normalize (incl. zero + sub-epsilon)/mean (incl. empty)/closest_on_segment (incl. clamped ends + degenerate) |
| `spec/vectors/geom/segment.json` | 12 | angle_between (90°, 180°, same, zero-vector)/constrain_ortho (X/Y/Z wins, XY tie -> X, rotated grid, takeoff parity)/plan_angle_of/is_vertical (incl. degenerate) |
| `spec/vectors/geom/units.json` | 10 | UNIT_TABLE factors/resolve (standard, dotted, case-insensitive, unknown)/convert (m<->ft, mm<->in, identity)/from/to_metres (10 ft round-trip) |
| `spec/vectors/geom/frames.json` | 8 | to_scene/to_original with identity base, translated base, axis-swap checks, round-trips, singular base |

54 cases total.

## Out of scope

- Snap priority, polar angles, ortho 3-axis UI choice, elevation raycast
(`conduit-core` snap module, task 4.2 — this crate only owns the segment primitive).
- `sizeToMillimetres` trade-size parsing (conduit registry seed, task 4.1/4.4).
- `DEFAULT_DIAMETERS` list and registry selection state (conduit registry, task 4.1).
- `formatLength`/`formatFileSize` presentation formatting (TS-only, pinned in conduit `units.json`).
- PCA centerline, graph clustering, Dijkstra (tray-routing, task 5.2 — they consume `mean`/`dot` from here).
- NEC bend tables and elbow fillets (conduit fitting, task 4.3 — they consume `cross`/`normalize` from here).
- Live `three.js` Matrix4 I/O, `fragments.baseCoordinationMatrix` access, extractor vertex reads (TS adapters).

## Parity reference

- `legacy/packages/routing-core/src/vector.js` + `legacy/packages/routing-core/test/routing-core.test.js` (vec cases).
- `legacy/packages/conduit-core/src/geometry.js` + `legacy/packages/conduit-core/test/conduit-core.test.js` (segment cases).
- `legacy/packages/conduit-core/src/snap-engine.js` `vec3` (normalize epsilon, `closestPointOnSegment` degenerate guard), `legacy/packages/conduit-core/src/fitting-solver.js` `v3` (cross, normalize).
- `legacy/packages/conduit-core/src/coordinate-utils.js` + `config.js` (`UNIT_TABLE`, constants) + `legacy/packages/conduit-core/test/coordinate-utils.test.js` (unit cases; format/size cases stay TS-only).
- `legacy/src/covillaf/coordinates.js` (frame mapping; verified numerically against three.js r184).

## Open questions

None. GUID determinism (owner-approved 2026-10-22) belongs to `ifc-io` (3.2), not here.
