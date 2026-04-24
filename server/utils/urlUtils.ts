/**
 * Safely extract hostname from a URL string for logging.
 *
 * User-supplied URLs can carry credentials in userinfo (`https://user:pw@host`)
 * or query-string (`?api_key=…`). Logging the hostname alone keeps enough
 * triage signal without leaking those secrets to Replit logs or error_logs.context.
 */
export function safeHostname(urlString: string): string {
  try {
    return new URL(urlString).hostname;
  } catch {
    return "unknown";
  }
}
