Squash-merge the current branch's PR and delete the remote branch.

## Instructions

1. Run `gh pr view --repo bd73-com/fetchthechange --json number,url,state,reviewDecision,mergeStateStatus,statusCheckRollup,labels,author` to check the PR's current status.
2. **Pre-flight checks** — evaluate all of these and report a summary table:
   - PR state must be `OPEN`.
   - `reviewDecision` must be `APPROVED` (no outstanding requesting-changes reviews).
   - `mergeStateStatus` must be `CLEAN` or `HAS_HOOKS` (not `DIRTY`, `BEHIND`, `BLOCKED`, `DRAFT`, or `UNSTABLE`).
   - PR must have exactly one release label from: `feature`, `fix`, `breaking`, `chore`, `docs`, `security`.
   - All required status checks must pass: every entry in `statusCheckRollup` must have a conclusion of `SUCCESS`, `NEUTRAL`, or `SKIPPED` — fail if any entry is `FAILURE`, `PENDING`, or missing.
3. If all checks pass, merge with: `gh pr merge --repo bd73-com/fetchthechange --squash --delete-branch`.
4. Confirm the merge succeeded and the remote branch was deleted.

## Handling failures

If a pre-flight check fails, report exactly which check failed. Do NOT retry or attempt to bypass branch protection. Then take **automatic recovery actions** based on the failure type:

### reviewDecision is empty or not APPROVED

1. Get the PR author from the JSON retrieved in step 1 (the `author` or `user` field).
2. Fetch repo collaborators, excluding the PR author: `gh api repos/bd73-com/fetchthechange/collaborators --jq '[.[].login] | map(select(. != "AUTHOR_LOGIN")) | first'` (replace `AUTHOR_LOGIN` with the actual author login).
3. If no eligible collaborators remain, tell the user no reviewers are available and they must manually request one.
4. Otherwise, request a review: `gh pr edit <number> --repo bd73-com/fetchthechange --add-reviewer <login>`.
5. Tell the user: who was requested, the PR URL, and that they can run `/merge-pr` again once approved.

### Status checks FAILURE or PENDING

- List which specific checks failed or are still running.
- If checks are PENDING, tell the user to wait and re-run `/merge-pr` once they finish.
- If checks FAILED, suggest investigating the failed check (link to the PR's checks tab).

### mergeStateStatus is DIRTY (merge conflicts)

- Tell the user to rebase or resolve conflicts locally, push, then re-run `/merge-pr`.

### Missing release label

- Ask the user which label to apply (`feature`, `fix`, `breaking`, `chore`, `docs`, or `security`) and offer to add it: `gh pr edit <number> --repo bd73-com/fetchthechange --add-label <label>` (replace `<number>` with the PR number from step 1, and `<label>` with the user's choice).
