# Blocker: spec/arch-parity-closeout (2026-10-25)

## What this branch did (no code touched)

Worktree `../wt-arch-parity`, branch `spec/arch-parity-closeout` from
`origin/main@23079d3`. Docs/specs only:

- `docs/specs/parity/architecture-closeout.md` — exact `ARCHITECTURE.md` deltas
  for the owner (or an `infra/*` branch) to fold in. This branch may NOT edit
  `ARCHITECTURE.md` itself (high-risk, `AGENTS.md` PR policy).
- `docs/specs/tray/tray-wasm.md` — new 5.3 spec (binding + app flag).
- `docs/specs/parity/parity-gate.md` — new 8.1 executable checklist spec.
- `docs/specs/tray/safe-ifc-editor.md` — expanded to the feature-spec template
  (deps, rules, acceptance, parity reference, open questions).

Deliberately NOT touched (active lanes own them):
`docs/specs/conduit/conduit-wasm.md` (lane `rust/conduit-wasm`),
`docs/specs/tray/tagging.md` + `routing.md` (lane `spec/tray-tagging-spec`),
`docs/TASKS.md` (lane `spec/parallel-docs-v03`), `legacy/`, any Rust/TS code.

## Attempt 1: verify 7.1-7.3 on origin/main

- `apps/tray-viewer/` and `apps/conduit-takeoff/` contain only `README.md`
  (scaffolds). `packages/excel-io/src/index.js` and
  `packages/viewer-core/src/{engine,coordinates,index,vite-plugin}.js` exist.
  `src/main.js` is 4,559 lines; `src/ui/` has `state.js` +
  `unified-export.js` only (7 modules promised by `split-main-js.md`).
- Conclusion: 7.1/7.2 read NOT-done in the tree; 7.3 partly (package exists,
  app wiring unverified). `spec/parallel-docs-v03` already re-opened 7.1-7.3
  as `todo` — this branch takes no action, just records agreement.

## Attempt 2: THINKING_SPECS duplication

- Root `THINKING_SPECS.md` exists only in the stale `infra/agent-autonomy`
  checkout (`/workspaces/Project_Bim-Tracker`, untracked); `origin/main`
  carries `docs/THINKING_SPECS.md`. No action in this worktree. Recommend the
  owner delete the stale root copy when that checkout is retired (no `rm`
  run from here — destructive ops need explicit instruction).

## Blockers (owner decisions needed)

1. Couplings formula: `ceil(len/stick)+elbows` (Python overlay spec) vs
   `max(0,sticks-1)` (BOM code) vs out-of-scope (`takeoff.js`). Blocks overlay
   quantity work.
2. NEC Table 2 edition: spec truncates at 4"; need 5"/6" rows? Blocks fitting
   finalization.
3. 100 ft / 30.48 m straight-pull limit: keep as legacy heuristic or drop;
   never label NEC. Blocks BOM spec final wording.
4. Routing frame: confirm IFC Z-up f64 across Wasm (conversion in TS adapter).
   Blocks 5.2 completion.
5. `P22115-*.sharedparameters.txt` still tracked at root: `git rm` now
   (normal commit), and is history rewrite yes/no? Blocks hygiene close.
6. 7.1-7.3 done or re-opened? (Recommend: accept the re-open, verify against
   the table in Attempt 1.)
7. 8.1 deps: add 7.4 (Safe Editor default in-scope, ported last) or fast-follow
   after `legacy/` deletion? Recorded conduit project file for gate check 9:
   provide or waive?
8. `ARCHITECTURE.md` fold-in: apply `parity/architecture-closeout.md` deltas
   via `infra/*` branch (owner merges), or direct owner edit?
