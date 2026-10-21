# AGENTS.md: instructions for AI agents working in this repo

Read `ARCHITECTURE.md` first. It defines the modules, allowed dependencies and migration phases. If a task conflicts with it, stop and write the conflict in `NOTES.md`; do not improvise.

## Working rules
1. **One task = one spec = one branch.** Branch from `main`. Names: `fix/<topic>`, `infra/<topic>`, `spec/<topic>`, `rust/<crate>-<feature>`, `viewer/<topic>`, `app/<topic>`. Branches are flat (git cannot nest them) and short-lived.
2. **Edit only the folders your spec lists as owned.** Anything else is another agent's work. Shared files (workspace configs, CI) are changed only in their own `infra/` branch.
3. **Never edit `legacy/`** except to run it. It is the reference until the parity gate passes.
4. **Never modify That Open libraries.** `viewer-core` wraps them; it does not patch them.
5. **Dependency direction is downward only** (see `ARCHITECTURE.md` section 2). Tray and conduit never import each other. Cores never touch the DOM, Three.js or `web-sys`. If you need a new dependency edge, stop and ask.
6. **Rust crates are pure:** no I/O, no globals, no time, no randomness, no panics for expected errors (return `Result`).
7. **Spec first, tests second, code third.** Acceptance criteria go to `spec/vectors/<module>/*.json` before the implementation.

## Definition of done (all must pass before you say "done")
- `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test`
- `wasm-pack build` for any binding you touched
- `npm test` and the build of any app you touched (`npm run build`, `npm run build:conduit` until renamed)
- the boundary check from CI
- your spec's acceptance vectors pass in Rust
- the spec file is updated if behaviour changed; open questions are listed in it

## Commits and pull requests
- Commit after each completed task in the checklist; small, one purpose each.
- Open a pull request per branch; list: spec implemented, folders touched, test commands run, any `[UNVERIFIED]` item you resolved or could not.

## PR & Merge Policy
- Never merge your own PR. Open it, report, and stop. Only the owner merges.

## Running unattended
- Work through `docs/specs/<module>/<feature>.md` and its checklist in order; tick items as they pass.
- If blocked for more than two attempts, stop, write the blocker and what you tried in `NOTES.md`, and end your turn.
- Do not run destructive commands (`rm -rf`, force-push, history rewrite, deleting branches) without an explicit instruction in the task.
- Use your own git worktree when other agents run in parallel: `git worktree add ../wt-<name> -b <branch>`.

## Parallel work
- Before starting, open `docs/TASKS.md` and claim ONE task by writing your agent name in Owner and `in progress` in Status; commit that one-line change to `main` first.
- Never start a task claimed by another agent. Never edit another agent's owned folders.
- Each agent works in its own git worktree and branch.
- Before opening a PR: `git pull --rebase origin main`, then rerun all checks from the definition of done.
- Only one agent at a time works on `infra/*` branches (root configs, CI, workspace manifests).
- Units: all quantities are metres internally; imperial values (10 ft sticks, NEC inches) are constants converted at the edges.

## Ownership by branch prefix
| Prefix | May edit |
|---|---|
| `rust/geom-*` | `crates/geom-core/`, its vectors and specs |
| `rust/ifc-*` | `crates/ifc-io/`, its vectors and specs |
| `rust/conduit-*` | `crates/conduit-core/`, `bindings/conduit-wasm/`, `spec/vectors/conduit/`, `docs/specs/conduit/` |
| `rust/tray-*` | `crates/tray-tagging/`, `crates/tray-routing/`, `bindings/tray-wasm/`, `spec/vectors/tray/`, `docs/specs/tray/` |
| `viewer/*` | `packages/viewer-core/`, `docs/specs/viewer/` |
| `app/*` | the named app under `apps/`, `packages/excel-io/` when its spec says so |
| `infra/*` | root configs, `.github/`, workspace manifests |
| `fix/*` | only the files named in the task |
