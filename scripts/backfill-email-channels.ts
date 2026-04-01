/**
 * Backfill script: insert a default email channel row for every monitor that
 * currently has at least one notification_channels row but no email row.
 *
 * This fixes a data gap where monitors created before the email channel seeding
 * logic was added silently lost email delivery once a Slack or webhook channel
 * was configured (the backwards-compatibility fallback only fires when there are
 * ZERO channel rows).
 *
 * Idempotent: safe to run multiple times. Uses INSERT ... ON CONFLICT DO NOTHING
 * so re-running produces zero duplicate rows.
 *
 * Run with: npx tsx scripts/backfill-email-channels.ts
 */

import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import * as schema from "../shared/schema";

const { Pool } = pg;

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL must be set.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const db = drizzle(pool, { schema });

  try {
    // Find monitors that have at least one channel row but no email row.
    const monitorsNeedingEmail = await db.execute(sql`
      SELECT DISTINCT nc.monitor_id
      FROM notification_channels nc
      WHERE NOT EXISTS (
        SELECT 1 FROM notification_channels nc2
        WHERE nc2.monitor_id = nc.monitor_id AND nc2.channel = 'email'
      )
    `);

    const monitorIds: number[] = (monitorsNeedingEmail as any).rows.map(
      (r: any) => r.monitor_id
    );

    if (monitorIds.length === 0) {
      console.log("No monitors need backfilling — all monitors with channels already have an email row.");
      await pool.end();
      process.exit(0);
    }

    console.log(`Found ${monitorIds.length} monitor(s) missing an email channel row: [${monitorIds.join(", ")}]`);

    let inserted = 0;
    // Use a transaction so all inserts succeed or none do.
    await db.transaction(async (tx) => {
      for (const monitorId of monitorIds) {
        const result = await tx.execute(sql`
          INSERT INTO notification_channels (monitor_id, channel, enabled, config, created_at, updated_at)
          VALUES (${monitorId}, 'email', true, '{}', NOW(), NOW())
          ON CONFLICT (monitor_id, channel) DO NOTHING
        `);
        const rowCount = (result as any).rowCount ?? 0;
        if (rowCount > 0) {
          console.log(`  Inserted email channel row for monitor ${monitorId}`);
          inserted++;
        } else {
          console.log(`  Skipped monitor ${monitorId} — email row already exists (race condition or re-run)`);
        }
      }
    });

    console.log(`\nBackfill complete: inserted ${inserted} email channel row(s).`);
  } catch (err) {
    console.error("Backfill failed:", err);
    process.exit(1);
  } finally {
    await pool.end();
  }

  process.exit(0);
}

main();
