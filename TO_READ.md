# TO_READ — 5-agent launch + demo guide (saved 2026-10-26, base `origin/main@88b37ab`)

State: ARCHITECTURE v1.0 (#41) + specs close-out (#46) + board sync (#47) +
lanes v1 (#48) all merged. Open PRs: 0. Remaining board todos: 7.2, 7.4, 8.1.

## 1. Branch protection (owner settings action, approved: no ci.yml change)

- Repo → Settings → Branches → rule for `main`:
  - No PR requirement → done, claims pushes work as-is.
  - Requires PR / blocks direct push → add bypass for the agent identity
    (or role). Do NOT add `paths-ignore` to `ci.yml` (claim commits keep
    running CI as a cheap main-green signal).

## 2. Run the 5 agents (copy-paste per agent)

Lane doc: `docs/ARCHITECTURE-PARALLEL-AGENTS.md` §1–§8.
One lane = one task = one branch = one worktree = one agent.

| # | Task | Claim file | Branch | Owned paths |
|---|---|---|---|---|
| 1 | 7.2 conduit UI split | `7.2.json` | `app/conduit-ui-split` | `conduit-takeoff/src/ui/` (new) + `conduit-takeoff/src/main.js` |
| 2 | 7.4 safe editor | `7.4.json` | `app/safe-ifc-editor` | `src/ifc/ifc-safe-editor.*` + new `src/ui/` glue only |
| 3 | 4.6 flag | `4.6-flag.json` | `app/conduit-wasm-flag` | new factory in `conduit-takeoff/src/` + ≤20-line touch |
| 4 | 5.3 flag | `5.3-flag.json` | `app/tray-wasm-flag` | new factory in `src/` + call-site touches |
| 5 | 8.1 harness (dry) | `8.1-harness.json` | `spec/parity-harness` | `scripts/parity-*` + own spec file only |

Claim + worktree (claims worktree `../wt-claims`, one per agent):

```bash
git fetch origin --prune
git worktree add ../wt-claims -B claims-<agent> origin/main
cd ../wt-claims && git fetch origin && git reset --hard origin/main
git cat-file -e origin/main:docs/claims/<id>.json 2>/dev/null && echo taken  # stop if taken
printf '{"owner":"<agent>","status":"in progress","branch":"<branch>","base":"%s","updated":"<date>"}\n' \
  "$(git rev-parse origin/main)" > docs/claims/<id>.json
git add docs/claims/<id>.json && git commit -m "claim <id>" && git push origin HEAD:main
git worktree add ../wt-<lane> -b <branch> origin/main  # work here
```

Rules: owned folders only; never `legacy/`, `src/main.js` (lanes 2/4),
frozen runners, `Cargo.toml`/`package.json`/`.github`; rebase daily.
Pre-push gate: `cargo fmt --check` + `cargo clippy --workspace --all-targets -- -D warnings`
+ `cargo test --workspace` + `python3 scripts/check-boundaries.py`
+ `npm test` + `npm run build` + `npm run build:conduit`.
PR per branch (`app/*`/`spec/*` self-merge when CI green, max 2 fixes else
blocker file in `docs/blockers/`); set claim to `done` after merge.
Lane 1 vs 3 share `conduit-takeoff/src/main.js` — parallel, lane 3 rebases
onto lane 1's merge (one-hunk touch).

## 3. When can you see it running?

Now, on current main — both apps build and boot:

```bash
npm run dev          # tray viewer
npm run dev:conduit  # conduit app
# load the fixture via ?ifc= (e.g. survey-box.ifc) — selection/hide/paint smoke works
```

Lanes 1–4 are behavior-preserving (splits + flags), apps keep running
identically after each merge — toggle wasm via `?core=wasm` once lanes 3/4
land. Full end-to-end proof (vectors + tag round-trip + no `legacy/` imports)
comes from lane 5's harness after lanes 1+2 merge; real `legacy/` deletion is
the owner-merged 8.1 gate after that.

## 4. Pending (do when resuming)

- 8.1 board deps line sync: `docs/TASKS.md:75` deps `4.6, 5.3, 6.2, 7.1, 7.2`
  → `4.6, 5.3, 6.2, 7.1, 7.2, 7.4` (approved parity-gate entry D7a).
  Branch `fix/board-sync-81-deps`, docs-only PR, merge, record revert SHA.
- Lane doc §11 OPENs: (a) branch-protection bypass (item 1 above);
  (b) lane 1 vs 3 sequencing (default parallel+rebase).
- Reverts: `git revert 88b37ab` (#48), `git revert 15d848b` (#41),
  `git revert 7bdc31c` (#47), `git revert 8f1023f` (#46).
