/**
 * Transient DB errors that are safe to retry (connection drops, pool exhaustion).
 * Checks both PostgreSQL error codes (stable across driver versions) and message
 * substrings (fallback for connection-level errors that lack a code).
 *
 * Shared between scheduler and scraper to ensure consistent transient classification.
 */
export function isTransientDbError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // PostgreSQL error codes: 08xxx = connection exceptions, 57P01 = admin shutdown
  const code = (err as any).code;
  if (typeof code === "string" && (/^08/.test(code) || code === "57P01")) return true;
  const msg = err.message.toLowerCase();
  return msg.includes("connection terminated")
    || msg.includes("connection timeout")
    || msg.includes("connection refused")
    || msg.includes("econnreset")
    || msg.includes("econnrefused")
    || msg.includes("cannot acquire")
    || msg.includes("timeout expired");
}
