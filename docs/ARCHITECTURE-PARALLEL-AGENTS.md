# Parallel-Agent Architecture: 5 lanes for the remaining work

Status: **v1.0**, 2026-10-26. Companion to `ARCHITECTURE.md` v1.0 (product
design). This file defines **how 5 agents work at the same time without
touching the same file** for the work left after #42–#47 + #41.

Branch: `spec/parallel-lanes-v1`
Owner folders: `docs/ARCHITECTURE-PARALLEL-AGENTS.md` (this file),
`docs/claims/README.md`, `docs/blockers/README.md`.
Non-goals: product code, CI config, `AGENTS.md` (lane-table AGENTS.md edits
are a separate high-risk PR; the owner merges).

Supersedes: `spec/parallel-docs` (v0.2, base `01452fe`) and the closed
`spec/parallel-docs-v03` (v0.3 draft — wave plan targeted 4.6/5.1/5.2,
merged as #44/#42/#43; P0/P1 moot on current main). Reusable from v0.3:
claims v3 protocol (taken = file exists, dedicated claims worktree, base
SHA recorded) — adopted below as §4.

## §0 Principles

1. **One lane = one task = one branch = one worktree = one agent.**
2. **Owned paths are exclusive.** A path appears in at most one lane row.
   Everything not in a lane row is *frozen* for this wave.
3. **Shared state is reduced to files nobody else writes** (claim files,
   blocker files), never to a shared table or log.
4. **Rules are checked by tools**, not by trust (`check-boundaries.py`, CI).
5. **No new features** (D3). Known legacy divergences are documented with a
   vector, not fixed, until the parity gate (8.1) passes.

## §1 Wave 1 lanes (base: `origin/main@15d848b` or newer)

Remaining `todo` on the board: 7.2, 7.4, 8.1 (entry needs 7.2 + 7.4).
Plus the two flag follow-ups named in the landed wasm specs.

| Lane | Task | Branch | Owned paths (exclusive) | Read-only for this lane | Done when |
|---|---|---|---|---|---|
| 1 | 7.2 `app/conduit-ui-split` | `app/conduit-ui-split` | `conduit-takeoff/src/ui/` (new), `conduit-takeoff/src/main.js` (rewrite ≤150 lines). Leaves frozen: `drawing-tool.js`, `mep-hud.js`, `surface-picker.js`, `viewport-controls.js`, `properties-panel.js` | `packages/conduit-core/`, `packages/viewer-core/` | Per `docs/specs/conduit/conduit-ui-split.md`: coordinator ≤150 lines; 8 `ui/` modules; `api.*` 100% resolve; `npm test` 92/92; both builds; boundaries OK; `window.__drawingTool` present |
| 2 | 7.4 `app/safe-ifc-editor` | `app/safe-ifc-editor` | `src/ifc/ifc-safe-editor.*` (modules split out) + its UI glue under `src/ui/` (new files only — never edits an existing `src/ui/*.js`), `docs/specs/tray/safe-ifc-editor.md` ( Touch only if behaviour changes) | `crates/ifc-io/`, `src/ui/properties-panel.js` (integration point, reads only) | Per `docs/specs/tray/safe-ifc-editor.md` §5: whitelist + type-table enforced; `-edited.ifc` byte-identical source; `npm test` + `npm run build` green |
| 3 | 4.6-follow `app/conduit-wasm-flag` | `app/conduit-wasm-flag` | `conduit-takeoff/src/` flag factory (new file, e.g. `backend.js`; ≤20-line touch in `main.js` import site — coordinate via blocker if lane 1 rewrote it) | `bindings/conduit-wasm/`, `crates/conduit-core/` | Per `docs/specs/conduit/conduit-wasm.md` R5: `?core=wasm` boots, takeoff numbers byte-equal to JS backend on synthetic fixture; both builds green |
| 4 | 5.3-follow `app/tray-wasm-flag` | `app/tray-wasm-flag` | `src/` flag factory (new file; ≤20-line touch at call sites — per-module tagging/routing) | `bindings/tray-wasm/`, `crates/tray-tagging/`, `crates/tray-routing/` | Per `docs/specs/tray/tray-wasm.md` R6: per-module flag, legacy default; app builds + runs flag on/off |
| 5 | 8.1-dry `spec/parity-harness` | `spec/parity-harness` | `scripts/parity-*` (new), `docs/specs/parity/parity-harness.md` (new) — **reads everything, writes only its own files** | everything (vectors, runners, apps) | Harness executes the 10 checks in `docs/specs/parity/parity-gate.md` and prints pass/fail per item; failing items expected (7.2/7.4 not landed); nothing deleted |

Why the split holds:

* Lanes 1 and 3 both touch `conduit-takeoff/src/` but disjoint files:
  lane 1 owns `ui/` + the `main.js` rewrite; lane 3 owns one new factory
  file + a ≤20-line import-site touch. If lane 1's rewrite lands first,
  lane 3 rebases and re-applies the touch; collision is one hunk, not a
  file. (Alternative: lane 3 waits for lane 1's PR — owner decides at
  claim time.)
* Lanes 2 and 4 both touch `src/` but disjoint files: lane 2 owns
  `src/ifc/ifc-safe-editor.*` + *new* `src/ui/` glue; lane 4 owns one new
  factory file + call-site touches. Neither edits `src/main.js` (frozen:
  7.1 coordinator, 153 lines) or any existing `src/ui/*.js`.
* Lane 5 writes only files it creates. `scripts/run-*-vectors.mjs`,
  `scripts/check-boundaries.py`, `Cargo.toml`, `package.json`, `.github/`,
  `legacy/` stay frozen for all lanes.
* `spec/*` branches own only files they **create** (replaces the v0.2 row
  that gave `spec/*` all of `docs/specs/**` + `spec/vectors/**`).

Deferred (not lanes — depend on lanes above):

* 8.1 real (`infra/remove-legacy`, `legacy/` deletion) — high-risk,
  owner merges; blocked on lanes 1 + 2 (+ flags).
* Any `infra/*` (root configs, CI, manifests) — one agent at a time per
  `AGENTS.md`; none scheduled while 5 lanes run.

## §2 Frozen list (all lanes)

`legacy/`, `src/main.js`, existing `src/ui/*.js` (except lane 1's
`conduit-takeoff/src/ui/` which is new), `conduit-takeoff/src/drawing-tool.js`,
`conduit-takeoff/src/{mep-hud,surface-picker,viewport-controls,properties-panel}.js`,
`scripts/run-*-vectors.mjs`, `scripts/check-boundaries.py`, `Cargo.toml`,
`package.json`, `.github/`, `apps/*` (scaffold READMEs), `NOTES.md`
(rollup target — lanes write blocker files, never the log).

## §3 Worktree bootstrap (each agent, copy-paste)

```bash
git fetch origin --prune
# 1. claim on main (shared ref — everyone sees it), from a claims worktree:
git worktree add ../wt-claims -B claims-<agent> origin/main
cd ../wt-claims && git fetch origin && git reset --hard origin/main
git cat-file -e origin/main:docs/claims/<task-id>.json 2>/dev/null && echo taken  # stop if taken
printf '{"owner":"<agent>","status":"in progress","branch":"<branch>","base":"%s","updated":"<date>"}\n' \
  "$(git rev-parse origin/main)" > docs/claims/<task-id>.json
git add docs/claims/<task-id>.json && git commit -m "claim <task-id>"
git push origin HEAD:main
# 2. lane worktree:
git worktree add ../wt-<lane> -b <branch> origin/main
cd ../wt-<lane>
```

Task IDs for claims: `7.2`, `7.4`, `4.6-flag`, `5.3-flag`, `8.1-harness`.

## §4 Claims (protocol v3 — adopted from closed #29)

Full protocol in `docs/claims/README.md` (updated in this branch).
Summary:

1. **Taken = a claim file exists**, whatever its status. Never overwrite one.
2. **Claim from the dedicated claims worktree** so a lost race cannot damage
   a lane checkout.
3. **Check before you commit**: `git fetch origin` then
   `git cat-file -e origin/main:docs/claims/<id>.json`. Exists → pick
   another lane.
4. **Record the base**: each claim stores the `origin/main` SHA the lane
   started from.
5. Claim and "done" commits touch only `docs/claims/` and are ignored by CI
   (direct pushes to `main` by design; if branch protection forbids this,
   the owner exempts `docs/claims/**` or the protocol moves — **[OPEN]**).

## §5 Blockers

* One file per branch, `docs/blockers/<branch-with-dashes>.md`, committed
  on the lane branch and **pushed**.
* Also set the claim file on `main` to `"status": "blocked"` with
  `"blocker": "<branch>"`, so the owner sees it without opening branches.
* Never append to `NOTES.md` from a lane.

## §6 Local pre-push gate (each agent, copy-paste)

```bash
cargo fmt --check \
&& cargo clippy --workspace --all-targets -- -D warnings \
&& cargo test --workspace \
&& python3 scripts/check-boundaries.py \
&& npm test \
&& npm run build && npm run build:conduit
# plus wasm-pack build for any binding touched (lanes 3/4 read bindings only —
# no rebuild needed unless the binding changes, which is out of scope)
```

## §7 Merge flow (tiered autonomy, unchanged from AGENTS.md)

1. `git pull --rebase origin main`, re-run the full §6 gate.
2. `gh pr create` listing: spec implemented, folders touched, test
   commands run, any `[UNVERIFIED]` item resolved or not.
3. Low-risk (`app/*`, `spec/*`, `fix/*`): self-merge when CI green (max 2
   red-fix attempts, else blocker file + stop). High-risk (`infra/*`,
   `legacy/` deletion): open PR, report, stop — owner merges.
4. `gh pr merge --squash`; report PR number, merge SHA,
   `git revert <SHA>` one-liner; `git pull --rebase origin main`;
   delete the worktree branch. On completion, set
   `docs/claims/<task-id>.json` to `"status": "done"` on `main`.

Rebase cadence with 5 agents: rebase daily; keep PRs small; never
force-push, never rewrite history, no `rm -rf`.

## §8 Collision scenarios and resolution

| Scenario | Resolution |
|---|---|
| Two agents claim the same task | Second pusher's `pull --rebase` shows the file exists → picks another lane. Different lanes are different filenames — no conflict text. |
| Rebase conflict on `main` | Expected only if ownership mis-declared. Stop, compare §1 table; the lane that owns the path keeps it; the other rebases. Record in blocker file if recurring. |
| Lane 1 vs lane 3 `main.js` touch | Lane 3's touch is ≤20 lines at the import site. Rebase onto lane 1's merged rewrite and re-apply; if the hunk fails, file a blocker — do not rewrite lane 1's coordinator. |
| Claim push rejected (non-fast-forward) | `pull --rebase`, re-check the file: exists → taken, pick another; missing → retry once. Max 2 retries, then blocker + stop. |
| Stale claim (no commits/PR for >3 days) | Do not steal. File a blocker; owner reassigns. |
| CI red | Max 2 fix attempts, then blocker + stop. Never fix another lane's files. |
| Need a frozen-file change | Stop, blocker file, do not touch. Separate `infra/*` branch, owner merges. |

## §9 AGENTS.md delta (separate high-risk PR, owner merges)

This branch does **not** touch `AGENTS.md`. The ownership table needs one
delta for this wave (lane 3/4 flag factories + lane 5 harness):

* `app/conduit-wasm-flag`: owns `conduit-takeoff/src/<factory>.js` (new) +
  ≤20-line `main.js` import touch.
* `app/tray-wasm-flag`: owns `src/<factory>.js` (new) + call-site touches.
* `spec/parity-harness`: owns `scripts/parity-*` + its spec file only
  (already covered by the `spec/*` row for created files).

Owner applies this as its own commit/PR or folds it into the lane-map
merge — agent does not edit `AGENTS.md` (high-risk per policy).

## §10 Wave rhythm and owner tasks

1. Owner merges this lane-map PR (or self-merge per §7 — `spec/*` low-risk;
   recommend owner-merge since it steers 5 agents).
2. Owner opens (or agents claim): `7.2`, `7.4`, `4.6-flag`, `5.3-flag`,
   `8.1-harness` — any order, all five may start the same day.
3. Lanes 1+2 are gate predecessors (8.1 entry needs 7.2 + 7.4); lanes 3–5
   are independent and may land first.
4. After lanes 1+2 merge: schedule the 8.1-real gate run (`infra/*`,
   owner merges, `legacy/` deletion).
5. `infra/claims-sync` (periodic, owner-scheduled): rolls
   `docs/claims/*.json` into `docs/TASKS.md` Owner/Status.

## §11 Open items

1. Branch protection vs claims pushes: if `main` forbids direct push, the
   owner must exempt `docs/claims/**` or move claims to a branch — **OPEN**.
2. Lane 1 vs 3 sequencing on `conduit-takeoff/src/main.js`: parallel with
   rebase, or lane 3 waits for lane 1 — owner decides at claim time.
3. `check-ownership.py` (closed-#29 P2c idea): proposed follow-up `infra/*`
   task to enforce §1 mechanically; not a wave gate.
