/**
 * Transient DB errors that are safe to retry (connection drops, pool exhaustion).
 * Checks both PostgreSQL error codes (stable across driver versions) and message
 * substrings (fallback for connection-level errors that lack a code).
 *
 * Shared between scheduler and scraper to ensure consistent transient classification.
 */
export function isTransientDbError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // PostgreSQL error codes: 08xxx = connection exceptions, 57P01 = admin shutdown,
  // 57P03 = cannot_connect_now, 53300 = too_many_connections (pool exhaustion)
  const code = (err as any).code;
  if (typeof code === "string" && (/^08/.test(code) || ["57P01", "57P03", "53300"].includes(code))) return true;
  const msg = err.message.toLowerCase();
  return msg.includes("connection terminated")
    || msg.includes("connection timeout")
    || msg.includes("connection refused")
    || msg.includes("econnreset")
    || msg.includes("econnrefused")
    || msg.includes("cannot acquire")
    || msg.includes("timeout expired")
    || msg.includes("too many clients")
    || msg.includes("remaining connection slots");
}
