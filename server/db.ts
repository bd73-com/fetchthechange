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
  // 5 leaves headroom for concurrent startup migrations, scheduler cron,
  // and API requests without exhausting the pool.
  max: 5,
  // Allow enough time for the DB to respond during startup when multiple
  // migrations and background tasks compete for connections.
  connectionTimeoutMillis: 10_000,
  // Release idle connections promptly — 15 s balances port reclamation vs connection reuse.
  idleTimeoutMillis: 15_000,
});

// Log unexpected pool-level errors (connection drops, auth failures) that pg
// would otherwise silently discard.
pool.on("error", (err) => {
  console.error("[DB Pool] Unexpected error on idle client:", err.message);
});

export const db = drizzle(pool, { schema });
