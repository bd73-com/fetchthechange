# Questioning Examples by Phase

Reference examples for how to construct codebase-grounded, multiple-choice questions during each phase of the interview specification workflow.

> **Note:** These examples use the TypeScript/Express/React/Drizzle patterns found in this codebase for illustration. When working with a different stack, adapt the specific library and pattern references to match the project's actual tools and conventions.

## Bad vs Good Questioning

**Bad (open-ended):**
> "How should this feature handle validation errors?"

**Bad (generic multiple-choice with no codebase grounding):**
> "How should we handle validation?
> A) Throw exceptions
> B) Return error codes
> C) Use a Result pattern"

**Good (grounded, reasoned, with recommendation):**
> "I see your monitor creation route in `server/routes.ts` validates input with Zod schemas defined in `shared/routes.ts` — the `insertMonitorSchema` is generated from the Drizzle table definition and checked before the handler runs. Your Stripe webhook handler in `server/webhookHandlers.ts` takes a different approach and validates the Stripe signature first, then processes the event body.
>
> For this new feature:
> **A) Zod schema validation via shared route definition (like monitor CRUD)** — keeps it consistent with most endpoints, caller gets structured errors via `errorSchemas`
> **B) Custom validation in the route handler (like webhooks)** — simpler if the validation is tightly coupled to external input format
> **C) Validation in the service layer** — if the rules are business logic that shouldn't live in the route definition
> **D) Something else**
>
> I'd recommend A since this is a standard user-facing endpoint and most of your routes follow that pattern. Thoughts?"

---

## Phase 0: Post-Reconnaissance Questions

After completing the 13-step codebase reconnaissance, present findings and ask:

> "Here's what I found in the codebase: [summary]. Before we dive in, a few quick decisions:
>
> **1. Reference implementation** — Which of these existing features should I model this after?
> A) `server/services/scraper.ts` + its route handlers — full service with static/rendered fallback chain, error logging, and database updates
> B) `server/services/email.ts` — simpler service with external API integration (Resend), rate limiting, and tier-based caps
> C) `server/webhookHandlers.ts` — event-driven processing with signature validation, user tier updates, and error handling
> D) A different feature: ___
>
> **2. Scope** — Based on the feature name, I'm thinking this involves [X, Y, Z]. Is the scope:
> A) Just [X] for now, we'll handle Y and Z later
> B) X and Y together, Z is separate
> C) All of X, Y, and Z in one feature
> D) Let me describe the actual scope..."

---

## Phase 1: Requirements Questions

**For API features:**
> "What's the entry point for this feature?
> A) New API endpoint in `server/routes.ts` (I'll ask about route/method next)
> B) Background job in `server/services/scheduler.ts` (cron-triggered)
> C) Extension to an existing service (which one?)
> D) Multiple entry points (e.g., API + scheduled check)"

**For data questions:**
> "I see these existing tables in `shared/schema.ts` that might be involved: `monitors`, `monitorChanges`, `users`, `errorLogs`. For this feature:
> A) We only need existing tables — no new schema changes
> B) New table needed, with a foreign key to an existing table (which one?)
> C) New table needed, standalone
> D) Modification to existing table (add columns to `monitors` or `users`)"

**For integration questions:**
> "Does this feature need to talk to anything external?
> A) No — purely internal logic and database via `server/storage.ts`
> B) Yes — extends existing integration (Browserless, Resend, or Stripe)
> C) Yes — calls a new external API (new service integration needed)
> D) Yes — needs to send notifications (email via Resend, or something new)"

---

## Phase 2: Don'ts Questions

**Inferred don'ts (present as checklist for confirmation):**
> "Based on what I see in the codebase, these constraints likely apply. Confirm, modify, or reject each:
>
> ✅/❌ **All database access goes through `DatabaseStorage` in `server/storage.ts`** (I see no direct `db.` calls in route handlers — everything uses the `storage` interface)
> ✅/❌ **URLs must be validated against SSRF before fetching** (I see `validateUrl()` and `safeFetch()` in `server/utils/ssrf.ts` — never use raw `fetch()` for user-provided URLs)
> ✅/❌ **Sensitive data is never logged raw** (I see `sanitizeLogData()` in `server/services/logger.ts` redacting paths and credentials)
> ✅/❌ **External API calls respect tier-based caps** (I see `BrowserlessTracker` and `ResendTracker` enforcing per-user/per-tier limits)
> ✅/❌ **Rate limiting is applied to all user-facing mutation endpoints** (I see `createTieredRateLimiter()` in `server/middleware/rateLimiter.ts`)"

**Feature-specific don'ts:**
> "Now for constraints specific to this feature:
>
> **1. Data mutation safety** — Which of these applies?
> A) This operation is irreversible — we need soft-delete or audit trail
> B) This operation is reversible — hard delete or direct update is fine
> C) This operation must be idempotent (same request twice = same result)
> D) Both A and C (irreversible AND must be idempotent)
>
> **2. Tier gating** — Should access vary by user tier?
> A) All tiers get the same access (no gating)
> B) Free tier is excluded, Pro and Power only
> C) Available to all tiers but with different limits (like monitor count caps in `TIER_LIMITS`)
> D) Depends on specific sub-features (let's map it out)"

**Disaster scenario push (if fewer than 3 don'ts):**
> "Let me push a bit harder — which of these disaster scenarios is realistic?
> A) A user triggers this 100 times in a minute (rate limiting needed beyond existing middleware?)
> B) An attacker manipulates the request to access another user's data (IDOR vulnerability)
> C) This feature sends a notification to the wrong person or at the wrong time
> D) A race condition causes duplicate processing (two requests for the same monitor at the exact same time)
> E) An external service (Browserless/Resend) is unavailable and data is silently lost
>
> Pick all that apply — I'll turn each into a specific don't."

---

## Phase 3: Decision Fork Questions

**Draft a decision tree, then ask:**
> "Based on what you've told me, here's my first attempt at the decision tree. Tell me what's wrong or missing:
>
> ```
> Request comes in
> ├── Authenticated? → No → 401 Unauthorized
> ├── Valid input? → No → Return Zod validation errors
> ├── User owns resource? → No → 404 Not Found
> ├── [Condition A]? → Yes → [Outcome 1]
> ├── [Condition B]? → Yes → [Outcome 2]
> └── Default → [Outcome 3]
> ```
>
> **1. Am I missing any branches?**
> A) Yes — there's a [specific condition] I haven't accounted for
> B) The order of checks is wrong — [X] should be evaluated before [Y]
> C) One of these outcomes is wrong — [which one?]
> D) Looks right
>
> **2. For the edge case where [A and B are both true], which wins?**
> A) A takes priority
> B) B takes priority
> C) Both apply (compound behavior)
> D) This shouldn't be possible — it's a data integrity issue if it happens"

**For each branch, ask about escalation:**
> "For [specific branch], should this be:
> A) Fully automated — system decides and acts
> B) System decides, but flags via error logging for post-hoc review (`ErrorLogger.error()`)
> C) System recommends, but requires user confirmation before action
> D) Always escalated — system never acts on this automatically"

---

## Phase 4: Relationship Questions

> "I see these related entities and rules in the codebase. Which affect this feature?
>
> **1. User tier differentiation** — I see a `UserTier` type in `shared/models/auth.ts` with `free`, `pro`, `power` tiers and different `TIER_LIMITS`, `BROWSERLESS_CAPS`. Does this feature behave differently per tier?
> A) Same behavior for all tiers
> B) Different thresholds/limits per tier (I'll ask for specifics)
> C) Certain tiers are excluded entirely
> D) Pro/Power gets enhanced handling (describe what)
>
> **2. Monitor lifecycle** — I see monitors go through states: `ok`, `blocked`, `selector_missing`, `error` (the `lastStatus` field). Does this feature interact with monitor status?
> A) No — it works independently of monitor status
> B) Yes — behavior changes based on current monitor status
> C) Yes — this feature can change monitor status
> D) Both B and C
>
> **3. Downstream effects** — Should this feature trigger notifications or side effects?
> A) Yes — should send email notifications (via `server/services/email.ts` pattern)
> B) Yes — should log to error_logs for admin visibility
> C) No — this is a terminal operation with no downstream effects
> D) Both A and B"

---

## Phase 5: Guardrail Questions

> "Let's nail down the failure modes. For each scenario, pick the behavior:
>
> **1. External dependency (Browserless/Resend/Stripe) is unavailable:**
> A) Fail fast — return error immediately, let the caller retry
> B) Retry with backoff — 3 attempts, then fail (like the scraper's Browserless fallback)
> C) Queue for later — accept the request, process when available (like the scheduler pattern)
> D) Degrade gracefully — proceed without that dependency with reduced functionality
>
> **2. Unexpected/invalid data encountered mid-operation:**
> A) Abort everything — return error to user
> B) Skip the bad record, continue with the rest
> C) Log via `ErrorLogger.error()` and continue without interrupting
> D) Depends on which data is bad (let me specify)
>
> **3. Rate limiting / abuse protection:**
> A) Not needed — existing rate limiting in `rateLimiter.ts` is sufficient
> B) Needs custom rate limit (different from existing tiers)
> C) Needs per-resource limiting (e.g., per-monitor, not just per-user)
> D) Needs circuit breaker (protect downstream system from overload)
>
> **4. Observability level:**
> A) Minimal — standard request logging via existing Express middleware is fine
> B) Moderate — log key decision points via `ErrorLogger` at info/warning level
> C) High — full audit trail of every step and decision in `error_logs` table
> D) This needs a dedicated tracking table (like `browserless_usage` or `resend_usage`)"

---

## Phase 6: Acceptance Criteria

> "Here are the acceptance criteria I've derived from our conversation. For each one, tell me:
> ✅ Correct as written
> ✏️ Needs adjustment (tell me what)
> ❌ Wrong / remove it
> ➕ Missing — I'll add what you suggest
>
> ### Happy Path
> 1. Given [context], when [action], then [outcome]
> 2. ...
>
> ### Negative Tests (from your don'ts)
> 3. Given [prohibited scenario], then [it must be blocked]
> 4. ...
>
> ### Edge Cases
> 5. Given [edge case], then [expected behavior]
> 6. ...
>
> ### Resilience
> 7. Given [failure scenario], then [degraded behavior]
> 8. ..."
