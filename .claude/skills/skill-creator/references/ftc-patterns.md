# FetchTheChange Patterns Reference

Constraints every skill must encode when its workflow touches the corresponding area.

## Schema & Storage

- New tables: define in `shared/schema.ts` using `pgTable()` from `drizzle-orm/pg-core`
- New types: export insert/select types from `shared/schema.ts` via `createInsertSchema`
- Storage methods: add to the `IStorage` interface and `DatabaseStorage` class in `server/storage.ts` — no raw DB queries in route handlers
- Relations: declare in `shared/schema.ts` using `relations()` from `drizzle-orm`

## Routes & Validation

- Route path constants: define in `shared/routes.ts` in the `api` object — no hardcoded path strings in handlers
- Request validation: Zod schemas for all request bodies and query params in `shared/routes.ts`
- Route registration: new routes go in `server/routes.ts`
- Ownership checks: every protected route must verify `monitor.userId === req.user.id` (or equivalent), not just `isAuthenticated`
- SSRF protection: every route accepting a user-supplied URL must call `isPrivateUrl()` from `server/utils/ssrf.ts` — missing check is **Critical** severity

## CSRF

- CSRF middleware in `server/middleware/csrf.ts` blocks state-changing requests without a valid Origin header
- Exempt paths listed in `EXEMPT_PATHS` (exact) and `EXEMPT_PREFIXES` (prefix match)
- New endpoints that receive requests without a session cookie (webhooks, external callbacks, API key auth) must be added to the exempt list
- Exemptions must be called out explicitly in the skill — never added silently

## Tier Gating

- Tier limits: `TIER_LIMITS` in `shared/models/auth.ts` — type is `UserTier`
- Server-side enforcement: `TIER_LIMITS[tier] ?? TIER_LIMITS.free` pattern in route handlers
- UI-only gating is never sufficient — server must enforce
- Unknown Stripe products: default to `free`, never to a paid tier

## Frontend

- React Query hooks: `client/src/hooks/use-*.ts` following `use-monitors.ts` pattern (queryKey from `api.*`, response parsed with Zod schema)
- New pages: register route in `client/src/App.tsx`
- SEO: `SEOHead` component + `getCanonicalUrl()` on every public page
- Blog posts: entry in `blogPosts` array in `Blog.tsx` AND route in `App.tsx` AND page file — all three required, enforced by `blog-integrity.test.ts`
- UI primitives: shadcn/ui from `@/components/ui/` — no raw HTML form elements
- Colors: Tailwind semantic tokens (`text-primary`, `bg-secondary`, `text-muted-foreground`) — no hardcoded hex/rgb

## Security

- API keys: SHA-256 hash stored at rest, plaintext never persisted, log only safe prefix
- Slack tokens: AES-256-GCM encrypted via `server/utils/encryption.ts`
- New env vars: add to `.env.example` with placeholder and explanatory comment

## Verification Gate

Every skill workflow must end with:

```bash
npm run check && npm run test
```

Fix all failures before committing. Run `npm run build` before creating a PR.

## PR Convention

```bash
gh pr create --repo bd73-com/fetchthechange --title "..." --body "..."
```

Always pass `--repo` — the git remote uses a local proxy and `gh` cannot infer it.
