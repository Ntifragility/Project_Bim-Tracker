# BIM Tracker Rewrite — Goals + Revit/Navisworks Architecture Analysis

> Corrections applied 2026-10-23 after review against `origin/main@01452fe`.
> Six fixes: (1) dependency chain — apps use viewer-core and bindings side-by-side,
> viewer-core must not depend on product cores (ARCH rule 6); (2) `revit-*`
> branch names are UX inspiration, not requirements — Revit/Navisworks
> integration is an explicit non-goal; §2 reframed as parity/todo status, not a
> fresh feature list; (3) overlay spec is a separate Python product —
> its perf rules don't transfer, and the real JS exporter writes 3 pset props,
> not 8; (4) couplings conflict flagged as [OPEN] owner decision;
> (5) 7.1–7.3 "done" marked [UNVERIFIED] — apps/ are scaffold READMEs,
> `src/main.js` still 4,559 lines; (6) hygiene not finished — P22115 files
> still tracked. Smaller points folded in: NEC table truncated at 4",
> 100 ft pull limit is a legacy heuristic (not NEC), controller.rs current
> state, routing frame still open, conduit vector count 165 on main.

## 1. Goals first (from `ARCHITECTURE.md:8-22`)

Product goals are unchanged:

1. **IFC viewer + QTO / tagging of cable trays**
2. **IFC viewer + QTO / tagging / drawing of conduit pipes**

Owner decisions:

| ID | Decision | Consequence for you |
|---|---|---|
| D1 | Full modular rewrite | Incremental, behind frozen `legacy/` until parity gate `ARCHITECTURE.md:193` |
| D2 | Rust everywhere possible | **Limits:** UI, 3D viewer (That Open + Three.js), Vite apps stay TS. `web-ifc` stays loader/geometry. Rust owns rules/calculations/graphs/transforms. TS owns drawing/input/glue. `ARCHITECTURE.md:22` |
| D3 | Rewrite only what is done | No new features, except viewer improvement track D5 |
| D4 | `.xlsx` always present, Excel not core | `packages/excel-io` optional, apps only. Cores never import it |
| D5 | Improved engine on That Open | `viewer-core` = additive layer over **unmodified** That Open libs |
| D6 | Everything public | Hygiene: no real project IFCs, no PII, `.ifc` gitignored, licenses recorded |
| D7 | Local branches as backup | Folded into legacy baseline |

Hard invariants:

* Dependency **downward only**, with viewer-core on a side branch
  (`ARCHITECTURE.md:56-64`, esp. rule 6): apps depend on `viewer-core`
  **and** on the bindings **side by side**; `viewer-core` depends only on
  That Open / Three.js and its internal crate `viewport-core` — it must
  **not** depend on product cores or apps. `bindings/*` depend only on
  their own cores; cores depend only on `geom-core` / `ifc-io`.
  Tray and conduit never import each other. Cores never touch
  DOM/Three.js/`web-sys`.
* Rust crates **pure**: no I/O, globals, time, randomness, panics for expected errors → `Result`. Needed for golden vectors.
* Numbers: `f64` **metres, IFC Z-up** internally. Imperial (10ft sticks = 3.048m, NEC inches) are constants converted at edges.
* Bindings: thin `wasm-bindgen`, plain data (`serde_json` small payloads, `Float64Array/Uint32Array` bulk).
* Spec-first: `docs/specs/<module>/*.md` → `spec/vectors/<module>/*.json` → Rust `cargo test` + legacy JS runner must both pass.

Scope in/out `ARCHITECTURE.md:28-30`:

In: IFC load/inspect, batch tagging, tagged IFC export, mapping export, tray-system management, continuity diagnostics, route calc, conduit snap/fittings/HUD/BOM/takeoff/CSV+IFC overlay export, viewport controls, auto-orbit (moved to `viewer-core`), `?ifc=` deep link, Excel upload via `excel-io`.

Not ported (stay in `legacy/` until the parity gate, then deleted): `sendMeasurementToExcel()`, generic `addProjectTagsToIfc/extractProjectTagsFromIfc`, unused assets, unused `web-ifc*.wasm`, live Excel bridge `excel-ifc-bridge/` + `src/viewer-socket.js` (frozen), `ThatOpenEngine/` moved out.

---

## 2. Revit/Navisworks-inspired parity work (NOT new Revit/Navisworks integration)

Framing correction: the `feature/revit-*` branch names and the planning doc
("Revit-Style Conduit Pipe Drawing System") describe **UX inspiration**, not
requirements. `takeoff-overlay.md` states Revit and Navisworks are not
available and lists **"Revit or Navisworks integration" as a non-goal**.
Under D3 the only new-feature track is viewer Phase B, and the board marks
it done (6.3+). So: §2.1 = conduit parity work already ported to Rust
(4.1–4.5 done, 4.6 wasm switch todo); §2.2 = tray parity work still to port
(5.1/5.2 todo, 5.3 wasm todo); §2.3 = already-built viewer coordination
tooling, not a fresh feature list.

Interpretation of the inspiration: Revit = authoring precision + systems +
schedules. Navisworks = coordination review: persistent markup, navigation,
sectioning, isolation.

### 2.1 Conduit parity — ported to Rust (4.1–4.5 done; 4.6 todo)

From `origin/integration/revit-conduit` + 5 merged branches + specs:

**a) Precision snapping (`feature/revit-snap-engine`, spec `docs/specs/conduit/snap.md`)**
Legacy: `legacy/packages/conduit-core/src/snap-engine.js:360 lines`
System: `snap_to_nodes` (endpoint, `d<=tol`, first-wins ties) > `snap_to_segments` (interior `0.02<t<0.98`, midpoint `|t-0.5|<=0.08` → exact middle) > `ortho` (dominant axis, Y>X>Z tie) > `polar` (plan projection Y-up `x/z` vs Z-up `x/y`, `radial<0.05→None`, `<=minDiff` first-wins, guideAxis X/0-180, up-axis/90-270) > `workplane raw`. Config struct `SnapConfig{tolerance 0.25m, angular 4.5°, angles [0,45..315]}` replaces class state. `findSnap` network binding in `takeoff-io.md` (task 4.5): nodes-first short-circuit, even if segment projection is closer; dangling `nodeById→null` skipped in Rust (unreachable after `validate_network`).

Revit analogue (inspiration only): endpoint/midpoint object snap + polar tracking + ortho + workplane.

**b) Fitting solver (`feature/revit-fitting-solver`, `docs/specs/conduit/fitting.md`)**
Legacy: `legacy/packages/conduit-core/src/fitting-solver.js:277 lines`
System: NEC Ch.9 Table 2 data (10 rows, 0.1016–0.4064 m, ½"–4"); string
lookup tradeSize/label/dash-insensitive, fallback 0.1143 m (¾"); mm query
closest-row first-wins. NOTE (truncation): the real NEC Table 2 also covers
5" and 6", so "exact" means **exact but truncated** — sizes above 4" snap to
the 4" radius. Verify against the owner's NEC edition before building from
this. `bend_angle=acos(clamp(dot))`, `<1e-7→0`. `solve_elbow`:
`<1°→{valid:false,straight:true}` else `tangent=R·tan(α/2)` clamped to
`0.95·min(leg)` with radius scaled down, center `R/cos(α/2)` on bisector,
`arc_segments+1` pts planar rotation pinned exact. `analyze_run_bends`:
`>=1°` counts, `quarter=|a-90|<=2°`, `exceeds=total>360`.
`solve_auto_riser`: `|Δh|<0.01→[start]` else vertical second point.

Revit analogue (inspiration only): type-driven elbows + 360° pull-point rule.

**c) MEP HUD + properties (`feature/revit-mep-hud`)**
Legacy: `conduit-takeoff/src/mep-hud.js`, `properties-panel.js`, `drawing-tool.js`, `surface-picker.js`
System: floating dimension HUD, direct keyboard typing, inspector. Must stay TS in `apps/conduit-takeoff` + `viewer-core overlay/pick`. Rust provides numbers only. Rubber-band must survive orbit (commit `9a2ea62`).

Revit analogue (inspiration only): temporary dimensions + properties palette + direct entry.

**d) BOM / QTO (`feature/revit-bom-export`, `docs/specs/conduit/bom.md`)**
Legacy: `legacy/packages/conduit-core/src/bom-calculator.js:363 lines`
System: FFD cutting: drop `<=1e-7`, sort desc, oversize consumes whole sticks `[stock]` + remainder first-fits (`remaining>=rem+kerf`), normal `remaining>=cut+(kerf if non-empty)`. Per-run: `sticks=ceil(len/stock)`, `couplings=max(0,sticks-1)`, `connectors=len>eps?2:0`, `straps=max(2,2+floor(len/stock))`. Elbows: `>=1°`, `|b-90|<=5→90`, `|b-45|<=5→45` (wider than fitting ±2° — pinned legacy duality). Pull boxes: `cum>360||len>30.48→max(floor(cum/360),floor(len/30.48))`. NOTE (heuristic, not NEC): the 30.48 m "100 ft straight pull limit" (`bom-calculator.js:21`) is a legacy heuristic — as far as could be verified the NEC has no such limit; the real rule is the 360° one (NEC 358.26 / 344.26). Do not label it NEC in the spec; owner decides keep/drop. `bySize` sorted mm, `optimized=ceil(raw·(1+waste%))`. Constants: `DEFAULT_STICK 3.048m`, `KERF 0.003m`.

Revit analogue (inspiration only): schedules + buy list. CSV rendering stays TS (`io.json jsOnly`).

**e) Network core (`docs/specs/conduit/network.md`)**
Legacy: `network.js:148` + `takeoff.js:101` + `command-stack.js:86` + `diameter-registry.js:103`
System: clone-on-write `Network{version,nodes,runs,stick,next_id}`; ids `n{}/r{}` via injected cursor (deterministic, TS owns counter); dup-last append no-op; orphan prune; `drop_incomplete<2pts`; `set_stick>0`; `validate: version==1, frame ifc-original, m, finite coords, refs exist, nextId=max(provided,maxNumeric+1)`. Minimal takeoff `{length,sticks=ceil(len/stick) per-run summed,points}`, `bySize` via `size_to_mm` (unicode fractions→None). History: push/clear-redo/trim, move labels. Registry: 9 `DEFAULT_DIAMETERS`, palette wrap, ¾" default, `#f59e0b` fallback.

### 2.2 Tray parity — still to port (5.1/5.2 todo, 5.3 todo)

**f) Batch tagging (`docs/specs/tray/tagging.md`, `docs/tagging-architecture.md`)**
Scheme `{prefix}{system}.{type}.{sequence}` e.g. `PT1.01.01` (01 tray, 02 fitting, configurable start/width, independent per system+type, append-after-max, never reuse gaps). Flow: highlight → ordered keys → explicit kind / conservative classifier (standard `IfcCableCarrier*` + metadata terms, ambiguous→None, user assigns) → allocator → conflict preview → pending map → integrity validation → IFC+Excel exporters. State: saved vs pending vs effective (pending overlay minus deletions), batch undo snapshots touched keys only. IFC: `CCP_TRAY_SYSTEM` + native `IfcElement.Tag` allowlist, unsupported→pset + report, source unchanged → `*_tagged.ifc`. Excel: Tag Register from effective + Summary by system/kind/model/source. Compat: `SystemTag-C001` readable, v2 `ElementTag=ComponentId`.

Revit analogue (inspiration only): system types + tag family + shared parameters.

**g) Routing / continuity (`docs/specs/tray/routing.md`, `docs/revizto-validation.md`)**
Reference Revizto export: **no** `IfcCableCarrierSegment/Fitting`; 134 `IfcBuildingElementPart`, 12 hierarchy-only, 122 leaf trays → class filter unreliable. Pipeline: `FragmentsModel -> src/routing/ifc-extractor.js (TS, imports Three.js, stays adapter) -> routing-core/centerline.js -> graph.js -> diagnostics.js -> pathfinding.js -> routing-controller.js -> Three overlay`. Inference: vertices → centroid/covariance → power-iteration principal axis → extrema endpoints; confidence=variance_axis/total; degenerate reject. Clustering: endpoints `dist<=tol` default 100mm. Graph: `{nodes Map, edges Map, segmentToEdge}` — must become arrays/typed arrays across Wasm. Diagnostics: components, dangling ends, high-degree ambiguous — **report, don't silently connect**. Validation: 100mm→244 nodes/122 comp/244 open; 500mm→232/116/226; 1000mm→139/79/99; route #3192→#3702 13.71m @1000mm exploratory. Out: fill, bend radius, drops, IFC edit, authoritative fitting topology.
OPEN (ARCHITECTURE.md:247): the spec must still settle the coordinate frame —
legacy likely works in scene space (Y-up) while the architecture mandates
IFC Z-up; declare it in the routing spec before porting.

Navisworks analogue (inspiration only): clash/continuity + shortest path by length + reviewable inference.

### 2.3 Viewer coordination tooling — already built (Phase B, board done)

**h) Overlay export — two designs, do not conflate.**
(i) Python desktop spec (`docs/conduit-overlay-spec.md`, copied to
`docs/specs/conduit/takeoff-overlay.md`): a **different product** — Python +
IfcOpenShell + PyVista desktop app ("Rust has no IFC writer mature enough for
this"). Its performance rules (cache tessellation once, raycast the cache,
progress state for multi-hundred-MB IFCs, no silent hang) belong to that
Python design, **not** to viewer-core. Its `Pset_ConduitRun` lists 8
properties and its couplings rule is `ceil(len/stick)+elbows`.
(ii) Actual JS implementation (`legacy/packages/conduit-core/src/ifc-exporter.js:155`):
writes `IfcAnnotation` + polyline but only **3** pset properties —
`Size, System, Length` — not the 8 in the Python spec. STEP text writing
stays TS-side (`Date.now` + seeded GUIDs, pinned by `io.json jsOnly`);
overlay *read* is already ported to `ifc-io` (3.2).

[OPEN — owner decision before building overlay quantities] Two couplings
formulas, both currently stated as fact, disagree: the Python overlay spec
says `ceil(length/stick_length) + elbow_count` (a 10 ft straight run ⇒ **1**
coupling), while the BOM legacy code (`bom-calculator.js:172`) says
`max(0, sticks-1)` (same run ⇒ **0**). Legacy `takeoff.js:10` calls
couplings **out of scope** entirely ("conduit is bent on site"). Decide
which formula governs before building.

**i) Navigation + picking (`viewer/viewport`, `viewer/extract-engine`) — done 6.1/6.1b**
`crates/viewport-core` (current `controller.rs`: 436 lines) with per-instance
handles `viewport_create/destroy/*_instance`, global compat kept;
`pkg/*.wasm` no longer committed. Generic gestures (orbit/pan/truck,
click-vs-drag) in `viewport-core`/`viewer-core`; conduit tool decisions
(`preserve_rubberband`, place-point, sample elevation) stay in app.
`engine.js:createEngine(container,opts)` stable facade: `loadIfc, selection,
highlight/paint, hide/isolate/ghost, pick(ndc,{snap})->{point,snapped,normal}`,
`camera, coordinates(toScene/toOriginal Z-up f64), overlay, dispose,
autoOrbit{start/stop/toggle/isActive/onChange}, clipper, isolation`.
Surface normal in world space. Auto-orbit lives in `viewer-core`, app only
badge/toggle, stops on canvas pointer.

**j) Coordination tools (Phase B, `docs/covillaf-next.md`, `viewer/section-planes`, `ghost-isolate`) — board done**
Stock-first: check `Clipper,Hider,Classifier,Length/Area/VolumeMeasurement,SnapResolvers,VertexPicker` before custom. `engine.clipper{createPlane/deletePlane/deleteAll/toggle,pickHonorsPlanes}` — pick discards clipped-space hits, non-destructive. `engine.isolation{ghostIsolate/hardIsolate/reset/isGhostActive}` — ghost 15% opacity depthWrite off, restorable. Per-topic specs cover the rest: frame cap, low-res while moving, WebGL-loss notice, undo colour/visibility, PNG export sized, IFC-coord API. Assembly select stops at spatial container + select-similar by class (tag run in one step).

Navisworks analogues (inspiration only): section box, hide/ghost, selection sets, measure, viewpoint (`?ifc=` deep link for smoke tests).

---

## 3. System design — how it fits together

```
apps/tray-viewer   apps/conduit-takeoff       (TS, UI only; depend on viewer-core + bindings + excel-io)
       \               /
        +-- packages/viewer-core (TS) --+  engine facade; That Open/Three.js + viewport-core ONLY,
        |                              |  never product cores or apps (ARCH rule 6)
bindings/tray-wasm  bindings/conduit-wasm     (thin wasm-bindgen; depend only on their own cores)
        |                    |
crates/tray-tagging  crates/conduit-core      (pure Rust, golden vectors)
crates/tray-routing
        |                    |
        +-- crates/ifc-io --+                  (STEP text helpers, tag extract, overlay read)
        +-- crates/geom-core                   (vec3, segment, units m, frames)
packages/excel-io (optional, apps only)
```

Boundary contract `ARCHITECTURE.md:102-109`: pure cores, `Float64Array` bulk, `Result` not panic, one public JS entry + `.d.ts` per binding, measure before optimize.

Coordinate story: picked point → full IFC placement chain → world (metres Z-up) stored in core → `viewer-core/coordinates.js` converts to Three Y-up origin-shifted only for drawing. `IfcMapConversion` preserved for Revizto federation.

Enforcement `ARCHITECTURE.md:199-210`: Cargo deps = boundary, `dependency-cruiser/eslint-boundaries`, no `web-sys` in cores, `fmt/clippy/test/wasm-pack/npm test/builds/boundary-check` in CI, vectors in CI.

---

## 4. Gap: what exists vs what you still implement

`origin/main` (`01452fe`) is **ahead** of this checkout (`infra/agent-autonomy@574def2`). Board on `main`:

Done: 0.x, 1.x, 2.x, 3.1/3.2, 4.1-4.5 (network/snap/fitting/BOM/takeoff-io — 165 conduit vector cases on main: 159 in this checkout + 6 `takeoff-io-engine`), 6.1/6.1b/6.2/6.3+, [UNVERIFIED 7.1/7.2/7.3 — see below], 7.5.
Todo: **4.6 `conduit-wasm` + app flag, 5.1 `tray-tagging`, 5.2 `tray-routing`, 5.3 `tray-wasm` + app flag, 7.4 Safe IFC Editor (spec `docs/specs/tray/safe-ifc-editor.md` exists), 8.1 parity gate → delete `legacy/`.**

| Capability | Legacy JS | Rust vectors | Rust crate | Wasm/App |
|---|---|---|---|---|
| geom/ifc base | — | 54+56 pass | done 3.1/3.2 | done |
| conduit network/history/registry | `network.js` etc. | 23 pass | done 4.1 | needs 4.6 |
| snap + findSnap | `snap-engine.js snap.js` | 24+6 pass | done 4.2/4.5 | needs 4.6 |
| fitting NEC | `fitting-solver.js` | 15 pass | done 4.3 | needs 4.6 |
| BOM FFD | `bom-calculator.js` | 8 pass | done 4.4 | CSV stays TS |
| overlay IFC/CSV/project I/O | `ifc-exporter.js csv-export.js project-io.js` | `io.json jsOnly` pins | **TS-side by design** | needs 4.6 flag; exporter writes 3 pset props, not 8 |
| tray tagging | `src/tagging/* src/ifc/*` | 33+7 cases, unrun | **todo 5.1** (scaffold) | needs 5.3 |
| tray routing | `routing-core/* src/routing/*` | 26 cases, unrun | **todo 5.2** (scaffold) | extractor stays TS |
| viewer-core/clipper/ghost/viewport/smoke | `src/covillaf/engine.js` | smoke `public/fixtures/survey-box.ifc` | done 6.x | done, Phase B per-topic |
| apps split/excel-io | `src/main.js` 4,559 lines (`initApp` at :285) | — | — | **[UNVERIFIED]** 7.1/7.2/7.3: `apps/*` on main are scaffold READMEs only |
| Safe IFC Editor | `src/ifc/ifc-safe-editor.js` | — | needs `ifc-io` reuse | **todo 7.4 port last** |

Verification notes (review of `01452fe`):

* `cargo test --workspace` passes in this checkout: conduit-core 36, geom-core 35, ifc-io 32 (tray crates + wasm bindings: 1 scaffold test each). 40 conduit-core tests reported on `01452fe` — plausible (4.5 added `find_snap` cases); re-run after rebasing.
* Tray: 91 vector cases exist (`tagging.json` 33 + `validator.json` 7 + `routing.json` 26 + `ifc-io.json` 25), but `tray-tagging`, `tray-routing` and both wasm bindings are still scaffolds — nothing in Rust runs them yet.
* Hygiene [NOT DONE]: `P22115-CC-2140-07-05_Cable_Tray[_tagged].ifc.sharedparameters.txt` are still tracked at repo root on `origin/main`, against `ARCHITECTURE.md:219` and task 0.9.
* Counts: per-area vector numbers above are per-case counts of the `cases` arrays. NEC table and pull-limit caveats in §2.1(b)/(d) apply before building from those vectors.

Risks `ARCHITECTURE.md:223-234`: rewrite stall → frozen legacy + vectors + flags; Rust IFC immaturity → keep `web-ifc` + Rust only tag/pset logic; Wasm overhead → typed arrays; agent collision → worktrees + one-spec-one-branch + owned folders (`rust/geom-*`, `rust/ifc-*`, `rust/conduit-*`, `rust/tray-*`, `viewer/*`, `app/*`, `infra/*`, `fix/*`); spec drift → spec updated same branch.

Open for owner: history rewrite for pushed samples? parity project file for smoke? (`survey-box.ifc` covers the small-public-IFC need). NEW from this review: (a) couplings formula for overlay quantities — `ceil+elbows` vs `max(0,sticks-1)` vs out-of-scope; (b) NEC Table 2 edition check for 5"/6" rows; (c) keep or drop the 100 ft pull heuristic, and never label it NEC; (d) routing spec must declare Y-up vs Z-up frame (ARCH:247); (e) confirm 7.1–7.3 actually landed or re-open them; (f) remove the two root P22115 files.
