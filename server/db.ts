import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Cap pool size to reduce ephemeral port usage (Replit's port scanner
  // detects outbound connections and tries to assign external ports).
  max: 3,
  // Fail fast instead of blocking indefinitely when all connections are busy.
  connectionTimeoutMillis: 5_000,
  // Release idle connections aggressively to free ephemeral ports sooner.
  idleTimeoutMillis: 10_000,
});

// Log unexpected pool-level errors (connection drops, auth failures) that pg
// would otherwise silently discard.
pool.on("error", (err) => {
  console.error("[DB Pool] Unexpected error on idle client:", err.message);
});

export const db = drizzle(pool, { schema });
