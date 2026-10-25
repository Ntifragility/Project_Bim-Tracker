# NOTES: deviations, blockers, open questions

## 2026-10-26: SPECS close-out run (owner: finish the architecture + specs set)
- D1-D8 rulings (owner, 2026-10-25): D1 couplings BOM max(0,sticks-1); D2 NEC
  truncated 4in pinned; D3 100ft kept legacy-labeled; D4 Z-up f64 confirmed;
  D5 git rm no rewrite; D6 7.1 done / 7.2 todo / 7.3 done; D7a gate waits 7.4;
  D7b synthetic fixture waived; D8 infra/* branch, owner merges.
- Step 1: PR #29 reworked (7.1 stays done, only 7.2/7.3 re-opened) + ready-note
  for owner merge; PR #31 closed unmerged (stale 7.1 claim, fulfilled by #32);
  PR #30 left for owner merge (D-rulings posted as comment).
- Step 3: PR #33 (fix/board-sync-72-73) merged as `cd81800` (self-merge,
  low-risk fix/*; CI baseline+rust SUCCESS, MERGEABLE). Evidence: conduit
  main.js 897 lines unsplit -> 7.2 todo; excel-io wired (readWorkbook in
  excel-panel, exportTagMapping in tagging-panel), npm 92/92, both builds
  green -> 7.3 stays done. Revert: `git revert cd81800`.
- Step 4: 4 new specs merged to main (self-merge, low-risk spec/*, all CI
  green): #34 conduit-ui-split (7.2, `da9ec2b`), #35 conduit-wasm (4.6,
  `2b641bd`), #37 excel-io base (7.3, `c74d9df`), #39 viewer gaps — 4 Phase-B
  specs (`d38b491`). Reverts: `git revert <SHA>` each.
- Step 4 stacked on #30 (merge after #30, in order #30 -> #36 -> #38 -> #40):
  #36 tray-wasm final (D4, per-module flag), #38 parity-gate + closeout final
  (D1-D4,D6,D7), #40 safe-editor final (D6,D7a). All rebased onto
  main@d38b491 conflict-free 2026-10-26. #30 itself rebased too.
- Step 5: PR #41 infra/arch-v1 OPEN (high-risk, owner merges, agent stopped).
  ARCHITECTURE v0.1 -> v1.0: viewport-core map, rules 9+10, conduit TS-side
  boundary, as-built engine iface, Phase-B built-vs-spec split, hygiene done
  (P22115 pair + legacy pkg wasm git-rm'd, *.sharedparameters.txt ignored),
  all 11 Qs resolved. Full DoD green in worktree (fmt, clippy -D warnings,
  cargo 40+35+32+1x4, both wasm-pack, npm 92/92, both builds, boundaries OK).
  Cargo.lock wasm-build churn reverted before commit.
- Remaining for owner: merge #29, #30, #36, #38, #40 (specs, in that order),
  #41 (infra). Then code lanes: app/conduit-ui-split (7.2), rust/conduit-wasm
  flag (4.6), 5.1/5.2 + 5.3, app/safe-ifc-editor (7.4), infra/remove-legacy
  8.1 (deps must add 7.4 per D7a — gate PR updates TASKS.md).
- No blockers. Root THINKING_SPECS.md (untracked, stale checkout) still needs
  owner `rm` when the infra/agent-autonomy checkout retires.

## 2026-10-23: smoke test on infra/agent-autonomy @ 80d0151 (Layer 1+2 green)
- Layer 1 (DoD parity): `cargo fmt --check` clean, `cargo clippy
  --workspace --all-targets -- -D warnings` clean, `cargo test --workspace`:
  conduit-core 36 + geom-core 35 + ifc-io 32 pass (tray-*/wasm scaffolds 1
  each), both `wasm-pack build` OK, `npm test` 84 pass, `npm run build` +
  `npm run build:conduit` green, `check-boundaries.py` OK.
- Layer 2 (golden vectors): geom 54, ifc 56, conduit-network 23,
  conduit-snap 24, conduit-fitting 15, conduit-bom 8 — all pass.
- Tray vectors run against legacy JS only (Rust tray-* empty); no browser
  smoke possible (apps/viewer-core/bindings are scaffolds); no IFC sample
  used (pure cores only). Layer 3 chain demo deferred to 4.5.
- Board fix: 4.2/4.3 were still `review` though #19/#21 merged; set `done`.

## 2026-10-22: PR #22 (rust/conduit-bom) merged by agent (4.4 done)
- PR #22 self-merged as `7c0a93d` under the tiered policy (low-risk `rust/*`).
  Revert: `git revert 7c0a93d`.
- Safeguards met: rebased clean; full DoD re-ran green (fmt, clippy
  `-D warnings`, `cargo test --workspace`: conduit-core 36 + geom-core 35 +
  ifc-io 32 pass, bom 8 vectors pass, both wasm builds, `npm test` 84 pass,
  both app builds, `check-boundaries.py` OK); CI `baseline` + `rust`
  SUCCESS; `MERGEABLE`; owned-folders scope.
- Worktree branch `rust/conduit-bom` deleted after merge.

## 2026-10-22: PR #17 (rust/conduit-network) merged by agent (4.1 done)
- PR #17 self-merged as `15f9d3b` under the tiered policy (low-risk `rust/*`).
  Revert: `git revert 15f9d3b`.
- Safeguards met: rebased clean; full DoD re-ran green (fmt, clippy
  `-D warnings`, `cargo test --workspace`: conduit-core 19 + geom-core 35 +
  ifc-io 32 pass, `run-conduit-network-vectors.mjs` 23 pass, both wasm builds,
  `npm test` 84 pass after `npm install` in the fresh worktree, both app
  builds, `check-boundaries.py` OK); CI `baseline` + `rust` SUCCESS;
  `MERGEABLE`; owned-folders scope; no destructive commands.
- Worktree branch `rust/conduit-network` deleted after merge.

## Waiver 2026-10-21: suspend per-task PRs for 0.3 -> 1.1 (owner-approved)
- Owner instruction (chat, 2026-10-21): proceed with one accumulation branch
  `infra/stabilize-to-workspaces`; open a single Draft PR for CI; mark ready
  only at task 1.1. No per-task PRs/merges for 0.3, 0.4, 0.5, 0.6, 0.7, 0.8,
  0.9, 0.10 between.
- Conflicts with AGENTS.md (recorded per AGENTS.md section 1, rule 3):
  1. "One task = one spec = one branch. Branches are flat and short-lived."
     -> 9 tasks (0.3-0.10, 1.1) + AGENTS.md policy fold-in share ONE long branch.
  2. "Open a pull request per branch" (Commits and pull requests).
     -> single PR at 1.1 instead of one PR per task.
- Still respected: Phase 0 in order; only one agent on infra/*; per-task commits
  on the accumulation branch (`git log` stays reviewable per task); Draft PR
  gives per-push CI (npm test + both builds); final PR lists all tasks, folders
  touched, test commands, [UNVERIFIED] items.
- Risks accepted by owner: no green-main checkpoint per task; one large review
  diff; harder bisect/revert; rebase drift if others push to main.
- PR #5 (fix/main-highlighter-setup, task 0.1b) was OPEN when accumulation
  started; its commit was cherry-picked onto the accumulation branch as 5cd2d83
  so the base is complete regardless of PR #5 merge timing. Close PR #5 when
  the accumulation PR merges (or merge it first; cherry-pick is identical).
- AGENTS.md "PR & Merge Policy" section (owner message 2026-10-21) folded in
  here as commit 1586a6a instead of its own infra/* branch, under the same
  waiver. The policy itself is honoured: agent never merges; owner merges the
  final PR.

## 2026-10-22: PR #15 (rust/ifc-io) merged by agent under tiered policy (PR #14 live)
- PR #14 (`infra/agent-autonomy`) owner-merged as `cc50251`; tiered autonomy live.
  Under it, PR #15 (`rust/ifc-io`) self-merged by agent as `b68aa84` — first
  low-risk autonomous merge. Revert: `git revert b68aa84`.
- Safeguards met: rebased clean onto `cc50251`; full DoD re-ran green after
  rebase (fmt, clippy `-D warnings`, `cargo test --workspace`: ifc-io 32 +
  geom-core 35 pass, `run-ifc-vectors.mjs` 56 pass, both wasm builds, `npm
  test` 84 pass after `npm install` in the fresh worktree, both app builds,
  `check-boundaries.py` OK); CI `baseline` + `rust` SUCCESS on the rebased PR;
  `MERGEABLE`; owned-folders scope; no destructive commands.
- Pre-existing (not caused by 3.2): `packages/routing-core/test/ifc-extractor.test.js`
  fails identically on `origin/main` (`afe976a` checked); `npm test` in a fresh
  worktree needs `npm install` first (`vite: not found` otherwise).

## 2026-10-22 (earlier): PR #13 block recorded pre-#14-merge (kept for history)
- PR #13 (task 3.1, branch `rust/geom-core`) is green (CI `baseline` + `rust`
  SUCCESS, mergeable) and DoD checks re-ran clean in `/workspaces/wt-geom-core`:
  `cargo test -p geom-core` 35 pass, `cargo fmt --check`, `cargo clippy
  --workspace --all-targets -- -D warnings`, `node scripts/run-geom-vectors.mjs`
  54 pass, `scripts/check-boundaries.py` OK. Branch is 3 ahead / 0 behind
  `origin/main`; scope is owned folders (`crates/geom-core/`, vectors, spec)
  plus the vectors runner script and the TASKS claim line.
- Conflict: this checkout (`infra/agent-autonomy`, PR #14) carries a new tiered
  merge policy that would allow self-merging `rust/*` PRs, but PR #14 is itself
  high-risk (edits the AGENTS.md policy section) and UNMERGED. `origin/main`
  still says "Never merge your own PR. ... Only the owner merges."
- Per the in-force policy: agent does NOT merge #13; PR left open, reported.
- PR #5 closed 2026-10-22 per the 2026-10-21 waiver above (cherry-picked as
  5cd2d83; accumulation PR #6 already merged).
- Stale board-sync PRs #9 (superseded by #12) and #12 (stale vs #13's TASKS.md
  line) left untouched for the owner: after #13 merges, rebase/close as needed.
