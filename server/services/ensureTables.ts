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
