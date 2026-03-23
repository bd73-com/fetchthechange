Squash-merge the current branch's PR and delete the remote branch.

## Instructions

1. Run `gh pr view --repo bd73-com/fetchthechange --json number,url,state,reviewDecision,mergeStateStatus,statusCheckRollup,labels,author,reviewRequests` to check the PR's current status.
2. **Pre-flight checks** — evaluate all of these and report a summary table:
   - PR state must be `OPEN`.
   - `reviewDecision` must be `APPROVED` (no outstanding requesting-changes reviews).
   - `mergeStateStatus` must be `CLEAN` or `HAS_HOOKS` (not `DIRTY`, `BEHIND`, `BLOCKED`, `DRAFT`, or `UNSTABLE`).
   - PR must have exactly one release label from: `feature`, `fix`, `breaking`, `chore`, `docs`, `security`.
   - All required status checks must pass: every entry in `statusCheckRollup` must have a conclusion of `SUCCESS`, `NEUTRAL`, or `SKIPPED` — fail if any entry is `FAILURE`, `PENDING`, or missing.
3. **Auto-resolve stale bot reviews** — before reporting failures for `reviewDecision` or `mergeStateStatus`, run the stale-bot-review check described below. If it resolves the blocker, re-fetch PR status and continue.
4. If all checks pass, merge with: `gh pr merge --repo bd73-com/fetchthechange --squash --delete-branch`.
5. Confirm the merge succeeded and the remote branch was deleted.

## Auto-resolving stale bot reviews

When `reviewDecision` is `CHANGES_REQUESTED` or `mergeStateStatus` is `BLOCKED`, check whether the blocker is a stale bot review that can be dismissed:

1. Fetch all reviews on the PR: `gh api repos/bd73-com/fetchthechange/pulls/<number>/reviews --jq '[.[] | {id: .id, user: .user.login, user_type: .user.type, state: .state, submitted_at: .submitted_at}]'`
2. Identify reviews with `state: "CHANGES_REQUESTED"`.
3. For each such review, check if the reviewer is a **trusted bot** by matching the login against this allowlist: `coderabbitai[bot]`, `github-actions[bot]`, `dependabot[bot]`. Do not rely solely on `user_type == "Bot"` — only dismiss reviews from bots on this list.
4. If the reviewer is a trusted bot, check whether new commits were pushed **after** the review's `submitted_at` timestamp:
   - Get the latest commit date: `gh api --paginate repos/bd73-com/fetchthechange/pulls/<number>/commits --jq '.[].commit.committer.date' | tail -n1`
   - Compare timestamps: convert both to epoch seconds (`date -d "$COMMIT_DATE" +%s` vs `date -d "$REVIEW_DATE" +%s`) and only proceed if the commit timestamp is strictly greater than the review timestamp.
5. If the last commit is newer than the bot's review, the review is stale. **Dismiss it automatically**: `gh api --method PUT repos/bd73-com/fetchthechange/pulls/<number>/reviews/<review_id>/dismissals -f message="Dismissing stale bot review — fixes were pushed in subsequent commits." -f event="DISMISS"`. If the dismissal API call fails (e.g., insufficient permissions, rate limit), log the error and skip to reporting the original failure — do not attempt to re-fetch or merge.
6. After a successful dismissal, re-fetch PR status from step 1 and continue the pre-flight checks. If the PR is now `APPROVED` (or `reviewDecision` is empty/null and `mergeStateStatus` is not `BLOCKED`) and `mergeStateStatus` is `CLEAN`/`HAS_HOOKS`, proceed to merge.

**Important**: Only dismiss bot reviews automatically. Never dismiss reviews from human collaborators — those always require manual resolution.

## Handling failures

If a pre-flight check fails (and was not auto-resolved above), report exactly which check failed. Do NOT retry or attempt to bypass branch protection. Then take **automatic recovery actions** based on the failure type:

### reviewDecision is empty or not APPROVED (human reviewers)

1. Get the PR author from the JSON retrieved in step 1 (the `author` or `user` field).
2. Fetch repo collaborators, excluding the PR author and any already-requested reviewers: `gh api repos/bd73-com/fetchthechange/collaborators --jq '[.[].login] | map(select(. != "AUTHOR_LOGIN"))' | jq -r 'first'` (replace `AUTHOR_LOGIN` with the actual author login; also exclude logins already in the PR's `reviewRequests` list from step 1).
3. If no eligible collaborators remain, tell the user no reviewers are available and they must manually request one.
4. Otherwise, request a review: `gh pr edit <number> --repo bd73-com/fetchthechange --add-reviewer <login>` (replace `<number>` with the PR number from step 1).
5. Tell the user: who was requested, the PR URL, and that they can run `/merge-pr` again once approved.

### Status checks FAILURE or PENDING

- List which specific checks failed or are still running.
- If checks are PENDING, tell the user to wait and re-run `/merge-pr` once they finish.
- If checks FAILED, suggest investigating the failed check (link to the PR's checks tab).

### mergeStateStatus is BLOCKED

- If blocked due to outstanding reviews that were not auto-resolved (i.e., human `CHANGES_REQUESTED` reviews), follow the "reviewDecision is empty or not APPROVED" steps above.
- If blocked for other reasons (branch protection rules, required approvals), tell the user what is blocking and suggest next steps.

### mergeStateStatus is DIRTY (merge conflicts)

- Tell the user to rebase or resolve conflicts locally, push, then re-run `/merge-pr`.

### Missing release label

- Ask the user which label to apply (`feature`, `fix`, `breaking`, `chore`, `docs`, or `security`) and offer to add it: `gh pr edit <number> --repo bd73-com/fetchthechange --add-label <label>` (replace `<number>` with the PR number from step 1, and `<label>` with the user's choice).

### Multiple release labels

- List the current release labels and ask which single label to keep.
- Remove extras with `gh pr edit <number> --repo bd73-com/fetchthechange --remove-label <extra_label>` until exactly one remains, then re-run the pre-flight checks.
