---
name: pr-comments
description: "Retrieve, triage, and resolve GitHub PR review comments. Use when asked to 'check PR comments', 'handle PR feedback', 'fix review comments', 'resolve PR threads', or 'address CodeRabbit comments'. Covers fetching inline threads, review summaries, and general comments via gh CLI; classifying each as valid, false positive, already fixed, or needs discussion; implementing fixes; and posting replies."
---

## Overview

Fetch all review comments on a GitHub PR, triage them by actionability, fix valid issues one file at a time, and post replies with thread resolution — all via the `gh` CLI against `bd73-com/fetchthechange`. The primary reviewer bot is `coderabbitai[bot]`. Bot noise from `github-actions[bot]` and other CI bots is filtered out unless it contains actionable feedback.

## Workflow

1. **Get the PR number.** If not provided by the user, detect it from the current branch:
   ```bash
   gh pr view --repo bd73-com/fetchthechange --json number -q .number
   ```

2. **Fetch all comment sources in parallel:**
   ```bash
   # General PR comments (conversation tab)
   gh pr view --repo bd73-com/fetchthechange {number} --json comments --jq '.comments'

   # Review summaries and review-level comments
   gh api repos/bd73-com/fetchthechange/pulls/{number}/reviews

   # Inline review comments (file-level threads)
   gh api repos/bd73-com/fetchthechange/pulls/{number}/comments
   ```

3. **Filter out noise.** Discard comments from `github-actions[bot]` and other CI bots unless the comment body contains an explicit error message, failure description, or actionable suggestion. Keep all comments from `coderabbitai[bot]` and human reviewers.

4. **Classify each comment.** For every remaining comment, read the referenced code (use the file path and line number from the comment) and assign one of:
   - **valid** — the issue exists and should be fixed
   - **already-fixed** — a subsequent commit on the branch already addresses it
   - **false-positive** — the reviewer misread the code or the suggestion is incorrect
   - **needs-discussion** — ambiguous; requires human judgment

5. **Present the triage table to the user.** Output a markdown table:
   ```
   | # | File | Line | Reviewer | Classification | Summary |
   ```
   Wait for user confirmation before proceeding to fixes or replies.

6. **Fix valid issues — one file at a time.**
   - Read the full file before making any change.
   - Apply the fix.
   - Run `npm run check && npm run test` immediately after modifying each file.
   - If either command fails, fix the failure before touching the next file.
   - Commit the fix with a message referencing the comment (e.g., `fix: address review comment on server/routes.ts`).

7. **Draft reply text for every classified comment.** For each comment, draft a reply:
   - **valid** — describe the fix, reference the commit SHA.
   - **already-fixed** — reference the commit that addressed it.
   - **false-positive** — explain why with a code reference.
   - **needs-discussion** — state the open question concisely.

8. **Show all draft replies to the user and get explicit confirmation before posting each one.** NEVER auto-post or auto-resolve. Present each reply and wait for approval.

9. **Post approved replies.**
   - For inline comments, reply to the thread:
     ```bash
     gh api repos/bd73-com/fetchthechange/pulls/{number}/comments/{comment_id}/replies \
       -f body="{approved reply text}"
     ```
   - For general PR comments:
     ```bash
     gh pr comment --repo bd73-com/fetchthechange {number} --body "{approved reply text}"
     ```

10. **Resolve threads only with explicit user approval.** After posting a reply, ask whether the thread should be resolved. Do not batch-resolve.

11. **Push all fix commits.**
    ```bash
    git push -u origin {branch-name}
    ```

12. **Final summary.** Output a table of actions taken:
    ```
    | # | Classification | Action | Commit / Reply |
    ```

## Hard Constraints

- NEVER auto-resolve threads or auto-post replies — always show the draft to the user and get explicit confirmation before each reply and each resolution — this is a blocking requirement to prevent unreviewed communication on shared PRs.
- NEVER run `gh` commands without `--repo bd73-com/fetchthechange` (for subcommands that accept it) or use the full `repos/bd73-com/fetchthechange/...` API path — the git remote uses a local proxy and `gh` cannot infer the repo.
- NEVER skip the verification gate (`npm run check && npm run test`) after modifying a file — every file change must pass before proceeding to the next file.
- NEVER batch multiple file fixes into a single verification run — fix one file, verify, then move to the next.
- NEVER treat `github-actions[bot]` output as actionable unless it contains an explicit error, failure, or suggestion — filter CI bot noise by default.
- NEVER modify code without first reading the full file to understand context — prevents blind fixes that break surrounding logic.
- NEVER force-push or amend commits that are already on the remote — create new fix commits instead.
- ALWAYS identify `coderabbitai[bot]` as the primary reviewer bot — not Copilot, not other bots.
- ALWAYS run `npm run build` in addition to check and test before pushing if the fixes are substantial (more than 3 files changed).
