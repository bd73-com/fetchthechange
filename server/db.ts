import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

/**
 * Normalize DATABASE_URL to use explicit sslmode=verify-full.
 * pg v8.16+ treats 'prefer', 'require', and 'verify-ca' as aliases
 * for 'verify-full' and emits a security warning. Setting it explicitly
 * preserves the same behaviour and silences the warning.
 */
function normalizeSslMode(url: string): string {
  try {
    const parsed = new URL(url);
    const sslmode = parsed.searchParams.get("sslmode");
    if (sslmode && ["prefer", "require", "verify-ca"].includes(sslmode)) {
      parsed.searchParams.set("sslmode", "verify-full");
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

export const databaseUrl = normalizeSslMode(process.env.DATABASE_URL);

export const pool = new Pool({ connectionString: databaseUrl });
export const db = drizzle(pool, { schema });
