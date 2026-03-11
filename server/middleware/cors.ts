/**
 * CORS origin validation logic, extracted for testability.
 */

export const SENSITIVE_LOG_PATHS = ['/api/stripe/', '/api/admin/', '/api/callback', '/api/login', '/api/keys'];

type CorsCallback = (err: Error | null, allow?: boolean) => void;

export function createCorsOriginChecker(allowedOrigins: string[], isDev: boolean) {
  return (origin: string | undefined, callback: CorsCallback): void => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    // Allow the specific Chrome extension origin (set CHROME_EXTENSION_ID env var)
    const extId = process.env.CHROME_EXTENSION_ID?.trim();
    if (extId && origin === `chrome-extension://${extId}`) return callback(null, true);
    if (isDev) {
      try {
        const { hostname, protocol } = new URL(origin);
        if (
          protocol === "http:" &&
          (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1")
        ) {
          return callback(null, true);
        }
      } catch {}
    }
    callback(new Error('Not allowed by CORS'));
  };
}
