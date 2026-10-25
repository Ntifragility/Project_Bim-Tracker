# Parity gate: run the checklist, then delete `legacy/` (task 8.1)

Status: draft
Branch: `infra/remove-legacy`
Owner folders: root configs, `.github/`, `legacy/` deletion only
High-risk: agent MUST NOT merge — open the PR, report, and stop. Owner merges.

## Goal

Prove the rewrite reproduces legacy behaviour, then delete `legacy/` in one
deliberate commit. Nothing is deleted before every check below passes on a clean
rebase onto `origin/main`.

## Entry conditions (all must hold before the gate run)

- Tasks done: 4.6, 5.3, 6.2, 7.1, 7.2 **plus 7.4** (Safe Editor is default
  in-scope, ported last — current `docs/TASKS.md` deps omit it; owner confirms
  whether 8.1 waits for 7.4 or 7.4 lands as a fast-follow).
- 7.1–7.3 verified done (currently disputed: `wt-parallel-docs` re-opened them;
  `src/main.js` is 4,559 lines on `origin/main`).

## Checklist (from `ARCHITECTURE.md:193`, made executable)

| # | Check | Command / artefact |
|---|---|---|
| 1 | All golden vectors pass in Rust | `cargo test --workspace` (geom 54, ifc ~50, conduit 23+24+6+15+8, tray 33+7+26) |
| 2 | Vectors pass against legacy JS (proves they describe real behaviour) | `node scripts/run-*-vectors.mjs` (all runners green) |
| 3 | Rust gates clean | `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings` |
| 4 | Wasm builds | `wasm-pack build` for every binding touched (conduit-wasm, tray-wasm) |
| 5 | JS gates clean | `npm test` (84 + excel-io + viewer smoke), `npm run build`, `npm run build:conduit` |
| 6 | Boundaries hold | `scripts/check-boundaries.py` exit 0 |
| 7 | Both apps smoke on the public fixture | load `public/fixtures/survey-box.ifc` via `?ifc=`, exercise selection/hide/paint through `viewer-core` |
| 8 | Tag round-trip equals legacy on the sample | tagged export from wasm path diffs clean vs legacy `_tagged.ifc` (GUIDs excluded, shape compared) |
| 9 | Conduit takeoff CSV/IFC equals legacy on a recorded project file | **blocked: no recorded project file in the repo** (ARCHITECTURE Q4 half-open). Owner provides or waives |
| 10 | No `legacy/` imports remain | grep: no `legacy/` import outside `legacy/` itself and parity runners |

## Deletion procedure

1. Rebase cleanly on `origin/main`, rerun checks 1–10.
2. One commit deleting `legacy/` (+ parity runners if they only served legacy).
3. Update `ARCHITECTURE.md` (legacy references past tense), `AGENTS.md` rule 3
   (reference deleted), CI (drop legacy vector runners or repoint to fixtures).
4. Open PR `infra/remove-legacy`, list all ten check results, stop. Owner merges.

## Out of scope

- History rewrite for already-pushed sample files (separate owner decision,
  ARCHITECTURE Q2).
- Live Excel bridge unfreeze (`excel-ifc-bridge/` stays frozen per D4).
- `ThatOpenEngine/` SIMULATE move (separate decision, already out of tree).

## Open questions

1. Does 8.1 wait for 7.4 (Safe Editor) or is 7.4 a fast-follow after deletion?
2. Recorded conduit project file for check 9: provide or waive?
3. Parity runners after deletion: keep against fixtures or delete with `legacy/`?
