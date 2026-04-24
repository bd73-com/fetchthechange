import rateLimit from "express-rate-limit";
import type { Request, Response, NextFunction } from "express";
import { authStorage } from "../replit_integrations/auth/storage";
import { type UserTier } from "@shared/models/auth";

async function getUserTier(userId: string): Promise<UserTier> {
  try {
    const user = await authStorage.getUser(userId);
    return (user?.tier || "free") as UserTier;
  } catch (err) {
    console.warn("[RateLimiter] DB lookup failed, defaulting to free tier:",
      err instanceof Error ? err.message : String(err));
    return "free";
  }
}

interface TierConfig {
  max: number;
  windowMs: number;
}

interface TieredRateLimiterConfig {
  free: TierConfig;
  pro: TierConfig;
  power: TierConfig;
  message: string;
  keyGenerator?: (req: any) => string;
}

const limiters = new Map<string, ReturnType<typeof rateLimit>>();

function getOrCreateLimiter(key: string, config: TierConfig, message: string, tier: string, keyGen: (req: any) => string) {
  const cacheKey = `${key}:${tier}`;
  if (!limiters.has(cacheKey)) {
    limiters.set(cacheKey, rateLimit({
      windowMs: config.windowMs,
      max: config.max,
      standardHeaders: true,
      legacyHeaders: true,
      keyGenerator: keyGen,
      handler: (_req, res) => {
        res.status(429).json({
          message,
          retryAfter: Math.ceil(config.windowMs / 1000),
          tier,
          upgradeUrl: tier === "free" ? "/pricing" : undefined
        });
      }
    }));
  }
  return limiters.get(cacheKey)!;
}

/**
 * Extracts userId from either session auth (req.user.claims.sub) or
 * extension JWT auth (req.extensionUser.id).
 */
function resolveUserId(req: any): string | null {
  if (req.extensionUser?.id) return req.extensionUser.id;
  if (req.user?.claims?.sub) return req.user.claims.sub;
  return null;
}

function createTieredRateLimiter(name: string, config: TieredRateLimiterConfig) {
  return async (req: any, res: Response, next: NextFunction) => {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const tier = await getUserTier(userId);
    const tierConfig = config[tier];

    // Use userId (already validated above) as fallback to avoid a shared "unknown" bucket
    const keyGen = config.keyGenerator || ((r: any) => resolveUserId(r) || `anon:${r.ip}`);
    const limiter = getOrCreateLimiter(name, tierConfig, config.message, tier, keyGen);

    return limiter(req, res, next);
  };
}

export const generalRateLimiter = createTieredRateLimiter("general", {
  free: { max: 30, windowMs: 60 * 1000 },
  pro: { max: 120, windowMs: 60 * 1000 },
  power: { max: 300, windowMs: 60 * 1000 },
  message: "Too many requests. Please try again later."
});

export const createMonitorRateLimiter = createTieredRateLimiter("createMonitor", {
  free: { max: 3, windowMs: 60 * 60 * 1000 },
  pro: { max: 30, windowMs: 60 * 60 * 1000 },
  power: { max: 100, windowMs: 60 * 60 * 1000 },
  message: "Too many monitor creation attempts. Please try again later."
});

export const checkMonitorRateLimiter = createTieredRateLimiter("checkMonitor", {
  free: { max: 1, windowMs: 24 * 60 * 60 * 1000 },
  pro: { max: 100, windowMs: 60 * 60 * 1000 },
  power: { max: 500, windowMs: 60 * 60 * 1000 },
  message: "Free tier: You can check each monitor once per 24 hours. Upgrade to Pro for more frequent checks.",
  keyGenerator: (req: any) => {
    const userId = resolveUserId(req) || `anon:${req.ip}`;
    const monitorId = req.params.id;
    return `${userId}:${monitorId}`;
  }
});

export const suggestSelectorsRateLimiter = createTieredRateLimiter("suggestSelectors", {
  free: { max: 3, windowMs: 24 * 60 * 60 * 1000 },
  pro: { max: 20, windowMs: 60 * 60 * 1000 },
  power: { max: 100, windowMs: 60 * 60 * 1000 },
  message: "Free tier: Limited selector suggestions per day. Upgrade to Pro for more."
});

export const emailUpdateRateLimiter = createTieredRateLimiter("emailUpdate", {
  free: { max: 5, windowMs: 60 * 60 * 1000 },
  pro: { max: 5, windowMs: 60 * 60 * 1000 },
  power: { max: 5, windowMs: 60 * 60 * 1000 },
  message: "Too many email update attempts. Please try again later."
});

// Caps per-user request volume on the admin error-log endpoints. Each call
// runs a 500-row SELECT + JS ownership filter (see #465); without a bucket a
// single Power-tier account with N browser tabs amplifies the badge poller
// into N concurrent scans every 30s. 60/min easily covers legitimate manual
// use (multiple tabs + mutation invalidations) while keeping DB load bounded.
export const adminErrorLogsRateLimiter = createTieredRateLimiter("adminErrorLogs", {
  free: { max: 60, windowMs: 60 * 1000 },
  pro: { max: 60, windowMs: 60 * 1000 },
  power: { max: 60, windowMs: 60 * 1000 },
  message: "Too many admin error-log requests. Please slow down."
});

export const contactFormRateLimiter = createTieredRateLimiter("contactForm", {
  free: { max: 3, windowMs: 60 * 60 * 1000 },
  pro: { max: 5, windowMs: 60 * 60 * 1000 },
  power: { max: 10, windowMs: 60 * 60 * 1000 },
  message: "Too many support requests. Please try again later."
});

export const unauthenticatedRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: true,
  handler: (_req, res) => {
    res.status(429).json({
      message: "Too many requests. Please try again later.",
      retryAfter: 60
    });
  }
});
