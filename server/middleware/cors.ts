/**
 * CORS origin validation logic, extracted for testability.
 */

export const SENSITIVE_LOG_PATHS = ['/api/stripe/', '/api/admin/', '/api/callback', '/api/login', '/api/keys', '/api/extension/token', '/api/v1/monitors', '/api/v1/zapier/', '/api/v1/ping'];

type CorsCallback = (err: Error | null, allow?: boolean) => void;

export function createCorsOriginChecker(allowedOrigins: string[], isDev: boolean) {
  return (origin: string | undefined, callback: CorsCallback): void => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    // Allow Chrome extension origins — extension API routes use their own JWT
    // auth, so CORS here is defense-in-depth only. Matching a specific ID is
    // fragile (dev vs. published IDs differ), so accept the scheme itself.
    if (origin.startsWith("chrome-extension://")) return callback(null, true);
    if (isDev) {
      try {
        const { hostname, protocol } = new URL(origin);
        const normalizedHostname =
          hostname.startsWith("[") && hostname.endsWith("]")
            ? hostname.slice(1, -1)
            : hostname;
        if (
          protocol === "http:" &&
          (normalizedHostname === "localhost" || normalizedHostname === "127.0.0.1" || normalizedHostname === "::1")
        ) {
          return callback(null, true);
        }
      } catch {}
    }
    callback(new Error('Not allowed by CORS'));
  };
}
