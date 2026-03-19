Squash-merge the current branch's PR and delete the remote branch.

## Instructions

1. Run `gh pr view --json number,state,reviewDecision,mergeStateStatus,statusCheckRollup,labels` to check the PR's current status.
2. **Pre-flight checks** — abort and report if any of these fail:
   - PR state must be `OPEN`.
   - `reviewDecision` must be `APPROVED` (no outstanding requesting-changes reviews).
   - `mergeStateStatus` must be `MERGEABLE` (not `CONFLICTING`, `BEHIND`, or `BLOCKED`).
   - PR must have exactly one release label from: `feature`, `fix`, `breaking`, `chore`, `docs`, `security`.
   - All required status checks must pass: every entry in `statusCheckRollup` must have a conclusion of `SUCCESS`, `NEUTRAL`, or `SKIPPED` — fail if any entry is `FAILURE`, `PENDING`, or missing.
3. If all checks pass, merge with: `gh pr merge --squash --delete-branch`.
4. Confirm the merge succeeded and the remote branch was deleted.

If a pre-flight check fails, report exactly which check failed and what the user needs to resolve — do NOT retry or attempt to bypass branch protection.
