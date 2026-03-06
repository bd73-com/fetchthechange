/**
 * Validates a Host header value against the REPLIT_DOMAINS allowlist.
 * Returns the validated host string, or null if the host is missing or not allowed.
 *
 * When REPLIT_DOMAINS is unset or empty, only localhost/127.0.0.1 are accepted
 * (fail-closed to prevent host-header injection in production).
 */
export function validateHost(host: string | undefined): string | null {
  if (!host) return null;
  const normalizedHost = host.trim().toLowerCase();
  const allowed = (process.env.REPLIT_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);

  if (allowed.length === 0) {
    return /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(normalizedHost) ? normalizedHost : null;
  }

  return allowed.includes(normalizedHost) ? normalizedHost : null;
}
