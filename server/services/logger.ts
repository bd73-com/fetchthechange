import { db } from "../db";
import { errorLogs } from "@shared/schema";
import { sql } from "drizzle-orm";
import type { ERROR_LOG_SOURCES } from "@shared/routes";

type LogLevel = "error" | "info";
type LogSource = (typeof ERROR_LOG_SOURCES)[number];

const SENSITIVE_KEYS = [
  "password", "token", "apikey", "api_key", "secret", "authorization",
  "cookie", "session", "credential", "private_key", "privatekey",
  "access_key", "accesskey", "connection_string", "connectionstring",
  "database_url", "databaseurl", "dsn", "bearer",
];

const SENSITIVE_VALUE_PATTERNS = [
  /postgres(ql)?:\/\/[^\s"']+/gi,
  /mysql:\/\/[^\s"']+/gi,
  /mongodb(\+srv)?:\/\/[^\s"']+/gi,
  /redis:\/\/[^\s"']+/gi,
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /\b(sk|pk|rk|whsec)[-_](?:live|test)[-_][A-Za-z0-9]{10,}\b/g,
  /\bre_[A-Za-z0-9]{10,}\b/g,
  /\bghp_[A-Za-z0-9]{36,}\b/g,
  /\bxox[bprsao]-[A-Za-z0-9\-]{10,}\b/g,
  /\b[A-Za-z0-9+/]{40,}={0,2}\b/g,
];

// Strip C0/C1 controls, Unicode line/paragraph separators (U+2028/U+2029),
// and BiDi overrides (U+202A-U+202E, U+2066-U+2069). The line-separator and
// BiDi points are not line terminators to Node's `console` but DO split lines
// in most terminal emulators (including Replit's) and downstream log
// aggregators, so an attacker who embeds `\n[ERROR][scheduler]` or U+2028 in
// a user-controlled field like `monitor.name` cannot forge fake log rows or
// poison the (level, source, message) dedup bucket. Tabs are normalized to a
// space separately. See #464.
function stripControlChars(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str
    .replace(/[\x00-\x08\x0A-\x1F\x7F-\x9F]/g, " ")
    .replace(/[\u2028\u2029]/g, " ")
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, "")
    .replace(/\t/g, " ");
}

function sanitizeString(str: string): string {
  let result = stripControlChars(str);
  for (const pattern of SENSITIVE_VALUE_PATTERNS) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, "[REDACTED]");
  }
  return result.length > 1000 ? result.substring(0, 1000) + "...[truncated]" : result;
}

function sanitizeContext(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") return sanitizeString(obj);
  if (typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeContext);

  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.some(s => key.toLowerCase().includes(s))) {
      sanitized[key] = "[REDACTED]";
    } else {
      sanitized[key] = sanitizeContext(value);
    }
  }
  return sanitized;
}

export class ErrorLogger {
  static async log(
    level: LogLevel,
    source: LogSource,
    message: string,
    error?: Error | null,
    context?: Record<string, any> | null
  ): Promise<void> {
    const prefix = `[${level.toUpperCase()}][${source}]`;

    // Sanitize before any console output so secrets embedded in the message
    // or the raw SDK error.message (e.g. `Authorization: Bearer re_…` echoed
    // in a Resend/Stripe HTTP response body) do not leak to the Replit log
    // stream. Matches the DB-write sanitization below. `sanitizedStack` is
    // intentionally NOT emitted to the console — stacks pollute Replit logs
    // and the DB copy is enough for admin triage. See #467.
    const sanitizedMessage = sanitizeString(message);
    const sanitizedStack = error?.stack ? sanitizeString(error.stack) : null;
    const sanitizedContext = context ? sanitizeContext(context) : null;
    const errorType = error?.constructor?.name || null;
    const logMsg = `${prefix} ${sanitizedMessage}`;

    if (level === "error") {
      if (error?.message) {
        console.error(logMsg, sanitizeString(error.message));
      } else {
        console.error(logMsg);
      }
    } else {
      console.log(logMsg);
    }

    try {
      // Atomic upsert against the partial unique index
      // `error_logs_unresolved_dedup_idx` (level, source, message) WHERE
      // resolved = false. Collapses the read-modify-write window of the old
      // SELECT-then-INSERT dedup path so concurrent writers with the same
      // (level, source, message) deterministically land in a single row with
      // `occurrence_count` bumped by every caller. Without this index +
      // upsert, concurrent writers with shared messages (e.g. the compacted
      // "Browserless service unavailable" warning) both miss the SELECT and
      // both INSERT, producing duplicate rows in the admin UI. See GitHub
      // issue #448.
      //
      // Stack/context semantics: `COALESCE(EXCLUDED.col, currentTable.col)`
      // is last-writer-wins when the incoming call supplies a non-null value,
      // and preserves the prior value when the incoming call doesn't. The
      // admin UI therefore shows the most recent caller's stack/context for
      // a dedup bucket, not the first-observed one. `firstOccurrence` is set
      // only on INSERT — the conflict update path deliberately does not
      // touch it, preserving the original event time.
      const now = new Date();
      await db
        .insert(errorLogs)
        .values({
          level,
          source,
          message: sanitizedMessage,
          errorType,
          stackTrace: sanitizedStack,
          context: sanitizedContext,
          firstOccurrence: now,
          timestamp: now,
          occurrenceCount: 1,
        })
        .onConflictDoUpdate({
          target: [errorLogs.level, errorLogs.source, errorLogs.message],
          targetWhere: sql`resolved = false`,
          set: {
            timestamp: now,
            // Clamp at INT32_MAX to match the ensureErrorLogColumns dedup
            // migration's rollup cap. Without this, a hot error bucket that
            // accumulates past 2,147,483,647 occurrences would overflow the
            // `integer` column on the next increment, Postgres would reject
            // the UPDATE, and the catch block below would silently disable
            // logging for this dedup key. Cast via bigint so the arithmetic
            // stays in range until the LEAST reduces it back to int.
            occurrenceCount: sql`LEAST(2147483647::bigint, ${errorLogs.occurrenceCount}::bigint + 1)::int`,
            stackTrace: sql`COALESCE(EXCLUDED.stack_trace, ${errorLogs.stackTrace})`,
            context: sql`COALESCE(EXCLUDED.context, ${errorLogs.context})`,
          },
        });
    } catch (dbError) {
      console.error(`[ErrorLogger] Failed to write log to database:`, dbError);
    }
  }

  static async error(source: LogSource, message: string, error?: Error | null, context?: Record<string, any> | null) {
    return ErrorLogger.log("error", source, message, error, context);
  }

  static async info(source: LogSource, message: string, context?: Record<string, any> | null) {
    return ErrorLogger.log("info", source, message, null, context);
  }
}
