import { db } from "../db";
import { sql } from "drizzle-orm";
import { encryptUrl, decryptToken, hashUrl, isValidEncryptedToken } from "../utils/encryption";

/**
 * Ensures error_logs deduplication columns exist (added in PR #56).
 * Without this, db.select().from(errorLogs) fails when the schema
 * references columns the database doesn't have yet.
 */
export async function ensureErrorLogColumns(): Promise<void> {
  try {
    await db.execute(sql`ALTER TABLE error_logs ADD COLUMN IF NOT EXISTS first_occurrence TIMESTAMP NOT NULL DEFAULT NOW()`);
    await db.execute(sql`ALTER TABLE error_logs ADD COLUMN IF NOT EXISTS occurrence_count INTEGER NOT NULL DEFAULT 1`);
    await db.execute(sql`ALTER TABLE error_logs ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`);
  } catch (e) {
    console.warn("Could not ensure error_logs columns:", e);
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
 * Without this, channel management routes return 503 "not available"
 * if schema:push has not been run after these tables were added to the schema.
 */
export async function ensureChannelTables(): Promise<void> {
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
  } catch (e) {
    console.error("Could not ensure notification channel tables:", e);
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
    // Drop legacy indexes that used plaintext hook_url for dedup.
    for (const name of ['automation_subscriptions_dedup_uniq', 'automation_subscriptions_dedup_with_monitor', 'automation_subscriptions_dedup_global']) {
      const old = await db.execute(sql`SELECT 1 FROM pg_indexes WHERE indexname = ${name} LIMIT 1`);
      if ((old as any).rows?.length > 0) {
        await db.execute(sql.raw(`DROP INDEX ${name}`));
      }
    }
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS automation_subscriptions_dedup_with_monitor ON automation_subscriptions(user_id, platform, hook_url_hash, monitor_id) WHERE active = true AND monitor_id IS NOT NULL`);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS automation_subscriptions_dedup_global ON automation_subscriptions(user_id, platform, hook_url_hash) WHERE active = true AND monitor_id IS NULL`);
    // Backfill: hash and encrypt any legacy plaintext hook_url rows
    await backfillAutomationSubscriptionUrls();
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
    // Use CONCURRENTLY to avoid taking a SHARE lock that blocks writes on large tables.
    // CONCURRENTLY cannot run inside a transaction — Drizzle's db.execute does not wrap in one.
    await db.execute(sql`CREATE INDEX CONCURRENTLY IF NOT EXISTS monitor_changes_monitor_detected_idx ON monitor_changes(monitor_id, detected_at)`);
  } catch (e) {
    console.warn("Could not ensure monitor_changes indexes:", e);
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
  try {
    // LIMIT 500 to bound startup time; FOR UPDATE SKIP LOCKED to prevent concurrent backfill races
    const rows = await db.execute(sql`SELECT id, hook_url FROM automation_subscriptions WHERE hook_url_hash IS NULL LIMIT 500 FOR UPDATE SKIP LOCKED`);
    const toUpdate = (rows as any).rows as Array<{ id: number; hook_url: string }>;
    if (!toUpdate || toUpdate.length === 0) return;

    for (const row of toUpdate) {
      const plainUrl = isValidEncryptedToken(row.hook_url) ? decryptToken(row.hook_url) : row.hook_url;
      const hash = hashUrl(plainUrl);
      const encrypted = encryptUrl(plainUrl);
      await db.execute(sql`UPDATE automation_subscriptions SET hook_url_hash = ${hash}, hook_url = ${encrypted} WHERE id = ${row.id}`);
    }
    console.log(`[ensureTables] Backfilled ${toUpdate.length} automation subscription URLs`);
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
  try {
    const rows = await db.execute(sql`SELECT id, config FROM notification_channels WHERE channel = 'webhook' LIMIT 500`);
    const toUpdate = (rows as any).rows as Array<{ id: number; config: Record<string, unknown> }>;
    if (!toUpdate || toUpdate.length === 0) return;

    let updated = 0;
    for (const row of toUpdate) {
      const cfg = row.config;
      if (!cfg) continue;
      const url = cfg.url as string | undefined;
      const secret = cfg.secret as string | undefined;
      const urlNeedsEncrypt = url && !isValidEncryptedToken(url);
      const secretNeedsEncrypt = secret && !isValidEncryptedToken(secret);
      if (!urlNeedsEncrypt && !secretNeedsEncrypt) continue;

      const newConfig = { ...cfg };
      if (urlNeedsEncrypt) newConfig.url = encryptUrl(url);
      if (secretNeedsEncrypt) newConfig.secret = encryptUrl(secret);
      await db.execute(sql`UPDATE notification_channels SET config = ${JSON.stringify(newConfig)}::jsonb WHERE id = ${row.id}`);
      updated++;
    }
    if (updated > 0) {
      console.log(`[ensureTables] Backfilled ${updated} notification channel webhook URLs`);
    }
  } catch (e) {
    console.warn("Could not backfill notification channel webhook URLs:", e);
  }
}
