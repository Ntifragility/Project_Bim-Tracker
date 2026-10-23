# Parallel-Agent Architecture: lanes with disjoint files

Status: **v0.3**, 2026-10-23. Companion to `ARCHITECTURE.md` (product design)
and `docs/THINKING_SPECS.md` (goals + parity analysis). This file defines
**how several agents work at the same time without touching the same file**.

Branch: `spec/parallel-docs-v03`
Owner folders: `docs/ARCHITECTURE-PARALLEL-AGENTS.md`, `docs/claims/README.md`,
`docs/blockers/README.md`.
Non-goals: product code, CI, `AGENTS.md` (the `AGENTS.md` edits in §9 are a
separate high-risk PR; the owner merges).

## Changelog v0.2 -> v0.3 (review of v0.2 against `origin/main@e6d597e`)

| # | Finding in v0.2 | Fix in v0.3 |
|---|---|---|
| 1 | Lane A "165 vectors pass through the binding" is impossible: 12 are `jsOnly`; the legacy runner exits 1 on `main` (140 pass / 25 fail) | §1 lane A uses the non-`jsOnly` set; §2 wave-0 task **P1** makes the legacy runner green by tagging Rust-only cases |
| 2 | Lane A owned `apps/conduit-takeoff/` (README only); the real app is root `conduit-takeoff/`; `rust/conduit-wasm@c0da00c` is not on the remote | Lane A owns root `conduit-takeoff/`; wave-0 **P0** pushes or replaces the branch |
| 3 | Lane C owned `ifc-io.json`, which pins tag-exporter and safe-editor shapes, not routing | `ifc-io.json` is frozen (nobody in wave 1); see §1 |
| 4 | Lane B owned `validator.json`, already read by `crates/ifc-io` tests (task 3.2) | Validator stays in `ifc-io`; lane B reads it, never edits it |
| 5 | Runner flag written `--file x`; the script parses `--file=x` (space form silently runs all 91 tray cases) | All commands use `--file=<name>` |
| 6 | Lane D needed `main.js` and a wasm home that `check-boundaries.py` forbids | Lane D deferred to wave 2, spec-only (§1, §7) |
| 7 | `spec/*` row owned `docs/specs/**` and `spec/vectors/**`, overlapping lanes A/B/C | `spec/*` owns only files it creates (§3) |
| 8 | Claim protocol: any push to `main` triggers full CI; collision leaves a half-done rebase; only `in progress` counted as taken; sync tasks unscheduled | Claims protocol v3 (§4), CI `paths-ignore` (**P2**), owner-run sync at wave end (§8) |
| 9 | Couplings decision framed as open; sticks epsilon mismatch unnoticed | §6: closed by D3; epsilon difference recorded as a known legacy divergence |
| 10 | Base pinned to `01452fe`; stale counts (`36` tests) | Base = `origin/main` at wave start, SHA recorded in each claim |

## 0. Principles

1. **One lane = one task = one branch = one worktree = one agent.**
2. **Owned paths are exclusive.** A path appears in at most one lane row.
   Everything not in a lane row is *frozen* for that wave.
3. **Shared state is reduced to files nobody else writes** (claim files,
   blocker files), never to a shared table or log.
4. **Rules are checked by tools**, not by trust (`check-ownership.py`,
   `check-boundaries.py`, CI).
5. **No new features** (D3). Known legacy bugs are documented with a vector,
   not fixed, until the parity gate (task 8.1) has passed.

## 1. Wave 1 lanes

Dependency direction is unchanged (`ARCHITECTURE.md` §2): apps use
`viewer-core` and bindings side by side; `viewer-core` never depends on
product cores.

| Lane | Task | Branch | Owned paths (exclusive) | Read-only for this lane | Done when |
|---|---|---|---|---|---|
| E | 8.1 dry run | `spec/parity-harness` | `scripts/parity-*`, `docs/specs/parity.md` | everything | Harness prints pass/fail per parity-gate item (`ARCHITECTURE.md` §7) and the baseline is committed in `docs/specs/parity.md`. Failing items are expected at this stage; nothing is deleted |
| B | 5.1 `tray-tagging` | `rust/tray-tagging` | `crates/tray-tagging/`, `spec/vectors/tray/tagging.json`, `docs/specs/tray/tagging.md` | `crates/ifc-io/`, `spec/vectors/tray/validator.json`, `scripts/run-tray-vectors.mjs` | `node scripts/run-tray-vectors.mjs --file=tagging` (legacy, 33 cases) and `cargo test -p tray-tagging` (same 33 cases) pass. Validator behaviour comes from the `ifc-io` crate (allowed edge `tray-tagging -> ifc-io`); lane B does not re-implement it |
| C | 5.2 `tray-routing` | `rust/tray-routing` | `crates/tray-routing/`, `spec/vectors/tray/routing.json`, `docs/specs/tray/routing.md` | `scripts/run-tray-vectors.mjs`, `crates/geom-core/` | `node scripts/run-tray-vectors.mjs --file=routing` (26 cases) and `cargo test -p tray-routing` pass. **Frame: IFC Z-up metres** (owner decision O3d). Legacy vectors are in scene space (Y-up), so the test loader converts with the mapping in `geom-core` (`spec/vectors/geom/frames.json`), never a hand-written one. `routing.json` stays valid for the legacy runner unchanged |
| A | 4.6 `conduit-wasm` | `rust/conduit-wasm` (after **P0**) | `bindings/conduit-wasm/`, `conduit-takeoff/` (the real app, root folder), `docs/specs/conduit/wasm-switch.md` | `spec/vectors/conduit/*`, `crates/conduit-core/` | `wasm-pack build bindings/conduit-wasm` green; `npm run build:conduit` green with the flag off **and** on; a JS test calls the binding on every non-`jsOnly` conduit case (at most 165 - 12 = 153; the spec lists any further exclusion such as TS-only `units.json` cases **[UNVERIFIED]**); couplings follow §6 |

Not in wave 1:

* **D, 7.4 Safe IFC Editor** — deferred to wave 2 and **spec-only** until 5.3
  exists (§7). Reasons: wiring the editor needs `src/main.js` (frozen),
  and `applySafeEdits` has no binding home (`check-boundaries.py` does not
  allow `tray-wasm -> ifc-io`, and there is no `ifc-wasm`).
* `spec/vectors/tray/ifc-io.json` (25 `jsOnly` shape pins of the tag
  exporter and safe editor) — frozen for everyone in wave 1; lane D takes it
  in wave 2.
* 5.3 `tray-wasm`, real 8.1 (`legacy/` deletion), any `infra/*`.

Why the split holds: B and C own different vector files; lane A reads the
vectors but owns no vector file; E writes only files it creates.

## 2. Wave 0: prerequisites (single agent each, merged before lanes start)

These touch shared or frozen files, so they run **one at a time**, in order,
before any lane claims work. Each is its own small branch.

| ID | Branch | Task | Why it is blocking |
|---|---|---|---|
| P0 | `fix/conduit-wasm-branch` | Push `rust/conduit-wasm` (local-only today) or declare "fresh branch from `main`" in this doc | Lane A cannot rebase a branch nobody else can see |
| P1 | `spec/conduit-vector-tags` | Tag the Rust-only cases in `spec/vectors/conduit/*` (`"rustOnly": true`, e.g. `snap-engine:config-defaults`, `takeoff-io-engine:findsnap-dangling-ref-skipped`) and make `run-conduit-vectors.mjs` skip them and exit 0 on `main` (today: 140 pass, 25 fail, exit 1). Do the same check for `run-tray-vectors.mjs`. Fix its usage comment to `--file=<name>` | The pre-push gate is unpassable otherwise, and ARCHITECTURE §6 requires the legacy JS to pass the vectors it can run |
| P2 | `infra/ci-claims` | (a) `ci.yml`: `paths-ignore: ['docs/claims/**', 'docs/blockers/**']` on `push` to `main`. (b) Add `scripts/check-ownership.py` (§3). (c) Wire it into `ci.yml` for pull requests | Claim commits otherwise start a full Rust + wasm build each; ownership is otherwise unenforced |
| P3 | `spec/bom-known-divergence` | In `docs/specs/conduit/bom.md`, add **KD-1** (§6) and one vector flagged `"knownDivergence"` | Keeps parity and records the bug |

P0 and P1 can run in parallel with each other; P2 and P3 after P1. Wave 1
starts when all four are merged.

## 3. Ownership rules

* An owned path is a file or folder in exactly one lane row at a time.
* **`spec/*` branches** own only files they **create** (`docs/specs/parity.md`,
  templates, harness scripts). They never own an existing spec or vector
  file; those belong to the lane that implements the feature. This replaces
  the v0.2 row that gave `spec/*` all of `docs/specs/**` and `spec/vectors/**`.
* `scripts/check-ownership.py <branch> <base>` (added in **P2**): maps the
  branch prefix and the lane table to allowed paths, lists
  `git diff --name-only <base>...<branch>`, and fails on any path outside the
  lane or inside the frozen list (`Cargo.toml`, `Cargo.lock` unless a
  dependency changed, `package.json`, `.github/`, `scripts/run-*-vectors.mjs`,
  `scripts/check-boundaries.py`, `legacy/`, `src/main.js`).
* `legacy/` is frozen: run and read it, never edit it.
* A lane that needs a frozen file stops and files a blocker (§5).

## 4. Claims (protocol v3)

Full protocol in `docs/claims/README.md`. Summary of changes from v0.2:

1. **Taken = a claim file exists**, whatever its status. Never overwrite one.
2. **Claim from a dedicated claims worktree** so a lost race cannot damage a
   lane checkout.
3. **Check before you commit**: `git fetch origin` then
   `git cat-file -e origin/main:docs/claims/<id>.json`. If it exists, pick
   another task.
4. **Record the base**: each claim stores the `origin/main` SHA the lane
   started from.
5. Claim and "done" commits touch only `docs/claims/` and are ignored by CI
   (P2). Claims are direct pushes to `main` by design; if `main` gets branch
   protection that forbids this, the owner must exempt `docs/claims/**` or
   the protocol must move to a `claims` branch **[OPEN, owner]**.

## 5. Blockers

* One file per branch, `docs/blockers/<branch-with-dashes>.md`, committed on
  the lane branch and **pushed**.
* Also set your claim file on `main` to `"status": "blocked"` with
  `"blocker": "<branch>"`, so the owner sees the blocker without opening
  every branch. (v0.2 left a blocked agent invisible until a PR existed.)
* Never append to `NOTES.md` from a lane.

## 6. Decisions recorded

**Couplings (closed).** The JS exporter writes three `Pset_ConduitRun`
properties (`Size`, `System`, `Length`). The Rust overlay reader
(`ifc-io`) returns a stored `Couplings` value and computes nothing. So no
current code needs the overlay's `ceil(len/stick)+elbows` rule; adding it
would be a new feature (D3). Rule for this rewrite: **BOM governs**,
`couplings = max(0, sticks - 1)`. The Python overlay spec's formula is
documented as superseded. `takeoff.js:10` ("couplings out of scope") is
correct and intentional: takeoff is the minimal quantity, BOM is the
schedule.

**KD-1: sticks epsilon (known legacy divergence).** `bom-calculator.js:171`
computes `ceil(len / stock)` with no tolerance; `takeoff.js:47` computes
`ceil(len / stock - 1e-7)`. A 3.048 m run plus 1e-12 gives 2 sticks and 1
coupling in the BOM but 1 stick in takeoff. Keep legacy parity until the
parity gate; document it in `bom.md`; fix afterwards by applying the takeoff
tolerance everywhere (owner to confirm).

**Routing frame:** Z-up (O3d), converted at the edge.

**7.1–7.3:** `TASKS.md` says done, but `apps/*` hold only READMEs and
`src/main.js` is still 4,559 lines (also on the unmerged `app/split-main-js`
and `app/modular-tray-ui` branches). Treat as **not done** and re-open in
`TASKS.md` (owner).

**Open for the owner:** (a) NEC Table 2: the 10 rows are the one-shot /
full-shoe column; confirm against your edition and add the 5" and 6" rows
(from memory 24 in and 30 in, **verify**); name the column in `fitting.md`.
(b) Keep or drop the 30.48 m "100 ft pull" heuristic; never label it NEC.
(c) Remove the two tracked `P22115-*` shared-parameter files at the repo
root (`ARCHITECTURE.md` §9). (d) Branch protection vs direct claim pushes
(§4). (e) Re-open 7.1–7.3.

## 7. Wave 2 (after wave 1)

* **D, 7.4:** `spec/safe-editor-wasm` first. It decides the binding home
  (either allow `tray-wasm -> ifc-io` in `check-boundaries.py` via an infra
  branch, or add `ifc-wasm`). Only then `app/safe-ifc-editor`, and only after
  the tray app split exists (re-opened 7.1).
* **5.3 `tray-wasm`:** after B and C.
* **Real 8.1:** `infra/remove-legacy`, owner merges, after A, 5.3, 6.2, 7.1,
  7.2.

## 8. Wave rhythm and owner tasks

1. Wave 0 (P0–P3), then wave 1 lanes in parallel.
2. At the end of each wave the **owner** (or one infra agent) runs
   `infra/claims-sync` (`docs/claims/*.json` -> `docs/TASKS.md`) and
   `infra/blockers-rollup` (`docs/blockers/*.md` -> `NOTES.md`). Lanes never
   do this.
3. Lane E re-runs the parity harness after every wave and commits the new
   baseline.

## 9. `AGENTS.md` edits (separate high-risk PR, owner merges)

* Point the claim section at `docs/claims/README.md` v3.
* Allow one narrow exception to "no destructive commands": inside the
  dedicated claims worktree only, `git reset --hard origin/main` after a lost
  claim race.
* Replace the `spec/*` ownership row with the §3 wording.
* Add the `check-ownership.py` step to "Definition of done".

## 10. Worktree bootstrap

```bash
git fetch origin --prune
# Claim (dedicated worktree; see docs/claims/README.md v3):
git worktree add ../wt-claims -B claims-<agent> origin/main   # first time only
cd ../wt-claims && git fetch origin && git reset --hard origin/main
git cat-file -e origin/main:docs/claims/<task-id>.json 2>/dev/null \
  && { echo "taken"; exit 1; }
printf '{"owner":"<agent>","status":"in progress","branch":"<branch>","base":"%s","updated":"<date>"}\n' \
  "$(git rev-parse origin/main)" > docs/claims/<task-id>.json
git add docs/claims/<task-id>.json && git commit -m "claim <task-id>"
git push origin HEAD:main || { git fetch origin; git reset --hard origin/main; echo "lost race, pick another task"; }
# Lane worktree (reuse the branch name if it exists on the remote):
cd .. && git worktree add ../wt-<lane> -b <branch> origin/main
```

## 11. Pre-push gate (inside your lane worktree)

```bash
git checkout -- Cargo.lock   # unless you changed a dependency
cargo fmt --check \
&& cargo clippy --workspace --all-targets -- -D warnings \
&& cargo test --workspace \
&& python3 scripts/check-boundaries.py \
&& python3 scripts/check-ownership.py <branch> origin/main \
&& npm test \
&& npm run build && npm run build:conduit
```

Plus your lane's own commands:

| Lane | Extra commands |
|---|---|
| B | `node scripts/run-tray-vectors.mjs --file=tagging` ; `cargo test -p tray-tagging` |
| C | `node scripts/run-tray-vectors.mjs --file=routing` ; `cargo test -p tray-routing` |
| A | `node scripts/run-conduit-vectors.mjs` (exit 0 after P1) ; `wasm-pack build bindings/conduit-wasm` ; the binding JS test |
| E | the parity harness itself |

First command for every lane: run its own vector command **before** writing
code and record the baseline in your spec.

## 12. Merge flow and collisions

* Low-risk (`rust/*`, `viewer/*`, `app/*`, `spec/*`, `fix/*`): rebase, rerun the
  gate, `gh pr create`, wait for green CI, `gh pr merge --squash`, report PR
  number, SHA and `git revert <SHA>`, then set the claim to `done` on `main`.
* High-risk (`infra/*`, `legacy/` deletion, `AGENTS.md`, policy, history):
  open the PR and stop; the owner merges.
* Never force-push, rewrite history or run `rm -rf`.

| Scenario | Resolution |
|---|---|
| Same task claimed twice | The claim file already on `main` wins; the second agent resets its claims worktree and picks another task |
| `check-ownership.py` fails | You edited a path outside your lane. Revert it; if you truly need it, file a blocker |
| CI red | Two fix attempts on your branch, then blocker file, claim `blocked`, stop. Never fix another lane's files |
| Stale claim (no commits or PR for 3 days) | Do not take it over. File a blocker naming the stale claim; the owner reassigns |
| Rebase conflict on lane files | Two lanes own the same path: stop and file a blocker (the lane table is wrong) |
