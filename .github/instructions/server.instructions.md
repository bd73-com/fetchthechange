---
applyTo: "server/**"
---

# Server Code Rules

## Never hardcode tier limits
Tier limits must always be read from the `TIER_LIMITS`, `BROWSERLESS_CAPS`, `PAUSE_THRESHOLDS`, `RESEND_CAPS`, `TAG_LIMITS`, `TAG_ASSIGNMENT_LIMITS`, or `API_RATE_LIMITS` constants exported from `shared/models/auth.ts`. Never use literal numbers like 3, 100, 200, 500, etc. for tier-gated values. Import the constant and index it by the user's tier.

## Require session ownership check
Every route handler that returns or mutates user-specific data must verify ownership by checking that the resource's `userId` matches `req.user.claims.sub`. Skipping this check is a Critical authorization bypass vulnerability. The pattern is: `if (resource.userId !== req.user!.claims.sub) return res.status(403).json({ message: 'Forbidden', code: 'FORBIDDEN' });`

## Require SSRF validation on user-supplied URLs
Every user-supplied URL must be validated with `isPrivateUrl()` from `server/utils/ssrf.ts` before any HTTP request is made. This applies at monitor creation time and at fetch time. Skipping this is a Critical SSRF vulnerability that can expose internal infrastructure.

## Database queries belong in storage layer
Never put database queries or Drizzle ORM calls directly in route handlers. All database access must go through methods on the `IStorage` interface implemented in `server/storage.ts`. Route handlers call `storage.methodName()` only.

## Validate requests with Zod schemas
All incoming request bodies, query parameters, and path parameters must be validated using Zod schemas defined in `shared/routes.ts`. Use `.safeParse()` and return a 400 error with `{ message, code }` JSON if validation fails. Never trust raw `req.body` or `req.params` without validation.

## Error responses must use standard JSON shape
All API error responses must follow the `{ message: string, code: string }` JSON shape. Never return plain text errors, HTML error pages, or non-standard JSON structures from API endpoints.

## Encrypt credentials at rest
OAuth tokens, bot tokens, API keys, and other secrets must be encrypted before storage using `encryptToken()` from `server/utils/encryption.ts`. API keys must be stored as SHA-256 hashes (`keyHash`), with only the prefix (`keyPrefix`) safe to return in responses. Never store plaintext tokens in the database. Never return stored credentials in GET responses — return a redacted placeholder only.

## Never log decrypted secrets
Never log decrypted tokens, API keys, or other secrets. Only log safe prefixes (e.g., `keyPrefix`). Decryption failures should be logged as errors but must not include the ciphertext or plaintext in log output.

## CSRF exemptions must be explicit
When adding a new route that needs CSRF exemption (e.g., OAuth callbacks, webhook receivers), add the path to `EXEMPT_PATHS` or `EXEMPT_PREFIXES` in `server/middleware/csrf.ts`. Call out the exemption explicitly in the commit message. Keep the exemption list minimal — only routes that genuinely cannot include CSRF tokens.

## Require isAuthenticated middleware on protected routes
All API routes that access user data must use the `isAuthenticated` middleware. This ensures the user has a valid session before the handler runs. Never access `req.user` without this middleware in place.

## Tier gates must be enforced server-side
Feature restrictions based on user tier (free, pro, power) must be enforced in server route handlers, not only in the client UI. A client-only tier gate is trivially bypassed. Read the user's tier and check against `TIER_LIMITS` or the relevant caps constant from `shared/models/auth.ts`.

## Notification channels require dedicated service files
Notification delivery logic must not be inlined in route handlers. Each notification channel (email, webhook, Slack, etc.) must have a dedicated service file under `server/services/`. The channel type must be added to `channelTypeSchema` in `shared/routes.ts`.

## Webhook handlers must verify signatures
Stripe webhook handlers must verify the webhook signature using `stripe.webhooks.constructEvent()` before processing. Never process an unverified webhook payload. Signing secrets must be auto-generated server-side and redacted in GET responses.

## Scraper must enforce timeouts and size limits
The scraper service must enforce request timeouts and response size limits to prevent resource exhaustion. Browserless usage must respect `BROWSERLESS_CAPS` from `shared/models/auth.ts`. URLs must be validated with `isPrivateUrl()` at both creation and fetch time.
