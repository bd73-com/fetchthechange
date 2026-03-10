Run the full release pipeline for the current branch: write and pass tests, security review, architecture review, code review, skeptic adversarial review, bug triage, documentation review, extension rebuild if needed, and create a PR.

## Instructions

This command accepts an optional `--from=N` argument (e.g. `/magicwand --from=3`). When provided, skip phases 1 through N-1 and begin execution at Phase N. All issue-tracking rules still apply from the starting phase onward. If `--from` is not provided, start at Phase 1.

This command is an orchestrator. It executes each phase below in strict order by reading the named command file and following its instructions completely. If any phase fails or exits with an error, stop immediately and do not proceed to the next phase.

**Issue tracking rule:** Maintain a running issue table throughout the entire pipeline. Every time an issue is found — a failing test, a security vulnerability, an architectural problem, a bug, a doc gap, or a skeptic discovery — append a row:

| # | Phase | Category | Found | File:Line | Fixed |
|---|-------|----------|-------|-----------|-------|

- `#` is sequential across all phases (never resets per phase).
- `Category` is one of: `test`, `security`, `architecture`, `code`, `skeptic:blocker`, `skeptic:gotcha`, `skeptic:pattern`, `bug`, `doc`, `pr`.
- Every row must have both Found and Fixed filled before the phase completes.
- Do not move to the next phase while any row in the current phase has an empty Fixed cell.

**Out-of-scope rule:** During phases 1–5, if a finding is clearly a pre-existing bug in unrelated code (not introduced by the current branch), mark it as out-of-scope instead of requiring an immediate fix. Log it in the issue table with `Fixed` set to `→ Bug Report (Phase 6)`. These entries are deferred to Phase 6 for triage and GitHub Issue filing. Only genuinely pre-existing bugs qualify — if the current branch touched the code, it is in-scope and must be fixed.

If a phase cannot complete, print the failure banner and stop:

```
✗ /magicwand stopped at phase: <PHASE_NAME>
  Reason: <error summary>
  Fix the issue above, then resume with: /magicwand --from=<N>
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

Invoke the skeptic by calling the **Agent tool** with `subagent_type: "skeptic"`. Pass it a prompt containing:

1. The branch name (from `git branch --show-current`)
2. The full diff (from `git diff main...HEAD`)

The prompt should ask the skeptic to review all changes on this branch against main.

Wait for the skeptic to emit one of its completion signals before continuing:

- `<promise>SKEPTIC_COMPLETE</promise>` — analysis done, proceed to triage
- `<promise>BLOCKED: ...</promise>` — stop and surface the message to the developer; human decision required before continuing
- `<promise>ESCALATE: ...</promise>` — stop immediately and halt the pipeline

If BLOCKED or ESCALATE: print the failure banner and stop:

```
✗ /magicwand stopped at phase: Skeptic Review
  Reason: <BLOCKED or ESCALATE message from skeptic>
  Human decision required. Resolve the issue above, then resume with: /magicwand --from=5
```

If SKEPTIC_COMPLETE: parse every `<discovery>` tag from the skeptic's output and triage as follows:

- `category="blocker"` → mandatory fix. Log a FOUND entry. Fix immediately. Log the FIXED entry. Do not proceed to Phase 6 while any blocker remains unresolved. Exception: if the blocker is clearly a pre-existing bug in unrelated code, mark it as out-of-scope with `Fixed` set to `→ Bug Report (Phase 6)`.
- `category="gotcha"` → mandatory fix. Log a FOUND entry. Fix immediately. Log the FIXED entry. Do not proceed while any gotcha remains unresolved. Exception: if the gotcha is clearly a pre-existing bug in unrelated code, mark it as out-of-scope with `Fixed` set to `→ Bug Report (Phase 6)`.
- `category="pattern"` → apply the suggested hardening. Log a FOUND entry. Apply fix. Log the FIXED entry. Exception: if the pattern is clearly a pre-existing issue in unrelated code, mark it as out-of-scope with `Fixed` set to `→ Bug Report (Phase 6)`.

After all discoveries are remediated, run:

```bash
npm run check && npm run test
```

A phase is complete when all `<discovery>` tags have a FOUND + FIXED log entry each, and `npm run check && npm run test` exit with code 0.

### Phase 6 of 9 — Bug Report

Invoke the bug reporter by calling the **Agent tool** with `subagent_type: "bug-reporter"`. Pass it a prompt containing:

1. The branch name (from `git branch --show-current`)
2. The full diff (from `git diff main...HEAD`)
3. All issue table rows from phases 1–5 that have `Fixed` set to `→ Bug Report (Phase 6)` — these are the out-of-scope findings deferred from earlier phases
4. Instructions to also perform an independent scan of adjacent code for pre-existing bugs

Wait for the bug reporter to emit one of its completion signals:

- `<promise>BUG_REPORTER_COMPLETE</promise>` — analysis done, proceed to file issues
- `<promise>ESCALATE: ...</promise>` — critical security vulnerability found; halt the pipeline

If ESCALATE: print the failure banner and stop:

```
✗ /magicwand stopped at phase: Bug Report
  Reason: <ESCALATE message from bug reporter>
  Critical pre-existing bug requires immediate attention. Resolve before continuing.
  Resume with: /magicwand --from=6
```

If BUG_REPORTER_COMPLETE: parse every `<bug>` tag from the bug reporter's output and file each as a GitHub Issue:

1. For each `<bug>` tag, create a GitHub Issue. Before filing the first issue, verify that the severity labels exist (run `gh label list --repo bd73-com/fetchthechange`). If a severity label (e.g. `critical`, `high`, `medium`, `low`) does not exist, create it first with `gh label create`. Then file:
   ```bash
   gh issue create --repo bd73-com/fetchthechange \
     --title "Bug: [title from bug report]" \
     --label "bug,[severity]" \
     --body "[full bug report content from inside the <bug> tag]"
   ```
2. Log each filed issue in the issue table with category `bug` and `Fixed` set to `Filed as #<issue-number>`.
3. Parse the `<bug-summary>` tag and record the totals.

If the bug reporter found bugs that it reclassified as **in-scope** (introduced by this branch), do NOT file them as issues. Instead, log them in the issue table with category matching the original phase and `Fixed` left empty. Print the failure banner — these must be fixed before proceeding:

```
✗ /magicwand stopped at phase: Bug Report
  Reason: <N> bug(s) reclassified as in-scope — must be fixed before continuing
  Fix the in-scope bugs listed above, then resume with: /magicwand --from=6
```

If the bug reporter found zero bugs and zero reclassifications, log `(no out-of-scope bugs found)` and proceed.

**Resume note:** When resuming with `--from=6`, the orchestrator does not have the issue table from phases 1–5. If there were deferred out-of-scope findings, the user must re-provide them in the prompt (e.g. paste the issue table rows with `Fixed` set to `→ Bug Report (Phase 6)`). If no deferred findings are provided, the bug reporter runs only its independent scan.

A phase is complete when all `<bug>` tags have been filed as GitHub Issues (or the summary shows zero bugs) and no in-scope reclassifications remain unresolved.

### Phase 7 of 9 — Documentation Review

Read `.claude/commands/review-doc.md` and execute every step in that file for the current branch.

For every documentation surface classified as UPDATE REQUIRED or NEW SECTION NEEDED, log a FOUND entry. Patch it and log the FIXED entry. Surfaces classified NO CHANGE NEEDED do not need a log entry.

A phase is complete when all UPDATE REQUIRED and NEW SECTION NEEDED surfaces have been patched and `npm run check` exits with code 0.

### Phase 8 of 9 — Extension Release

Before delegating, pre-check whether extension files changed:

```bash
git diff main...HEAD --name-only | grep -qE '^extension/(src/|manifest\.json|package\.json|tsconfig\.json|scripts/)'
```

If no match (exit code 1): print `✓ Phase 8 skipped — no extension changes detected` and continue to Phase 9. Do not read or execute `extension-release.md`.

If match (exit code 0): read `.claude/commands/extension-release.md` and execute every step in that file.

A phase is complete when either the skip condition is met, or `extension/fetchthechange-extension.zip` exists, is larger than 1 KB, and the version in `extension/manifest.json` has been bumped.

### Phase 9 of 9 — Create PR

Read `.claude/commands/create-pr.md` and execute every step in that file.

After the PR is created, infer the appropriate release label and apply it:

1. Examine all commits and diffs on the branch to determine the change type.
2. Pick exactly one label from: `feature`, `fix`, `breaking`, `chore`, `docs`, `security`.
   - New user-facing capability → `feature`
   - Bug fix → `fix`
   - Breaking API or schema change → `breaking`
   - Security patch or hardening → `security`
   - Documentation-only changes → `docs`
   - Everything else (refactor, deps, CI) → `chore`
3. Apply it: `gh pr edit --add-label "<label>" --repo bd73-com/fetchthechange`

A phase is complete when `gh pr view` returns a valid open PR URL with a release label applied.

## Final summary

After all 9 phases complete successfully, print the following two sections.

### Section 1 — Pipeline summary

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  🪄 /magicwand — Complete
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Branch:   <branch name>
  PR:       <PR URL>
  Status:   PR Created ✓

  Phases completed:
    ✓ Phase 1 — Write Tests
    ✓ Phase 2 — Security Review
    ✓ Phase 3 — Architecture Review
    ✓ Phase 4 — Code Review
    ✓ Phase 5 — Skeptic Review       (<N> discoveries resolved)
    ✓ Phase 6 — Bug Report           (<N> issues filed / no bugs found)
    ✓ Phase 7 — Documentation Review
    ✓ Phase 8 — Extension Release    (skipped / rebuilt <version>)
    ✓ Phase 9 — Create PR

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Replace `(<N> discoveries resolved)` with the actual count from Phase 5.
Replace `(<N> issues filed / no bugs found)` with the actual outcome of Phase 6.
Replace `(skipped / rebuilt <version>)` with the actual outcome of Phase 8.

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

  ── Phase 6 — Bug Report ──────────────────
  Bugs filed: <N> (<N> critical, <N> high, <N> medium, <N> low)

  #7  [high] FOUND:  <description> (<file:line>)
             FILED:  GitHub Issue #<number>

  ── Phase 7 — Documentation Review ─────
  #8  FOUND:  <surface name> — <what was stale>
      FIXED:  <what was updated>

  ── Phase 8 — Extension Release ─────────
  (skipped — no extension changes)

  ── Phase 9 — Create PR ──────────────────
  (no issues)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Rules for this report:

- Issue numbers are sequential across all phases (not reset per phase).
- Phase 5 Skeptic entries must include the discovery category tag (`[blocker]`, `[gotcha]`, `[pattern]`) before FOUND.
- Phase 5 must also include the skeptic's Final Verdict line and discovery counts.
- Phase 6 Bug Report entries use `FILED` instead of `FIXED`, with the GitHub Issue number. Include severity in brackets (`[high]`, `[medium]`, etc.) before FOUND. Include bug summary counts. Phase 6 entries with `FILED` count as resolved for the total issues found/fixed invariant check.
- Every phase must appear even if it has no issues — print `(none)` or `(no issues)`.
- If total issues fixed does not equal total issues found, print a warning: `⚠ WARNING: <N> issue(s) were found but not resolved.` and list them explicitly.
- Do not omit or summarise issues — every row from the issue table must appear verbatim.
