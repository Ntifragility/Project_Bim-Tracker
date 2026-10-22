# conduit-core / BOM + stick optimizer (task 4.4)

Status: draft
Branch: `rust/conduit-bom`
Owner folders: `crates/conduit-core/` (bom module only), `spec/vectors/conduit/bom-engine.json`, `docs/specs/conduit/`, `scripts/run-conduit-bom-vectors.mjs`

## Goal

Port the pure BOM engine to Rust: First-Fit Decreasing stick-cutting
optimization plus the detailed hardware BOM (couplings, box connectors,
straps, elbows, pull boxes). CSV text rendering stays TS-side (4.5).
Consumes 4.1 (`Network`, `size_to_mm`) and 4.3 (`bend_angle`).

## Public interface

All types plain data (`f64` metres); all functions pure. No I/O, no
globals, no randomness.

```rust
// bom
pub const DEFAULT_STICK_LENGTH_M: f64 = 3.048;
pub const KERF_WASTE_M: f64 = 0.003;
pub const MAX_PULL_DISTANCE_M: f64 = 30.48;   // 100 ft straight pull
pub struct StickPlan { pub cuts: Vec<f64>, pub waste_m: f64 }
pub struct CuttingPlan { pub sticks_needed: usize, pub total_length_m: f64, pub total_waste_m: f64, pub waste_pct: f64, pub sticks: Vec<StickPlan> }
pub fn optimize_stick_cutting(cuts: &[f64], stock_m: f64, kerf_m: f64) -> CuttingPlan
pub struct BomOptions { pub stock_length_m: f64, pub waste_factor_pct: f64 }
impl Default for BomOptions { ... }  // stock 3.048, waste 0
pub struct RunBom { pub run_id: String, pub name: String, pub size: String, pub system: String, pub length_m: f64, pub sticks_basic: u32, pub couplings: u32, pub box_connectors: u32, pub straps: u32, pub elbows90: u32, pub elbows45: u32, pub cumulative_bends_deg: f64, pub pull_boxes: u32, pub nec_compliant: bool }
pub struct SizeBom { pub size: String, pub mm: f64, pub runs: usize, pub length_m: f64, pub raw_sticks: usize, pub optimized_sticks: usize, pub waste_pct: f64, pub couplings: u32, pub box_connectors: u32, pub straps: u32, pub elbows90: u32, pub elbows45: u32 }
pub struct BomTotals { pub runs: usize, pub length_m: f64, pub sticks: usize, pub couplings: u32, pub box_connectors: u32, pub straps: u32, pub elbows90: u32, pub elbows45: u32, pub pull_boxes: u32 }
pub struct DetailedBom { pub stock_length_m: f64, pub totals: BomTotals, pub by_size: Vec<SizeBom>, pub runs: Vec<RunBom> }
pub fn compute_detailed_bom(net: &Network, opts: &BomOptions) -> DetailedBom
```

## Rules

R1: Metres everywhere; rounding only at report precision: per-stick
`wasteM` to 3 decimals, totals `lengthM` to 2 (legacy `toFixed` parity —
Rust keeps full precision internally; vectors assert with `tol`).
R2: FFD exact discipline (legacy parity): drop cuts `<= 1e-7`, sort
descending; cuts longer than stock consume whole sticks first (`remaining
0`, `cuts: [stock]`), then the remainder first-fits (requiring
`remaining >= remainder + kerf`); normal cuts require `remaining >= cut +
(kerf if stick non-empty else 0)`; otherwise open a new stick
(`remaining = stock - cut`).
R3: `wasteM = remaining` per stick; `wastePercentage` over purchased
stock; empty input → all zeros (legacy parity).
R4: Per-run hardware (legacy parity): sticks_basic =
`len > eps ? ceil(len/stock) : 0`; couplings = `max(0, sticks-1)`; box
connectors = `len > eps ? 2 : 0`; straps = `len > eps ? max(2, 2 +
floor(len/stock)) : 0`.
R5: Elbows: bend `>= 1.0°` counts; `|b-90| <= 5` → 90, else `|b-45| <=
5` → 45 (note: wider than the 4.3 `quarter_bend` ±2° flag — legacy has
two different tolerances, pinned as-is).
R6: Pull boxes per run: `cumulative > 360 || len > 30.48` →
`max(floor(cum/360), floor(len/30.48))`, else 0 (legacy parity).
R7: `bySize` sorted by mm ascending; `optimizedSticks =
ceil(rawSticks · (1 + wasteFactor))` per size; grand sticks sum the
per-size optimized counts (legacy parity).
R8: Unknown sizes (`size_to_mm` → `None`) sort as 0 (legacy `|| 0`
parity). Empty runs (no points) contribute zero hardware.

## Acceptance criteria

Stored as `spec/vectors/conduit/bom-engine.json`, run against legacy JS
via `node scripts/run-conduit-bom-vectors.mjs` and against this crate
via `cargo test`:

| Area | Cases | Covers |
|---|---|---|
| FFD | 4 | two-cuts-one-stick, three-cuts-three-sticks, oversize-spans, empty |
| BOM | 4 | L-run hardware (couplings/connectors/elbows/compliance), NEC-violation + pullbox, straps rule, waste-factor scaling |

~8 cases. Reuses `bom.json` expectations.

## Out of scope

- Contractor CSV text rendering (4.5 / TS-side, `io.json` jsOnly).
- Takeoff quantities (4.1 — BOM consumes run lengths, not takeoff rows).
- Fitting geometry / arc points (4.3 — BOM consumes bend *angles* only).

## Parity reference

- `legacy/packages/conduit-core/src/bom-calculator.js` (363 lines).
- `legacy/packages/conduit-core/test/bom-calculator.test.js`.
- Vectors: `spec/vectors/conduit/bom.json` (6 cases).

## Open questions

None. Dual elbow tolerances (±5° BOM vs ±2° fitting flag) are pinned
legacy behaviour, not a bug to fix.
