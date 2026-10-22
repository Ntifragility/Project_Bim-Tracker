# conduit-core / network + command stack + registries (task 4.1)

Status: draft
Branch: `rust/conduit-network`
Owner folders: `crates/conduit-core/`, `spec/vectors/conduit/network.json`, `docs/specs/conduit/`, `scripts/run-conduit-network-vectors.mjs`

## Goal

Port the pure state core of the conduit engine to Rust: the network graph
(nodes + runs CRUD, validation), the per-run takeoff, the command-stack
history model, and the diameter registry seed. Everything with closures,
`Date.now`/`Math.random` ids, listeners, or WebCrypto stays TS-side.

## Public interface

All types are plain data (`f64` metres, IFC Z-up); all functions are pure
(no I/O, no globals, no randomness). Id allocation takes an injected
counter cursor (owner-approved Q1 pattern); TS owns the `nextId` state.

```rust
// network
pub struct Node { pub id: String, pub x: f64, pub y: f64, pub z: f64 }
pub struct Run { pub id: String, pub name: String, pub size: String, pub system: String, pub node_ids: Vec<String> }
pub struct Network { pub version: u32, pub nodes: Vec<Node>, pub runs: Vec<Run>, pub stick_length: f64, pub next_id: u64 }
pub fn create_network(stick_length: f64) -> Network
pub fn add_node(net: &Network, x: f64, y: f64, z: f64) -> (Network, String)
pub fn start_run(net: &Network, size: &str, system: &str, name: &str, first_node: &str) -> Result<(Network, String), NetError>
pub fn append_to_run(net: &Network, run: &str, node: &str) -> Result<Network, NetError>
pub fn split_segment(net: &Network, run: &str, index: usize, x: f64, y: f64, z: f64) -> Result<(Network, String), NetError>
pub fn remove_last_point(net: &Network, run: &str) -> Network
pub fn delete_run(net: &Network, run: &str) -> Network
pub fn drop_incomplete_runs(net: &Network) -> Network
pub fn update_run(net: &Network, run: &str, name: Option<&str>, size: Option<&str>, system: Option<&str>) -> Network
pub fn set_stick_length(net: &Network, stick: f64) -> Result<Network, NetError>
pub fn validate_network(data: &NetworkJson) -> Result<Network, NetError>
// takeoff (minimal, R2 of takeoff vectors: length/sticks/points only)
pub struct RunTakeoff { pub length: f64, pub sticks: u32, pub points: usize }
pub fn compute_run_takeoff(net: &Network, run: &str) -> RunTakeoff
pub fn compute_takeoff(net: &Network) -> Takeoff
pub fn size_to_mm(size: &str) -> Option<f64>   // None = NaN (unicode fractions)
// history (command-stack model WITHOUT closures: TS owns execute/undo fns)
pub struct History { pub undo: Vec<String>, pub redo: Vec<String>, pub max_depth: usize }
pub fn history_execute(h: &History, label: String) -> History
pub fn history_undo(h: &History) -> (History, Option<String>)
pub fn history_redo(h: &History) -> (History, Option<String>)
// registry (diameter seed WITHOUT listeners/random ids)
pub struct Diameter { pub id: String, pub label: String, pub mm: f64, pub color: String }
pub fn default_diameters() -> Vec<Diameter>
pub fn registry_color(label_or_id: &str, list: &[Diameter]) -> &str
pub fn sort_diameters(list: &mut Vec<Diameter>)
```

## Rules

R1: Metres internally; every edit returns a new `Network` (clone-on-write,
legacy parity — the UI keeps snapshots for undo).
R2: Ids are `n{nextId}` / `r{nextId}`; `nextId` increments per allocation;
`append_to_run` with the same last node is a no-op returning the network
unchanged (legacy parity).
R3: `remove_last_point` on an emptied run deletes the run; orphan nodes are
pruned after remove/delete/drop (legacy `pruneOrphanNodes` parity).
R4: `drop_incomplete_runs` removes runs with fewer than 2 points.
R5: `set_stick_length` rejects non-positive values (`Err`).
R6: `validate_network`: version must be 1; frame `ifc-original` + units `m`;
every node coordinate finite; every run ref exists; `nextId` becomes
`max(provided, maxNumericId+1)` (legacy parity).
R7: Takeoff is minimal: per-run `{length, sticks, points}`, `sticks =
ceil(length / stick)` per run summed (never `ceil(total / stick)`),
`bySize` sorted by `size_to_mm` (fallback 0), no elbow/riser/coupling
fields (takeoff vectors R2 parity, already owner-approved).
R8: `size_to_mm`: `25mm` → 25; fractions `1 1/2"` → 38.1; bare numbers
without unit stay bare; unicode fractions and garbage → `None` (legacy
parity: `½/¾ → NaN`, TS edge normalizes labels).
R9: History model: `execute` pushes + clears redo + trims to `maxDepth`;
`undo`/`redo` move labels between stacks; empty stacks return `None`
(legacy `createCommandStack` parity minus closures/listeners, which stay
TS-side per `io.json` R8).
R10: Registry seed: the 9 `DEFAULT_DIAMETERS` with palette fallback
`DIAMETER_PALETTE[index % 10]`; default selected is `¾"`; `getColor`
falls back to `#f59e0b`; `add` sorts by mm (legacy parity minus
`Date.now`/random ids + listeners, which stay TS-side).
R11: `takeId` cursor rule: ids suggested as `n{next_id}`/`r{next_id}`;
the TS edge owns the counter (injected determinism, Q1 pattern).

## Acceptance criteria

Stored as `spec/vectors/conduit/network.json`, run against legacy JS via
`node scripts/run-conduit-network-vectors.mjs` where a legacy function
exists and against this crate via `cargo test`:

| Area | Cases | Covers |
|---|---|---|
| network CRUD | ~14 | create/add/start/append (incl. dup-last no-op + unknown errors)/split/remove-last/delete/drop/update/stick-length/validate (incl. round-trip + nextId cursor) |
| takeoff | ~10 | straight/exact/25ft/L-sum/per-run-sum/grouping/no-hardware/zero-length/collinear/run-standalone/size-ordering |
| history | ~4 | execute/undo/redo sequence, maxDepth trim, empty stacks |
| registry | ~5 | default 9 sizes, default selected ¾", color fallback, sort-by-mm, palette wrap |

~33 cases total. Reuses `takeoff.json` expectations where identical;
`command-stack` closure behaviour + registry random ids stay `jsOnly`.

## Out of scope

- Snap resolution, polar angles, ortho UI, elevation raycast (4.2).
- Fitting solver / NEC tables (4.3). BOM optimizer (4.4).
- CSV/IFC text rendering, project JSON serialize, SHA-256 (4.5 / TS-side).
- Marker store ids/listeners, command-stack listeners (TS-side, `io.json`).
- Snap-engine vector helpers (already in `geom-core`, 3.1).

## Parity reference

- `legacy/packages/conduit-core/src/network.js` (148 lines) + `takeoff.js`
(101 lines) + `command-stack.js` (86 lines) + `diameter-registry.js` (103
lines) + `config.js` (`DEFAULT_DIAMETERS`, `DIAMETER_PALETTE`,
`MAX_UNDO_DEPTH`) + `geometry.js` distance (delegates to `geom-core`).
- Vectors: `spec/vectors/conduit/takeoff.json` (20 cases, reused),
`spec/vectors/conduit/io.json` (`command-stack-sequence`,
`command-stack-max-depth`, `marker-store-counts` — model parity only).

## Open questions

None. Takeoff minimal-shape decision already owner-approved (takeoff
vectors R2). History/registry closures + randomness stay TS-side per
`io.json` R8 (owner-approved).
