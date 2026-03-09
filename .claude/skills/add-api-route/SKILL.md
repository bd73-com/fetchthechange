---
name: add-api-route
description: "Adding a new API endpoint — defining the route constant and Zod schema in shared/routes.ts, registering the handler in server/routes.ts, adding the storage method to server/storage.ts, applying session ownership check, SSRF protection, tier gate, and CSRF exemption. Use when asked to 'add an endpoint', 'create an API route', 'add a new route', or 'wire up a backend endpoint'."
---

## Overview

Every API endpoint in FetchTheChange touches at least three files that must change together: `shared/routes.ts` (path constant + Zod schema), `server/routes.ts` (Express handler), and `server/storage.ts` (database method). Skipping any one of these causes type errors or runtime failures. This skill encodes the constraints that are easy to miss: SSRF checks on user-supplied URLs, ownership verification, tier gating, and CSRF exemptions.

## Workflow

1. Read `shared/routes.ts` — understand the `api` object structure and existing Zod schemas.
2. Read `server/routes.ts` (first 120 lines) — understand imports, middleware order, and the `registerRoutes` function.
3. Read `server/storage.ts` — understand the `IStorage` interface and `DatabaseStorage` class.
4. Read `shared/models/auth.ts` — note `TIER_LIMITS` and `UserTier`.
5. Add the route constant to the `api` (or `apiV1`) object in `shared/routes.ts` with `method`, `path`, and `responses`. If the route accepts a body, add an `input` field referencing a Zod schema defined in the same file.
6. Add the Zod request schema (if any) to `shared/routes.ts` and export it.
7. Add a new method signature to the `IStorage` interface in `server/storage.ts`.
8. Implement the method in the `DatabaseStorage` class in `server/storage.ts` using Drizzle ORM queries.
9. Register the handler in `server/routes.ts`:
   - Import the new Zod schema from `@shared/routes`.
   - Use `isAuthenticated` middleware.
   - Parse the request body with the Zod schema (`.safeParse(req.body)`).
   - Verify session ownership: `monitor.userId !== req.user.claims.sub` for user-owned resources.
   - If the route accepts a URL field, call `isPrivateUrl()` and return 400 on error.
   - If the route is tier-gated, read `TIER_LIMITS[tier]` — never hardcode a number.
   - Return errors as `{ message, code }` JSON.
10. If the route receives bearer-token or external callback requests (no session cookie), add the path to `EXEMPT_PATHS` or `EXEMPT_PREFIXES` in `server/middleware/csrf.ts` and note it in the commit message.
11. Run `npm run check && npm run test`.

## Hard constraints

- NEVER put database queries directly in a route handler — all queries go through `server/storage.ts` (`IStorage` interface + `DatabaseStorage` class)
- NEVER hardcode a tier limit value — always read from `TIER_LIMITS` in `shared/models/auth.ts` using the `TIER_LIMITS[tier] ?? TIER_LIMITS.free` pattern
- NEVER skip the session ownership check (`monitor.userId !== req.user.claims.sub`) on routes returning or mutating user-owned data — this is an authorization bypass
- NEVER accept a user-supplied URL without calling `isPrivateUrl()` from `server/utils/ssrf.ts` — missing SSRF check is Critical severity
- NEVER add a CSRF exemption silently — call it out explicitly in the commit message and add to `EXEMPT_PATHS` or `EXEMPT_PREFIXES` in `server/middleware/csrf.ts`
- NEVER hardcode route path strings in handlers — define path constants in the `api` or `apiV1` object in `shared/routes.ts`
- NEVER return error responses outside the `{ message, code }` JSON shape used throughout `server/routes.ts`
- NEVER skip the verification gate — run `npm run check && npm run test` before committing
