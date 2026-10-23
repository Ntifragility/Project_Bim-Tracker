# Blocker files: one file per branch, no shared-log edits

`NOTES.md` stays the rolled-up log. To let ≥5 agents record blockers with
zero merge conflicts, blockers live here — **one Markdown file per
branch**. A periodic infra task merges them into `NOTES.md`.

## Protocol

1. Blocked (or blocked > 2 attempts per `AGENTS.md`)? Write
   `docs/blockers/<branch-with-slashes-as-dashes>.md`, e.g.
   `docs/blockers/rust-conduit-wasm.md`:
   ```md
   # Blocker: <branch> (<YYYY-MM-DD>)
   ## What I tried (2 attempts)
   1. ...
   2. ...
   ## Blocker
   ...
   ```
2. Commit just that file, push on your branch, end your turn.

## Rules

* Never append to `NOTES.md` from a lane branch.
* Never edit another agent's blocker file.
