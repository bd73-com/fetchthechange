Review the Pull Request on the current branch, fix any issues found, merge it, and clean up the branch.

## Instructions

1. Run `git diff main...HEAD` to see all changes on this branch.
2. For each changed file, read the full file to understand context.
3. Review the changes for:
   - **Bugs**: Logic errors, null handling gaps, race conditions, off-by-one mistakes
   - **Security**: Injection, auth issues, data exposure, input validation gaps
   - **Architecture**: Separation of concerns, coupling, consistency with existing patterns
4. Rate each finding as **critical**, **warning**, or **nit**.
5. If any **critical** or **warning** issues are found:
   - Fix each issue directly in the source code.
   - Run `npx vitest run` to verify nothing is broken.
   - If tests fail, fix them and re-run until all tests pass.
   - Commit the fixes with a clear message describing what was fixed and why.
   - Push the fixes with `git push -u origin HEAD`.
6. Output a summary of findings: what was found, what was fixed, and what was left as-is.
7. Merge the PR with `gh pr merge --squash --delete-branch`.
8. Confirm the merge succeeded and the remote branch was deleted.

Fix real problems, not style preferences. When in doubt, leave it alone and mention it in the summary.
