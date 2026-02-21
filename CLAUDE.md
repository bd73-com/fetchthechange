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
