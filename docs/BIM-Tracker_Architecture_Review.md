# BIM Tracker / COVILLAF: Architecture Review, Specs and Recommendations

Repo reviewed: `Ntifragility/Project_Bim-Tracker` (public), `main` at `9e1a9b4`, plus all remote branches.
Review date: 2026-10-19. Method: full clone, commit graph, per-branch diffs, `npm test`, `npm run build`, `npm run build:conduit`, import analysis.
Limits: read-only access; local unpushed branches (`feature/revit-viewport-controls` 9a2ea62, `integration/revit-conduit` 76b9160) and the separate COVILLAF 3D / DESIGN repos were not visible.

---

## 1. Goal and target architecture

Three independent parts, each splittable into submodules:

1. **Viewer**: an independent, shared 3D IFC viewer.
2. **Cable tray module**: QTO / tagging of cable trays.
3. **Conduit module**: QTO / tagging / drawing of conduit pipes.

**The rule that makes them independent is a dependency rule, not a folder tree:**
apps depend on their core packages; cores depend only downward (on a tiny shared base); tray and conduit never import each other; both may import the viewer.

```
packages/
  viewer-core/      engine, coordinates, web-ifc Vite plugin   (JS/TS)
  tray-core/        tagging, IFC export, routing graph          (submodules ok: tagging-core, routing-core)
  conduit-core/     snap, fittings, BOM, takeoff                (JS now, Rust/Wasm later)
  (optional) math-core/   shared vector/geometry base, kept tiny
apps/
  tray-viewer/      UI only
  conduit-takeoff/  UI only
tools/excel-ifc-bridge/
docs/               all notes, specs, architecture
samples/            test IFC / xlsx (or keep out of git)
AGENTS.md           which folders each kind of branch may edit
.github/workflows/ci.yml
```

Enforcement (without it the rule is only a convention):
- npm workspaces (`"workspaces": ["packages/*", "apps/*"]`), each package exposing one entry point.
- One lint rule that blocks imports in the wrong direction.
- CI on every pull request.

### Do big enterprise systems work this way?
Yes. This is the "dependency rule" (layered / hexagonal / clean architecture), enforced by tools: Chromium restricts which directories may include which (`DEPS` files), Google's Bazel has per-package visibility rules, frontend monorepos use module-boundary lint rules (e.g. Nx), and COVILLAF SIMULATE's own architecture uses `import-linter` with "each layer imports only the lower ones". (General industry knowledge, not looked up during the review.)

Refinements:
- "Cores depend on nothing" is a simplification: they depend on a small shared base. `routing-core/src/vector.js` and `conduit-core/src/geometry.js` / `coordinate-utils.js` probably overlap (not compared). Keep any shared base tiny; do not let it become a "common/utils" dump.
- For a solo developer with agents, the minimum viable version is: workspaces + one boundary lint rule + CI.

---

## 2. Concepts: agents, harnesses, branches, worktrees

- **Model** = the brain (DeepSeek, Gemini, Claude). **Agent** = model + tools in a loop (try, check, fix). **Harness** = the program that provides the tools and loop (Antigravity, OpenCode, Claude Code).
- **Branch** = a named line of history stored in git. **Folder / working copy** = the actual files on disk; a normal repo has one folder showing one branch at a time.
- Two agents on two branches in the **same folder** fight (switching branch rewrites the files under the other agent). Fixes: run agents one at a time per folder, or use **git worktrees** (one extra folder per branch, shared history): `git worktree add ../wt-snap -b conduit/snap-engine`.
- **Git cannot nest branches.** A slash is only a label; `feature/conduit/snap-engine` does not live inside `feature/conduit` and receives none of its updates. A name cannot be both a branch and a "folder" (`feature/conduit` vs `feature/conduit/x` conflict).
- "1 agent = 1 task = 1 branch (= 1 worktree if parallel)" is a professional, standard workflow. Long-lived branches are what cause merge pain.

### Running agents all day with little intervention (OpenCode + DeepSeek or Antigravity)
1. A written goal file (`TASKS.md`): small checklist items.
2. A way to verify (tests, build, linter); "do not move on until they pass".
3. Auto-approve safe permissions (edit files, run tests).
4. Safety net: separate git branch, commit per task, ideally a container/VM.
5. Spending cap on the API account.
6. Keep the laptop awake and plugged in (`caffeinate -i`, power settings, or `systemd-inhibit`); run in `tmux`.
7. Start with a 1-hour test on a throwaway project. Expect to get stuck around hour 2-3; use a `NOTES.md` for blockers and check the git log instead of watching.

---

## 3. Findings from the repository

### 3.1 BLOCKER: `main` does not build (tray app)
- `npm test` passes (67/67) and `npm run build:conduit` works, but **`npm run build` fails**: `src/main.js` declares `highlighter` and `hider` twice (line 289 destructures them from `engine`; lines 328 and 390 declare them again).
- Introduced by merge commit `cf0a947` ("Merge codex/ifc-routing into main"). Both parents (`114c321`, `d86ab22`) parse fine alone; git merged without a textual conflict but produced invalid code.
- Inherited by snap-engine, fitting-solver, mep-hud and bom-export (all branch from `cf0a947`).
- Fix: remove the old duplicate declarations and the second `highlighter.setup` block, keeping the engine's versions. Nothing catches this today because there is no CI.

### 3.2 What is working well
- The four conduit feature branches are already independent. Snap, fitting and BOM each add new files in `packages/conduit-core/` (+ one `export * from ...` line in `index.js`); HUD adds files in `conduit-takeoff/`. The only overlap is that one line in `index.js` (trivial to resolve: keep all lines).
- Clean, small shared engine (`engine.js`, 150 lines); `docs/` with architecture notes; pure-logic `packages/`; Node's built-in test runner; small dependency list.

### 3.3 Structural problems (ranked)
1. **`src/main.js` is a 4,645-line monolith.** `initApp()` spans lines 285-4638 with ~119 nested functions. Every tray feature edits it, so parallel agents collide regardless of branch names. Split into feature modules (loader, property panel, tagging panel, system manager, Excel linking, safe-editor UI).
2. **Viewer is not a module.** The tray app imports `./covillaf/engine.js`; the conduit app reaches in via Vite alias `@covillaf` -> `../src/covillaf`. The ~50-line web-ifc/worker Vite plugin is copy-pasted into both Vite configs. Move engine + coordinates + plugin into `packages/viewer-core/`.
3. **Tray tests live in the wrong package.** `packages/routing-core/test/` tests tagging/IFC-export code in `src/` via `../../../src/...`. The package imports upward into app code. No workspaces configured.
4. **No safety rails:** no `.github/` (CI), no `AGENTS.md`, no linter/formatter. One CI job running `npm test`, `npm run build`, `npm run build:conduit` would have caught 3.1.
5. **Test coverage is partial.** The `test` script covers only `routing-core` and `conduit-core` (the tray tagging tests sit inside routing-core). The viewer and UI have none.
6. **`ThatOpenEngine/` is a different product** (see section 6): move it out of this repo.
7. **Repo hygiene:** tracked `__pycache__/*.pyc`, two `.nwc` (~276 KB each), `.log.html`, `.xlsx` files; five planning `.md` files in the root; root README only describes the tray app and the repo description still says "cable tray scheduling tool".
8. **Dependency:** `xlsx@0.18.5` (SheetJS on npm) is the last npm release and has known advisories; you load user-supplied Excel files, so evaluate SheetJS's own distribution or a replacement.
9. **Public-repo exposure:** `.gitignore` says `*.ifc` "may contain sensitive BIM data", yet `.nwc` and shared-parameter files from project `P22115-CC-2140-07-05` are committed. Confirm you may publish them.

### 3.4 Branch state
| Branch | Tip | Status |
|---|---|---|
| `origin/main` | 9e1a9b4 | trunk; contains the build bug |
| `codex/batch-tagging-workbench` | 4387217 | merged history; can delete |
| `codex/ifc-routing` | d86ab22 | merged history; can delete |
| `feature/revit-snap-engine` | bed0e45 | +702 lines, 4 files (conduit-core) |
| `feature/revit-fitting-solver` | 88d6bd1 | +526 lines, 4 files (conduit-core) |
| `feature/revit-mep-hud` | cf0c5e0 | +557 lines, 5 files (conduit-takeoff) |
| `feature/revit-bom-export` | 322752e | +604 lines, 4 files (conduit-core) |
| remote `feature/revit-viewport-controls`, `integration/revit-conduit` | cf0a947 | empty pointers; real work is local and **not pushed** |

Push the two local branches soon; their work is unprotected.

---

## 4. Branching recommendations

- **One trunk (`main`).** Two long-lived trunks would make every engine fix land twice. Tagging and conduit routing are already on `main`.
- **Flat branch names off `main`:** `conduit/<topic>`, `tray/<topic>`, `viewer/<topic>`, `fix/<topic>`. Short-lived (hours to days), merged back often. Use a simple on/off flag for half-finished features instead of a long-lived integration branch. `main` is the integration; `conduit/integration` becomes unnecessary once the features are merged.
- **Each branch edits only its module's folders** (state this in `AGENTS.md` and in each agent prompt). Shared-engine changes go in a small separate branch merged first; other branches then pull it in.
- **Do not run two agents on the same file in parallel** (e.g. `engine.js`): finish and merge one, then start the next.
- **Pull requests even when working solo:** review before merging.
- **Viewport controls:** generic orbit/pan/pick logic that edits `engine.js` belongs to the viewer module; drawing-specific suppression (keeping the rubber-band line while orbiting) stays in conduit. The local branch could not be inspected, so confirm the split there.

### Suggested order of work
1. Fix the duplicate declarations on a small branch; add the CI job. Nothing else merges before this.
2. Merge snap, fitting, BOM and HUD into `main` one at a time (resolve the one-line `index.js` overlap).
3. Create `packages/viewer-core`, add workspaces, then split `main.js` piece by piece (one branch per piece), moving tagging/IFC tests into a `tray-core` package.
4. Add `AGENTS.md` and a boundary lint rule.
5. Clean repo hygiene (samples, `.pyc`, root notes, README for both apps).

---

## 5. Rust plan

State today: `snap-engine`, `fitting-solver` and `bom-export` branches each include `rust-reference/*.rs` written to match the JS "1-to-1" via `wasm-bindgen`. Their diffs contain no `Cargo.toml`, so they look like drafts never compiled.

Recommendations:
- **`conduit-core` is the ideal first target:** pure math, no Three.js/DOM, one `index.js` entry point, existing tests.
- Port one function group at a time (snap, fittings, BOM) behind the same API.
- **Use the JS tests as the specification:** run the same test vectors against JS and Rust; switch only when they agree (golden tests).
- Tray logic (`tag-scheme`, `tag-validator`, routing graph/pathfinding) can follow later. IFC export depends on web-ifc and text handling: port last, if at all.
- **The viewer stays JS/TS** (That Open + Three.js); web-ifc is already WebAssembly.
- **Measure before porting.** Rust pays off where profiling shows a bottleneck (routing on large models, stick-cut optimizer). Snapping math rarely needs it for 60 fps.
- Python Excel bridge (`excel-ifc-bridge`): the planning notes rate a Rust port 6.5/10 (Axum + calamine are easy; IFC geometry is hard). Lowest priority.
- Prerequisite: `main` must build and CI must run tests, otherwise you cannot tell whether a port changed behavior.

---

## 6. `ThatOpenEngine/` and the free That Open Engine

**Verdict: `ThatOpenEngine/` is not a fork or optimization of the free That Open Engine.** It is a snapshot of the interface and kernel pieces of **COVILLAF SIMULATE** (structural analysis, SAP2000-style), "the third product of the COVILLAF family, sibling of COVILLAF 3D (viewer) and COVILLAF DESIGN".

| | Free That Open Engine | `ThatOpenEngine/` folder |
|---|---|---|
| Purpose | Library for 3D BIM viewers | Structural-analysis product (static, modal solvers, results display) |
| Content | Libraries (MIT) | 51 tracked files, ~9.6k lines: 18 Python, 15 TypeScript, 6 docs, 5 json, 4 mjs |
| That Open code inside | All of it | None (no That Open imports in any file) |
| Third-party use | n/a | Only three.js in `capa-resultados.ts` |

- Cannot run from this repo: flattened from a monorepo; imports `@covillaf-simulate/viewer`, `@covillaf-design/ui/protocolo`; `vite.config.ts` throws if the "COVILLAF DESIGN" sibling folder is missing; Python imports `covillaf.sim.*` which is not included.
- Your own `docs/covillaf-next.md` confirms: "`ThatOpenEngine` is the simulation shell and does not contain those modules"; its simulation pieces "stay disconnected". Nothing in the JS apps imports it.
- Its own decision H-02: the COVILLAF 3D viewer "is consumed by alias, never duplicated". That supports a shared `viewer-core` package (three consumers: tray, conduit, Simulate).
- Recommendation: move it to its own repo (or rename it) so agents do not mistake it for the engine.

### Where That Open actually enters: `src/covillaf/engine.js`
| Stock That Open (used as-is) | Added by COVILLAF |
|---|---|
| World, SimpleScene, SimpleCamera, RendererWith2D, Grids, FragmentsManager, IfcLoader, Highlighter, Hider, Raycasters | Offline wasm + worker paths (no CDN) |
| | Fragment worker, `graphicsQuality = 1`, polygon-offset on non-LOD materials |
| | Middle-mouse pan, `addAllAttributes/Relations` on load, fallback load |
| | Own code: `pick()` with snapping, `paintGroups()`, `coordinates.js` (scene <-> IFC axes) |

**Is COVILLAF 3D improving That Open by modifying its libraries? No, not by what is visible.** `package.json` installs `@thatopen/components`, `components-front`, `fragments` and `web-ifc` unchanged from npm; there is no patch folder or vendored copy. The "optimization" is configuration plus a thin wrapper. No benchmarks were found. The separate COVILLAF 3D repo could not be inspected, so patches there cannot be ruled out. Not confirmed: whether `COORDINATE_TO_ORIGIN` already defaults to on in the stock loader. That Open's online docs could not be opened; the comparison used the installed 3.4.x packages.

### Stock That Open features worth checking before building your own
The installed packages already export `Clipper` (section planes), `Hider` (isolate), `Classifier`, `LengthMeasurement` / `AreaMeasurement` / `VolumeMeasurement`, `SnapResolvers`, `VertexPicker`, `DxfExporter`, `TechnicalDrawings`, BCF tools. These overlap `docs/covillaf-next.md` ideas (section planes, ghost isolate) and the conduit snap engine. Fit for your needs was not tested.

### Licenses and privacy
- Installed: `@thatopen/components` 3.4.6 (MIT), `components-front` 3.4.3 (MIT), `fragments` 3.4.5 (MIT), `three` 0.184.0 (MIT), `camera-controls` 3.1.2 (MIT), `xlsx` 0.18.5 (Apache-2.0), **`web-ifc` 0.0.77 (MPL-2.0)**. MPL-2.0 is a file-level copyleft: it matters if you modify web-ifc's own files. Not legal advice; check before any commercial release.
- The SIMULATE logbook (in the public repo) contains a personal email address (git author) and your machine inventory. SIMULATE's own docs state clean-room and confidentiality rules; confirm what is meant to be public.

---

## 7. Action checklist

- [ ] Fix duplicate `highlighter` / `hider` declarations in `src/main.js`; confirm `npm run build` passes.
- [ ] Add CI: `npm test`, `npm run build`, `npm run build:conduit`.
- [ ] Push local `feature/revit-viewport-controls` and `integration/revit-conduit`.
- [ ] Merge snap, fitting, BOM, HUD into `main` one at a time.
- [ ] Create `packages/viewer-core`; add npm workspaces; remove the duplicated Vite plugin.
- [ ] Split `src/main.js` into feature modules (one branch per piece); move tray tagging/IFC tests out of `routing-core`.
- [ ] Add `AGENTS.md` (folder ownership per branch type) and a boundary lint rule.
- [ ] Move or rename `ThatOpenEngine/`; review what must not be public (project files, logbook email, machine inventory).
- [ ] Clean tracked junk (`__pycache__`, `.nwc`, `.log.html`, root `.md` notes); update README and repo description for both apps.
- [ ] Evaluate `xlsx` replacement.
- [ ] Rust: add `Cargo.toml` + golden tests for `conduit-core`; port only after profiling shows a need.
- [ ] Delete merged branches `codex/batch-tagging-workbench` and `codex/ifc-routing`.

---

## 8. What was not verified
- Contents of the unpushed local branches and the COVILLAF 3D / DESIGN repos.
- Whether the `rust-reference` files compile or match the JS exactly.
- Whether `routing-core/vector.js` and `conduit-core/geometry.js` duplicate each other.
- Whether That Open's stock `SnapResolvers` / `Clipper` etc. fit your use cases.
- Runtime behavior of either app in a browser (only unit tests and builds were run).
