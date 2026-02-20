import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

/**
 * Run pending schema migrations that drizzle-kit push may have missed.
 * Each statement uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS so it is
 * safe to run repeatedly.
 */
export async function runAppMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS campaign_unsubscribed BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS unsubscribe_token VARCHAR UNIQUE;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS campaigns (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        subject TEXT NOT NULL,
        html_body TEXT NOT NULL,
        text_body TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        filters JSONB,
        total_recipients INTEGER NOT NULL DEFAULT 0,
        sent_count INTEGER NOT NULL DEFAULT 0,
        failed_count INTEGER NOT NULL DEFAULT 0,
        delivered_count INTEGER NOT NULL DEFAULT 0,
        opened_count INTEGER NOT NULL DEFAULT 0,
        clicked_count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT now() NOT NULL,
        scheduled_at TIMESTAMP,
        sent_at TIMESTAMP,
        completed_at TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS campaign_recipients (
        id SERIAL PRIMARY KEY,
        campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
        user_id VARCHAR NOT NULL REFERENCES users(id),
        recipient_email TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        resend_id TEXT,
        sent_at TIMESTAMP,
        delivered_at TIMESTAMP,
        opened_at TIMESTAMP,
        clicked_at TIMESTAMP,
        failed_at TIMESTAMP,
        failure_reason TEXT
      );
    `);

    // Indexes (IF NOT EXISTS supported since PG 9.5)
    await client.query(`CREATE INDEX IF NOT EXISTS campaigns_status_idx ON campaigns(status);`);
    await client.query(`CREATE INDEX IF NOT EXISTS campaigns_created_at_idx ON campaigns(created_at);`);
    await client.query(`CREATE INDEX IF NOT EXISTS campaign_recipients_campaign_idx ON campaign_recipients(campaign_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS campaign_recipients_user_idx ON campaign_recipients(user_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS campaign_recipients_resend_id_idx ON campaign_recipients(resend_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS campaign_recipients_status_idx ON campaign_recipients(status);`);

    await client.query("COMMIT");
    console.log("App schema migrations applied successfully");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Failed to run app migrations:", err);
    throw err;
  } finally {
    client.release();
  }
}
