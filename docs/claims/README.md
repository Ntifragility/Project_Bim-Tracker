# Claim files: one file per task, no shared-table edits

`docs/TASKS.md` stays the human-readable board. To let ≥5 agents claim
work with zero merge conflicts, claims live here — **one JSON file per
task**. Two agents never write the same file.

## Protocol (v2 — claims commit to `main`)

1. `git checkout main && git pull --rebase origin main` (board is source of truth; lane branches are invisible until PR, `main` is the one ref everyone fetches).
2. Pick a free task: no `docs/claims/<task-id>.json` with
   `"status": "in progress"` exists for it.
3. Write `docs/claims/<task-id>.json`:
   ```json
   {"owner": "<agent>", "status": "in progress", "branch": "<branch>", "updated": "<YYYY-MM-DD>"}
   ```
4. Commit just that file, then `git pull --rebase origin main && git push origin main`.
   Same file appeared first = someone claimed it → pick another free task.
   Push rejected for any other reason → `pull --rebase` and retry (max 2 retries, then file a blocker and stop).
5. Create/rebase your lane worktree from `origin/main` (§3 of the parallel-agents doc) and work there. Never commit claim files on the lane branch.
6. On completion, update your file to `"status": "done"` on `main` and push.
   A periodic infra task (`infra/claims-sync`) syncs claim files back into `docs/TASKS.md`.
7. Stale claims (`in progress` with no commits/PR for >3 days): do not steal. File a blocker; the owner reassigns.

## Rules

* Filename is the task ID from `docs/TASKS.md` (e.g. `4.6.json`).
* Never edit another agent's claim file.
* Never edit `docs/TASKS.md` to claim — claim files only.
