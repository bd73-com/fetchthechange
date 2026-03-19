export function escapeAttr(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Keep in sync with shared/models/auth.ts TIER_LIMITS
const KNOWN_TIERS = ["free", "pro", "power"];
export function sanitizeTier(tier: string): string {
  return KNOWN_TIERS.includes(tier) ? tier : "free";
}
