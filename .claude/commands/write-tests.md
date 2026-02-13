Write tests for the code changes on the current branch, then run them until they pass.

## Instructions

1. Run `git diff main...HEAD` to identify changed files and functions.
2. For each changed file, read the full file and its existing test file (if any).
3. Identify untested or under-tested code paths in the diff:
   - New functions or methods
   - New branches (if/else, switch cases)
   - Edge cases and error paths
   - Boundary conditions
4. Write tests following the existing test patterns in the codebase:
   - Use vitest (describe/it/expect)
   - Use existing mocks and helpers where available
   - Co-locate tests in `*.test.ts` files next to the source
5. Run the tests with `npx vitest run <test-file>`.
6. If any test fails:
   - Read the error output carefully
   - Fix the test (not the source code) if the test logic is wrong
   - Fix the source code only if you discover a genuine bug
   - Re-run until all tests pass
7. Report the final test count and pass/fail status.

Do not write trivial tests. Focus on meaningful coverage of the changed code.
