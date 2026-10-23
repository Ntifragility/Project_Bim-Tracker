# Claim files: one file per task, no shared-table edits

`docs/TASKS.md` stays the human-readable board. Claims live here, **one JSON
file per task**, so two agents only touch the same file when they claim the
same task. Protocol **v3** (changes from v2 in bold).

## Rules

* Filename is the task ID from `docs/TASKS.md` (e.g. `4.6.json`).
* **A task is taken if its file exists, whatever its status.** Never overwrite
  or delete a claim file. Only the owner of the file edits it.
* Never edit `docs/TASKS.md` to claim. Never commit claim files on a lane
  branch.

## Schema

```json
{"owner": "<agent>", "status": "in progress", "branch": "<branch>",
 "base": "<origin/main SHA the lane started from>", "updated": "<YYYY-MM-DD>"}
```

`status`: `in progress` | `review` | `done` | `blocked`.
When `blocked`, add `"blocker": "<branch>"` (the branch holding
`docs/blockers/<branch-with-dashes>.md`).

## Claim (do this from a dedicated claims worktree, not a lane checkout)

```bash
# once:
git worktree add ../wt-claims -B claims-<agent> origin/main
# every claim:
cd ../wt-claims && git fetch origin && git reset --hard origin/main
git cat-file -e origin/main:docs/claims/<task-id>.json 2>/dev/null && echo taken   # stop if taken
printf '{"owner":"<agent>","status":"in progress","branch":"<branch>","base":"%s","updated":"<date>"}\n' \
  "$(git rev-parse origin/main)" > docs/claims/<task-id>.json
git add docs/claims/<task-id>.json && git commit -m "claim <task-id>"
git push origin HEAD:main
```

If the push is rejected: `git fetch origin`, check whether the file now
exists on `origin/main`. If it does, the task is taken: run
`git reset --hard origin/main` (allowed **only** in the claims worktree, where
the one local commit is your own claim), then pick another free task. If it
does not, the rejection was an unrelated commit: reset, redo the claim, retry
once. After two failed retries, file a blocker and stop.

## Lifecycle

1. Create the lane worktree from `origin/main` and work there (see
   `docs/ARCHITECTURE-PARALLEL-AGENTS.md` §10).
2. Open the PR: set `"status": "review"` (claims worktree, same push steps).
3. After merge: set `"status": "done"`.
4. Blocked: write the blocker file on the lane branch, push the branch, then set
   `"status": "blocked"` with `"blocker"`.
5. **Stale claim** (`in progress` and no commits or PR for 3 days): do not
   take it over. File a blocker naming it; the owner reassigns.

## CI

Claim and blocker commits are ignored by CI (`paths-ignore`, wave-0 task
**P2**). They touch only `docs/claims/` or `docs/blockers/`.

## Sync

The owner (or one `infra/claims-sync` agent) rolls claim files into
`docs/TASKS.md` at the end of each wave. Lanes never edit the board.
