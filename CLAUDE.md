# CLAUDE.md — FetchTheChange

See `README.md` for project overview, tech stack, structure, and setup.

## Key Files
- `shared/models/auth.ts` — Tier configuration constants (`TIER_LIMITS`, `BROWSERLESS_CAPS`, `PAUSE_THRESHOLDS`, `RESEND_CAPS`), user table schema
- `shared/schema.ts` — Database table definitions (monitors, monitorChanges, etc.)
- `shared/routes.ts` — Zod validation schemas for API routes

## Conventions
- **Shared types**: All types shared between client and server live in `shared/`. Import with `@shared/` alias.
- **Tier system**: Tier limits are defined as constants in `shared/models/auth.ts`. Backend enforcement reads from these constants dynamically — never hardcode tier limits in server code.
- **UI components**: Use shadcn/ui primitives (Card, Badge, Button, Dialog, etc.) from `@/components/ui/`.
- **Styling**: Tailwind CSS with dark mode as default. Use semantic color tokens (`text-primary`, `text-muted-foreground`, `bg-secondary`, etc.).
- **State management**: TanStack React Query for server state. No Redux or Zustand.
- **Testing**: Vitest with `expect` assertions. Test files co-located as `*.test.ts` next to source files.
- **API patterns**: Express routes in `server/routes.ts`. JSON responses with `{ message, code }` for errors.
- **Authentication**: Replit Auth with OpenID Connect via Passport.
- **Database**: PostgreSQL with Drizzle ORM. Schema in `shared/schema.ts` and `shared/models/auth.ts`.
- **Release labels**: PRs should carry one of: `feature`, `fix`, `breaking`, `chore`, `docs`, `security`. Auto-applied from PR title by release-drafter, but verify before merging.
- **Chrome extension surface area**: The extension (`extension/`) depends on server and client files beyond its own source. When changing `server/routes/extension.ts`, `server/middleware/extensionAuth.ts`, `client/src/pages/ExtensionAuth.tsx`, or `server/utils/extensionToken.ts`, check whether the extension source needs matching updates and run `/extension-release`.

## Verification
- `npm run check` — TypeScript type checking (tsc)
- `npm run test` — Run all tests (vitest run)
- `npm run build` — Full production build (frontend Vite + server esbuild bundle)
- Always run `check` and `test` before creating commits. Run `build` before creating PRs.

## PR Workflow
- Create PRs against `main` using `gh pr create`.
- CodeRabbit auto-reviews all PRs (configured in `.coderabbit.yaml`).
- PR titles should be concise (<70 chars); use the body for details.
- Run `npm run check && npm run test` before pushing.
## Environment Notes
- Git remote uses a local proxy. `gh` CLI cannot infer the repo from remotes.
- Always pass `--repo bd73-com/fetchthechange` when using `gh` commands:
```
  gh pr create --repo bd73-com/fetchthechange --title "..." --body "..."
  gh pr list --repo bd73-com/fetchthechange
```

## Skills

- `.claude/skills/skill-creator/` — guide for creating new skills that encode FetchTheChange conventions
- `.claude/skills/blog/` — adding a new blog post (page component + Blog.tsx index entry + App.tsx route); enforced by `blog-integrity.test.ts`
- `.claude/skills/pr-comments/` — retrieving, triaging, and resolving GitHub PR review comments
- `.claude/skills/add-api-route/` — adding a new API endpoint (route constant, Zod schema, storage method, ownership check, SSRF, tier gate, CSRF exemption)
- `.claude/skills/add-page/` — adding a new public page (SEOHead, getCanonicalUrl, PublicNav, shadcn/ui, Tailwind tokens, App.tsx registration)
- `.claude/skills/add-notification-channel/` — adding a new notification channel (encrypted credentials, delivery service, tier gate, OAuth CSRF exemption)
- `.claude/skills/changelog/` — keeping the changelog up to date (sync-changelog.ts workflow, never edit changelog.ts by hand, seed entries)
- `.claude/skills/seo-audit/` — technical and on-page SEO diagnostics (crawlability, indexation, Core Web Vitals, content quality, E-E-A-T); includes AI writing detection reference

## Agents

- `.claude/agents/architect.md` — system-wide architectural analysis (read-only)
- `.claude/agents/bug-reporter.md` — out-of-scope bug triage and structured report preparation (read-only); invoked by magicwand Phase 6
- `.claude/agents/performance-analyst.md` — performance bottleneck identification (read-only)
- `.claude/agents/plan-reviewer.md` — implementation plan validation (read-only)
- `.claude/agents/pr-creation.md` — automated PR generation
- `.claude/agents/security-auditor.md` — OWASP security analysis (read-only)
- `.claude/agents/skeptic.md` — adversarial review for edge cases and failure modes (read-only); invoked by magicwand Phase 5

## graphify (optional tooling)

Some developers use [graphify](https://github.com/safishamsi/graphify) to maintain a knowledge graph at `graphify-out/`. The directory is gitignored — these rules apply only when graphify is primed on this checkout (i.e. `graphify-out/graph.json` exists). If it doesn't exist, skip everything in this section.

Rules (when primed):
- Before answering architecture or codebase questions, read `graphify-out/GRAPH_REPORT.md` for god nodes and community structure
- If `graphify-out/wiki/index.md` exists, navigate it instead of reading raw files
- If you modified code files during a task, run the graph rebuild **once at the end** of the task (after all edits are done, before handing back), not after each individual edit. Multi-phase commands like `/magicwand` should rebuild a single time at the end of the pipeline. Rebuild command: `python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"` (this is the same call graphify's own `graphify hook install` post-commit hook uses — AST-only, no LLM)
