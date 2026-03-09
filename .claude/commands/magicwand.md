Run the full release pipeline for the current branch: write and pass tests, security review, architecture review, code review, documentation review, extension rebuild if needed, create a PR, then review and merge it.

## Instructions

This command is an orchestrator. It executes each phase below in strict order by reading the named command file and following its instructions completely. If any phase fails or exits with an error, stop immediately and do not proceed to the next phase. Print a clear failure banner before stopping:

**Issue tracking rule:** Maintain a running internal log throughout the entire pipeline. Every time an issue is found — a failing test, a security vulnerability, an architectural problem, a bug, a doc gap — record it with this structure:

```
[Phase N — <phase name>] FOUND: <brief description of the issue> (file:line if applicable)
[Phase N — <phase name>] FIXED: <brief description of what was done to fix it>
```

Every FOUND entry must have a corresponding FIXED entry before the phase completes. A phase is never complete while any FOUND entry in that phase has no corresponding FIXED entry. Do not move to the next phase until every issue from the current phase is resolved.

```
✗ /magicwand stopped at phase: <PHASE_NAME>
  Reason: <error summary>
  Fix the issue above and re-run /magicwand, or run /<phase-command> directly to resume from this phase.
```

Print a progress banner before starting each phase:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  🪄 /magicwand — Phase <N> of 8: <PHASE_NAME>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Phase 1 of 8 — Write Tests

Read `.claude/commands/write-tests.md` and execute every step in that file for the current branch.

For every test that fails to pass after being written, log it as a FOUND entry and record the fix applied. Do not mark the phase complete until all tests pass.

A phase is complete when `npm run test` exits with code 0 and all newly written tests pass.

### Phase 2 of 8 — Security Review

Read `.claude/commands/review-security.md` and execute every step in that file for the current branch.

For every vulnerability or security finding identified, log a FOUND entry. Fix it immediately — do not batch fixes. Log the FIXED entry as each issue is resolved. Do not mark the phase complete while any security finding remains unresolved.

A phase is complete when all critical and high-severity security findings have been remediated and `npm run check && npm run test` exit with code 0.

### Phase 3 of 8 — Architecture Review

Read `.claude/commands/review-architecture.md` and execute every step in that file for the current branch.

For every architectural or design issue identified, log a FOUND entry. Fix it immediately and log the FIXED entry. Do not proceed to Phase 4 while any blocking architectural issue remains open.

A phase is complete when all blocking architectural issues have been remediated and `npm run check && npm run test` exit with code 0.

### Phase 4 of 8 — Code Review

Read `.claude/commands/review-code.md` and execute every step in that file for the current branch.

For every bug, regression risk, or quality issue identified, log a FOUND entry. Fix it immediately and log the FIXED entry. Do not proceed to Phase 5 while any identified issue remains open.

A phase is complete when all bugs and quality issues identified by the review have been resolved and `npm run check && npm run test` exit with code 0.

### Phase 5 of 8 — Documentation Review

Read `.claude/commands/review-doc.md` and execute every step in that file for the current branch.

For every documentation surface classified as UPDATE REQUIRED or NEW SECTION NEEDED, log a FOUND entry. Patch it and log the FIXED entry. Surfaces classified NO CHANGE NEEDED do not need a log entry.

A phase is complete when all UPDATE REQUIRED and NEW SECTION NEEDED surfaces have been patched and `npm run check` exits with code 0.

### Phase 6 of 8 — Extension Release

Read `.claude/commands/extension-release.md` and execute every step in that file.

If the command determines that no rebuild is required (no extension files changed), print:

```
✓ Phase 6 skipped — no extension changes detected
```

and continue to Phase 7.

A phase is complete when either the skip condition is met, or `extension/fetchthechange-extension.zip` exists, is larger than 1 KB, and the version in `extension/manifest.json` has been bumped.

### Phase 7 of 8 — Create PR

Read `.claude/commands/create-pr.md` and execute every step in that file.

A phase is complete when `gh pr view` returns a valid open PR URL for the current branch.

### Phase 8 of 8 — Review and Merge PR

Read `.claude/commands/review-pr.md` and execute every step in that file.

A phase is complete when the PR has been squash-merged into main and the feature branch has been deleted.

## Final summary

After all 8 phases complete successfully, print the following two sections.

### Section 1 — Pipeline summary

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  🪄 /magicwand — Complete
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Branch:   <branch name>
  PR:       <PR URL>
  Status:   Merged ✓

  Phases completed:
    ✓ Phase 1 — Write Tests
    ✓ Phase 2 — Security Review
    ✓ Phase 3 — Architecture Review
    ✓ Phase 4 — Code Review
    ✓ Phase 5 — Documentation Review
    ✓ Phase 6 — Extension Release  (skipped / rebuilt <version>)
    ✓ Phase 7 — Create PR
    ✓ Phase 8 — Review and Merge PR

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Replace `(skipped / rebuilt <version>)` with the actual outcome of Phase 6.

### Section 2 — Issues found and fixed

Print a consolidated report of every issue logged across all phases. Group by phase. Use this format exactly:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  🪄 /magicwand — Issues Found & Fixed
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Total issues found:  <N>
  Total issues fixed:  <N>  (must equal total found)

  ── Phase 1 — Write Tests ──────────────
  #1  FOUND:  <description> (<file:line>)
      FIXED:  <what was done>

  #2  FOUND:  <description>
      FIXED:  <what was done>

  ── Phase 2 — Security Review ──────────
  #3  FOUND:  <description> (<file:line>)
      FIXED:  <what was done>

  ── Phase 3 — Architecture Review ──────
  (none)

  ── Phase 4 — Code Review ───────────────
  #4  FOUND:  <description> (<file:line>)
      FIXED:  <what was done>

  ── Phase 5 — Documentation Review ─────
  #5  FOUND:  <surface name> — <what was stale>
      FIXED:  <what was updated>

  ── Phase 6 — Extension Release ─────────
  (skipped — no extension changes)

  ── Phase 7 — Create PR ──────────────────
  (no issues)

  ── Phase 8 — Review & Merge PR ─────────
  #6  FOUND:  <description>
      FIXED:  <what was done>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Rules for this report:

- Issue numbers are sequential across all phases (not reset per phase).
- Every phase must appear even if it has no issues — print `(none)` or `(no issues)`.
- If total issues fixed does not equal total issues found, print a warning line in red: `⚠ WARNING: <N> issue(s) were found but not resolved.` and list them explicitly.
- Do not omit or summarise issues — every FOUND/FIXED pair from the internal log must appear verbatim.
