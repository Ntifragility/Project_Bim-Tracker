# conduit-core / takeoff-io: network snap binding + TS-side I/O boundary (task 4.5)

Status: draft
Branch: `rust/conduit-takeoff-io`
Owner folders: `crates/conduit-core/` (snap module only), `spec/vectors/conduit/takeoff-io-engine.json`, `docs/specs/conduit/`, `scripts/run-conduit-takeoff-io-vectors.mjs`

## Goal

Port the last remaining pure conduit logic to Rust: the network-bound
snap query `findSnap` (legacy `snap.js`) — nodes-first, then segment
interiors — which 4.2 deferred ("network binding lives in 4.1") but 4.1
never implemented. Everything else under the 4.5 title (CSV text
rendering, project JSON serialize, SHA-256, marker/command-stack
closures + ids, overlay STEP write) is owner-approved TS-side, pinned by
the `jsOnly` shape vectors in `spec/vectors/conduit/io.json`; this spec
records that boundary, it does not re-port it.

## Public interface

All types plain data (`f64` metres, IFC Z-up); all functions pure (no
I/O, no globals, no randomness). Lives in the existing `snap` module
(next to `snap_to_nodes`/`snap_to_segments`, which are point-level; this
is the network-level binding).

```rust
// snap (added in 4.5)
pub enum FindSnapHit {
    Node { node_id: String, point: Vec3, distance: f64 },
    Segment { run_id: String, index: usize, point: Vec3, distance: f64 },
}
pub fn find_snap(net: &Network, point: Vec3, tolerance_m: f64) -> Option<FindSnapHit>
```

Consumes 4.1 (`Network`) + `geom-core::segment::closest_on_segment`
(via the existing `snap::closest_on_segment` re-export).

## Rules

R1: Metres everywhere; tolerance in metres. `None` when nothing is close
enough (legacy `null` parity).
R2: Node stage first (legacy parity): every node with `d <= tolerance`
is a candidate; strictly-smaller `d` replaces the best, so ties keep the
first node scanned (legacy `d < best.distance` parity).
R3: Any node hit short-circuits: the segment stage never runs when the
node stage hit (legacy early-`return` parity). A node always beats a
segment, even a strictly closer segment projection.
R4: Segment stage (legacy parity): per run, per consecutive node-id pair;
a pair whose endpoint is missing from the node list is skipped (see R6).
Hits with `t <= 0` or `t >= 1` are skipped (endpoints belong to node
snap); hits with `distance > tolerance` are skipped; strictly-smaller
`distance` replaces the best (first wins ties).
R5: Segment `index` is the segment position inside the run's `node_ids`
(`run.nodeIds[index] -> nodeIds[index+1]`, legacy parity). Hit `point`
is the projection point (NOT re-snapped to a midpoint — `findSnap` has
no midpoint stage, unlike `snap_to_segments`).
R6: Dangling node-id deviation (documented, unreachable in practice):
legacy `nodeById` returns `null` for a missing id and
`closestOnSegment` then throws a `TypeError`. Rust skips unresolvable
pairs and keeps scanning. `validate_network` (4.1) already rejects
dangling refs, so parity holds on every valid input.
R7: TS-side boundary (owner-approved, no Rust code): `serializeProject` /
`deserializeProject` (JSON text + `Date.now`), `computeSha256` /
`verifySourceHash` (WebCrypto), `exportRunsCsv` / `exportSummaryCsv` /
`exportCompleteCsv` / `generateContractorBomCsv` (string rendering),
`exportOverlayIfc` (STEP text + `Date.now` + seeded GUIDs), marker-store
ids/listeners, command-stack closures/listeners. Pinned as `jsOnly`
shape vectors in `io.json`; TS owns JSON parsing (4.1 `NetworkFile`
pattern) and string building.

## Acceptance criteria

Stored as `spec/vectors/conduit/takeoff-io-engine.json`, run against
legacy JS via `node scripts/run-conduit-takeoff-io-vectors.mjs` and
against this crate via `cargo test`:

| Area | Cases | Covers |
|---|---|---|
| `findSnap` | 6 | node hit, segment hit, miss, node-beats-closer-segment, tie-keeps-first, dangling-ref skipped |

Reuses `takeoff.json` `findsnap-*` expectations verbatim (node/segment/
miss); the remaining three pin priority/tie/defensive-skip behaviour
from `snap.js` lines 10-32.

## Out of scope

- CSV/contractor-BOM/overlay-IFC text rendering (TS-side, `io.json`
  `jsOnly`; 4.5 only records the boundary).
- Project JSON round-trip + SHA-256 (TS-side: `Date.now`, WebCrypto).
- Marker store + command-stack closures/listeners (TS-side; pure
  history/registry models already in 4.1).
- Overlay *read* (already in `ifc-io`, 3.2).
- `conduit-wasm` binding + app switch (4.6).

## Parity reference

- `legacy/packages/conduit-core/src/snap.js` (32 lines, `findSnap`).
- Vectors: `spec/vectors/conduit/takeoff.json` (`findsnap-node`,
  `findsnap-segment`, `findsnap-miss`), `spec/vectors/conduit/io.json`
  (12 `jsOnly` TS-side shape pins, unchanged by this task).

## Open questions

None. TS-side boundary already owner-approved (`vectors.md` R9, `io.json`
notes). The R6 dangling-ref deviation is unreachable after
`validate_network` and needs no owner decision.
