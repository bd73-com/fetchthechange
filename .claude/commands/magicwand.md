Run the full release pipeline for the current branch: write and pass tests, security review, architecture review, code review, skeptic adversarial review, documentation review, extension rebuild if needed, create a PR, then review and merge it.

## Instructions

This command is an orchestrator. It executes each phase below in strict order by reading the named command file and following its instructions completely. If any phase fails or exits with an error, stop immediately and do not proceed to the next phase.

**Issue tracking rule:** Maintain a running internal log throughout the entire pipeline. Every time an issue is found — a failing test, a security vulnerability, an architectural problem, a bug, a doc gap, or a skeptic discovery — record it with this structure:

```
[Phase N — <phase name>] FOUND: <brief description of the issue> (file:line if applicable)
[Phase N — <phase name>] FIXED: <brief description of what was done to fix it>
```

Every FOUND entry must have a corresponding FIXED entry before the phase completes. A phase is never complete while any FOUND entry in that phase has no corresponding FIXED entry. Do not move to the next phase until every issue from the current phase is resolved.

If a phase cannot complete, print the failure banner and stop:

```
✗ /magicwand stopped at phase: <PHASE_NAME>
  Reason: <error summary>
  Fix the issue above and re-run /magicwand, or run /<phase-command> directly to resume from this phase.
```

Print a progress banner before starting each phase:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  🪄 /magicwand — Phase <N> of 9: <PHASE_NAME>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Phase 1 of 9 — Write Tests

Read `.claude/commands/write-tests.md` and execute every step in that file for the current branch.

For every test that fails to pass after being written, log it as a FOUND entry and record the fix applied. Do not mark the phase complete until all tests pass.

A phase is complete when `npm run test` exits with code 0 and all newly written tests pass.

### Phase 2 of 9 — Security Review

Read `.claude/commands/review-security.md` and execute every step in that file for the current branch.

For every vulnerability or security finding identified, log a FOUND entry. Fix it immediately — do not batch fixes. Log the FIXED entry as each issue is resolved. Do not mark the phase complete while any security finding remains unresolved.

A phase is complete when all critical and high-severity security findings have been remediated and `npm run check && npm run test` exit with code 0.

### Phase 3 of 9 — Architecture Review

Read `.claude/commands/review-architecture.md` and execute every step in that file for the current branch.

For every architectural or design issue identified, log a FOUND entry. Fix it immediately and log the FIXED entry. Do not proceed to Phase 4 while any blocking architectural issue remains open.

A phase is complete when all blocking architectural issues have been remediated and `npm run check && npm run test` exit with code 0.

### Phase 4 of 9 — Code Review

Read `.claude/commands/review-code.md` and execute every step in that file for the current branch.

For every bug, regression risk, or quality issue identified, log a FOUND entry. Fix it immediately and log the FIXED entry. Do not proceed to Phase 5 while any identified issue remains open.

A phase is complete when all bugs and quality issues identified by the review have been resolved and `npm run check && npm run test` exit with code 0.

### Phase 5 of 9 — Skeptic Review

Invoke the skeptic subagent against the current branch:

Use the skeptic agent to review all changes on this branch against main. Pass it the output of:

```bash
git diff main...HEAD
```

and the current branch name from:

```bash
git branch --show-current
```

Wait for the skeptic to emit one of its completion signals before continuing:

- `<promise>SKEPTIC_COMPLETE</promise>` — analysis done, proceed to triage
- `<promise>BLOCKED: ...</promise>` — stop and surface the message to the developer; human decision required before continuing
- `<promise>ESCALATE: ...</promise>` — stop immediately and halt the pipeline

If BLOCKED or ESCALATE: print the failure banner and stop:

```
✗ /magicwand stopped at phase: Skeptic Review
  Reason: <BLOCKED or ESCALATE message from skeptic>
  Human decision required. Resolve the issue above, then re-run /magicwand.
```

If SKEPTIC_COMPLETE: parse every `<discovery>` tag from the skeptic's output and triage as follows:

- `category="blocker"` → mandatory fix. Log a FOUND entry. Fix immediately. Log the FIXED entry. Do not proceed to Phase 6 while any blocker remains unresolved.
- `category="gotcha"` → mandatory fix. Log a FOUND entry. Fix immediately. Log the FIXED entry. Do not proceed while any gotcha remains unresolved.
- `category="pattern"` → apply the suggested hardening. Log a FOUND entry. Apply fix. Log the FIXED entry.

After all discoveries are remediated, run:

```bash
npm run check && npm run test
```

A phase is complete when all `<discovery>` tags have a FOUND + FIXED log entry each, and `npm run check && npm run test` exit with code 0.

### Phase 6 of 9 — Documentation Review

Read `.claude/commands/review-doc.md` and execute every step in that file for the current branch.

For every documentation surface classified as UPDATE REQUIRED or NEW SECTION NEEDED, log a FOUND entry. Patch it and log the FIXED entry. Surfaces classified NO CHANGE NEEDED do not need a log entry.

A phase is complete when all UPDATE REQUIRED and NEW SECTION NEEDED surfaces have been patched and `npm run check` exits with code 0.

### Phase 7 of 9 — Extension Release

Read `.claude/commands/extension-release.md` and execute every step in that file.

If the command determines that no rebuild is required (no extension files changed), print:

```
✓ Phase 7 skipped — no extension changes detected
```

and continue to Phase 8.

A phase is complete when either the skip condition is met, or `extension/fetchthechange-extension.zip` exists, is larger than 1 KB, and the version in `extension/manifest.json` has been bumped.

### Phase 8 of 9 — Create PR

Read `.claude/commands/create-pr.md` and execute every step in that file.

A phase is complete when `gh pr view` returns a valid open PR URL for the current branch.

### Phase 9 of 9 — Review and Merge PR

Read `.claude/commands/review-pr.md` and execute every step in that file.

A phase is complete when the PR has been squash-merged into main and the feature branch has been deleted.

## Final summary

After all 9 phases complete successfully, print the following two sections.

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
    ✓ Phase 5 — Skeptic Review       (<N> discoveries resolved)
    ✓ Phase 6 — Documentation Review
    ✓ Phase 7 — Extension Release    (skipped / rebuilt <version>)
    ✓ Phase 8 — Create PR
    ✓ Phase 9 — Review and Merge PR

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Replace `(<N> discoveries resolved)` with the actual count from Phase 5.
Replace `(skipped / rebuilt <version>)` with the actual outcome of Phase 7.

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

  ── Phase 2 — Security Review ──────────
  #2  FOUND:  <description> (<file:line>)
      FIXED:  <what was done>

  ── Phase 3 — Architecture Review ──────
  (none)

  ── Phase 4 — Code Review ───────────────
  #3  FOUND:  <description> (<file:line>)
      FIXED:  <what was done>

  ── Phase 5 — Skeptic Review ────────────
  Skeptic verdict: PROCEED WITH CAUTIONS  [or PROCEED]
  Discoveries: <N> blocker, <N> gotcha, <N> pattern

  #4  [blocker] FOUND:  <description> (<file:line>)
               FIXED:  <what was done>

  #5  [gotcha]  FOUND:  <description> (<file:line>)
               FIXED:  <what was done>

  #6  [pattern] FOUND:  <description> (<file:line>)
               FIXED:  <what was done>

  ── Phase 6 — Documentation Review ─────
  #7  FOUND:  <surface name> — <what was stale>
      FIXED:  <what was updated>

  ── Phase 7 — Extension Release ─────────
  (skipped — no extension changes)

  ── Phase 8 — Create PR ──────────────────
  (no issues)

  ── Phase 9 — Review & Merge PR ─────────
  #8  FOUND:  <description>
      FIXED:  <what was done>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Rules for this report:

- Issue numbers are sequential across all phases (not reset per phase).
- Phase 5 Skeptic entries must include the discovery category tag (`[blocker]`, `[gotcha]`, `[pattern]`) before FOUND.
- Phase 5 must also include the skeptic's Final Verdict line and discovery counts.
- Every phase must appear even if it has no issues — print `(none)` or `(no issues)`.
- If total issues fixed does not equal total issues found, print a warning: `⚠ WARNING: <N> issue(s) were found but not resolved.` and list them explicitly.
- Do not omit or summarise issues — every FOUND/FIXED pair from the internal log must appear verbatim.
