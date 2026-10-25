# conduit / conduit-wasm
Status: approved (owner D-rulings 2026-10-25; spec written 2026-10-26)
Branch: spec/conduit-wasm        Owner folders: docs/specs/conduit/
Code landing: rust/conduit-wasm (follows this spec; owned folders: bindings/conduit-wasm/, spec/vectors/conduit/ only for runner glue)

## Goal
Expose the finished `conduit-core` (4.1–4.5: network, snap, fitting, BOM, takeoff, history, registry) to `apps/conduit-takeoff` through a thin `wasm-bindgen` binding, behind a runtime flag so the app can switch between the legacy `@conduit-core` JS package and the Wasm core without behavior change.

## Current state (verified 2026-10-26 on origin/main@cd81800)
- `bindings/conduit-wasm/` is a scaffold: one `conduit_wasm_version()` export, deps `conduit-core` + `wasm-bindgen 0.2`.
- `crates/conduit-core` exports: network (create/add/validate/split/drop), snap (`find_snap`, `snap_to_nodes/segments`, ortho/polar/raycast/resolve), fitting (`solve_elbow`, `analyze_run_bends`, NEC table), BOM (`compute_detailed_bom`, `optimize_stick_cutting`), takeoff (`compute_takeoff`, `compute_run_takeoff`), history, registry. 1,970 lines.
- Vectors: 165 cases across 13 files (`network 19, snap 22+24, fitting 11+15, bom 6+8, takeoff 20, io 12 jsOnly, takeoff-io-engine 6, history/registry/units`).
- Owner D-rulings apply: **D1** couplings = `max(0,sticks-1)`; **D2** NEC truncated at 4″ (larger sizes borrow 4″ row, documented); **D3** 100 ft pull limit kept, labeled legacy heuristic, never NEC.

## Public interface (thin wrappers, plain data only)
```rust
// version / health
pub fn conduit_wasm_version() -> String          // "conduit-core <ver> enums…"
// network (serde_json in/out; f64 metres, IFC Z-up)
pub fn network_validate(net_json: &str) -> String        // Result JSON {ok} | {code,message}
pub fn network_takeoff(net_json: &str) -> String        // Takeoff JSON (per-run + by-size + totals)
pub fn network_run_takeoff(net_json: &str, run_id: &str) -> String
pub fn network_mutate(op_json: &str, net_json: &str) -> String  // add_node/start_run/append/delete/split/set_stick (one op per call, deterministic ids from injected cursor)
// snap
pub fn snap_find(net_json: &str, point_json: &str, tolerance_m: f64) -> String  // Option<FindSnapHit> JSON
pub fn snap_point(candidates_json: &str, query_json: &str, config_json: &str) -> String
// fitting
pub fn fitting_elbow(p1: &[f64;3], p2: …, p3: …, trade_label: &str) -> String   // ElbowSolution JSON
pub fn fitting_run_bends(points_json: &str) -> String                            // RunBends JSON
pub fn fitting_nec_lookup(query: &str) -> String                                  // NecBendRow JSON
// bom
pub fn bom_detailed(net_json: &str, opts_json: &str) -> String                   // DetailedBom JSON (D1+D3 applied)
pub fn bom_optimize(cuts_json: &str, stock_m: f64, kerf_m: f64) -> String        // StickPlan JSON
// history + registry (stateful helpers stay TS-side; binding exposes pure transitions)
pub fn history_step(hist_json: &str, op: &str, payload_json: &str) -> String
pub fn registry_list() -> String            // DEFAULT_DIAMETERS JSON
```
- Small payloads: `serde_json` strings. Bulk geometry (run polylines for overlay): `Float64Array` out.
- Errors: `{code, message}` objects, never panics (ARCH §3). Codes: `E_SCHEMA` (bad JSON), `E_NETWORK` (validate failure), `E_RANGE` (bad tolerance/stock), `E_SIZE` (unknown trade label → fallback row + warning field, per fitting R-fallback).
- One public JS entry + generated `.d.ts`: `bindings/conduit-wasm/pkg/conduit_wasm.{js,d.ts}`.

## Rules
- **R1: Thin only.** No logic in the binding: parse → call core → serialize. Any behavior fix lands in `conduit-core` + vectors first.
- **R2: Purity preserved.** Same input JSON → same output JSON. No I/O, globals, time, randomness. Ids come from the caller-supplied cursor (4.1 pattern).
- **R3: D-ruling parity.** BOM output uses D1 couplings, D2 truncated NEC, D3 legacy-labeled pull boxes — identical to the Rust core the vectors pin.
- **R4: TS-side stays TS-side.** `serializeProject`/`deserializeProject` (Date.now), SHA-256 (WebCrypto), CSV string rendering, STEP overlay text, marker ids/listeners, command-stack closures — per `takeoff-io.md` R7 + `io.json` jsOnly. The binding never touches JSON text building beyond core structs.
- **R5: Flag switch.** App reads `?core=wasm | localStorage conduit.core` (default JS until 8.1): one `createConduitBackend()` factory returning the same interface; vectors run against both backends in CI.
- **R6: No new TS deps from binding.** Only `wasm-bindgen` + `serde`/`serde_json` in the crate; no `web-sys` in cores (bindings may use it for logging only).

## Acceptance criteria
| Check | Expected |
|---|---|
| `wasm-pack build bindings/conduit-wasm` | green, `.d.ts` emitted |
| Golden vectors (165 cases) via Wasm entry | all pass (runner: node + wasm-pack output) |
| `cargo fmt --check`, `clippy -- -D warnings`, `cargo test` | clean |
| Flag switch in app (follow-up `app/*` task) | `?core=wasm` boots, takeoff numbers byte-equal to JS backend on synthetic fixture (D7b) |
| Bulk path | run polyline export as `Float64Array`, no JSON round-trip for ≥1k points |
| Errors | malformed JSON → `E_SCHEMA`, invalid net → `E_NETWORK`, never a trap/panic |

## Out of scope
- CSV/IFC text, project JSON, SHA-256, marker/command-stack closures — TS-side by design (R4).
- App flag wiring itself (separate `app/conduit-wasm-flag` task after 7.2 lands).
- Perf work (SIMD/threads) — measure first (ARCH §3).

## Parity reference
- Legacy: `packages/conduit-core/src/*.js` + `conduit-takeoff/src/*` (snap 24+6, fitting 15, BOM 8, takeoff 20, io jsOnly 12).
- Rust: `crates/conduit-core/src/*.rs` (all 165 vectors green in `cargo test`).
- Spec chain: `network.md`, `snap.md`, `fitting.md`, `bom.md` (D1/D3), `takeoff-io.md` (R7 boundary).

## Open questions / [UNVERIFIED]
- **Q1:** `history_step` shape (op vocabulary) is fixed at landing from `history.rs` exports — spec allows the exact op names to settle in code + vectors glue.
- **Q2:** Wasm vector runner (node vs `wasm-pack test`) chosen at landing; either must run the same 165 cases.
