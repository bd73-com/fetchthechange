# Performance Analysis: FetchTheChange

## Summary

The application has a **well-structured foundation** with good defensive patterns (circuit breaker, browser pool, SSRF protection, daily cleanup jobs), but contains several scalability bottlenecks that will become production problems beyond ~200 monitors. The single most urgent concern is the **scheduler's `getAllActiveMonitors()` call every minute** combined with **N+1 query patterns in the notification pipeline** — together these create O(n²) database load per scheduler tick that will saturate the default pg connection pool.

---

## Critical Issues (will cause production problems at scale)

### 1. Scheduler fetches ALL active monitors every minute — unbounded
- **Category**: Unbounded Query / Algorithm
- **Severity**: Critical
- **Location**: `server/services/scheduler.ts:70`
- **Problem**: `storage.getAllActiveMonitors()` loads every active monitor into memory every 60 seconds. There is no filtering by `lastChecked` or `frequency` at the SQL level — the entire table is scanned and filtering happens in JS (lines 72–102). With growth, this becomes increasingly wasteful since most monitors won't be due for a check.
- **Current Complexity**: O(n) per tick, where n = total active monitors
- **Impact at Scale**: At 500 active monitors, this pulls 500 rows every minute (fine). At 5K monitors, this is 5K rows × 60/hr = 300K row reads/hour from a table with text columns (`currentValue`, `lastError`), consuming significant I/O and memory on a single Replit instance.
- **Recommendation**: Replace `getAllActiveMonitors()` with a `getMonitorsDue()` query that filters in SQL: `WHERE active = true AND (last_checked IS NULL OR (frequency = 'hourly' AND last_checked < NOW() - INTERVAL '1 hour') OR (frequency = 'daily' AND last_checked < NOW() - INTERVAL '24 hours'))`. Add a composite index on `(active, frequency, last_checked)`.

### 2. N+1: `getMonitorChanges()` fetches ALL changes per monitor in notification pipeline
- **Category**: N+1 Query / Memory
- **Severity**: Critical
- **Location**: `server/services/notification.ts:451` (`processDigestBatch`), `server/services/notification.ts:504` (`processQueuedNotifications`), `server/services/scheduler.ts:184` (webhook retry)
- **Problem**: `storage.getMonitorChanges(monitorId)` returns **all** change history for a monitor (unbounded, no LIMIT). In `processDigestBatch()` (line 451), it loads all changes just to match a few `changeId`s from the queue. In `processQueuedNotifications()` (line 504), it does this per-monitor in a loop. In the webhook retry cron (scheduler.ts:184), it loads all changes to find a single change by ID.
- **Current Complexity**: O(n×m) where n = monitors with queued notifications, m = average changes per monitor
- **Impact at Scale**: A monitor with 1,000 changes will load all 1,000 rows (including full `oldValue`/`newValue` text) just to find 1–5 specific entries. At 200 monitors with 100 changes each, the digest cron alone could load 20K change rows.
- **Recommendation**: Replace with `getMonitorChangesByIds(changeIds: number[])` using `WHERE id IN (...)`. For the webhook retry, add `getMonitorChangeById(id: number)` or use the existing join capability.

### 3. N+1: `markQueueEntriesDelivered()` fires individual UPDATEs in a loop
- **Category**: N+1 Query
- **Severity**: Critical
- **Location**: `server/storage.ts:199-203`
- **Problem**: `markQueueEntriesDelivered(ids)` iterates over each ID and calls `markQueueEntryDelivered(id)` individually, issuing N separate UPDATE statements.
- **Current Complexity**: O(n) DB round-trips where n = number of queue entries
- **Impact at Scale**: A digest batch with 50 queued entries fires 50 individual UPDATEs.
- **Recommendation**: Single batch UPDATE: `UPDATE notification_queue SET delivered = true, delivered_at = NOW() WHERE id = ANY($1)` using `inArray(notificationQueue.id, ids)`.

### 4. `monitors` table has NO indexes on key scheduler columns
- **Category**: Missing Indexes
- **Severity**: Critical
- **Location**: `shared/schema.ts:11-30`
- **Problem**: The `monitors` table has no indexes on `userId`, `active`, `frequency`, or `lastChecked`. Every query filtering by `userId` (used in nearly every API endpoint) or `active` (used by the scheduler every minute) does a sequential scan.
- **Impact at Scale**: At 500+ monitors, `getAllActiveMonitors()` and `getMonitors(userId)` become increasingly slow. The `userId` filter is used on every authenticated request.
- **Recommendation**: Add indexes: `index("monitors_user_id_idx").on(monitors.userId)`, `index("monitors_active_idx").on(monitors.active)`, and a composite `index("monitors_active_frequency_last_checked_idx").on(monitors.active, monitors.frequency, monitors.lastChecked)`.

---

## High Issues (should fix before next growth milestone)

### 5. `monitorChanges` table has NO indexes
- **Category**: Missing Indexes
- **Severity**: High
- **Location**: `shared/schema.ts:32-38`
- **Problem**: The `monitor_changes` table has no index on `monitorId` or `detectedAt`. Every `getMonitorChanges(monitorId)` query and the `getMonitorChangesPaginated()` query filter on `monitorId` and sort by `detectedAt` without index support.
- **Impact at Scale**: This table grows fastest (every detected change adds a row). At 1K changes per monitor × 200 monitors = 200K rows, seq scans become very expensive.
- **Recommendation**: Add `index("monitor_changes_monitor_id_idx").on(monitorChanges.monitorId)` and `index("monitor_changes_monitor_detected_idx").on(monitorChanges.monitorId, monitorChanges.detectedAt)`.

### 6. Database connection pool uses pg defaults (10 connections) — no explicit config
- **Category**: Connection Pooling
- **Severity**: High
- **Location**: `server/db.ts:13`
- **Problem**: `new Pool({ connectionString: ... })` uses the `pg` default of 10 connections. The scheduler can dispatch up to 10 concurrent checks (`MAX_CONCURRENT_CHECKS = 10`), each of which makes multiple DB calls (read monitor, fetch HTML, update monitor, record metrics, process notification). Combined with API requests from users, the pool can easily be exhausted.
- **Current state**: 10 concurrent scraper checks × ~5 DB calls each = 50 queries competing for 10 connections, plus API traffic.
- **Impact at Scale**: At 100+ monitors with frequent checks, connection pool exhaustion causes query timeouts and cascading failures.
- **Recommendation**: Explicitly configure pool size to match workload: `new Pool({ connectionString, max: 20, idleTimeoutMillis: 30000 })`. Consider reducing `MAX_CONCURRENT_CHECKS` to 5, or increasing pool to 25 if Postgres allows it.

### 7. `deleteSlackChannelsForUser()` is N+1
- **Category**: N+1 Query
- **Severity**: High
- **Location**: `server/storage.ts:344-352`
- **Problem**: Fetches all user monitors, then deletes Slack channels one monitor at a time in a loop.
- **Current Complexity**: O(n) queries where n = user's monitor count
- **Impact at Scale**: A Power user with 100 monitors fires 101 queries (1 SELECT + 100 DELETEs) on disconnect.
- **Recommendation**: Single query using a subquery: `DELETE FROM notification_channels WHERE channel = 'slack' AND monitor_id IN (SELECT id FROM monitors WHERE user_id = $1)`.

### 8. `deleteMonitor()` fires 6+ sequential DELETE statements
- **Category**: Algorithm / Connection Pool
- **Severity**: High
- **Location**: `server/storage.ts:84-103`
- **Problem**: Deleting a monitor fires at least 6 sequential DELETE queries (notification_queue, notification_preferences, delivery_log, notification_channels, monitor_changes, monitor_metrics, browserless_usage, resend_usage, monitors). Each is a separate DB round-trip.
- **Impact at Scale**: Holds a connection for 6+ round-trips. Under concurrent deletes, this amplifies pool pressure.
- **Recommendation**: Wrap in a single transaction. Better yet, add `ON DELETE CASCADE` to all FK references to `monitors.id` and let Postgres handle cascading deletes in one statement.

### 9. Webhook retry cron loads ALL changes to find ONE change
- **Category**: N+1 Query / Memory
- **Severity**: High
- **Location**: `server/services/scheduler.ts:184`
- **Problem**: For each pending webhook retry, the cron calls `storage.getMonitorChanges(monitor.id)` (all changes, unbounded) and then `.find(c => c.id === entry.changeId)` to locate a single row.
- **Impact at Scale**: If 10 monitors each have 500 changes and 1 pending retry, this loads 5,000 change rows to find 10.
- **Recommendation**: Add `storage.getMonitorChange(changeId: number)` — a single-row lookup by primary key.

### 10. `getMonitorChanges()` returns unbounded results to API
- **Category**: Unbounded Query
- **Severity**: High
- **Location**: `server/storage.ts:118-123`, served via `server/routes.ts:453`
- **Problem**: `GET /api/monitors/:id/history` calls `getMonitorChanges()` which has no LIMIT clause. Returns all changes for a monitor to the frontend.
- **Impact at Scale**: A monitor that's been running hourly for 6 months could have 4,000+ changes, each with full `oldValue`/`newValue` text blobs. This can be megabytes of JSON per request.
- **Recommendation**: Add pagination. The API v1 already has `getMonitorChangesPaginated()` — reuse it for the internal API. Default to last 50 changes.

---

## Medium Issues (good to address)

### 11. Slack channel cache has no eviction / no size bound
- **Category**: Memory / Caching
- **Severity**: Medium
- **Location**: `server/routes.ts:854`
- **Problem**: `slackChannelsCache` is a `Map<string, { data, timestamp }>` with TTL-based reads (5-min) but **no active eviction**. Entries are only removed on Slack disconnect. Stale entries accumulate indefinitely.
- **Impact at Scale**: Each entry holds the channel list (could be 100s of channels × ~50 bytes each). At 500 users who've ever fetched channels, ~2.5MB of memory that's never freed.
- **Recommendation**: Add a periodic sweep (every 10 minutes) that deletes entries older than 5 minutes. Or use a proper LRU cache with `max` entries (e.g., `lru-cache` package).

### 12. `cleanupPollutedValues()` runs at startup with no LIMIT
- **Category**: Unbounded Query / Startup
- **Severity**: Medium
- **Location**: `server/storage.ts:218-250`
- **Problem**: At startup, this queries ALL monitors with `currentValue = 'Blocked/Unavailable'` and ALL monitorChanges with polluted values, then deletes/updates them one at a time in a loop. This is an N+1 pattern at startup.
- **Impact at Scale**: If a bug once caused 500 monitors to be polluted, startup takes 500+ DB round-trips before the scheduler even starts.
- **Recommendation**: Use batch UPDATE/DELETE statements: `UPDATE monitors SET current_value = NULL WHERE current_value = 'Blocked/Unavailable'` and `DELETE FROM monitor_changes WHERE old_value = 'Blocked/Unavailable' OR new_value = 'Blocked/Unavailable'`.

### 13. Digest webhook delivery is sequential per change
- **Category**: Algorithm
- **Severity**: Medium
- **Location**: `server/services/notification.ts:309` and `server/services/notification.ts:341`
- **Problem**: In `deliverDigestToChannels()`, webhook and Slack deliveries for digest batches are done sequentially via `for (const change of changes)` loops. Each iteration awaits delivery + DB log.
- **Impact at Scale**: A digest with 20 changes fires 20 sequential webhook POSTs (each with a 5s timeout) + 20 delivery log inserts = up to 100s+ of blocking time.
- **Recommendation**: Use `Promise.allSettled()` to parallelize deliveries within a channel, or batch webhook payloads into a single delivery.

### 14. Rate limiter makes a DB call on every request to look up tier
- **Category**: Caching
- **Severity**: Medium
- **Location**: `server/middleware/rateLimiter.ts:6-9`
- **Problem**: `getUserTier()` calls `authStorage.getUser(userId)` on every API request that passes through the rate limiter. User tier rarely changes (only on subscription events).
- **Impact at Scale**: At 300 req/min (Power tier limit), this is 300 extra DB queries/min just for tier lookup.
- **Recommendation**: Cache user tier in-memory with a 60-second TTL. Invalidate on Stripe webhook subscription change events.

### 15. `processDigestCron()` iterates ALL digest preferences — per-monitor DB calls
- **Category**: N+1 Query
- **Severity**: Medium
- **Location**: `server/services/notification.ts:533-582`
- **Problem**: Fetches all digest preferences, then for each calls `storage.getMonitor()`, `hasActiveChannels()` (which calls `getMonitorChannels()`), and `processDigestBatch()` (which calls `getMonitorChanges()`). This is 3–5 DB calls per digest-enabled monitor.
- **Impact at Scale**: 100 digest-enabled monitors = 300–500 DB calls per cron tick.
- **Recommendation**: Join monitors with preferences in a single query. Pre-load channels for all relevant monitors in batch.

### 16. `Resend` client is instantiated per email send
- **Category**: Memory / GC pressure
- **Severity**: Medium
- **Location**: `server/services/email.ts:77`
- **Problem**: `prepareEmailInfra()` creates `new Resend(process.env.RESEND_API_KEY)` on every email send. The Resend SDK likely initializes HTTP clients internally.
- **Recommendation**: Create a singleton `Resend` instance at module level and reuse it.

---

## Low Issues (nice-to-have)

### 17. SSRF `isPrivateUrl()` does DNS resolution on every webhook delivery
- **Category**: Latency
- **Severity**: Low
- **Location**: `server/services/webhookDelivery.ts:61`, `server/utils/ssrf.ts`
- **Problem**: `isPrivateUrl()` performs DNS resolution before every webhook delivery. Then `ssrfSafeFetch()` does it again (with redirect-following). This is 2 DNS lookups per webhook delivery.
- **Impact**: ~1–10ms added latency per delivery. Not a bottleneck, but redundant.
- **Recommendation**: Since `ssrfSafeFetch` already validates redirects, the pre-check `isPrivateUrl` in `deliver()` is defence-in-depth. Consider caching DNS results for 60s for known-good webhook domains.

### 18. `meetsThreshold()` uses string length difference as change metric
- **Category**: Algorithm
- **Severity**: Low
- **Location**: `server/services/notification.ts:132-145`
- **Problem**: Sensitivity threshold comparison uses `Math.abs(newStr.length - oldStr.length)`. This means a complete content replacement of equal length scores 0 and would be suppressed.
- **Impact**: Functional correctness issue more than performance, but worth noting for the sensitivity feature's reliability.

### 19. Stale queue entry warning fires individual ErrorLogger calls
- **Category**: Algorithm
- **Severity**: Low
- **Location**: `server/services/notification.ts:528-530`
- **Problem**: Iterates over all stale queue entries and fires `ErrorLogger.warning()` per entry. If 100 entries are stale, that's 100 DB inserts to the error_logs table.
- **Recommendation**: Log a single summary warning with count and sample IDs.

---

## Database Query Inventory

| Location | Query Type | Est. Rows | Index? | Risk |
|----------|-----------|-----------|--------|------|
| `storage.ts:134` `getAllActiveMonitors` | SELECT WHERE active=true | All active monitors | No index on `active` | **Critical** — called every minute by scheduler |
| `storage.ts:58` `getMonitors(userId)` | SELECT WHERE userId | Per-user | No index on `userId` | **High** — called on every dashboard load |
| `storage.ts:118` `getMonitorChanges(monitorId)` | SELECT WHERE monitorId, no LIMIT | All changes for monitor | No index on `monitorId` | **Critical** — called in hot paths with no bound |
| `storage.ts:502` `getMonitorsWithTags(userId)` | SELECT + JOIN | Per-user monitors + tags | No index on monitors.userId | **Medium** — dashboard list endpoint |
| `storage.ts:166` `getUndeliveredQueueEntries` | SELECT WHERE monitorId AND delivered=false | Small | Indexes exist | Low |
| `storage.ts:184` `getReadyQueueEntries(before)` | SELECT WHERE delivered=false AND scheduledFor<=now | Queued entries | Indexes exist | Low |
| `storage.ts:213` `getAllDigestMonitorPreferences` | SELECT WHERE digestMode=true | All digest prefs | No index on `digestMode` | **Medium** — scans full table |
| `storage.ts:306` `getPendingWebhookRetries` | SELECT WHERE channel='webhook' AND status='pending' | Pending retries | Partial (monitorCreatedIdx) | Medium |
| `email.ts:96-101` `canSendEmail` raw SQL | SELECT COUNT WHERE monitorId AND detectedAt | Per-monitor | No index on monitorChanges.monitorId | **High** — called per email send |

## N+1 Patterns Found

1. **Location**: `notification.ts:451` (`processDigestBatch`)
   - **Pattern**: Loads ALL changes for a monitor (`getMonitorChanges`), then filters in JS by changeId
   - **Recommended fix**: `getMonitorChangesByIds(ids)` using `WHERE id IN (...)`

2. **Location**: `notification.ts:490-519` (`processQueuedNotifications`)
   - **Pattern**: For each monitor group, loads ALL changes, then filters per-entry in nested loop
   - **Recommended fix**: Same as above — batch fetch by changeId

3. **Location**: `scheduler.ts:160-189` (webhook retry cron)
   - **Pattern**: For each pending retry: `getMonitor()` + `getMonitorChannels()` + `getMonitorChanges()` (all) + `.find()` by changeId
   - **Recommended fix**: Single query joining delivery_log → monitor_changes, batch-load monitors and channels

4. **Location**: `storage.ts:199-203` (`markQueueEntriesDelivered`)
   - **Pattern**: Loops over IDs calling individual UPDATE per entry
   - **Recommended fix**: Batch UPDATE with `WHERE id IN (...)`

5. **Location**: `storage.ts:344-352` (`deleteSlackChannelsForUser`)
   - **Pattern**: Fetches all user monitors, then deletes Slack channels per-monitor
   - **Recommended fix**: Subquery DELETE

6. **Location**: `storage.ts:218-250` (`cleanupPollutedValues`)
   - **Pattern**: Fetches all polluted rows, then updates/deletes one at a time
   - **Recommended fix**: Batch UPDATE/DELETE statements

## Unbounded Queries

1. **Location**: `storage.ts:118-123` (`getMonitorChanges`)
   - **Query**: `SELECT * FROM monitor_changes WHERE monitor_id = ? ORDER BY detected_at DESC` (no LIMIT)
   - **Risk**: At 1K monitors with 100 changes each = 100K rows; loading all for one monitor = 100+ rows with text blobs
   - **Fix**: Add default LIMIT (e.g., 100) or migrate all callers to paginated variant

2. **Location**: `storage.ts:134-136` (`getAllActiveMonitors`)
   - **Query**: `SELECT * FROM monitors WHERE active = true` (no LIMIT, no column selection)
   - **Risk**: Returns full rows including `currentValue` and `lastError` text — unnecessary for scheduler dispatch
   - **Fix**: Select only needed columns (`id, url, selector, frequency, lastChecked, userId, consecutiveFailures`) and add WHERE clause for due monitors

3. **Location**: `routes.ts:453` (history endpoint)
   - **Query**: Proxies `getMonitorChanges()` — all changes returned to frontend
   - **Risk**: Unbounded JSON response; potential OOM on large histories
   - **Fix**: Add pagination (reuse `getMonitorChangesPaginated`)

## Memory Risk Inventory

| Component | Estimated Size | Growth Pattern | Risk |
|-----------|---------------|----------------|------|
| Slack channel cache | ~50 bytes × channels × users | Per-user, no eviction | **Medium** — grows unbounded |
| `monitorsNeedingRetry` Set | ~8 bytes × monitor IDs | Per-failure, cleared on success | Low — bounded by total monitors |
| `retryBackoff` Map | ~24 bytes × monitor IDs | Per-failure, cleaned by scheduler | Low |
| Rate limiter maps | Per-tier × per-route | Per user per window | Low — express-rate-limit handles cleanup |
| Browser pool | 2 browsers max | Fixed ceiling | Low — well-bounded |
| `getAllActiveMonitors()` result | ~1KB × active monitors | Recreated every minute | **Medium** at 5K monitors = 5MB/tick |

## Scalability Assessment

| Subsystem | Current Estimate | At 500 monitors | At 5K monitors | Bottleneck |
|-----------|-----------------|-----------------|----------------|------------|
| Scheduler dispatch | ~10ms for 50 monitors | ~100ms, 500 rows/min | ~1s, 5K rows/min — GC pressure | `getAllActiveMonitors()` full table scan |
| Scraper concurrency | 10 concurrent, well-managed | OK with jitter | Check queue backs up; jitter window (30s) may not spread load enough | Pool of 10 + 10-connection DB pool |
| Notification pipeline | Sequential per-monitor | OK for 10 notifications/tick | N+1 queries dominate; 50+ DB calls per tick | `getMonitorChanges()` unbounded loads |
| DB connection pool | 10 connections (default) | Tight but survivable | **Exhausted** — 10 scrapers × 5 calls + API traffic | No explicit pool config |
| Webhook retry | Sequential, loads all changes | OK for <10 retries | 50 retries × full change load = OOM risk | `getMonitorChanges()` per retry |
| Digest cron | Sequential per-digest-monitor | OK for <20 digest monitors | 200 digest monitors = 1K+ DB calls | Per-monitor DB round-trips |

## Top Optimization Priorities

1. [ ] Add indexes to `monitors` (userId, active, frequency+lastChecked) and `monitor_changes` (monitorId, detectedAt) — **largest impact, lowest effort**
2. [ ] Replace `getAllActiveMonitors()` with `getMonitorsDue()` that filters by frequency/lastChecked in SQL — **eliminates unnecessary I/O**
3. [ ] Add `getMonitorChangesByIds(ids)` and `getMonitorChangeById(id)` to eliminate all N+1 patterns in notification and webhook retry pipelines
4. [ ] Batch `markQueueEntriesDelivered()` into a single UPDATE with `WHERE id IN (...)`
5. [ ] Explicitly configure pg Pool size (`max: 20`) and add pagination to `GET /api/monitors/:id/history`

## Final Verdict

- [ ] PERFORMANT — ready for expected load
- [x] CONDITIONAL — proceed with the optimizations listed above
- [ ] UNSCALABLE — architecture changes required before growth

The architecture is fundamentally sound — single-process with cron scheduling is fine for the current Replit deployment model up to ~500 monitors. The circuit breaker, browser pool, and rate limiting show good engineering. However, the missing indexes and N+1 query patterns will cause measurable degradation before reaching that threshold. Priorities #1–#3 above should be addressed before the next growth milestone.

---
