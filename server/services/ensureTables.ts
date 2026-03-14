import { db } from "../db";
import { sql } from "drizzle-orm";

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
