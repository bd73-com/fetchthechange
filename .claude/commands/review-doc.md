Review all documentation surfaces in the app and update any that are stale or incomplete based on the code changes on the current branch.

## Instructions

1. Run `git diff main...HEAD` to understand what changed on this branch:

   ```bash
   git diff main...HEAD -- '*.ts' '*.tsx' '*.sql' 'shared/schema.ts'
   ```

   Also read the PR description if one exists:

   ```bash
   gh pr view --json title,body 2>/dev/null || echo "No PR yet"
   ```

2. Produce an internal **Change Summary** before touching anything:
   - Feature name
   - New user-facing capabilities (bullet list)
   - Plan/tier gating (Free / Pro / Power)
   - New or modified `/api/v1/` endpoints
   - New env vars or third-party services introduced

   Stop and think carefully here — this summary drives every decision below.

3. Read all documentation surfaces in full:

   ```bash
   cat client/src/pages/Pricing.tsx
   cat client/src/components/UpgradeDialog.tsx
   cat client/src/pages/Changelog.tsx
   cat client/src/pages/Support.tsx
   cat client/src/pages/DocsWebhooks.tsx
   cat client/src/pages/Developer.tsx
   cat client/src/pages/BlogComparison.tsx
   cat client/src/pages/BlogWhyMonitorsFail.tsx
   cat client/src/pages/BlogPriceMonitoring.tsx
   cat client/src/pages/BlogSelectorBreakage.tsx
   cat client/src/pages/BlogUseCases.tsx
   cat client/src/pages/Privacy.tsx
   ```

4. Produce a **Documentation Gap Report** — classify each surface as one of:
   - ✅ **NO CHANGE NEEDED** — state why
   - ⚠️ **UPDATE REQUIRED** — state exactly what is stale and what it should say
   - ➕ **NEW SECTION NEEDED** — state what must be added

5. Apply these rules per surface:
   - **Pricing.tsx** — does the features array for affected plan(s) include every new capability? Never change the Free plan unless the branch explicitly modifies Free tier behavior.
   - **UpgradeDialog.tsx** — `getPlanFeatures()` must stay in sync with Pricing.tsx bullet for bullet.
   - **Changelog.tsx** — a new entry is ALWAYS required. Use today's date. Format: `{ date: "YYYY-MM-DD", title: "...", items: ["..."] }`. Most recent entry goes first.
   - **Support.tsx** — is there at least one FAQ item covering the new feature? Non-obvious behavior (rate limits, OAuth flows, retry logic) warrants a dedicated section. Never remove existing FAQ items unless they describe a removed feature.
   - **DocsWebhooks.tsx** — update only if webhook payload shape, HMAC signing, retry logic, or delivery log changed.
   - **Developer.tsx** — update only if `/api/v1/` endpoints, rate limits, or API key behavior changed.
   - **Blog pages** — scan for factual errors only (e.g. a feature described as unavailable that now ships). Do not add new marketing copy — only correct inaccuracies.
   - **Privacy.tsx** — update only if a new third-party sub-processor, new data category, or data retention change was introduced.

6. Execute updates in this order, running `npm run check && npm run test` after each file. Fix any failure before continuing:
   1. `client/src/pages/Pricing.tsx`
   2. `client/src/components/UpgradeDialog.tsx`
   3. `client/src/pages/Changelog.tsx`
   4. `client/src/pages/Support.tsx`
   5. `client/src/pages/DocsWebhooks.tsx` (if flagged)
   6. `client/src/pages/Developer.tsx` (if flagged)
   7. Blog pages (if any flagged)
   8. `client/src/pages/Privacy.tsx` (if flagged)

7. Hard constraints for all edits:
   - Do not touch files marked NO CHANGE NEEDED.
   - Preserve all existing JSX structure, import order, and component names — patch, don't rewrite.
   - All new prose must match the existing tone: concise, technical, no hype.
   - Internal links must use `<Link href="...">` (wouter), not `<a href="...">`.
   - Code blocks in docs pages must be syntactically valid.

8. Run a final check across all changed files:

   ```bash
   npm run check && npm run test
   ```

9. Open a pull request:

   ```bash
   gh pr create \
     --repo bd73-com/fetchthechange \
     --title "docs: update documentation surfaces for $(git branch --show-current)" \
     --body "## Documentation review

   **Branch reviewed:** \`$(git branch --show-current)\`

   ### Surfaces updated
   <!-- list files changed -->

   ### Surfaces unchanged
   <!-- list NO CHANGE NEEDED surfaces with reason -->

   ---
   Verify that the Changelog date is correct and that FAQ wording matches the shipped behavior." \
     --base main
   ```
