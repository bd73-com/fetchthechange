Review the code changes on the current branch for bugs and quality issues.

## Instructions

1. Run `git diff main...HEAD` to see all changes on this branch.
2. For each changed file, read the full file to understand context.
3. Check for:
   - Logic errors and off-by-one mistakes
   - Null/undefined handling gaps
   - Missing error handling
   - Race conditions or async issues
   - Unreachable code or dead branches
   - Incorrect types or type assertions
   - Copy-paste errors
   - Inconsistent naming or conventions vs the rest of the codebase
4. Rate each finding as **critical**, **warning**, or **nit**.
5. Output a summary table of findings with file, line, severity, and description.
6. If no issues are found, say so clearly.

Focus on correctness over style. Do not suggest refactors unless they fix a real bug.
