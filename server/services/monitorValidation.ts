import { isPrivateUrl } from "../utils/ssrf";
import { validateCssSelector } from "./scraper";
import { storage } from "../storage";
import { TIER_LIMITS, FREQUENCY_TIERS, type UserTier } from "@shared/models/auth";

export interface MonitorValidationError {
  status: number;
  error: string;
  code: string;
}

/**
 * Validates that the user hasn't exceeded their tier's monitor limit.
 * Returns null if OK, or an error object if the limit is reached.
 */
export async function checkMonitorLimit(
  userId: string,
  tier: UserTier,
): Promise<MonitorValidationError | null> {
  const limit = TIER_LIMITS[tier] ?? TIER_LIMITS.free;
  const currentCount = await storage.getMonitorCount(userId);
  if (currentCount >= limit) {
    const limitStr = limit === Infinity ? "unlimited" : String(limit);
    return {
      status: 403,
      error: `You've reached your ${tier} plan limit of ${limitStr} monitors. Upgrade to add more.`,
      code: "TIER_LIMIT_REACHED",
    };
  }
  return null;
}

/**
 * Validates that the user's tier allows the requested check frequency.
 * Returns null if OK, or an error object if the frequency is not allowed.
 */
export function checkFrequencyTier(
  frequency: string | undefined,
  tier: UserTier,
): MonitorValidationError | null {
  if (!frequency || frequency === "daily") return null;
  const allowedTiers = FREQUENCY_TIERS[frequency as keyof typeof FREQUENCY_TIERS];
  if (!allowedTiers || !allowedTiers.includes(tier as any)) {
    return {
      status: 403,
      error: `The "${frequency}" check frequency requires a pro or power plan. Upgrade to use this frequency.`,
      code: "FREQUENCY_TIER_RESTRICTED",
    };
  }
  return null;
}

/**
 * Validates a monitor URL against SSRF and optionally validates the CSS selector.
 * Returns null if OK, or an error object describing the issue.
 */
export async function validateMonitorInput(
  url: string,
  selector?: string,
): Promise<MonitorValidationError | null> {
  const ssrfError = await isPrivateUrl(url);
  if (ssrfError) {
    return {
      status: 422,
      error: `URL blocked: ${ssrfError}`,
      code: "SSRF_BLOCKED",
    };
  }

  if (selector) {
    const selectorError = validateCssSelector(selector);
    if (selectorError) {
      return {
        status: 422,
        error: selectorError,
        code: "VALIDATION_ERROR",
      };
    }
  }

  return null;
}

/**
 * Safely extract hostname from a URL string for logging.
 */
export function safeHostname(urlString: string): string {
  try {
    return new URL(urlString).hostname;
  } catch {
    return "unknown";
  }
}
