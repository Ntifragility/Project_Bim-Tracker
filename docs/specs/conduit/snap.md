# conduit-core / snap engine (task 4.2)

Status: draft
Branch: `rust/conduit-snap`
Owner folders: `crates/conduit-core/` (snap module only), `spec/vectors/conduit/snap-engine.json`, `docs/specs/conduit/`, `scripts/run-conduit-snap-vectors.mjs`

## Goal

Port the pure snap engine to Rust: node/segment/midpoint snapping, polar
angle guides, 3-axis ortho lock, elevation-plane raycast, and the
`SnapEngine.resolve` priority chain — minus class state (an explicit
`SnapConfig` struct instead). `findSnap` (network-bound, 4.1) is reused,
not re-ported.

## Public interface

All types plain data (`f64` metres); all functions pure (no I/O, no
globals, no randomness). `geom-core` owns the vector math; this module
owns snap decisions.

```rust
// snap
pub enum SnapType { Endpoint, Midpoint, Segment, PolarAngle, Ortho, Workplane }
pub struct SnapCandidate { pub point: [f64; 3], pub snap_type: SnapType, pub distance: f64, pub target_id: Option<String>, pub angle_deg: Option<f64>, pub guide_axis: Option<char>, pub t: Option<f64> }
pub struct SnapNode { pub id: String, pub point: [f64; 3] }
pub struct SnapSegment { pub id: String, pub start: [f64; 3], pub end: [f64; 3] }
pub struct SnapConfig { pub tolerance_m: f64, pub angular_tolerance_deg: f64, pub up_axis_y: bool, pub polar_enabled: bool, pub ortho_enabled: bool, pub endpoint_enabled: bool, pub midpoint_enabled: bool, pub segment_enabled: bool, pub allowed_polar_angles: Vec<f64> }
impl Default for SnapConfig { ... }  // tolerance 0.25, angular 4.5, Y-up, polar on, ortho off, angles [0,45,...,315]
pub fn snap_to_nodes(query: [f64; 3], nodes: &[SnapNode], tol: f64) -> Option<SnapCandidate>
pub fn snap_to_segments(query: [f64; 3], segments: &[SnapSegment], tol: f64, mid_thresh: f64) -> Option<SnapCandidate>
pub fn snap_polar_angle(from: [f64; 3], to: [f64; 3], allowed: &[f64], tol_deg: f64, up_axis_y: bool) -> Option<SnapCandidate>
pub fn snap_ortho_3d(from: [f64; 3], to: [f64; 3]) -> SnapCandidate
pub fn raycast_elevation_plane(origin: [f64; 3], dir: [f64; 3], elevation: f64, up_axis_y: bool, last: Option<[f64; 3]>) -> [f64; 3]
pub fn resolve(raw: [f64; 3], cfg: &SnapConfig, last: Option<[f64; 3]>, nodes: &[SnapNode], segments: &[SnapSegment]) -> SnapCandidate
```

## Rules

R1: Metres everywhere; tolerances in metres, angles in degrees.
R2: Priority (legacy `SnapEngine.resolve` parity): endpoint > segment-or-
midpoint (each gated by its own enable flag) > ortho (only if enabled AND
`last` exists) > polar (only if enabled AND `last` exists) > workplane raw
(distance 0).
R3: `snap_to_nodes`: nearest node with `d <= tol`; ties keep the first
scanned (legacy `<= minDistance` parity).
R4: `snap_to_segments`: nearest hit with `d <= tol` and `0.02 < t < 0.98`
(endpoints belong to node snap); `|t - 0.5| <= mid_thresh` (default 0.08)
→ midpoint at the exact segment middle, `t = 0.5`, distance recomputed to
the middle; otherwise the projection point with its `t` (legacy parity).
R5: `snap_polar_angle`: plan projection uses Y-up (`x/z`) or Z-up (`x/y`)
by flag; `radial < 0.05` → `None`; angle normalized to `[0, 360)`;
nearest allowed angle within `tol_deg` wins, ties keep the first allowed
(`<= minDiff` scan parity); re-project along the snapped ray at the same
radial distance; `guideAxis` is `X` for 0/180, the up axis for 90/270,
else none (legacy parity).
R6: `snap_ortho_3d`: dominant axis wins; ties resolve Y first, then X,
then Z (legacy `max === absY / absX / else` chain parity).
R7: `raycast_elevation_plane`: `|dir_h| > 1e-7` and `t > 0` → plane hit
with the height pinned to `elevation`; else horizon fallback at
`max(5, dist(origin, last))` or `10.0`, height pinned (legacy parity).
R8: `resolve` with `last = None` skips ortho/polar even when enabled;
empty nodes/segments skip their stages (legacy parity).

## Acceptance criteria

Stored as `spec/vectors/conduit/snap-engine.json`, run against legacy JS
via `node scripts/run-conduit-snap-vectors.mjs` and against this crate
via `cargo test`:

| Area | Cases | Covers |
|---|---|---|
| nodes | 2 | hit n1 (endpoint + point), miss → null |
| segments | 2 | midpoint (t→0.5, middle point), plain segment |
| closest | 3 | midpoint projection, clamped start, clamped end |
| polar | 3 | 44°→45 (Y-up), 30° rejected, tolerance edge |
| ortho | 3 | X/Y/Z dominant wins (incl. tie order) |
| raycast | 3 | plane hit, horizon fallback, Z-up axis |
| resolve | 5 | endpoint wins, midpoint wins, polar fallback, workplane raw, ortho-when-enabled |
| config | 1 | default values |

~22 cases total. Reuses `snap.json` expectations where functions overlap
(vec3 cases already live in `geom-core`; not duplicated here).

## Out of scope

- `findSnap` network binding (4.1, `snap.js` — delegates here).
- Elevation picking from live camera input (conduit app, TS-side).
- Marker rendering / rubber-band overlay (viewer-core / conduit app).

## Parity reference

- `legacy/packages/conduit-core/src/snap-engine.js` (360 lines).
- `legacy/packages/conduit-core/test/snap-engine.test.js` (8 tests).
- Vectors: `spec/vectors/conduit/snap.json` (22 cases; vec3 + closest
subsets already ported to `geom-core` in 3.1).

## Open questions

None. Priority order + tolerances are pinned data from the legacy engine.
