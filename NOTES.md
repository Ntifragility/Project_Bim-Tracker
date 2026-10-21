# NOTES: deviations, blockers, open questions

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
