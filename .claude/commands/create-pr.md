Create a GitHub Pull Request for the current branch with a generated title and description.

## Instructions

1. Run `git diff main...HEAD` to see all changes on this branch.
2. Run `git log main..HEAD --oneline` to see all commit messages on this branch.
3. For each changed file, read the full file to understand what was changed and why.
4. Generate a PR title:
   - Use a short imperative phrase (under 72 characters)
   - Summarize the overall intent, not individual commits
5. Generate a PR description with these sections:
   - **Summary**: 2-3 sentences explaining what this PR does and why
   - **Changes**: Bulleted list of the key changes, grouped by area
   - **How to test**: Step-by-step instructions for verifying the changes
6. Push the current branch with `git push -u origin HEAD`.
7. Create the PR with `gh pr create --title "<title>" --body "<description>" --base main`.
8. Output the PR URL and the generated title and description for review.

Write the PR description for a reviewer who has no context. Be specific, not vague.
