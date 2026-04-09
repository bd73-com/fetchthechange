import { Router } from "express";
import { z } from "zod";
import { isAuthenticated } from "../replit_integrations/auth";
import { authStorage } from "../replit_integrations/auth/storage";
import { extensionAuth } from "../middleware/extensionAuth";
import { createMonitorRateLimiter } from "../middleware/rateLimiter";
import { sign as signExtensionToken, getExpiresAt as getExtensionTokenExpiresAt } from "../utils/extensionToken";
import { storage } from "../storage";
import { api } from "@shared/routes";
import type { UserTier } from "@shared/models/auth";
import {
  checkMonitorLimit,
  checkFrequencyTier,
  validateMonitorInput,
  safeHostname,
} from "../services/monitorValidation";
import { checkMonitor as scraperCheckMonitor } from "../services/scraper";
import { seedDefaultEmailChannel } from "../services/notification";

async function checkMonitor(monitor: any) {
  console.log(`Checking monitor ${monitor.id}: ${monitor.url}`);
  return scraperCheckMonitor(monitor);
}

const router = Router();

// POST /api/extension/token — issue JWT for the logged-in user (session auth)
router.post("/token", isAuthenticated, async (req: any, res) => {
  try {
    const userId = req.user.claims.sub;

    // DB lookup for tier — non-fatal so token generation works even
    // when the database is slow or timing out.
    let tier = "free";
    try {
      const user = await authStorage.getUser(userId);
      tier = (user?.tier || "free") as string;
    } catch (dbErr) {
      console.warn("[Extension] DB lookup failed, defaulting to free tier:",
        dbErr instanceof Error ? dbErr.message : String(dbErr));
    }

    const token = signExtensionToken(userId, tier);
    const expiresAt = getExtensionTokenExpiresAt();

    res.json({ token, expiresAt });
  } catch (error: any) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[Extension] Failed to issue token:", detail);
    res.status(500).json({ message: "Failed to generate extension token", detail });
  }
});

// GET /api/extension/verify — validate stored token from extension
router.get("/verify", extensionAuth, async (req: any, res) => {
  try {
    const { id: userId, tier } = req.extensionUser!;
    const user = await authStorage.getUser(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found", code: "USER_NOT_FOUND" });
    }
    res.json({ userId, tier: user.tier || tier, email: user.email || "" });
  } catch (error: any) {
    console.error("[Extension] Verify error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// POST /api/extension/monitors — create monitor from extension
router.post("/monitors", extensionAuth, createMonitorRateLimiter, async (req: any, res) => {
  try {
    const { id: userId, tier: tokenTier } = req.extensionUser!;

    // Fetch fresh user data for tier (may have changed since token was issued)
    const user = await authStorage.getUser(userId);
    const tier = (user?.tier || tokenTier || "free") as UserTier;

    // Tier limit check
    const limitErr = await checkMonitorLimit(userId, tier);
    if (limitErr) {
      return res.status(limitErr.status).json({
        message: limitErr.error,
        code: limitErr.code,
      });
    }

    // Validate input
    const input = api.monitors.create.input.parse(req.body);

    // Frequency tier check
    const freqErr = checkFrequencyTier(input.frequency, tier);
    if (freqErr) {
      return res.status(freqErr.status).json({ message: freqErr.error, code: freqErr.code });
    }

    // SSRF + CSS selector validation
    const validationErr = await validateMonitorInput(input.url, input.selector);
    if (validationErr) {
      if (validationErr.code === "SSRF_BLOCKED") {
        console.warn(`[Extension] SSRF blocked for userId=${userId}, hostname=${safeHostname(input.url)}`);
      }
      return res.status(validationErr.status).json({ message: validationErr.error, code: validationErr.code });
    }

    const monitor = await storage.createMonitor({
      ...input,
      userId,
    } as any);

    // Seed default email channel (mirrors server/routes.ts monitor creation)
    await seedDefaultEmailChannel(monitor.id);

    // Run first check asynchronously
    checkMonitor(monitor).catch(console.error);

    console.log(`[Extension] Monitor created userId=${userId}, monitorId=${monitor.id}, hostname=${safeHostname(input.url)}`);

    res.status(201).json(monitor);
  } catch (error: any) {
    if (error.name === "ZodError") {
      return res.status(400).json({ message: "Invalid input", errors: error.errors });
    }
    console.error("[Extension] Monitor creation error:", error);
    res.status(500).json({ message: "Failed to create monitor" });
  }
});

export default router;
