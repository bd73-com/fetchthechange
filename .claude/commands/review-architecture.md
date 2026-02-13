Review the code changes on the current branch for architecture and design issues.

## Instructions

1. Run `git diff main...HEAD` to see all changes on this branch.
2. For each changed file, read the full file and understand its role in the project.
3. Explore related files (imports, callers, shared types) to understand the broader context.
4. Evaluate:
   - **Separation of concerns**: Is logic in the right layer (route vs service vs utility)?
   - **Coupling**: Are modules tightly coupled? Would a change here force changes elsewhere?
   - **Consistency**: Do the changes follow established patterns in the codebase?
   - **Error propagation**: Do errors flow correctly through the call chain?
   - **API design**: Are function signatures, return types, and naming clear and consistent?
   - **Scalability**: Will this approach work as the codebase grows, or does it create tech debt?
   - **Duplication**: Is there duplicated logic that should be shared?
5. Rate each finding as **critical**, **suggestion**, or **note**.
6. Output a summary with file, concern area, severity, and description.
7. For critical findings, suggest a specific alternative approach.
8. If the architecture is sound, say so clearly.

Focus on structural issues that affect maintainability. Do not flag cosmetic preferences.
