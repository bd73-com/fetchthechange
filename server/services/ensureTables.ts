import { db } from "../db";
import { sql } from "drizzle-orm";
import { encryptUrl, decryptToken, hashUrl, isValidEncryptedToken, isEncryptionAvailable } from "../utils/encryption";

/**
 * Ensures error_logs deduplication columns and the partial unique index used
 * by ErrorLogger's atomic upsert (see GitHub issue #448) exist.
 *
 * Without the index, `INSERT … ON CONFLICT (level, source, message) WHERE
 * resolved = false` fails at runtime with "there is no unique or exclusion
 * constraint matching the ON CONFLICT specification", which ErrorLogger's
 * catch block at server/services/logger.ts swallows to `console.error` —
 * silently disabling DB-backed error logging for the entire deploy window
 * between code ship and `npm run schema:push`.
 *
 * Migration strategy:
 * 1. Fast-path idempotency: if a VALID unique index already exists, skip the
 *    whole migration. If an INVALID one exists (leftover from an interrupted
 *    CREATE CONCURRENTLY), drop it so we can rebuild.
 * 2. Dedup pre-existing duplicate unresolved rows (the bug being fixed!) in
 *    a transaction gated by a pg_advisory_xact_lock so concurrent instances
 *    in a rolling deploy don't race on overlapping DELETEs. Cap the rolled-
 *    up `occurrence_count` at INT32_MAX to avoid an overflow-rollback loop
 *    on busy tables.
 * 3. CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS — outside the tx so we
 *    don't take a SHARE lock that would block every ErrorLogger.log caller
 *    on the entire app during index build. Mirrors the pattern established
 *    by ensureMonitorChangesIndexes below.
 */
export async function ensureErrorLogColumns(): Promise<void> {
  try {
    await db.execute(sql`ALTER TABLE error_logs ADD COLUMN IF NOT EXISTS first_occurrence TIMESTAMP NOT NULL DEFAULT NOW()`);
    await db.execute(sql`ALTER TABLE error_logs ADD COLUMN IF NOT EXISTS occurrence_count INTEGER NOT NULL DEFAULT 1`);
    await db.execute(sql`ALTER TABLE error_logs ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`);

    // Enforce the level enum at the DB layer so a direct SQL INSERT or a
    // caller that bypasses the TypeScript union (e.g. `db.execute(sql\`INSERT
    // INTO error_logs (level, …) VALUES ('Error', …)\`)`) cannot land a
    // misspelled/miscased level in the table. The admin UI's levelConfig
    // (`client/src/pages/AdminErrors.tsx`) only indexes `error|warning|info`,
    // so an unknown level silently falls back to the info badge. Keep
    // `'warning'` allowed until the historical warning rows are purged — new
    // writes only use `error|info`. See #466.
    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'error_logs_level_chk'
            AND conrelid = 'error_logs'::regclass
        ) THEN
          BEGIN
            ALTER TABLE error_logs
              ADD CONSTRAINT error_logs_level_chk
              CHECK (level IN ('error', 'info', 'warning'));
          EXCEPTION WHEN check_violation THEN
            RAISE WARNING 'error_logs_level_chk not added: existing rows have levels outside (error, info, warning)';
          END;
        END IF;
      END$$;
    `);

    // Check if a VALID, UNIQUE, correctly-shaped index already exists — skip
    // DDL entirely if so. Validates four invariants simultaneously:
    //   1. `indisvalid` — not a leftover INVALID build
    //   2. `indisunique` — ON CONFLICT inference requires uniqueness
    //   3. `pg_get_indexdef` exposes the column tuple + predicate so we can
    //      assert the index covers (level, source, message) with the
    //      `WHERE resolved = false` partial predicate
    // A stale index with the same name but a different definition (wrong
    // columns, non-unique, missing predicate) fails this check and is
    // dropped and rebuilt. Without the definition check, a drifted index
    // would pass the fast path and ON CONFLICT would fail silently at
    // runtime, swallowed by ErrorLogger.log's catch block.
    const existing = await db.execute(sql`
      SELECT i.indisvalid, i.indisunique, pg_get_indexdef(i.indexrelid) AS indexdef
      FROM pg_indexes ix
      JOIN pg_class c ON c.relname = ix.indexname
      JOIN pg_index i ON i.indexrelid = c.oid
      WHERE ix.indexname = 'error_logs_unresolved_dedup_idx'
    `);
    const rows = (existing as any).rows as Array<{ indisvalid: boolean; indisunique: boolean; indexdef: string }> | undefined;
    if (rows && rows.length > 0) {
      const { indisvalid, indisunique, indexdef } = rows[0];
      const defIsCorrect =
        indexdef.includes("(level, source, message)") &&
        /WHERE\s+\(?resolved\s*=\s*false\)?/i.test(indexdef);
      if (indisvalid && indisunique && defIsCorrect) return;
      console.warn(
        `[ensureTables] Dropping existing error_logs_unresolved_dedup_idx (valid=${indisvalid} unique=${indisunique} defMatch=${defIsCorrect}) so it can be rebuilt with the expected shape`,
      );
      await db.execute(sql`DROP INDEX IF EXISTS error_logs_unresolved_dedup_idx`);
    }

    // Dedupe pre-existing unresolved rows produced by the old racy
    // SELECT-then-INSERT path. Keep the newest row per
    // (level, source, message) group and roll up `occurrence_count` into it
    // so the dedup bucket's total event count is preserved. The advisory
    // xact lock serializes concurrent boots in a rolling deploy so only one
    // instance performs the dedup at a time; follow-up boots find nothing
    // to merge and fall through to the idempotent CONCURRENTLY step below.
    // LEAST(INT32_MAX, SUM) caps the rolled-up count so a site with many
    // already-huge duplicate rows doesn't blow past integer range and
    // rollback the whole transaction.
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '10s'`);
      // Advisory lock key is a stable 64-bit hash of the migration identifier.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('error_logs_unresolved_dedup_migration', 0))`);
      await tx.execute(sql`
        WITH dups AS (
          SELECT id,
                 ROW_NUMBER() OVER (
                   PARTITION BY level, source, message
                   ORDER BY timestamp DESC, id DESC
                 ) AS rn,
                 LEAST(2147483647, SUM(occurrence_count) OVER (
                   PARTITION BY level, source, message
                 ))::int AS total_count
          FROM error_logs
          WHERE resolved = false
        )
        UPDATE error_logs
        SET occurrence_count = dups.total_count
        FROM dups
        WHERE error_logs.id = dups.id AND dups.rn = 1
      `);
      await tx.execute(sql`
        DELETE FROM error_logs
        WHERE id IN (
          SELECT id FROM (
            SELECT id, ROW_NUMBER() OVER (
              PARTITION BY level, source, message
              ORDER BY timestamp DESC, id DESC
            ) AS rn
            FROM error_logs WHERE resolved = false
          ) d WHERE rn > 1
        )
      `);
    });

    // CONCURRENTLY cannot run inside a transaction. IF NOT EXISTS makes this
    // safe if another rolling-deploy instance beat us to it between the
    // dedup tx above and this statement.
    await db.execute(sql`
      CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS error_logs_unresolved_dedup_idx
      ON error_logs(level, source, message)
      WHERE resolved = false
    `);
  } catch (e) {
    console.warn("Could not ensure error_logs columns/index:", e);
  }
}

/**
 * Ensures the api_keys table exists (added in PR #77).
 * Returns true if the table is ready, false if creation failed.
 */
export async function ensureApiKeysTable(): Promise<boolean> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS api_keys (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        name TEXT NOT NULL,
        key_hash TEXT NOT NULL UNIQUE,
        key_prefix TEXT NOT NULL,
        last_used_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        revoked_at TIMESTAMP
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS api_keys_user_revoked_idx ON api_keys(user_id, revoked_at)
    `);
    return true;
  } catch (e) {
    console.error("Could not ensure api_keys table — API key routes will be disabled:", e);
    return false;
  }
}

/**
 * Ensures notification channel tables exist (notification_channels, delivery_log, slack_connections).
 * Returns true when schema is ready, false when provisioning failed — callers
 * should gate traffic off the result because delivery_log.claimed_at is
 * referenced by retry/recovery queries that would otherwise throw
 * `column "claimed_at" does not exist` for the life of the process.
 */
export async function ensureChannelTables(): Promise<boolean> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS notification_channels (
        id SERIAL PRIMARY KEY,
        monitor_id INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
        channel TEXT NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT true,
        config JSONB NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS notification_channels_monitor_idx ON notification_channels(monitor_id)`);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS notification_channels_monitor_channel_uniq ON notification_channels(monitor_id, channel)`);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS delivery_log (
        id SERIAL PRIMARY KEY,
        monitor_id INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
        change_id INTEGER NOT NULL REFERENCES monitor_changes(id),
        channel TEXT NOT NULL,
        status TEXT NOT NULL,
        attempt INTEGER NOT NULL DEFAULT 1,
        response JSONB,
        delivered_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS delivery_log_monitor_created_idx ON delivery_log(monitor_id, created_at)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS delivery_log_channel_status_attempt_idx ON delivery_log(channel, status, created_at, attempt)`);
    // claimed_at column for multi-replica atomic claim coordination (see scheduler webhook retry cron).
    await db.execute(sql`ALTER TABLE delivery_log ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMP`);
    // Recovery scans filter by (channel, status, claimed_at) to find rows stuck
    // in 'processing' after a replica crash — index matches the query shape.
    await db.execute(sql`CREATE INDEX IF NOT EXISTS delivery_log_channel_status_claimed_idx ON delivery_log(channel, status, claimed_at)`);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS slack_connections (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
        team_id TEXT NOT NULL,
        team_name TEXT NOT NULL,
        bot_token TEXT NOT NULL,
        scope TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    // Backfill: encrypt existing plaintext webhook URLs
    await backfillNotificationChannelWebhookUrls();
    return true;
  } catch (e) {
    console.error("Could not ensure notification channel tables:", e);
    return false;
  }
}

/**
 * Ensures monitor health-alert columns exist (added in PR #113).
 * Without this, db.select().from(monitors) fails when the schema
 * references columns the database doesn't have yet.
 */
export async function ensureMonitorHealthColumns(): Promise<boolean> {
  try {
    await db.execute(sql`ALTER TABLE monitors ADD COLUMN IF NOT EXISTS health_alert_sent_at TIMESTAMP`);
    await db.execute(sql`ALTER TABLE monitors ADD COLUMN IF NOT EXISTS last_healthy_at TIMESTAMP`);
    return true;
  } catch (e) {
    console.error("Could not ensure monitor health columns — health alerts will not work:", e);
    return false;
  }
}

/**
 * Ensures monitor_conditions table exists.
 * Without this, condition routes return 500 "relation monitor_conditions does not exist"
 * if schema:push has not been run after this table was added to the schema.
 */
export async function ensureMonitorConditionsTable(): Promise<boolean> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS monitor_conditions (
        id SERIAL PRIMARY KEY,
        monitor_id INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        value TEXT NOT NULL,
        group_index INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS monitor_conditions_monitor_idx ON monitor_conditions(monitor_id)`);
    return true;
  } catch (e) {
    console.error("Could not ensure monitor_conditions table:", e);
    return false;
  }
}

/**
 * Ensures notification_queue has `attempts` and `permanently_failed` columns
 * (added in PR #158).  Without this, all notification cron queries crash
 * when the schema references columns the database doesn't have yet.
 */
export async function ensureNotificationQueueColumns(): Promise<boolean> {
  try {
    await db.execute(sql`ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0`);
    await db.execute(sql`ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS permanently_failed BOOLEAN NOT NULL DEFAULT false`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS notification_queue_permanently_failed_idx ON notification_queue(permanently_failed)`);
    return true;
  } catch (e) {
    console.error("Could not ensure notification_queue columns:", e);
    return false;
  }
}

/**
 * Ensures automated_campaign_configs table exists (added in PR #275).
 * Without this, bootstrapWelcomeCampaign() and automated campaign routes
 * crash with: relation "automated_campaign_configs" does not exist.
 */
export async function ensureAutomatedCampaignConfigsTable(): Promise<boolean> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS automated_campaign_configs (
        id SERIAL PRIMARY KEY,
        key TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        subject TEXT NOT NULL,
        html_body TEXT NOT NULL,
        text_body TEXT,
        enabled BOOLEAN NOT NULL DEFAULT true,
        last_run_at TIMESTAMP,
        next_run_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    return true;
  } catch (e) {
    console.error("Could not ensure automated_campaign_configs table:", e);
    return false;
  }
}

/**
 * Ensures the monitors.pending_retry_at column exists (added in PR #302).
 * Without this, db.select().from(monitors) fails when the schema
 * references columns the database doesn't have yet.
 */
export async function ensureMonitorPendingRetryColumn(): Promise<boolean> {
  try {
    await db.execute(sql`ALTER TABLE monitors ADD COLUMN IF NOT EXISTS pending_retry_at TIMESTAMP`);
    return true;
  } catch (e) {
    console.error("Could not ensure monitors.pending_retry_at column:", e);
    return false;
  }
}

/**
 * Ensures automation_subscriptions table exists (Zapier REST Hooks).
 * Without this, Zapier subscribe/unsubscribe endpoints and deliverToAutomationSubscriptions
 * crash with: relation "automation_subscriptions" does not exist.
 */
export async function ensureAutomationSubscriptionsTable(): Promise<boolean> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS automation_subscriptions (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        platform TEXT NOT NULL,
        hook_url TEXT NOT NULL,
        monitor_id INTEGER REFERENCES monitors(id) ON DELETE CASCADE,
        active BOOLEAN NOT NULL DEFAULT true,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        deactivated_at TIMESTAMP,
        last_delivered_at TIMESTAMP
      )
    `);
    // Add columns for existing tables that predate the consecutive failures / cleanup feature
    await db.execute(sql`ALTER TABLE automation_subscriptions ADD COLUMN IF NOT EXISTS consecutive_failures INTEGER NOT NULL DEFAULT 0`);
    await db.execute(sql`ALTER TABLE automation_subscriptions ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMP`);
    // Add hook_url_hash column for dedup (replaces plaintext hook_url in unique indexes)
    await db.execute(sql`ALTER TABLE automation_subscriptions ADD COLUMN IF NOT EXISTS hook_url_hash TEXT`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS automation_subscriptions_user_idx ON automation_subscriptions(user_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS automation_subscriptions_platform_idx ON automation_subscriptions(platform)`);
    // Enforce dedup at DB level: one active subscription per (user, platform, hookUrlHash, monitorId).
    // Split into two partial indexes to avoid COALESCE expression that confuses migration introspection.
    // Drop legacy indexes that used plaintext hook_url (not hook_url_hash) for dedup.
    // Only drop if the index definition does NOT already reference hook_url_hash.
    // Wrapped in a transaction with EXCLUSIVE lock to prevent duplicate inserts during the
    // window between dropping old indexes and creating new ones (fixes race in rolling deploys).
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
      await tx.execute(sql`LOCK TABLE automation_subscriptions IN EXCLUSIVE MODE`);
      // SECURITY: index names must remain hardcoded literals — sql.raw() bypasses parameterization
      for (const name of ['automation_subscriptions_dedup_uniq', 'automation_subscriptions_dedup_with_monitor', 'automation_subscriptions_dedup_global']) {
        const old = await tx.execute(sql`SELECT indexdef FROM pg_indexes WHERE indexname = ${name} LIMIT 1`);
        const row = (old as any).rows?.[0];
        if (row && !row.indexdef?.includes('hook_url_hash')) {
          await tx.execute(sql.raw(`DROP INDEX IF EXISTS ${name}`));
        }
      }
      await tx.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS automation_subscriptions_dedup_with_monitor ON automation_subscriptions(user_id, platform, hook_url_hash, monitor_id) WHERE active = true AND monitor_id IS NOT NULL AND hook_url_hash IS NOT NULL`);
      await tx.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS automation_subscriptions_dedup_global ON automation_subscriptions(user_id, platform, hook_url_hash) WHERE active = true AND monitor_id IS NULL AND hook_url_hash IS NOT NULL`);
    });
    // Backfill: hash and encrypt any legacy plaintext hook_url rows
    await backfillAutomationSubscriptionUrls();
    // Warn if any active subscriptions still have NULL hook_url_hash after backfill
    // (e.g. decryption errors during backfill) — these bypass dedup unique indexes
    const nullHashRows = await db.execute(
      sql`SELECT count(*)::int AS cnt FROM automation_subscriptions WHERE active = true AND hook_url_hash IS NULL`,
    );
    const nullCount = (nullHashRows as any).rows?.[0]?.cnt ?? 0;
    if (nullCount > 0) {
      console.warn(`[ensureTables] WARNING: ${nullCount} active automation subscription(s) have NULL hook_url_hash — dedup indexes will not cover these rows. Investigate backfill failures.`);
    }
    return true;
  } catch (e) {
    console.error("Could not ensure automation_subscriptions table:", e);
    return false;
  }
}

/**
 * Ensures the composite index on monitor_changes(monitor_id, detected_at) exists.
 * Without this index, queries filtering by monitor_id with ORDER BY detected_at
 * perform sequential scans as the table grows.
 */
export async function ensureMonitorChangesIndexes(): Promise<void> {
  try {
    // Check if a valid index already exists — skip DDL entirely if so.
    const existing = await db.execute(sql`
      SELECT i.indisvalid
      FROM pg_indexes ix
      JOIN pg_class c ON c.relname = ix.indexname
      JOIN pg_index i ON i.indexrelid = c.oid
      WHERE ix.indexname = 'monitor_changes_monitor_detected_idx'
    `);
    const rows = (existing as any).rows as Array<{ indisvalid: boolean }> | undefined;
    if (rows && rows.length > 0) {
      if (rows[0].indisvalid) return; // Valid index exists — nothing to do
      // Invalid index left from interrupted CREATE CONCURRENTLY — drop it first
      console.warn("[ensureTables] Dropping invalid index monitor_changes_monitor_detected_idx");
      await db.execute(sql`DROP INDEX IF EXISTS monitor_changes_monitor_detected_idx`);
    }
    // Use CONCURRENTLY to avoid taking a SHARE lock that blocks writes on large tables.
    // CONCURRENTLY cannot run inside a transaction — Drizzle's db.execute does not wrap in one.
    await db.execute(sql`CREATE INDEX CONCURRENTLY IF NOT EXISTS monitor_changes_monitor_detected_idx ON monitor_changes(monitor_id, detected_at)`);
  } catch (e) {
    console.warn("Could not ensure monitor_changes indexes:", e);
  }
}

/**
 * Ensures the partial indexes on `campaigns(id) WHERE type='automated'` and
 * `campaign_recipients(user_id, campaign_id) WHERE status IN (<active>)` exist
 * (PR #447). Without them, the welcome-exclusion anti-join in
 * resolveRecipients (server/services/campaignEmail.ts) falls back to a Seq
 * Scan + Hash Anti Join whose runtime scales O(N) in total historical
 * recipient rows — see GitHub issue #452.
 *
 * Predicates are kept byte-identical to shared/schema.ts. The
 * partial-index-invariants test asserts this parity so drift between schema
 * and DDL is caught before it ships.
 */
export async function ensureCampaignPartialIndexes(): Promise<void> {
  try {
    // campaigns_type_automated_idx — also check pg_get_indexdef so a stale
    // same-name index with wrong columns/predicate gets dropped and rebuilt
    // (CREATE INDEX CONCURRENTLY IF NOT EXISTS is name-based only). Matches
    // the ensureErrorLogColumns pattern — see CodeRabbit review on PR #455.
    const existingCampaignIdx = await db.execute(sql`
      SELECT i.indisvalid, pg_get_indexdef(i.indexrelid) AS indexdef
      FROM pg_indexes ix
      JOIN pg_class c ON c.relname = ix.indexname
      JOIN pg_index i ON i.indexrelid = c.oid
      WHERE ix.indexname = 'campaigns_type_automated_idx'
    `);
    const campaignRows = (existingCampaignIdx as any).rows as Array<{ indisvalid: boolean; indexdef: string }> | undefined;
    if (campaignRows && campaignRows.length > 0) {
      const { indisvalid, indexdef } = campaignRows[0];
      // Postgres canonicalizes `type = 'automated'` and may emit ::text casts
      // and extra parens; match the key tokens rather than the raw string.
      const defIsCorrect =
        / ON [^.]*\.?campaigns\b/i.test(indexdef) &&
        /\(id\)/.test(indexdef) &&
        /type\s*=\s*'automated'/i.test(indexdef);
      if (!indisvalid || !defIsCorrect) {
        console.warn(
          `[ensureTables] Dropping existing campaigns_type_automated_idx (valid=${indisvalid} defMatch=${defIsCorrect}) so it can be rebuilt with the expected shape`,
        );
        await db.execute(sql`DROP INDEX IF EXISTS campaigns_type_automated_idx`);
      }
    }
    await db.execute(sql`CREATE INDEX CONCURRENTLY IF NOT EXISTS campaigns_type_automated_idx ON campaigns(id) WHERE type = 'automated'`);

    // campaign_recipients_active_user_idx — predicate must byte-match schema.ts
    const existingRecipientIdx = await db.execute(sql`
      SELECT i.indisvalid, pg_get_indexdef(i.indexrelid) AS indexdef
      FROM pg_indexes ix
      JOIN pg_class c ON c.relname = ix.indexname
      JOIN pg_index i ON i.indexrelid = c.oid
      WHERE ix.indexname = 'campaign_recipients_active_user_idx'
    `);
    const recipientRows = (existingRecipientIdx as any).rows as Array<{ indisvalid: boolean; indexdef: string }> | undefined;
    if (recipientRows && recipientRows.length > 0) {
      const { indisvalid, indexdef } = recipientRows[0];
      // Postgres rewrites `status IN ('a','b',...)` as
      // `status = ANY (ARRAY['a'::text, ...])`, so check for each status
      // literal and the column tuple rather than the raw `IN (...)` form.
      const activeStatuses = ["pending", "sent", "delivered", "opened", "clicked"];
      const defIsCorrect =
        / ON [^.]*\.?campaign_recipients\b/i.test(indexdef) &&
        /\(user_id,\s*campaign_id\)/.test(indexdef) &&
        activeStatuses.every((s) => indexdef.includes(`'${s}'`));
      if (!indisvalid || !defIsCorrect) {
        console.warn(
          `[ensureTables] Dropping existing campaign_recipients_active_user_idx (valid=${indisvalid} defMatch=${defIsCorrect}) so it can be rebuilt with the expected shape`,
        );
        await db.execute(sql`DROP INDEX IF EXISTS campaign_recipients_active_user_idx`);
      }
    }
    await db.execute(sql`CREATE INDEX CONCURRENTLY IF NOT EXISTS campaign_recipients_active_user_idx ON campaign_recipients(user_id, campaign_id) WHERE status IN ('pending', 'sent', 'delivered', 'opened', 'clicked')`);
  } catch (e) {
    console.warn("Could not ensure campaign partial indexes:", e);
  }
}

/**
 * Ensures tags and monitor_tags tables exist (added in PR #86).
 * Without this, getMonitorsWithTags() fails when the tables have not been created yet.
 */
export async function ensureTagTables(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS tags (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        name TEXT NOT NULL,
        name_lower TEXT NOT NULL,
        colour TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS tags_user_idx ON tags(user_id)`);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS tags_user_name_lower_uniq ON tags(user_id, name_lower)`);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS monitor_tags (
        id SERIAL PRIMARY KEY,
        monitor_id INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
        tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS monitor_tags_monitor_tag_uniq ON monitor_tags(monitor_id, tag_id)`);
  } catch (e) {
    console.error("Could not ensure tag tables:", e);
  }
}

/**
 * Backfills hook_url_hash and encrypts plaintext hook_url values for
 * existing automation_subscriptions rows.  Rows that already have a
 * hook_url_hash are skipped (idempotent).
 */
async function backfillAutomationSubscriptionUrls(): Promise<void> {
  // Skip backfill when encryption key is unavailable — populating hook_url_hash
  // while hook_url stays plaintext would mark the row as "done" permanently.
  if (!isEncryptionAvailable()) {
    return;
  }
  try {
    let totalUpdated = 0;
    // Process in batches of 500 until no un-hashed rows remain.
    // Each batch runs inside an explicit transaction so FOR UPDATE SKIP LOCKED
    // actually holds locks until the UPDATE completes (fixes autocommit issue).
    while (true) {
      const batchCount = await db.transaction(async (tx) => {
        const rows = await tx.execute(sql`SELECT id, hook_url FROM automation_subscriptions WHERE hook_url_hash IS NULL ORDER BY id LIMIT 500 FOR UPDATE SKIP LOCKED`);
        const toUpdate = (rows as any).rows as Array<{ id: number; hook_url: string }>;
        if (!toUpdate || toUpdate.length === 0) return { batchSize: 0, updated: 0 };

        let updated = 0;
        for (const row of toUpdate) {
          let plainUrl: string;
          try {
            plainUrl = isValidEncryptedToken(row.hook_url) ? decryptToken(row.hook_url) : row.hook_url;
          } catch (decryptErr) {
            // Skip row if decryption fails (e.g. key rotation) — don't abort the batch
            console.warn(`[ensureTables] Skipping automation subscription ${row.id}: decryption failed`, decryptErr);
            continue;
          }
          const hash = hashUrl(plainUrl);
          const encrypted = encryptUrl(plainUrl);
          await tx.execute(sql`UPDATE automation_subscriptions SET hook_url_hash = ${hash}, hook_url = ${encrypted} WHERE id = ${row.id} AND hook_url_hash IS NULL`);
          updated++;
        }
        return { batchSize: toUpdate.length, updated };
      });
      if (batchCount.batchSize === 0) break;
      totalUpdated += batchCount.updated;
    }
    if (totalUpdated > 0) {
      console.log(`[ensureTables] Backfilled ${totalUpdated} automation subscription URLs`);
    }
  } catch (e) {
    console.warn("Could not backfill automation subscription URLs:", e);
  }
}

/**
 * Backfills encryption for existing notification_channels webhook config.url
 * and config.secret.  Rows with already-encrypted values (detected by
 * isValidEncryptedToken) are skipped.  Processes in batches of 500.
 */
async function backfillNotificationChannelWebhookUrls(): Promise<void> {
  // Skip backfill entirely when encryption key is unavailable — encrypting
  // with a missing/rotated key would silently store plaintext or corrupt data.
  if (!isEncryptionAvailable()) {
    return;
  }
  try {
    let lastId = 0;
    let updated = 0;
    // Cursor-based pagination to process all webhook channels.
    // Each batch runs inside a transaction to prevent double-encryption races.
    while (true) {
      const batchResult = await db.transaction(async (tx) => {
        const rows = await tx.execute(sql`SELECT id, config FROM notification_channels WHERE channel = 'webhook' AND id > ${lastId} ORDER BY id LIMIT 500 FOR UPDATE SKIP LOCKED`);
        const toUpdate = (rows as any).rows as Array<{ id: number; config: Record<string, unknown> }>;
        if (!toUpdate || toUpdate.length === 0) return { batchUpdated: 0, batchSize: 0, newLastId: lastId };

        let batchUpdated = 0;
        const newLastId = toUpdate[toUpdate.length - 1].id;
        for (const row of toUpdate) {
          const cfg = row.config;
          if (!cfg) continue;
          const url = cfg.url as string | undefined;
          const secret = cfg.secret as string | undefined;
          const urlNeedsEncrypt = url && !isValidEncryptedToken(url);
          const secretNeedsEncrypt = secret && !isValidEncryptedToken(secret);
          if (!urlNeedsEncrypt && !secretNeedsEncrypt) continue;

          // Validate each plaintext value independently before encrypting so a
          // corrupted URL does not block encryption of a valid secret (and vice versa).
          let urlSkipped = false;
          let secretSkipped = false;
          if (urlNeedsEncrypt && url && !/^https?:\/\//i.test(url)) {
            console.warn(`[ensureTables] Skipping URL encryption for notification channel ${row.id}: URL does not look like a valid http(s) URL`);
            urlSkipped = true;
          }
          if (secretNeedsEncrypt && secret && !secret.startsWith("whsec_")) {
            console.warn(`[ensureTables] Skipping secret encryption for notification channel ${row.id}: secret does not start with whsec_ prefix`);
            secretSkipped = true;
          }

          const willEncryptUrl = urlNeedsEncrypt && !urlSkipped;
          const willEncryptSecret = secretNeedsEncrypt && !secretSkipped;
          if (!willEncryptUrl && !willEncryptSecret) continue;

          const newConfig = { ...cfg };
          if (willEncryptUrl) newConfig.url = encryptUrl(url!);
          if (willEncryptSecret) newConfig.secret = encryptUrl(secret!);
          await tx.execute(sql`UPDATE notification_channels SET config = ${JSON.stringify(newConfig)}::jsonb WHERE id = ${row.id}`);
          batchUpdated++;
        }
        return { batchUpdated, batchSize: toUpdate.length, newLastId };
      });
      if (batchResult.batchSize === 0) break;
      lastId = batchResult.newLastId;
      updated += batchResult.batchUpdated;
    }
    if (updated > 0) {
      console.log(`[ensureTables] Backfilled ${updated} notification channel webhook URLs`);
    }
  } catch (e) {
    console.warn("Could not backfill notification channel webhook URLs:", e);
  }
}
