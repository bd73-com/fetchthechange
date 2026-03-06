/**
 * Validates a Host header value against the REPLIT_DOMAINS allowlist.
 * Returns the validated host string, or null if the host is missing or not allowed.
 *
 * When REPLIT_DOMAINS is unset or empty (e.g. local dev), any host is accepted.
 */
export function validateHost(host: string | undefined): string | null {
  if (!host) return null;
  const allowed = process.env.REPLIT_DOMAINS?.split(",").map((d) => d.trim()).filter(Boolean) || [];
  if (allowed.length > 0 && !allowed.includes(host)) return null;
  return host;
}
