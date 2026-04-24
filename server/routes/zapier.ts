import { Router } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { storage } from "../storage";
import { isPrivateUrl } from "../utils/ssrf";
import { ErrorLogger } from "../services/logger";
import {
  zapierSubscribeSchema,
  zapierUnsubscribeSchema,
  zapierChangesQuerySchema,
} from "@shared/routes";
import { AUTOMATION_SUBSCRIPTION_LIMITS } from "@shared/models/auth";
import { isEncryptionAvailable } from "../utils/encryption";

/** Maximum length for oldValue/newValue in Zapier responses (100KB, matching webhook payload). */
const MAX_VALUE_LENGTH = 100_000;
function truncateValue(v: string | null): string | null {
  if (v === null || v.length <= MAX_VALUE_LENGTH) return v;
  let end = MAX_VALUE_LENGTH;
  const code = v.charCodeAt(end - 1);
  if (code >= 0xD800 && code <= 0xDBFF) end--;
  return v.slice(0, end);
}

const router = Router();

// All Zapier endpoints require Power tier — API keys are a Power feature but
// a user could downgrade and retain a key, so enforce tier on every route.
router.use((req: any, res, next) => {
  if (req.apiUser?.tier !== "power") {
    return res.status(403).json({
      message: "Automation endpoints require a Power tier plan",
      code: "TIER_REQUIRED",
    });
  }
  next();
});

// Tighter rate limit for subscription management (10 per hour per user)
const subscribeRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: any) => {
    if (!req.apiUser?.id) {
      throw new Error("subscribeRateLimit: req.apiUser.id missing — tier middleware must run first");
    }
    return String(req.apiUser.id);
  },
  handler: (_req, res) => {
    res.status(429).json({
      message: "Too many subscription requests. Please try again later.",
      code: "RATE_LIMIT_EXCEEDED",
    });
  },
});

// POST /subscribe — Zapier calls this when a Zap is activated
router.post("/subscribe", subscribeRateLimit, async (req: any, res) => {
  try {
    const body = zapierSubscribeSchema.parse(req.body);

    // Refuse subscriptions when encryption key is unavailable — hook URLs are bearer tokens
    if (!isEncryptionAvailable()) {
      return res.status(503).json({
        message: "Automation subscriptions are temporarily unavailable (encryption not configured)",
        code: "ENCRYPTION_UNAVAILABLE",
      });
    }

    // SSRF check on hookUrl
    const ssrfError = await isPrivateUrl(body.hookUrl);
    if (ssrfError) {
      const hostname = new URL(body.hookUrl).hostname;
      await ErrorLogger.warning("api", "SSRF blocked on Zapier subscribe", {
        userId: req.apiUser.id,
        hookUrlHostname: hostname,
      });
      return res.status(422).json({ message: "Hook URL targets a private network", code: "SSRF_BLOCKED" });
    }

    // Enforce subscription limit (soft — concurrent requests may briefly exceed by 1-2;
    // the DB unique constraint prevents actual duplicates, and 25 is generous headroom)
    const activeCount = await storage.countActiveAutomationSubscriptions(req.apiUser.id);
    if (activeCount >= AUTOMATION_SUBSCRIPTION_LIMITS.maxPerUser) {
      return res.status(422).json({
        message: `Maximum of ${AUTOMATION_SUBSCRIPTION_LIMITS.maxPerUser} active automation subscriptions reached`,
        code: "SUBSCRIPTION_LIMIT_REACHED",
      });
    }

    // Verify monitor ownership if provided
    if (body.monitorId) {
      const monitor = await storage.getMonitor(body.monitorId);
      if (!monitor || monitor.userId !== req.apiUser.id) {
        return res.status(404).json({ message: "Monitor not found", code: "NOT_FOUND" });
      }
    }

    const subscription = await storage.createAutomationSubscription(
      req.apiUser.id,
      "zapier",
      body.hookUrl,
      body.monitorId ?? null,
    );

    // Post-create limit check to close the count-then-create race window
    const postCount = await storage.countActiveAutomationSubscriptions(req.apiUser.id);
    if (postCount > AUTOMATION_SUBSCRIPTION_LIMITS.maxPerUser) {
      await storage.deactivateAutomationSubscription(subscription.id, req.apiUser.id);
      return res.status(422).json({
        message: `Maximum of ${AUTOMATION_SUBSCRIPTION_LIMITS.maxPerUser} active automation subscriptions reached`,
        code: "SUBSCRIPTION_LIMIT_REACHED",
      });
    }

    await ErrorLogger.info("api", "Automation subscription created", {
      userId: req.apiUser.id,
      platform: "zapier",
      monitorId: body.monitorId ?? "all",
      subscriptionId: subscription.id,
    });

    res.status(201).json({
      id: subscription.id,
      monitorId: subscription.monitorId,
      createdAt: subscription.createdAt,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(422).json({ message: err.errors[0].message, code: "VALIDATION_ERROR" });
    }
    throw err;
  }
});

// DELETE /unsubscribe — Zapier calls this when a Zap is paused or deleted
router.delete("/unsubscribe", async (req: any, res) => {
  try {
    // Accept id from body (Zapier standard) or query param (fallback for proxies that strip DELETE bodies)
    const source = req.body && typeof req.body === "object" && req.body.id != null ? req.body : req.query;
    const body = zapierUnsubscribeSchema.parse(source);
    const deactivated = await storage.deactivateAutomationSubscription(body.id, req.apiUser.id);

    if (deactivated) {
      await ErrorLogger.info("api", "Automation subscription deactivated", {
        id: body.id,
        userId: req.apiUser.id,
        platform: "zapier",
      });
    }
    // Return 204 for idempotent unsubscribe — Zapier expects success even if already deactivated
    res.status(204).send();
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(422).json({ message: err.errors[0].message, code: "VALIDATION_ERROR" });
    }
    throw err;
  }
});

// GET /monitors — Used by Zapier to populate the "Monitor" dropdown
router.get("/monitors", async (req: any, res) => {
  const userMonitors = await storage.getMonitors(req.apiUser.id);
  res.json(
    userMonitors
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((m) => ({ id: m.id, name: m.name, url: m.url, active: m.active })),
  );
});

// GET /changes — Polling fallback for Zap testing.
// Returns raw changes without evaluating alert conditions because this is a
// Zapier test/sample endpoint. Conditions are evaluated at delivery time in
// deliverToAutomationSubscriptions, so production Zaps only fire when conditions pass.
router.get("/changes", async (req: any, res) => {
  try {
    const query = zapierChangesQuerySchema.parse(req.query);

    // Verify monitor ownership if provided
    if (query.monitorId) {
      const monitor = await storage.getMonitor(query.monitorId);
      if (!monitor || monitor.userId !== req.apiUser.id) {
        return res.status(404).json({ message: "Monitor not found", code: "NOT_FOUND" });
      }
    }

    // Get user's monitors to filter changes
    const userMonitors = await storage.getMonitors(req.apiUser.id);
    const monitorIds = query.monitorId
      ? [query.monitorId]
      : userMonitors.map((m) => m.id);

    if (monitorIds.length === 0) {
      return res.json([]);
    }

    const monitorMap = new Map(userMonitors.map((m) => [m.id, m]));

    const changes = await storage.getRecentChangesForMonitors(monitorIds, query.limit);

    const result = changes.map((c) => {
      const mon = monitorMap.get(c.monitorId);
      return {
        id: c.id,
        event: "change.detected",
        monitorId: c.monitorId,
        monitorName: mon?.name ?? "Unknown",
        url: mon?.url ?? "",
        oldValue: truncateValue(c.oldValue),
        newValue: truncateValue(c.newValue),
        detectedAt: c.detectedAt.toISOString(),
        timestamp: c.detectedAt.toISOString(),
      };
    });

    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(422).json({ message: err.errors[0].message, code: "VALIDATION_ERROR" });
    }
    throw err;
  }
});

export default router;
