/**
 * Derive the application's public URL from environment variables.
 * Falls back to the legacy Replit domain when REPLIT_DOMAINS is unset.
 */
export function getAppUrl(): string {
  const domains = process.env.REPLIT_DOMAINS?.split(",")[0];
  return domains ? `https://${domains}` : "https://fetch-the-change.replit.app";
}
