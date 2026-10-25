# tray-routing / centerline + graph + diagnostics + pathfinding (task 5.2)

Status: implemented (2026-10-25: 5.2 landed, 26/26 Rust tests + 26 vectors green)
Branch: `rust/tray-routing`
Owner folders: `crates/tray-routing/`, `spec/vectors/tray/routing.json`, `docs/specs/tray/routing.md`

## Goal

Port the pure tray-routing graph core to Rust: PCA centerline inference,
tolerance-based endpoint clustering, connectivity graph + diagnostics, and
Dijkstra shortest path by physical length. The Three.js extractor and the
DOM/scene controller stay TypeScript adapters.

## Public interface

All types plain data (`f64` metres, IFC Z-up); all functions pure (no I/O,
no globals, no randomness). Graph uses arrays / typed arrays across Wasm —
never `Map`/`Set` objects at the boundary.

```rust
// vec (deduplicated from geom-core in 3.1; re-export, do not fork)
pub struct Vec3 { pub x: f64, pub y: f64, pub z: f64 }
pub fn vec_add(a: Vec3, b: Vec3) -> Vec3
pub fn vec_sub(a: Vec3, b: Vec3) -> Vec3
pub fn vec_scale(a: Vec3, s: f64) -> Vec3
pub fn vec_dot(a: Vec3, b: Vec3) -> f64
pub fn vec_length(a: Vec3) -> f64
pub fn vec_distance(a: Vec3, b: Vec3) -> f64
pub fn vec_normalize(a: Vec3) -> Vec3   // zero -> zero
pub fn vec_mean(points: &[Vec3]) -> Vec3 // empty -> zero

// centerline
pub struct Centerline { pub valid: bool, pub reason: String, pub centroid: Vec3,
  pub axis: Vec3, pub start: Vec3, pub end: Vec3, pub length: f64, pub confidence: f64 }
pub fn derive_centerline(points: &[Vec3], minimum_length: f64) -> Centerline

// graph
pub struct SegmentRef { pub id: String, pub start: Vec3, pub end: Vec3,
  pub length: f64, pub confidence: f64 }
pub struct Node { pub id: String, pub position: Vec3, pub endpoint_refs: Vec<EndpointRef>,
  pub edge_ids: Vec<String> }
pub struct Edge { pub id: String, pub from: String, pub to: String,
  pub length: f64, pub segment: SegmentRef }
pub struct Graph { pub nodes: Vec<Node>, pub edges: Vec<Edge>,
  pub segment_to_edge: Vec<(String, String)>, pub tolerance: f64 }
pub fn build_connectivity_graph(segments: &[SegmentRef], tolerance: f64) -> Graph
pub struct Component { pub node_ids: Vec<String>, pub edge_ids: Vec<String> }
pub fn connected_components(graph: &Graph) -> Vec<Component>  // sorted by edge count desc

// diagnostics
pub struct Diagnosis { pub segment_count: usize, pub node_count: usize,
  pub component_count: usize, pub components: Vec<Component>,
  pub dangling_nodes: Vec<String>, pub ambiguous_nodes: Vec<String>,
  pub low_confidence_edges: Vec<String>, pub is_connected: bool }
pub fn diagnose_graph(graph: &Graph, minimum_confidence: f64) -> Diagnosis

// pathfinding
pub struct Path { pub found: bool, pub reason: String,
  pub node_ids: Vec<String>, pub edge_ids: Vec<String>, pub length: f64 }
pub fn shortest_path(graph: &Graph, start: &str, end: &str,
  exclude_edge_ids: &[String]) -> Path
```

Extractor contract (TS-side, pinned): TS passes `Vec3` vertex arrays to
`derive_centerline`; Rust never touches Three.js or the live model.
`geometrySource: vertices | bounding-box | none` and the 0.7
bounding-box confidence penalty stay TS-side.

## Rules

R1: `vec_*` legacy parity: `normalize(zero) = zero`; `mean([]) = zero`;
`distance` = Euclidean.
R2: `derive_centerline`: `< 2` vertices → `{valid:false,
reason:"insufficient-vertices"}`. Centroid = mean; covariance =
mean outer product / n; principal axis = 32 power-iterations from
normalized `(1, 0.73, 0.37)`; zero axis → `{valid:false,
reason:"degenerate-geometry"}`. Endpoints = centroid ± axis·(min/max
projection); `length = max-min`; non-finite or `< minimum_length`
(default `1e-4`; extractor passes `0.02`) → `{valid:false,
reason:"centerline-too-short", length}`. `confidence =
longitudinalVariance / totalVariance` (`0` when total is `0`).
R3: `build_connectivity_graph`: cluster the `2N` endpoints by
`distance <= tolerance` (default `0.1` m) via union-find; each cluster
becomes one node, insertion-ordered `node-1..N`, position = mean of its
endpoints. Each segment becomes one edge `{id: segment.id, from, to,
length: segment.length}`; `segment_to_edge` maps segment → edge id.
Returns the used `tolerance`.
R4: `connected_components`: BFS over node↔edge adjacency; sorted by
`edgeIds.size` descending.
R5: `diagnose_graph`: `minimumConfidence` default `0.65`. Dangling =
degree exactly 1; ambiguous = degree > 4; low-confidence = `(confidence
?? 1) < threshold` (missing confidence counts as 1.0). `segmentCount =
edges.size`, `nodeCount = nodes.size`, `isConnected = components <= 1`.
R6: `shortest_path`: Dijkstra over physical `length`. Unknown
start/end → `{found:false, reason:"unknown-node", length:Infinity}`.
Unreachable → `{found:false, reason:"disconnected", length:Infinity}`;
broken predecessor chain → `reason:"incomplete-path"`.
`excludeEdgeIds` are skipped. Reconstruction returns ordered `nodeIds`
+ `edgeIds` and total length.
R7: Report, don't silently connect: tees/elbows/crossings the
tolerance cannot resolve surface as dangling / multi-component /
ambiguous nodes — never auto-merge across components.
R8: Coordinate frame: inputs and outputs are IFC Z-up metres `f64`.
The legacy extractor reads world vertices in scene space (Y-up);
the TS adapter converts scene → IFC Z-up before calling Rust (see
Open Q1). Node ids are deterministic insertion order, never random.
R9: `vec` helpers are canonical in `geom-core` (3.1); this crate
re-exports them. No second implementation.

## Acceptance criteria

Covered by `spec/vectors/tray/routing.json` (26 cases) via
`node scripts/run-tray-vectors.mjs` (26/26 green against legacy JS) and
`cargo test -p tray-routing` (26/26 green in Rust).

| Case | Input | Expected |
|---|---|---|
| vec-add/sub/dot/distance-3-4-0/normalize-zero/mean/mean-empty | vectors `vec-*` | exact / `tol 1e-12` |
| centerline-rotated-cloud | 8-pt box cloud | valid, `length ≈ 5.657 tol 0.05`, `confidence > 0.95`, centroid origin |
| centerline-two-point / vertical | 2 pts | valid, exact length/confidence/endpoints `tol 1e-9` |
| centerline-empty / single-point | 0–1 pts | `insufficient-vertices` |
| centerline-coincident / minimum-length-option | dup pts / `minimumLength: 10` | `centerline-too-short` + length |
| graph-clusters-nearby / gap-splits / default-tolerance | 2 segments ± tolerance | 3 vs 4 nodes, 2 edges, `tolerance 0.1` default |
| diagnose-single-chain | 2-seg chain | 2 seg / 3 nodes / 1 comp / 2 dangling / 0 ambiguous / connected |
| diagnose-disconnected-low-confidence | far pair, conf 0.4 | 2 comps, `lowConfidenceEdges ["a"]`, disconnected |
| diagnose-ambiguous-star | 5 spokes, tol 0.001 | 6 nodes / 5 seg / 1 ambiguous / connected |
| diagnose-custom-confidence-threshold | `minimumConfidence 0.99` | `lowConfidenceEdges []` |
| components-sorted-by-edge-size | 2+1 chain | 2 comps, `edgeSizes [2,1]` |
| shortest-weighted-path / exclude-endpoint-edges | triangle / 3-chain + excludes | `edgeIds [a,b] len 2` / `[middle] len 1` |
| shortest-disconnected / unknown-node | far pair / bad id | `disconnected` / `unknown-node` |

## Out of scope

- `ifc-extractor.js` (Three.js, live `FragmentsModel`, world-vertex /
bounding-box fallback, candidate filtering) — stays TS; covered at
most by `jsOnly` shape cases.
- `routing-controller.js` (DOM, selection, Three.js diagnostic
overlay) — stays TS/UI.
- Code-compliant tray fill, cable separation, bend-radius modelling,
equipment drops, IFC modification/export, authoritative fitting
topology (explicit non-goals, pinned).
- Full STEP golden files (GUIDs vary; shape asserted only).
- `.xlsx` bytes (task 7.3).

## Parity reference

- `legacy/packages/routing-core/src/vector.js` (18 lines)
- `legacy/packages/routing-core/src/centerline.js` (72)
- `legacy/packages/routing-core/src/graph.js` (104)
- `legacy/packages/routing-core/src/diagnostics.js` (29)
- `legacy/packages/routing-core/src/pathfinding.js` (50)
- `legacy/src/routing/ifc-extractor.js` (131, TS-side adapter —
candidate regexes `IFCCABLECARRIERSEGMENT|FITTING` + Revizto
`IFCBUILDINGELEMENTPART` + tray text, vertex→bbox fallback,
`minimumLength 0.02`, bbox confidence ×0.7)
- Tests: `legacy/packages/routing-core/test/routing-core.test.js`,
`ifc-extractor.test.js`; evidence `docs/revizto-validation.md`
(100/500/1000 mm tolerance table; route #3192→#3702 13.71 m);
vectors `spec/vectors/tray/routing.json` + runner
`scripts/run-tray-vectors.mjs`.

## Open questions — resolved by 5.2 (2026-10-25)

1. **Coordinate frame (was ARCHITECTURE.md:247):** RESOLVED by owner D4
   (IFC Z-up f64). Rust takes Z-up inputs; the TS `ifc-extractor` adapter
   owns scene (Y-up) → IFC conversion before calling Rust (see R8).
   The conversion point (`viewer-core/coordinates.js` vs extractor) is a
   TS-side detail owned by the 5.3 flag-switch task. CLOSED.
2. Tolerance default `100 mm` preserved from legacy; 500/1000 mm
   values are exploratory only (revizto evidence) — no change. CLOSED.
3. Node `position` = mean of clustered endpoints (legacy parity);
   per-endpoint residuals for the overlay are TS's call at 5.3. CLOSED.
