# Parallel-Agent Architecture: 5 fully independent lanes

Status: **v0.2**, 2026-10-23. Companion to `ARCHITECTURE.md` (product
design) and `docs/THINKING_SPECS.md` (goals + Revit/Navisworks parity
analysis). This file designs **how 5 agents work at the same time with
zero shared files** — no claim races, no blocker-log conflicts, no
overlapping edits.

Branch: `spec/parallel-docs`
Owner folders: `docs/THINKING_SPECS.md`, `docs/ARCHITECTURE-PARALLEL-AGENTS.md`
(this file), `docs/claims/`, `docs/blockers/`.
Non-goals: changing product code, changing CI. `AGENTS.md` ownership +
claim protocol changes are in this branch under explicit owner approval
(chat 2026-10-23) — owner merges.

## Changelog v0.1 -> v0.2 (owner decisions, chat 2026-10-23)

| # | Decision | Effect on this doc |
|---|---|---|
| O1 | `AGENTS.md` change approved | §2 protocol + ownership table below now normative; `AGENTS.md` edited in this branch (owner merges per high-risk rule) |
| O2 | Ownership: "proceed as you need" | §1 lane split + §2.3 ownership deltas are authoritative pending `AGENTS.md` merge |
| O3d | Routing frame: up = Z | Lane C builds in **IFC Z-up** metres; legacy Y-up scene values converted at the edge (`viewer-core/coordinates.js`). `ARCHITECTURE.md:247` OPEN item closed |
| O3a | Couplings formula (owner asked for recommendation) | **Recommended + adopted as interim:** BOM governs quantities with `couplings = max(0, sticks-1)` per `bom-calculator.js:172`. The overlay spec's `ceil(len/stick)+elbows` overcounts a straight 10 ft stick as 1 coupling vs 0 — treated as a bug in the Python-spec copy until the owner says otherwise. `takeoff.js:10` "out of scope" is outdated. Lane A pins the BOM formula in `docs/specs/conduit/wasm-switch.md`; the [OPEN] below tracks final owner sign-off |
| O3e | 7.1–7.3 status: "build it if you need it" | `docs/TASKS.md:66-68` marks 7.1/7.2/7.3 `done`, but `apps/*` on `main` are scaffold READMEs and `src/main.js` is still 4,559 lines. Lane D treats them as **[UNVERIFIED]**: if the split modules it needs are missing, it rebuilds the minimum inside its owned files and records it in the spec |
| O4-base | Base = `origin/main@01452fe`, reuse branches OK, `Cargo.lock` at agent discretion | §3 pins base to `01452fe` (or newer `origin/main`). Lane A reuses the existing `rust/conduit-wasm` branch (currently at `c0da00c`). This branch reverted its own dirty `Cargo.lock` to stay docs-only; lanes follow §2.6 |

## 0. Answers to the owner's questions

**Q1 — totally independent lanes.** Yes. §1 defines 5 lanes whose owned
folders, vector files, and spec files are pairwise disjoint. Two agents
never `git add` the same path. The only shared touchpoints
(`docs/TASKS.md` board, `NOTES.md` blockers, `main`) are removed from the
write path by §2.

**Q2 — claim mechanism: per-task claim files on `main` (approved).**
Editing the `docs/TASKS.md` table is a shared-write hotspot: 5 agents
committing one-line changes to the same table means rebase conflicts on
nearly every claim. Claim files (`docs/claims/<task-id>.json`, one file
per task — see `docs/claims/README.md`) mean two agents only ever touch
the same file when they claim the *same* task — and then git flags it.
Protocol (v2, §2.1): claims commit **directly to `main`**, not to lane
branches, so every agent sees every claim with a plain `git fetch`.
Disjoint filenames rebase cleanly; same filename = someone was first.

**Q3 — rebase first, then independent lanes.** Every agent starts from
`origin/main@01452fe` (or newer), each in their own worktree + branch —
never from a stale checkout. The board on `main` is the source of truth.

## 1. Lane map (5 lanes, zero file overlap)

Dependency direction stays downward-only (`ARCHITECTURE.md` §2, rule 6:
apps use `viewer-core` and bindings **side by side**; `viewer-core`
never depends on product cores).

```
Lane A ── bindings/conduit-wasm/  apps/conduit-takeoff/   (4.6)
Lane B ── crates/tray-tagging/    tray tagging vectors    (5.1)
Lane C ── crates/tray-routing/    tray routing vectors    (5.2)
Lane D ── src/ safe-editor only   tray safe-editor spec   (7.4)
Lane E ── scripts/parity-*        parity harness spec     (8.1 dry run, read-only)
```

| Lane | Task | Branch (reuse OK) | Owned folders/files (exclusive) | Done when |
|---|---|---|---|---|
| A | 4.6 `conduit-wasm` binding + app flag | `rust/conduit-wasm` (exists at `c0da00c`, rebase onto `01452fe`) | `bindings/conduit-wasm/`, `apps/conduit-takeoff/`, `docs/specs/conduit/wasm-switch.md` (new, lane-local). Reads (never writes): `spec/vectors/conduit/*` | `wasm-pack build` green; app builds behind flag; all **165** conduit vector cases pass through the binding (per-file: `bom-engine 8`, `bom 6`, `fitting-engine 15`, `fitting 11`, `io 12`, `network-history 2`, `network-registry 2`, `network 19`, `snap-engine 24`, `snap 22`, `takeoff-io-engine 6`, `takeoff 20`, `units 18`); couplings pinned to BOM formula per O3a |
| B | 5.1 `tray-tagging` | `rust/tray-tagging` | `crates/tray-tagging/`, `spec/vectors/tray/tagging.json` (33 cases), `spec/vectors/tray/validator.json` (7 cases), `docs/specs/tray/tagging.md`. Runner (read-only): `scripts/run-tray-vectors.mjs --file tagging\|validator` | tagging + validator vectors pass in Rust (`cargo test -p tray-tagging`) |
| C | 5.2 `tray-routing` | `rust/tray-routing` | `crates/tray-routing/`, `spec/vectors/tray/routing.json` (26 cases), `spec/vectors/tray/ifc-io.json` (25 cases), `docs/specs/tray/routing.md`. Runner (read-only): `scripts/run-tray-vectors.mjs --file routing\|ifc-io` | routing vectors pass in Rust (`cargo test -p tray-routing`); **frame declared Z-up per O3d**, legacy Y-up converted at edge |
| D | 7.4 Safe IFC Editor (port last) | `app/safe-ifc-editor` | `src/ifc/ifc-safe-editor.*` and its UI modules only (never `src/main.js`), `docs/specs/tray/safe-ifc-editor.md`. Reuses `ifc-io` (read-only). Per O3e: if 7.1–7.3 split modules are missing, rebuild the minimum inside owned files and record it | editor modules split out; behaviour unchanged (`npm test` green, same `-edited.ifc` output on fixture); spec documents the `applySafeEdits` Wasm contract |
| E | 8.1 parity harness (dry run) | `spec/parity-harness` | `scripts/parity-*` (new), `docs/specs/parity.md` (new) — **reads everything, writes only its own files** | harness runs the parity checklist (`ARCHITECTURE.md:193`: all golden vectors pass in Rust, both apps build + smoke test, tag round-trip matches, no `legacy/` imports) end-to-end and reports pass/fail without deleting anything |

Split rationale:

* B/C split the tray vectors **by file**: B owns `tagging.json` +
  `validator.json`, C owns `routing.json` + `ifc-io.json`. No shared
  vector file, no merge conflict. Shared runner `scripts/run-tray-vectors.mjs`
  is **read-only** (it already takes `--file`); lane-local helpers go in
  lane-owned spec dirs.
* D never touches `src/main.js` (4,559 lines, single-writer hazard);
  only the safe-editor modules. `main.js` stays frozen until lanes B–D
  land.
* E is read-only against product code: it may `Read`/`cargo test`/
  run vector runners anywhere, but may only **write** inside
  `scripts/parity-*` and `docs/specs/parity.md`.

Deferred (not lanes — they depend on lanes above):

* 5.3 `tray-wasm` — blocked on B + C.
* 8.1 real (`infra/remove-legacy`, `legacy/` deletion) — high-risk,
  owner merges; blocked on A + 5.3 + 6.2 + 7.1 + 7.2.
* Any `infra/*` (root configs, CI, workspace manifests) — one agent at
  a time per `AGENTS.md`; none scheduled while 5 lanes run.

## 2. Zero-shared-file protocol (v2 — normative pending AGENTS.md merge)

1. **Claims (v2 — fixed):** one file per task in `docs/claims/` (see
   `docs/claims/README.md`), committed **directly to `main`**, not to
   the lane branch. Never edit `docs/TASKS.md` to claim.
   `TASKS.md` remains the human-readable board; a periodic infra task
   syncs claim files back into it (see §2.7).
   Why `main`: lane branches are invisible to other agents until PR;
   `main` is the one ref everyone fetches. Disjoint filenames rebase
   without conflicts; identical filename = claim race, loser picks
   another lane (§6).
2. **Blockers:** one file per branch in `docs/blockers/` (see
   `docs/blockers/README.md`). Never append to `NOTES.md` from a lane;
   a periodic infra task rolls blocker files up into `NOTES.md`.
   Blocker files commit on the lane branch (they are read at PR time,
   so no shared ref needed).
3. **Owned folders only:** `AGENTS.md` ownership table applies as amended
   for this design (see §2.3 deltas): `spec/*` owns `docs/specs/**`,
   `spec/vectors/**`, `docs/claims/`, `docs/blockers/` templates. Lane E
   additionally owns `scripts/parity-*`.
4. **`legacy/` is frozen:** run it, read it, never edit it (until 8.1).
5. **Shared-file need?** If a lane needs a workspace-config or CI
   change: stop, file it in your blocker file, do not touch it.
   Shared changes get their own small `infra/*` branch, merged first,
   one agent at a time.
6. **`Cargo.lock` rule:** never commit `Cargo.lock` changes unless you
   add/remove a dependency. `cargo test`/`wasm-pack build` may dirty it
   locally — run `git checkout -- Cargo.lock` before every commit unless
   the diff is intentional. This branch follows the rule (reverted its
   own `Cargo.lock` churn to stay docs-only).
7. **Sync tasks (infra, owner-scheduled):** `infra/claims-sync` rolls
   `docs/claims/*.json` into `docs/TASKS.md` Owner/Status columns;
   `infra/blockers-rollup` appends `docs/blockers/*.md` into `NOTES.md`.
   Lanes never do this themselves.

### 2.3 Ownership deltas vs AGENTS.md (applied in this branch per O1/O2)

* New row `spec/*`: owns `docs/specs/**`, `spec/vectors/**`,
  `docs/claims/`, `docs/blockers/` templates; lane E (`spec/parity-harness`)
  additionally owns `scripts/parity-*`.
* `rust/tray-*` split for lanes B/C: `rust/tray-tagging` owns
  `crates/tray-tagging/` + `tagging.json` + `validator.json` +
  `docs/specs/tray/tagging.md`; `rust/tray-routing` owns
  `crates/tray-routing/` + `routing.json` + `ifc-io.json` +
  `docs/specs/tray/routing.md`. Neither touches the other's vector files.
* `app/safe-ifc-editor` (only): may edit `src/ifc/ifc-safe-editor.*`
  and its UI modules, never `src/main.js`. No other `app/*` branch
  touches `src/`.
* Shared vector runners (`scripts/run-*-vectors.mjs`),
  `Cargo.toml`, `.github/`, `package.json` stay frozen for lanes.

## 3. Worktree bootstrap (each agent, copy-paste)

Base is `origin/main@01452fe` or newer. Reusing an existing branch name
(e.g. `rust/conduit-wasm`) is allowed — rebase it, do not fork it.

```bash
git fetch origin --prune
# 1. claim on main (shared ref — everyone sees it):
git checkout main && git pull --rebase origin main
printf '{"owner":"<agent>","status":"in progress","branch":"<branch>","updated":"<date>"}' \
  > docs/claims/<task-id>.json
git add docs/claims/<task-id>.json && git commit -m "claim <task-id>" \
  && git pull --rebase origin main && git push origin main
# same filename appeared first = someone claimed it → pick another lane.
# 2. lane worktree (reuse or create the branch):
git worktree add ../wt-<lane> -b <branch> origin/main  # or: git checkout <branch> && git rebase origin/main
cd ../wt-<lane>
```

## 4. Local pre-push gate (each agent, copy-paste)

Run inside your worktree before every push. Boundary violations then
fail locally, not in CI. Keep the branch docs/code-only per §2.6
(`git checkout -- Cargo.lock` unless the dep change is intentional).

```bash
cargo fmt --check \
&& cargo clippy --workspace --all-targets -- -D warnings \
&& cargo test --workspace \
&& python3 scripts/check-boundaries.py \
&& npm test \
&& npm run build && npm run build:conduit
# plus, for your lane: the lane's vector runner, e.g.
# B: node scripts/run-tray-vectors.mjs --file tagging && node scripts/run-tray-vectors.mjs --file validator
# C: node scripts/run-tray-vectors.mjs --file routing && node scripts/run-tray-vectors.mjs --file ifc-io
# A: node scripts/run-conduit-vectors.mjs (all 13 files, 165 cases) && wasm-pack build bindings/conduit-wasm
# and wasm-pack build for any binding touched
```

## 5. Merge flow (tiered autonomy, unchanged from AGENTS.md)

1. `git pull --rebase origin main`, re-run the full §4 gate.
2. `gh pr create` listing: spec implemented, folders touched, test
   commands run, any `[UNVERIFIED]` item resolved or not.
3. Low-risk (`rust/*`, `viewer/*`, `app/*`, `spec/*`, `fix/*`): self-merge
   when CI is green (max 2 red-fix attempts, else blocker file + stop).
   High-risk (`infra/*`, `legacy/` deletion, history/policy changes):
   open PR, report, stop — owner merges.
   Note: **this** branch (`spec/parallel-docs`) becomes high-risk by
   touching `AGENTS.md` — open PR, report, stop; owner merges.
4. `gh pr merge --squash`; report PR number, merge SHA,
   `git revert <SHA>` one-liner; `git pull --rebase origin main`;
   delete the worktree branch. On completion, update your
   `docs/claims/<task-id>.json` to `"status": "done"` on `main`.

Rebase cadence with 5 agents: rebase daily; keep PRs small (small diff
preferred); never force-push, never rewrite history, no `rm -rf`.

## 6. Collision scenarios and resolution

| Scenario | Resolution |
|---|---|
| Two agents claim the same task | Claim files on `main`: second pusher's `pull --rebase` shows the file already exists with `"in progress"` → retries with a free lane. No conflict text to resolve — different lanes are different filenames. |
| Rebase conflict on `main` | Expected only if two lanes mis-declared ownership. Stop, compare §1 table, the lane that owns the path keeps it; the other rebases. Record in blocker file if recurring. |
| Claim-file push rejected (non-fast-forward) | `pull --rebase`, re-check the file: claimed → pick another lane; missing → push again. Max 2 retries, then blocker file + stop. |
| Stale claim (`in progress` with no commits/PR for >3 days) | Do not steal it. File a blocker noting the stale claim; owner reassigns. Expiry is owner-only. |
| CI red | Max 2 fix attempts on your branch, then blocker file + stop. Never fix another lane's files to green your PR. |
| Need a shared-file change | Stop, blocker file, do not touch. Infra branch handles it. |
| Blocked > 2 attempts | Blocker file + end turn (`AGENTS.md` unattended rule). |

## 7. What this branch adds

* `docs/THINKING_SPECS.md` — goals + parity analysis (Claude-corrected).
* This file (v0.2) — the 5-lane parallel design with owner decisions O1–O4 applied.
* `docs/claims/README.md` + `.gitkeep` — claim-file protocol (v2: claims commit to `main`).
* `docs/blockers/README.md` + `.gitkeep` — blocker-file protocol.
* `AGENTS.md` — ownership + claim-protocol update (owner-approved, owner merges).
* No product code touched. Docs-only: boundary check + `npm test`
  unaffected by construction (`Cargo.lock` reverted).

## 8. Open questions for the owner

Resolved in v0.2: (a-interim) couplings pinned to BOM formula
`max(0, sticks-1)` — needs final sign-off; (d) routing frame = Z-up;
(e) 7.1–7.3 treated as UNVERIFIED, Lane D rebuilds minimum if missing;
(g) claim/blocker files approved.
Still open: (b) NEC Table 2 edition check (5"/6" rows — vectors truncate
at 4", sizes above snap to the 4" radius); (c) keep or drop the 30.48 m
"100 ft straight pull" heuristic, never labelled NEC (real rule is the
360° one, NEC 358.26 / 344.26); (f) remove the two root P22115
sharedparameters files (still tracked, against `ARCHITECTURE.md:219`).
New: (h) confirm Lane A reuses `rust/conduit-wasm@c0da00c` (rebased) vs
a fresh branch name.
