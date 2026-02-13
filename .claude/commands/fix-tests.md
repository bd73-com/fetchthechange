Find and fix broken tests in the project.

## Instructions

1. Run `npx vitest run` to discover all failing tests.
2. For each failing test:
   - Read the full error output and stack trace.
   - Read the test file and the source file it tests.
   - Determine the root cause: is it a test bug or a source bug?
     - **Test bug**: Outdated assertion, wrong mock setup, stale snapshot, missing async handling.
     - **Source bug**: The implementation changed and the test correctly caught a regression.
3. Fix the issue:
   - For test bugs: update the test to match current correct behavior.
   - For source bugs: fix the source code, then verify the test passes.
4. Re-run `npx vitest run` after each fix to confirm the fix works and didn't break other tests.
5. Repeat until all tests pass.
6. Report a summary: how many tests were broken, what the root causes were, and what was fixed.

Never delete a failing test to make the suite pass. Always understand why it fails first.
