import { Router } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { isPrivateUrl } from "../utils/ssrf";
import { ErrorLogger } from "../services/logger";
import {
  zapierSubscribeSchema,
  zapierUnsubscribeSchema,
  zapierChangesQuerySchema,
} from "@shared/routes";
import { AUTOMATION_SUBSCRIPTION_LIMITS } from "@shared/models/auth";
import { monitorChanges } from "@shared/schema";
import { db } from "../db";
import { eq, desc, and, inArray } from "drizzle-orm";

const router = Router();

// POST /subscribe — Zapier calls this when a Zap is activated
router.post("/subscribe", async (req: any, res) => {
  try {
    const body = zapierSubscribeSchema.parse(req.body);

    // SSRF check on hookUrl
    const ssrfError = await isPrivateUrl(body.hookUrl);
    if (ssrfError) {
      const hostname = new URL(body.hookUrl).hostname;
      await ErrorLogger.warning("api", "SSRF blocked on Zapier subscribe", {
        userId: req.apiUser.id,
        hookUrlHostname: hostname,
      });
      return res.status(422).json({ error: "Hook URL targets a private network", code: "SSRF_BLOCKED" });
    }

    // Enforce subscription limit
    const activeCount = await storage.countActiveAutomationSubscriptions(req.apiUser.id);
    if (activeCount >= AUTOMATION_SUBSCRIPTION_LIMITS.maxPerUser) {
      return res.status(422).json({
        error: `Maximum of ${AUTOMATION_SUBSCRIPTION_LIMITS.maxPerUser} active automation subscriptions reached`,
        code: "SUBSCRIPTION_LIMIT_REACHED",
      });
    }

    // Verify monitor ownership if provided
    if (body.monitorId) {
      const monitor = await storage.getMonitor(body.monitorId);
      if (!monitor || monitor.userId !== req.apiUser.id) {
        return res.status(404).json({ error: "Monitor not found", code: "NOT_FOUND" });
      }
    }

    const subscription = await storage.createAutomationSubscription(
      req.apiUser.id,
      "zapier",
      body.hookUrl,
      body.monitorId ?? null,
    );

    const hookUrlDomain = new URL(body.hookUrl).hostname;
    await ErrorLogger.info("api", "Automation subscription created", {
      userId: req.apiUser.id,
      platform: "zapier",
      monitorId: body.monitorId ?? "all",
      hookUrlDomain,
    });

    res.status(201).json({
      id: subscription.id,
      monitorId: subscription.monitorId,
      createdAt: subscription.createdAt,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(422).json({ error: err.errors[0].message, code: "VALIDATION_ERROR" });
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
    if (!deactivated) {
      return res.status(404).json({ error: "Subscription not found", code: "NOT_FOUND" });
    }

    await ErrorLogger.info("api", "Automation subscription deactivated", {
      id: body.id,
      userId: req.apiUser.id,
      platform: "zapier",
    });

    res.status(204).send();
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(422).json({ error: err.errors[0].message, code: "VALIDATION_ERROR" });
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

// GET /changes — Polling fallback for Zap testing
router.get("/changes", async (req: any, res) => {
  try {
    const query = zapierChangesQuerySchema.parse(req.query);

    // Verify monitor ownership if provided
    if (query.monitorId) {
      const monitor = await storage.getMonitor(query.monitorId);
      if (!monitor || monitor.userId !== req.apiUser.id) {
        return res.status(404).json({ error: "Monitor not found", code: "NOT_FOUND" });
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

    const changes = await db.select().from(monitorChanges)
      .where(
        monitorIds.length === 1
          ? eq(monitorChanges.monitorId, monitorIds[0])
          : inArray(monitorChanges.monitorId, monitorIds),
      )
      .orderBy(desc(monitorChanges.detectedAt))
      .limit(query.limit);

    const result = changes.map((c) => {
      const mon = monitorMap.get(c.monitorId);
      return {
        id: c.id,
        monitorId: c.monitorId,
        monitorName: mon?.name ?? "Unknown",
        url: mon?.url ?? "",
        oldValue: c.oldValue,
        newValue: c.newValue,
        detectedAt: c.detectedAt.toISOString(),
        timestamp: c.detectedAt.toISOString(),
      };
    });

    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(422).json({ error: err.errors[0].message, code: "VALIDATION_ERROR" });
    }
    throw err;
  }
});

export default router;
