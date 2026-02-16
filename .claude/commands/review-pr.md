Reviews the PR for bugs/security/architecture, fixes issues found, reads feedback from CodeRabbit and fix the issues, runs tests, merges via squash, and deletes the merged branch.

## Instructions

1. Run `git diff main...HEAD` to see all changes on this branch.
2. For each changed file, read the full file to understand context.
3. Review the changes for:
   - **Bugs**: Logic errors, null handling gaps, race conditions, off-by-one mistakes
   - **Security**: Injection, auth issues, data exposure, input validation gaps
   - **Architecture**: Separation of concerns, coupling, consistency with existing patterns
4. Rate each finding as **critical**, **warning**, or **nit**.
5. Read CodeRabbit feedback on the PR:
   - Run `gh pr view --comments --json comments` to get all PR comments.
   - Run `gh api repos/{owner}/{repo}/pulls/{number}/reviews` to get review comments.
   - Run `gh api repos/{owner}/{repo}/pulls/{number}/comments` to get inline review comments.
   - Evaluate each CodeRabbit suggestion and fix any that are valid.
6. If any **critical** or **warning** issues are found (from your review or CodeRabbit):
   - Fix each issue directly in the source code.
   - Run `npx vitest run` to verify nothing is broken.
   - If tests fail, fix them and re-run until all tests pass.
   - Commit the fixes with a clear message describing what was fixed and why.
   - Push the fixes with `git push -u origin HEAD`.
7. Output a summary of findings: what was found, what was fixed, and what was left as-is.
8. **Ask the user for confirmation before merging.** Present the summary and wait for explicit approval.
9. If approved, merge the PR with `gh pr merge --squash --delete-branch`.
10. Confirm the merge succeeded and the remote branch was deleted.

Fix real problems, not style preferences. When in doubt, leave it alone and mention it in the summary.
