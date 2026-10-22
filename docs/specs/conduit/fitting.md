# conduit-core / fitting solver (task 4.3)

Status: draft
Branch: `rust/conduit-fitting`
Owner folders: `crates/conduit-core/` (fitting module only), `spec/vectors/conduit/fitting-engine.json`, `docs/specs/conduit/`, `scripts/run-conduit-fitting-vectors.mjs`

## Goal

Port the pure NEC fitting solver to Rust: the Chapter 9 Table 2 bend
radius table, bend-angle computation, smooth arc elbow fillets, run-bend
analysis (NEC 360° rule), and the auto-riser solver. Vec math delegates
to `geom-core`.

## Public interface

All types plain data (radii `f64` metres, angles degrees); all functions
pure. Trade-size strings are edge input — lookup accepts the same
spellings the legacy table matches; numeric mm queries find the closest
row.

```rust
// fitting
pub struct NecBendRow { pub trade_size: &'static str, pub label: &'static str, pub mm: f64, pub radius_in: f64, pub radius_m: f64 }
pub const NEC_BEND_TABLE: [NecBendRow; 10]
pub fn nec_bend_radius_m(query: &NecQuery) -> f64
pub enum NecQuery { TradeSize(String), Mm(f64) }
pub fn bend_angle(p1: Vec3, corner: Vec3, p2: Vec3) -> f64   // 0..180
pub struct ElbowSolution { pub valid: bool, pub straight: bool, pub angle_deg: f64, pub radius_m: f64, pub tangent_dist: f64, pub tangent_start: Vec3, pub tangent_end: Vec3, pub center: Vec3, pub arc_points: Vec<Vec3> }
pub fn solve_elbow(p1: Vec3, corner: Vec3, p2: Vec3, radius_m: f64, arc_segments: usize) -> ElbowSolution
pub struct BendInfo { pub index: usize, pub angle_deg: f64, pub quarter_bend: bool }
pub struct RunBends { pub total_deg: f64, pub fittings: usize, pub exceeds_nec360: bool, pub bends: Vec<BendInfo> }
pub fn analyze_run_bends(points: &[Vec3]) -> RunBends
pub struct RiserNode { pub point: Vec3, pub is_riser: bool, pub height_delta: f64 }
pub fn solve_auto_riser(start: Vec3, target_elevation: f64, up_axis_y: bool) -> Vec<RiserNode>
```

## Rules

R1: NEC table is exact data (10 rows, radii 0.1016–0.4064 m). String
lookup matches `tradeSize`, `label`, or dash/space-insensitive
`tradeSize` (legacy `find` parity); unknown strings AND unparseable input
fall back to 0.1143 (¾" default, legacy parity).
R2: Numeric mm queries return the closest row by `|mm - row.mm|`; ties
keep the first row scanned (legacy `< minDiff` parity).
R3: `bend_angle`: `acos(clamp(dot(d1,d2)/(|d1||d2|)))` in degrees; either
leg `< 1e-7` → 0 (legacy `EPSILON` parity).
R4: `solve_elbow` with `angle < 1.0°` → `{valid: false, straight: true,
angle: 0, tangents = corner, arc = [corner]}` (legacy parity).
R5: Otherwise: `tangent = R·tan(α/2)`, clamped to `0.95·min(leg)` with the
radius scaled down proportionally (`effectiveRadius = effectiveTangent /
tan(α/2)`, legacy parity); center along the normalized bisector at
`R/cos(α/2)`; `arc_segments + 1` points by planar rotation from `pStart`
to `pEnd`, endpoints pinned exact (legacy Rodrigues/slerp parity:
`vOrtho = normalize(cross(normal, normalize(rStart)))`,
`pt = center + normalize(rStart)·R·cos θ + vOrtho·R·sin θ`).
R6: `analyze_run_bends`: corners with `angle >= 1.0°` count (rounded to 1
decimal in the legacy *report*; the Rust core keeps full precision and
the rounding lives at the TS edge — vectors assert with `tol`); `quarter`
when `|angle - 90| <= 2`; `exceeds = total > 360` (legacy parity).
Fewer than 3 points → zeros.
R7: `solve_auto_riser`: `|Δh| < 0.01` → `[start]`; else
`[start, {same x/z (Y-up) or x/y (Z-up), elevation, isRiser, Δh}]`
(legacy parity).
R8: Radii in metres, angles in degrees, lengths in metres — no imperial
inside the core (edge converts).

## Acceptance criteria

Stored as `spec/vectors/conduit/fitting-engine.json`, run against legacy
JS via `node scripts/run-conduit-fitting-vectors.mjs` and against this
crate via `cargo test`:

| Area | Cases | Covers |
|---|---|---|
| table | 2 | 10-row exact radii (strings + unicode + mm + fallback + dash/space) |
| bend angle | 4 | straight 0, 90, 45, degenerate zero-leg |
| elbow | 3 | 90° tangents/center/count, straight degenerate, clamped-tangent short legs |
| run bends | 3 | compliant 180, exceeds 450 (flag), short-run zeros |
| riser | 3 | Y-up, Z-up, no-op threshold |

~15 cases. Reuses `fitting.json` expectations.

## Out of scope

- Elbow/riser counts in takeoff (4.1 minimal shape, out of scope by
design — conduit is bent on site).
- BOM hardware from fittings (4.4 consumes `analyze_run_bends`).
- UI fitting previews / overlay rendering (viewer-core / conduit app).

## Parity reference

- `legacy/packages/conduit-core/src/fitting-solver.js` (277 lines).
- `legacy/packages/conduit-core/test/fitting-solver.test.js`.
- Vectors: `spec/vectors/conduit/fitting.json` (11 cases).

## Open questions

None. NEC data + 360° rule are pinned legacy behaviour.
