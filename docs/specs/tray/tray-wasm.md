# tray / tray-wasm binding + app flag switch (task 5.3)

Status: implemented (2026-10-26: 5.3 landed, 72/72 wasm vectors green)
Branch: `rust/tray-wasm6`
Owner folders: `bindings/tray-wasm/`, `crates/tray-tagging/` + `crates/tray-routing/` (serde derives only), `docs/specs/tray/tray-wasm.md`, `scripts/run-tray-wasm-vectors.mjs`
Flag wiring (`apps/tray-viewer`) is the follow-up `app/tray-wasm-flag` task (legacy default until gate, R6). Q1 (per-module flag) + Q2 (frame) confirmed at landing.

## Goal

Expose the pure 5.1 (`tray-tagging`) + 5.2 (`tray-routing`) logic to the tray
viewer through a thin `wasm-bindgen` layer, and switch `apps/tray-viewer`
behind a flag. No business rules live in the binding or the app.

## Public interface

All types plain data across the boundary (serde-JSON for small payloads,
`Float64Array`/`Uint32Array` for bulk geometry — graph nodes/edges, centerline
vertices). Errors are typed results (`{code, message}`), never panics. One
public JS entry point + generated `.d.ts`; the app imports only that entry.

```ts
// tagging (wraps 5.1; all unit-free strings)
allocateTags(input: AllocateInput): AllocationResult   // scheme normalize/format/parse/validate/allocate
classifyElement(input: ClassifyInput): Classification   // conservative classifier; ambiguous -> {kind: null}
validateAssignment(input: ValidateInput): ValidationReport  // integrity R5
buildRegisterRows(effective: EffectiveMap): { register: Row[], summary: Row[] }

// routing (wraps 5.2; all f64 metres, IFC Z-up)
computeCenterline(vertices: Float64Array): Centerline  // PCA 32-step rule, R6
clusterEndpoints(centerlines, toleranceM): Graph        // arrays across Wasm, never Map
diagnoseGraph(graph): Diagnostics                       // dangling/ambiguous/low-confidence
shortestPath(graph, fromId, toId): PathResult            // Dijkstra over length
```

Consumes 5.1 vectors (`tagging.json` 33 + `validator.json` 7) and 5.2 vectors
(`routing.json` 26). `ifc-io.json` (25 cases) is `jsOnly` — pinned shape, never
ported, never exposed here.

## Rules

R1: Thin layer only: argument marshal → core call → result marshal. No
allocation schemes, no PCA, no Dijkstra, no STEP text in the binding.
R2: Graph crosses Wasm as arrays/typed arrays (node/edge lists), never JS
`Map`s (`docs/specs/tray/vectors.md` R9; ARCHITECTURE section 2).
R3: Coordinate frame: IFC Z-up `f64` in Rust; the TS `ifc-extractor` adapter
owns the scene (Y-up) → IFC conversion. Declare the conversion point in the
5.2 spec; this spec only pins that the binding never converts.
R4: Rust-pure boundary: `createIfcGuid` (random), STEP text rendering,
entity-id sequencing, colour/style entities, extractor (three + live model I/O),
`routing-controller` (DOM + scene) stay TS-side — already `jsOnly`, no new
exposure.
R5: Units: metres across the routing boundary; tags are unit-free strings.
Imperial constants convert at the app edge.
R6: Flag switch: `apps/tray-viewer` keeps the legacy JS path until the vectors
pass in Rust; the flag selects wasm vs legacy per module (tagging, routing),
defaulting to legacy until the parity gate (8.1).
R7: Core purity holds through the binding: crates take no `web-sys`/`js-sys`;
only `bindings/tray-wasm` touches `wasm-bindgen` (boundary check R2).

## Acceptance criteria

| Area | Cases | Covers |
|---|---|---|
| tagging passthrough | 33 + 7 | same expectations as 5.1 vectors, called through wasm exports |
| routing passthrough | 26 | same expectations as 5.2 vectors, arrays across the boundary |
| flag switch | manual | app builds + runs with flag on/off; legacy default until gate |

Run `wasm-pack build` for `bindings/tray-wasm`; `npm test`; `npm run build`
(tray viewer); boundary check.

## Out of scope

- Any 5.1/5.2 logic change (belongs in the tagging/routing lanes).
- Extractor/controller behaviour (TS adapters, at most `jsOnly` shape cases).
- Excel Tag Register / Summary sheet rendering (`excel-io`, 7.3).
- Saved/pending/undo UI state machines (7.1 port, reusing these vectors).
- CSV/IFC full-text goldens (GUIDs vary; shape asserted only).

## Parity reference

- `docs/specs/tray/tagging.md` (5.1 lane draft) + `docs/specs/tray/routing.md`
  (5.2 lane draft) + `docs/specs/tray/vectors.md` (R1–R9).
- `legacy/src/tagging/*`, `src/ifc/tag-validator.js`,
  `legacy/packages/routing-core/src/*`.
- Vectors: `spec/vectors/tray/tagging.json`, `validator.json`, `routing.json`
  (`ifc-io.json` jsOnly, excluded).

## Open questions — resolved at landing (2026-10-26)

1. Flag granularity: per-module (tagging, routing), legacy default until gate. CLOSED (flag wiring itself is the `app/tray-wasm-flag` follow-up).
2. Routing frame conversion point: D4 (IFC Z-up f64 in Rust); TS `ifc-extractor` owns the conversion. The exact call site (`viewer-core/coordinates.js` vs extractor) is settled in the flag task. CLOSED for the binding (never converts, R3).

Wire format note (landing decision): binding JSON is camelCase
(JS-idiomatic parity with the legacy modules); `#[serde(rename_all =
"camelCase")]` on all transfer structs in both tray crates. Rust-side
field names unchanged; only the wire changes.
