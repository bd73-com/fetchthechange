# CLAUDE.md — FetchTheChange

## Project Overview
FetchTheChange is a website change monitoring SaaS. Users create monitors that track CSS-selected elements on web pages and receive email notifications when values change. Built with React + Express + PostgreSQL (Drizzle ORM).

## Project Structure
- `shared/` — Shared types, schemas, and constants used by both client and server
- `shared/models/auth.ts` — Tier configuration constants (`TIER_LIMITS`, `BROWSERLESS_CAPS`, `PAUSE_THRESHOLDS`, `RESEND_CAPS`), user table schema
- `shared/schema.ts` — Database table definitions (monitors, monitorChanges, etc.)
- `shared/routes.ts` — Zod validation schemas for API routes
- `server/` — Express backend (routes, services, webhook handlers)
- `client/src/` — React frontend (pages, components, hooks)
- `client/src/pages/` — Page components (Dashboard, Pricing, LandingPage, Support, Blog*)
- `client/src/components/` — Reusable UI components (shadcn/ui based)

## Conventions
- **Shared types**: All types shared between client and server live in `shared/`. Import with `@shared/` alias.
- **Tier system**: Tier limits are defined as constants in `shared/models/auth.ts`. Backend enforcement reads from these constants dynamically — never hardcode tier limits in server code.
- **UI components**: Use shadcn/ui primitives (Card, Badge, Button, Dialog, etc.) from `@/components/ui/`.
- **Styling**: Tailwind CSS with dark mode as default. Use semantic color tokens (`text-primary`, `text-muted-foreground`, `bg-secondary`, etc.).
- **State management**: TanStack React Query for server state. No Redux or Zustand.
- **Testing**: Vitest with `expect` assertions. Test files co-located as `*.test.ts` in `shared/`.
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

## Specs
- `update-free-tier-monitors` — Increase free tier from 1 to 3 monitors: `.claude/specs/update-free-tier-monitors.md`
