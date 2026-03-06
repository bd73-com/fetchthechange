import { db } from "../db";
import { sql } from "drizzle-orm";

let tablesConfirmed = false;
let channelTablesConfirmed = false;

/**
 * Returns true if notification_preferences and notification_queue tables exist.
 * Caches a positive result permanently (tables don't disappear once created).
 * Negative results are NOT cached so tables can be created via schema:push without restart.
 */
export async function notificationTablesExist(): Promise<boolean> {
  if (tablesConfirmed) return true;
  try {
    await db.execute(sql`SELECT 1 FROM notification_preferences LIMIT 0`);
    await db.execute(sql`SELECT 1 FROM notification_queue LIMIT 0`);
    tablesConfirmed = true;
    return true;
  } catch (error: any) {
    if (error?.message?.includes("relation")) return false;
    throw error;
  }
}

/**
 * Returns true if notification_channels, delivery_log, and slack_connections tables exist.
 * Caches a positive result permanently (tables don't disappear once created).
 * Negative results are NOT cached so tables can be created via schema:push without restart.
 */
export async function channelTablesExist(): Promise<boolean> {
  if (channelTablesConfirmed) return true;
  try {
    await db.execute(sql`SELECT 1 FROM notification_channels LIMIT 0`);
    await db.execute(sql`SELECT 1 FROM delivery_log LIMIT 0`);
    await db.execute(sql`SELECT 1 FROM slack_connections LIMIT 0`);
    channelTablesConfirmed = true;
    return true;
  } catch (error: any) {
    if (error?.message?.includes("relation")) return false;
    throw error;
  }
}

/** Reset cached state — for testing only. */
export function _resetCache(): void {
  tablesConfirmed = false;
  channelTablesConfirmed = false;
}
