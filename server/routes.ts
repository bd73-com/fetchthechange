import { checkMonitor as scraperCheckMonitor, extractWithBrowserless, detectPageBlockReason, discoverSelectors, validateCssSelector, extractValueFromHtml } from "./services/scraper";
import { getResendClient } from "./services/resendClient";
import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api, channelTypeSchema, webhookConfigInputSchema, slackConfigInputSchema, createTagSchema, updateTagSchema, setMonitorTagsSchema, createConditionSchema, ERROR_LOG_SOURCES, errorLogSourceSchema } from "@shared/routes";
import { isSafeRegex } from "./services/conditions";
import { z } from "zod";
import { setupAuth, registerAuthRoutes, isAuthenticated } from "./replit_integrations/auth";
import { authStorage } from "./replit_integrations/auth/storage";
import { TIER_LIMITS, TAG_LIMITS, TAG_ASSIGNMENT_LIMITS, BROWSERLESS_CAPS, RESEND_CAPS, PAUSE_THRESHOLDS, type UserTier } from "@shared/models/auth";
// startScheduler is called from index.ts after registerRoutes completes
import * as cheerio from "cheerio";
import { getUncachableStripeClient, getStripePublishableKey } from "./stripeClient";
import { sql, asc, desc, eq, and, isNull, isNotNull, inArray, notInArray } from "drizzle-orm";
import { db } from "./db";
import { sendNotificationEmail } from "./services/email";
import { ErrorLogger } from "./services/logger";
import { notificationTablesExist, channelTablesExist } from "./services/notificationReady";
import { seedDefaultEmailChannel } from "./services/notification";
import { BrowserlessUsageTracker, getMonthResetDate } from "./services/browserlessTracker";
import { ResendUsageTracker, getResendResetDate } from "./services/resendTracker";
import { errorLogs, monitorMetrics, monitors } from "@shared/schema";
import {
  generalRateLimiter,
  createMonitorRateLimiter,
  checkMonitorRateLimiter,
  suggestSelectorsRateLimiter,
  emailUpdateRateLimiter,
  contactFormRateLimiter,
  unauthenticatedRateLimiter
} from "./middleware/rateLimiter";
import { generateWebhookSecret, redactSecret } from "./services/webhookDelivery";
import { listChannels as listSlackChannels } from "./services/slackDelivery";
import { encryptToken, decryptToken, isValidEncryptedToken } from "./utils/encryption";
import { validateHost } from "./utils/hostValidation";
import { createHmac } from "node:crypto";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { ensureErrorLogColumns, ensureApiKeysTable, ensureChannelTables, ensureTagTables, ensureMonitorHealthColumns, ensureMonitorConditionsTable, ensureNotificationQueueColumns, ensureAutomatedCampaignConfigsTable, ensureMonitorPendingRetryColumn, ensureAutomationSubscriptionsTable, ensureMonitorChangesIndexes } from "./services/ensureTables";


// ------------------------------------------------------------------
// URL VALIDATION - SSRF PROTECTION (shared module)
// ------------------------------------------------------------------
import { isPrivateUrl, ssrfSafeFetch } from './utils/ssrf';
import { checkFrequencyTier } from './services/monitorValidation';

// ------------------------------------------------------------------
// 1. CHECK MONITOR FUNCTION
// ------------------------------------------------------------------
async function checkMonitor(monitor: any) {
  console.log(`Checking monitor ${monitor.id}: ${monitor.url}`);
  return scraperCheckMonitor(monitor);
}

let softDeleteCleanupInterval: ReturnType<typeof setInterval> | null = null;

/** Clear the soft-delete cleanup interval. Call during graceful shutdown. */
export function stopRouteTimers(): void {
  if (softDeleteCleanupInterval) {
    clearInterval(softDeleteCleanupInterval);
    softDeleteCleanupInterval = null;
  }
}

// ------------------------------------------------------------------
// 3. ROUTE REGISTRATION
// ------------------------------------------------------------------
export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<{ httpServer: Server; campaignConfigsReady: boolean }> {

  const healthColumnsReady = await ensureMonitorHealthColumns();
  if (!healthColumnsReady) {
    console.error("CRITICAL: Monitor health columns missing — health alerts and recovery emails will be disabled");
  }
  const pendingRetryReady = await ensureMonitorPendingRetryColumn();
  if (!pendingRetryReady) {
    console.error("CRITICAL: monitors.pending_retry_at column missing — auto-retry scheduling will fail");
  }
  await ensureErrorLogColumns();
  const apiKeysReady = await ensureApiKeysTable();
  await ensureChannelTables();
  await ensureMonitorChangesIndexes();
  const notificationQueueReady = await ensureNotificationQueueColumns();
  if (!notificationQueueReady) {
    console.error("CRITICAL: notification_queue columns missing — notification cron queries will fail");
  }
  await ensureTagTables();
  const automationSubsReady = await ensureAutomationSubscriptionsTable();
  if (!automationSubsReady) {
    console.error("CRITICAL: automation_subscriptions table missing — Zapier endpoints and automation delivery will fail");
  }
  let campaignConfigsReady = await ensureAutomatedCampaignConfigsTable();
  if (!campaignConfigsReady) {
    console.error("CRITICAL: automated_campaign_configs table missing — campaign bootstrap and admin routes will fail");
  }
  // Per-route 503 guard (not conditional registration like apiKeysReady)
  // because condition routes are inline — 503 gives clients a clear retry signal.
  // Lazy retry: if startup fails (transient DB error), first request retries once.
  let conditionsReady = await ensureMonitorConditionsTable();
  let conditionsReadyProbe: Promise<boolean> | null = null;
  async function requireConditionsReady(res: any): Promise<boolean> {
    if (!conditionsReady) {
      conditionsReadyProbe ??= ensureMonitorConditionsTable()
        .then((ready) => {
          if (ready) conditionsReady = true;
          return conditionsReady;
        })
        .finally(() => {
          conditionsReadyProbe = null;
        });
      await conditionsReadyProbe;
    }
    if (!conditionsReady) {
      res.status(503).json({ message: "Conditions not available", code: "SERVICE_UNAVAILABLE" });
      return false;
    }
    return true;
  }

  // Lazy retry guard for automated campaign configs table (mirrors requireConditionsReady)
  let campaignConfigsReadyProbe: Promise<boolean> | null = null;
  async function requireCampaignConfigsReady(res: any): Promise<boolean> {
    if (!campaignConfigsReady) {
      campaignConfigsReadyProbe ??= ensureAutomatedCampaignConfigsTable()
        .then((ready) => {
          if (ready) campaignConfigsReady = true;
          return campaignConfigsReady;
        })
        .finally(() => {
          campaignConfigsReadyProbe = null;
        });
      await campaignConfigsReadyProbe;
    }
    if (!campaignConfigsReady) {
      res.status(503).json({ message: "Campaign configs not available", code: "SERVICE_UNAVAILABLE" });
      return false;
    }
    return true;
  }

  // Setup Auth (must be before rate limiter so req.user is populated)
  await setupAuth(app);

  // Apply general rate limiting to all API routes (after auth so req.user is available)
  app.use("/api/", async (req: any, res: Response, next: NextFunction) => {
    if (req.user) {
      return generalRateLimiter(req, res, next);
    }
    return unauthenticatedRateLimiter(req, res, next);
  });

  registerAuthRoutes(app);

  // Validate :id route params — reject non-numeric IDs with 400 instead of
  // letting NaN propagate into DB queries and causing 500 errors (#346).
  // NOTE: This only covers routes registered directly on `app`. Sub-routers
  // (v1, extension, keys) must validate IDs themselves (v1 uses parseId()).
  app.param("id", (req, res, next, value) => {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) {
      return res.status(400).json({ message: "Invalid ID parameter" });
    }
    next();
  });

  // Scheduler startup is deferred to index.ts (after registerRoutes completes)
  // to avoid DB pool exhaustion during migrations.

  // Welcome campaign bootstrap is deferred to index.ts (after registerRoutes completes)
  // to avoid DB pool exhaustion during cold starts.

  // Debug Browserless Endpoint (admin-only, SSRF-validated)
  app.post("/api/debug/browserless", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await authStorage.getUser(userId);
      if (!user || user.tier !== "power") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { url, selector } = req.body;
      if (!url || !selector) {
        return res.status(400).json({ message: "URL and Selector are required" });
      }

      const urlError = await isPrivateUrl(url);
      if (urlError) {
        return res.status(400).json({ message: urlError });
      }

      console.log(`[Debug] Running Browserless extraction for: ${url}`);
      const result = await extractWithBrowserless(url, selector);

      res.json({
        urlAfter: result.urlAfter,
        title: result.title,
        selectorCount: result.selectorCount,
        extractedValue: result.value
      });
    } catch (error: any) {
      console.error("[Debug] Browserless endpoint error:", error);
      res.status(500).json({ message: "Browserless extraction failed" });
    }
  });

  // Test Email Endpoint - verifies Resend email delivery
  app.post("/api/test-email", isAuthenticated, emailUpdateRateLimiter, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await authStorage.getUser(userId);
      
      if (!user || !user.email) {
        return res.status(400).json({ 
          success: false, 
          message: "No email address found for your account" 
        });
      }

      // Create a mock monitor for the test email
      const testMonitor = {
        id: 0,
        userId: userId,
        name: "Test Monitor",
        url: "https://example.com/test-page",
        selector: "div.test-selector",
        frequency: "daily" as const,
        lastChecked: new Date(),
        lastChanged: new Date(),
        currentValue: "New Test Value",
        lastStatus: "ok" as const,
        lastError: null,
        active: true,
        emailEnabled: true,
        consecutiveFailures: 0,
        pauseReason: null,
        healthAlertSentAt: null,
        lastHealthyAt: null,
        pendingRetryAt: null,
        createdAt: new Date()
      };

      const maskedEmail = user.email
        ? (user.email.includes('@')
          ? user.email.replace(/^(.)(.*)(@.*)$/, (_, first: string, middle: string, domain: string) => first + '*'.repeat(Math.max(middle.length, 1)) + domain)
          : '[redacted]')
        : 'unknown';
      console.log(`[Test Email] Sending test email to ${maskedEmail}`);
      const result = await sendNotificationEmail(testMonitor, "Old Test Value", "New Test Value");
      
      if (result.success) {
        res.json({ 
          success: true, 
          message: `Test email sent to ${user.email}. Please check your inbox (and spam folder).`,
          resendEmailId: result.id,
          details: {
            to: result.to,
            from: result.from,
            apiKeyConfigured: !!process.env.RESEND_API_KEY
          }
        });
      } else {
        res.status(400).json({
          success: false,
          message: `Failed to send email: ${result.error}`,
          details: {
            to: result.to || user.email,
            from: result.from || process.env.RESEND_FROM || 'onboarding@resend.dev',
            apiKeyConfigured: !!process.env.RESEND_API_KEY,
            error: result.error
          }
        });
      }
    } catch (error: any) {
      console.error("[Test Email] Error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to send test email",
        details: {
          apiKeyConfigured: !!process.env.RESEND_API_KEY
        }
      });
    }
  });

  // Selector Debug Mode Endpoint
  app.post("/api/monitors/:id/debug", isAuthenticated, suggestSelectorsRateLimiter, async (req: any, res) => {
    try {
      const id = Number(req.params.id);
      console.log(`[Debug] monitorId=${id}`);
      const monitor = await storage.getMonitor(id);
      if (!monitor) return res.status(404).json({ message: "Not found" });
      if (String(monitor.userId) !== String(req.user.claims.sub)) {
        return res.status(403).json({ message: "Forbidden" });
      }

      // Static Phase (uses ssrfSafeFetch to validate URL at fetch time)
      let staticHtml = "";
      try {
        const response = await ssrfSafeFetch(monitor.url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Cache-Control': 'no-cache',
            'Upgrade-Insecure-Requests': '1'
          },
          signal: AbortSignal.timeout(15000)
        });
        staticHtml = await response.text();
      } catch (e) {}
      
      const staticBlock = staticHtml ? detectPageBlockReason(staticHtml) : { blocked: true, reason: "Fetch failed" };
      const $static = cheerio.load(staticHtml || "");
      const trimmedSelector = monitor.selector.trim();
      const isClassName = !trimmedSelector.startsWith('.') && !trimmedSelector.startsWith('#') && !trimmedSelector.includes(' ');
      const effectiveSelector = isClassName ? `.${trimmedSelector}` : trimmedSelector;
      const staticCount = $static(effectiveSelector).length;

      // Rendered Phase
      let rendered: any = { used: false };
      if (process.env.BROWSERLESS_TOKEN) {
        try {
          const result = await extractWithBrowserless(monitor.url, monitor.selector, monitor.id, monitor.name);
          rendered = {
            used: true,
            blocked: result.blocked,
            reason: result.reason || null,
            selectorCount: result.selectorCount,
            finalUrl: result.urlAfter,
            title: result.title
          };
        } catch (e: any) {
          rendered = { used: true, blocked: true, reason: e.message };
        }
      }

      res.json({
        url: monitor.url,
        selector: monitor.selector,
        static: {
          blocked: staticBlock.blocked,
          reason: staticBlock.reason || null,
          selectorCount: staticCount
        },
        rendered
      });
    } catch (error: any) {
      console.error("[Debug] Selector debug endpoint error:", error);
      res.status(500).json({ message: "Selector debug failed" });
    }
  });

  // Selector suggestion endpoint
  app.post("/api/monitors/:id/suggest-selectors", isAuthenticated, suggestSelectorsRateLimiter, async (req: any, res) => {
    try {
      const id = Number(req.params.id);
      const { expectedText } = req.body || {};
      console.log(`[Suggest] monitorId=${id} expectedText="${expectedText || '(none)'}"`)
      
      const monitor = await storage.getMonitor(id);
      if (!monitor) return res.status(404).json({ message: "Not found" });
      if (String(monitor.userId) !== String(req.user.claims.sub)) {
        return res.status(403).json({ message: "Forbidden" });
      }
      
      if (!process.env.BROWSERLESS_TOKEN) {
        return res.status(400).json({ message: "BROWSERLESS_TOKEN not configured" });
      }

      const result = await discoverSelectors(monitor.url, monitor.selector, expectedText);
      console.log(`[Suggest] monitorId=${id} suggestions=${result.suggestions.length}`);
      res.json(result);
    } catch (error: any) {
      console.error("[Suggest] Selector suggestion error:", error);
      console.error("[Suggest] Error details:", {
        name: error.name,
        message: error.message,
        stack: error.stack?.substring(0, 500)
      });
      const errorMessage = error.message || "";
      if (errorMessage.includes("Playwright") || errorMessage.includes("connectOverCDP") || errorMessage.includes("browser") || errorMessage.includes("websocket")) {
        return res.status(503).json({ 
          message: "Browser automation service is temporarily unavailable. Please try again later.",
          code: "BROWSERLESS_UNAVAILABLE"
        });
      }
      if (errorMessage.includes("timeout") || errorMessage.includes("Timeout") || errorMessage.includes("ETIMEDOUT")) {
        return res.status(504).json({ 
          message: "The page took too long to load. Please try again.",
          code: "TIMEOUT"
        });
      }
      if (errorMessage.includes("Target page, context or browser has been closed")) {
        return res.status(503).json({ 
          message: "Browser session ended unexpectedly. Please try again.",
          code: "BROWSER_CLOSED"
        });
      }
      res.status(500).json({ message: "Failed to analyze page. Please try again." });
    }
  });

  // Monitors API

  app.get(api.monitors.list.path, isAuthenticated, async (req: any, res) => {
    const userId = req.user.claims.sub;
    const monitors = await storage.getMonitorsWithTags(userId);
    res.json(monitors);
  });

  app.get(api.monitors.get.path, isAuthenticated, async (req: any, res) => {
    const monitor = await storage.getMonitorWithTags(Number(req.params.id));
    if (!monitor) return res.status(404).json({ message: "Not found" });
    if (String(monitor.userId) !== String(req.user.claims.sub)) return res.status(403).json({ message: "Forbidden" });
    res.json(monitor);
  });

  app.post(api.monitors.create.path, isAuthenticated, createMonitorRateLimiter, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      
      // Check tier limits
      const user = await authStorage.getUser(userId);
      const tier = (user?.tier || "free") as UserTier;
      const limit = TIER_LIMITS[tier] ?? TIER_LIMITS.free;
      const currentCount = await storage.getMonitorCount(userId);
      
      if (currentCount >= limit) {
        const limitStr = limit === Infinity ? "unlimited" : String(limit);
        return res.status(403).json({ 
          message: `You've reached your ${tier} plan limit of ${limitStr} monitors. Upgrade to add more.`,
          code: "TIER_LIMIT_REACHED",
          tier,
          limit: limit === Infinity ? -1 : limit,
          currentCount
        });
      }
      
      const input = api.monitors.create.input.parse(req.body);

      // Frequency tier check
      const freqErr = checkFrequencyTier(input.frequency, tier);
      if (freqErr) {
        return res.status(freqErr.status).json({ message: freqErr.error, code: freqErr.code });
      }

      const urlError = await isPrivateUrl(input.url);
      if (urlError) {
        return res.status(400).json({ message: urlError });
      }

      if (input.selector) {
        const selectorError = validateCssSelector(input.selector);
        if (selectorError) {
          return res.status(400).json({ message: selectorError });
        }
      }

      const monitor = await storage.createMonitor({
        ...input,
        userId,
      } as any);

      // Seed default email channel so the notification dispatcher always has an
      // explicit channel row. Without this, adding a second channel (e.g. Slack)
      // later would bypass the legacy emailEnabled fallback and silently skip email.
      await seedDefaultEmailChannel(monitor.id);

      // Run the first check asynchronously but capture a quick static validation
      // to return an early warning to the user if the selector is likely wrong.
      checkMonitor(monitor).catch(console.error);

      // Quick static pre-check: fetch the page and test the selector without Browserless.
      // This is best-effort and doesn't block monitor creation.
      let selectorWarning: string | undefined;
      try {
        const preCheckResponse = await ssrfSafeFetch(input.url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          },
          signal: AbortSignal.timeout(8000),
        });
        const preCheckHtml = await preCheckResponse.text();
        const block = detectPageBlockReason(preCheckHtml);
        if (block.blocked) {
          selectorWarning = `The page appears to be blocking automated access (${block.reason}). The monitor may need Browserless rendering to work.`;
        } else {
          const testValue = extractValueFromHtml(preCheckHtml, input.selector);
          if (!testValue) {
            selectorWarning = "The CSS selector didn't match any elements on the page's static HTML. It may work after JavaScript rendering, or the selector may need adjusting.";
          }
        }
      } catch {
        // Pre-check is best-effort; don't block creation
      }

      res.status(201).json({ ...monitor, selectorWarning });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message, code: "VALIDATION_ERROR" });
      }
      throw err;
    }
  });

  app.patch(api.monitors.update.path, isAuthenticated, async (req: any, res) => {
    const id = Number(req.params.id);
    const existing = await storage.getMonitor(id);
    if (!existing) return res.status(404).json({ message: "Not found" });
    if (String(existing.userId) !== String(req.user.claims.sub)) return res.status(403).json({ message: "Forbidden" });

    let input;
    try {
      input = api.monitors.update.input.parse(req.body);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message, code: "VALIDATION_ERROR" });
      }
      throw err;
    }

    if (Object.keys(input).length === 0) {
      return res.status(400).json({ message: "At least one field is required", code: "VALIDATION_ERROR" });
    }

    // Frequency tier check
    if (input.frequency) {
      const userId = req.user.claims.sub;
      const user = await authStorage.getUser(userId);
      const tier = (user?.tier || "free") as UserTier;
      const freqErr = checkFrequencyTier(input.frequency, tier);
      if (freqErr) {
        return res.status(freqErr.status).json({ message: freqErr.error, code: freqErr.code });
      }
    }

    if (input.url) {
      const urlError = await isPrivateUrl(input.url);
      if (urlError) {
        return res.status(400).json({ message: urlError });
      }
    }

    if (input.selector) {
      const selectorError = validateCssSelector(input.selector);
      if (selectorError) {
        return res.status(400).json({ message: selectorError });
      }
    }

    const updates: Record<string, any> = { ...input };
    if (input.active === true && !existing.active) {
      updates.consecutiveFailures = 0;
      updates.pauseReason = null;
    }

    const updated = await storage.updateMonitor(id, updates);
    res.json(updated);
  });

  app.delete(api.monitors.delete.path, isAuthenticated, async (req: any, res) => {
    try {
      const id = Number(req.params.id);
      const existing = await storage.getMonitor(id);
      if (!existing) return res.status(404).json({ message: "Monitor not found" });
      if (String(existing.userId) !== String(req.user.claims.sub)) return res.status(403).json({ message: "Forbidden" });

      await storage.deleteMonitor(id);
      res.status(204).send();
    } catch (error: any) {
      console.error("[Delete Monitor] Error:", error.message);
      res.status(500).json({ message: "Server error while deleting monitor" });
    }
  });

  app.get(api.monitors.history.path, isAuthenticated, async (req: any, res) => {
    const id = Number(req.params.id);
    const existing = await storage.getMonitor(id);
    if (!existing) return res.status(404).json({ message: "Not found" });
    if (String(existing.userId) !== String(req.user.claims.sub)) return res.status(403).json({ message: "Forbidden" });

    const changes = await storage.getMonitorChanges(id);
    res.json(changes);
  });

  app.post(api.monitors.check.path, isAuthenticated, checkMonitorRateLimiter, async (req: any, res) => {
    try {
      const id = Number(req.params.id);
      const existing = await storage.getMonitor(id);
      if (!existing) return res.status(404).json({ message: "Not found" });
      if (String(existing.userId) !== String(req.user.claims.sub)) return res.status(403).json({ message: "Forbidden" });

      // Clear any pending auto-retry before the manual check to prevent
      // a narrow race where the scheduler cron fires a duplicate check.
      await db.update(monitors)
        .set({ pendingRetryAt: null })
        .where(eq(monitors.id, id))
        .catch((err: unknown) => {
          console.error(`[AutoRetry] Failed to clear pendingRetryAt for monitor ${id}:`,
            err instanceof Error ? err.message : err);
        });

      const result = await checkMonitor(existing);
      res.json(result);
    } catch (error: any) {
      console.error("[Check Monitor] Error:", error.message);
      res.status(500).json({ message: "Server error while checking monitor" });
    }
  });

  // ---------------------------------------------------------------
  // NOTIFICATION PREFERENCES ROUTES
  // ---------------------------------------------------------------

  app.get(api.monitors.notificationPreferences.get.path, isAuthenticated, async (req: any, res) => {
    const id = Number(req.params.id);
    const monitor = await storage.getMonitor(id);
    if (!monitor) return res.status(404).json({ message: "Not found" });
    if (String(monitor.userId) !== String(req.user.claims.sub)) return res.status(403).json({ message: "Forbidden" });

    const defaults = {
      id: 0,
      monitorId: id,
      quietHoursStart: null,
      quietHoursEnd: null,
      timezone: null,
      digestMode: false,
      sensitivityThreshold: 0,
      notificationEmail: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    if (!(await notificationTablesExist())) {
      return res.json(defaults);
    }

    const prefs = await storage.getNotificationPreferences(id);
    if (!prefs) {
      return res.json(defaults);
    }
    res.json(prefs);
  });

  app.put(api.monitors.notificationPreferences.put.path, isAuthenticated, async (req: any, res) => {
    try {
      const id = Number(req.params.id);
      const monitor = await storage.getMonitor(id);
      if (!monitor) return res.status(404).json({ message: "Not found" });
      if (String(monitor.userId) !== String(req.user.claims.sub)) return res.status(403).json({ message: "Forbidden" });

      if (!(await notificationTablesExist())) {
        return res.status(503).json({ message: "Notification preferences are not available yet" });
      }

      const input = api.monitors.notificationPreferences.put.input.parse(req.body);
      const prefs = await storage.upsertNotificationPreferences(id, {
        quietHoursStart: input.quietHoursStart ?? null,
        quietHoursEnd: input.quietHoursEnd ?? null,
        timezone: input.timezone ?? null,
        digestMode: input.digestMode ?? false,
        sensitivityThreshold: input.sensitivityThreshold ?? 0,
        notificationEmail: input.notificationEmail ?? null,
      });
      res.json(prefs);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message, code: "VALIDATION_ERROR" });
      }
      throw err;
    }
  });

  app.delete(api.monitors.notificationPreferences.delete.path, isAuthenticated, async (req: any, res) => {
    const id = Number(req.params.id);
    const monitor = await storage.getMonitor(id);
    if (!monitor) return res.status(404).json({ message: "Not found" });
    if (String(monitor.userId) !== String(req.user.claims.sub)) return res.status(403).json({ message: "Forbidden" });

    if (!(await notificationTablesExist())) {
      return res.status(204).send();
    }

    await storage.deleteNotificationPreferences(id);
    res.status(204).send();
  });

  // ---------------------------------------------------------------
  // NOTIFICATION CHANNELS ROUTES
  // ---------------------------------------------------------------

  // GET /api/monitors/:id/channels
  app.get(api.monitors.channels.list.path, isAuthenticated, async (req: any, res) => {
    if (!(await channelTablesExist())) return res.json([]);

    const id = Number(req.params.id);
    const monitor = await storage.getMonitor(id);
    if (!monitor) return res.status(404).json({ message: "Not found" });
    if (String(monitor.userId) !== String(req.user.claims.sub)) return res.status(403).json({ message: "Forbidden" });

    const channels = await storage.getMonitorChannels(id);
    // Redact webhook secrets in GET responses
    const redacted = channels.map((ch) => {
      if (ch.channel === "webhook" && ch.config && (ch.config as any).secret) {
        return { ...ch, config: { ...ch.config as object, secret: redactSecret((ch.config as any).secret) } };
      }
      return ch;
    });
    res.json(redacted);
  });

  // PUT /api/monitors/:id/channels/:channel
  app.put(api.monitors.channels.put.path, isAuthenticated, async (req: any, res) => {
    if (!(await channelTablesExist())) {
      return res.status(503).json({ message: "Notification channels are not available yet", code: "NOT_CONFIGURED" });
    }
    try {
      const id = Number(req.params.id);
      const channelParam = req.params.channel;

      const channelParsed = channelTypeSchema.safeParse(channelParam);
      if (!channelParsed.success) {
        return res.status(400).json({ message: "Invalid channel type. Must be email, webhook, or slack.", code: "INVALID_CHANNEL" });
      }
      const channel = channelParsed.data;

      const monitor = await storage.getMonitor(id);
      if (!monitor) return res.status(404).json({ message: "Not found" });
      if (String(monitor.userId) !== String(req.user.claims.sub)) return res.status(403).json({ message: "Forbidden" });

      // Tier gating: webhook and slack require Pro or Power
      if (channel !== "email") {
        const user = await authStorage.getUser(req.user.claims.sub);
        const tier = ((user as any)?.tier || "free") as UserTier;
        if (tier === "free") {
          return res.status(403).json({
            message: `Webhook and Slack channels require a Pro or Power plan. Upgrade to unlock this feature.`,
            code: "TIER_LIMIT_REACHED",
          });
        }
      }

      const input = api.monitors.channels.put.input.parse(req.body);
      let config: Record<string, unknown> = input.config as Record<string, unknown>;
      let isNewWebhook = false;

      if (channel === "webhook") {
        const webhookInput = webhookConfigInputSchema.parse(input.config);
        // SSRF check on webhook URL
        const ssrfError = await isPrivateUrl(webhookInput.url);
        if (ssrfError) {
          return res.status(422).json({ message: `Invalid webhook URL: ${ssrfError}`, code: "INVALID_WEBHOOK_URL" });
        }
        // Check if this is a new webhook (no existing secret)
        const existing = await storage.getMonitorChannels(id);
        const existingWebhook = existing.find((c) => c.channel === "webhook");
        const existingSecret = existingWebhook ? (existingWebhook.config as any)?.secret : null;
        const secret = existingSecret || generateWebhookSecret();
        isNewWebhook = !existingSecret;
        config = { url: webhookInput.url, secret, headers: (input.config as any)?.headers || {} };
      } else if (channel === "slack") {
        slackConfigInputSchema.parse(input.config);
      }

      const result = await storage.upsertMonitorChannel(id, channel, input.enabled, config);

      // Return secret only on first create, redacted afterwards
      const responseConfig = channel === "webhook" && !isNewWebhook
        ? { ...result.config as object, secret: redactSecret((result.config as any).secret) }
        : result.config;

      res.json({ ...result, config: responseConfig });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message, code: "VALIDATION_ERROR" });
      }
      throw err;
    }
  });

  // DELETE /api/monitors/:id/channels/:channel
  app.delete(api.monitors.channels.delete.path, isAuthenticated, async (req: any, res) => {
    if (!(await channelTablesExist())) return res.status(204).send();

    const id = Number(req.params.id);
    const parsed = channelTypeSchema.safeParse(req.params.channel);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid channel type", code: "INVALID_CHANNEL" });
    }
    const channel = parsed.data;
    const monitor = await storage.getMonitor(id);
    if (!monitor) return res.status(404).json({ message: "Not found" });
    if (String(monitor.userId) !== String(req.user.claims.sub)) return res.status(403).json({ message: "Forbidden" });
    await storage.deleteMonitorChannel(id, channel);
    if (channel === "email" && monitor.emailEnabled) {
      console.warn(`[notification] Email channel deleted for monitor ${id} while emailEnabled=true — email delivery will stop unless channel is re-added`);
    }
    res.status(204).send();
  });

  // POST /api/monitors/:id/channels/webhook/reveal-secret
  const revealSecretRateLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5,
    keyGenerator: (req: any) => req.user?.claims?.sub || ipKeyGenerator(req.ip || "0.0.0.0"),
    message: { message: "Too many secret reveal requests. Try again later." },
  });
  app.post(api.monitors.channels.revealSecret.path, isAuthenticated, revealSecretRateLimiter, async (req: any, res) => {
    if (!(await channelTablesExist())) {
      return res.status(404).json({ message: "No webhook channel configured", code: "NOT_FOUND" });
    }
    const id = Number(req.params.id);
    const monitor = await storage.getMonitor(id);
    if (!monitor) return res.status(404).json({ message: "Not found" });
    if (String(monitor.userId) !== String(req.user.claims.sub)) return res.status(403).json({ message: "Forbidden" });

    const channels = await storage.getMonitorChannels(id);
    const webhook = channels.find((c) => c.channel === "webhook");
    if (!webhook) return res.status(404).json({ message: "No webhook channel configured", code: "NOT_FOUND" });

    const secret = (webhook.config as any)?.secret;
    if (!secret) return res.status(404).json({ message: "No webhook secret found", code: "NOT_FOUND" });

    res.json({ secret });
  });

  // GET /api/monitors/:id/deliveries
  app.get(api.monitors.channels.deliveries.path, isAuthenticated, async (req: any, res) => {
    if (!(await channelTablesExist())) return res.json([]);

    const id = Number(req.params.id);
    const monitor = await storage.getMonitor(id);
    if (!monitor) return res.status(404).json({ message: "Not found" });
    if (String(monitor.userId) !== String(req.user.claims.sub)) return res.status(403).json({ message: "Forbidden" });

    const limit = Math.max(1, Math.min(Number(req.query.limit) || 50, 200));
    const channel = req.query.channel as string | undefined;
    const entries = await storage.getDeliveryLog(id, limit, channel);
    res.json(entries);
  });

  // ---------------------------------------------------------------
  // MONITOR CONDITIONS ROUTES
  // ---------------------------------------------------------------

  // GET /api/monitors/:id/conditions
  app.get(api.monitors.conditions.list.path, isAuthenticated, async (req: any, res) => {
    if (!(await requireConditionsReady(res))) return;
    const id = Number(req.params.id);
    const monitor = await storage.getMonitor(id);
    if (!monitor) return res.status(404).json({ message: "Not found", code: "NOT_FOUND" });
    if (String(monitor.userId) !== String(req.user.claims.sub)) return res.status(404).json({ message: "Not found", code: "NOT_FOUND" });

    const conditions = await storage.getMonitorConditions(id);
    res.json(conditions);
  });

  // POST /api/monitors/:id/conditions
  app.post(api.monitors.conditions.create.path, isAuthenticated, async (req: any, res) => {
    if (!(await requireConditionsReady(res))) return;
    try {
      const id = Number(req.params.id);
      const monitor = await storage.getMonitor(id);
      if (!monitor) return res.status(404).json({ message: "Not found", code: "NOT_FOUND" });
      if (String(monitor.userId) !== String(req.user.claims.sub)) return res.status(404).json({ message: "Not found", code: "NOT_FOUND" });

      // Tier check: Free users capped at 1 condition per monitor
      const user = await authStorage.getUser(req.user.claims.sub);
      const tier = ((user as any)?.tier || "free") as UserTier;
      const isFreeTier = tier === "free";
      if (isFreeTier) {
        const count = await storage.countMonitorConditions(id);
        if (count >= 1) {
          return res.status(403).json({
            message: "Free plan supports 1 condition per monitor. Upgrade to Pro or Power for unlimited conditions.",
            code: "TIER_LIMIT_REACHED",
          });
        }
      }

      const input = createConditionSchema.parse(req.body);

      // Validate numeric condition values are actually numbers
      if (input.type.startsWith("numeric_")) {
        const parsed = parseFloat(input.value);
        if (!Number.isFinite(parsed)) {
          return res.status(422).json({
            message: "Numeric condition value must be a valid number.",
            code: "VALIDATION_ERROR",
          });
        }
        if (input.type === "numeric_change_pct" && parsed <= 0) {
          return res.status(422).json({
            message: "Percentage threshold must be a positive number.",
            code: "VALIDATION_ERROR",
          });
        }
      }

      // Validate regex at save time
      if (input.type === "regex") {
        if (!isSafeRegex(input.value)) {
          return res.status(422).json({
            message: "Invalid or unsafe regular expression. Avoid nested quantifiers like (a+)+ which can cause slowdowns.",
            code: "INVALID_REGEX",
          });
        }
      }

      const condition = await storage.addMonitorCondition(id, input.type, input.value, input.groupIndex);

      // TOCTOU guard: if a concurrent request also inserted, keep the earliest (lowest ID).
      // Queries are auto-committed (no explicit txn), so both inserts are visible here.
      if (isFreeTier) {
        const postInsertCount = await storage.countMonitorConditions(id);
        if (postInsertCount > 1) {
          const existing = await storage.getMonitorConditions(id);
          if (!existing.some((c) => c.id === condition.id)) {
            return res.status(409).json({
              message: "Condition state changed during creation. Please retry.",
              code: "CONDITION_RACE",
            });
          }
          const minId = Math.min(...existing.map((c) => c.id));
          if (condition.id !== minId) {
            await storage.deleteMonitorCondition(condition.id, id);
            return res.status(403).json({
              message: "Free plan supports 1 condition per monitor. Upgrade to Pro or Power for unlimited conditions.",
              code: "TIER_LIMIT_REACHED",
            });
          }
        }
      }

      res.status(201).json(condition);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message, code: "VALIDATION_ERROR" });
      }
      throw err;
    }
  });

  // DELETE /api/monitors/:id/conditions/:conditionId
  app.delete(api.monitors.conditions.delete.path, isAuthenticated, async (req: any, res) => {
    if (!(await requireConditionsReady(res))) return;
    const id = Number(req.params.id);
    const conditionId = Number(req.params.conditionId);
    if (!Number.isInteger(conditionId) || conditionId <= 0) {
      return res.status(400).json({ message: "Invalid condition ID" });
    }
    const monitor = await storage.getMonitor(id);
    if (!monitor) return res.status(404).json({ message: "Not found", code: "NOT_FOUND" });
    if (String(monitor.userId) !== String(req.user.claims.sub)) return res.status(404).json({ message: "Not found", code: "NOT_FOUND" });

    await storage.deleteMonitorCondition(conditionId, id);
    res.status(204).send();
  });

  // ---------------------------------------------------------------
  // SLACK OAUTH ROUTES
  // ---------------------------------------------------------------

  function signSlackState(userId: string): string {
    const secret = process.env.SLACK_CLIENT_SECRET;
    if (!secret) {
      throw new Error("SLACK_CLIENT_SECRET is not configured");
    }
    return createHmac("sha256", secret).update(userId).digest("hex");
  }

  // GET /api/integrations/slack/install
  app.get(api.integrations.slack.install.path, isAuthenticated, async (req: any, res) => {
    if (!(await channelTablesExist())) {
      return res.status(503).json({ message: "Slack integration is not available.", code: "NOT_CONFIGURED" });
    }

    const userId = req.user.claims.sub;

    // Tier check
    const user = await authStorage.getUser(userId);
    const tier = ((user as any)?.tier || "free") as UserTier;
    if (tier === "free") {
      return res.status(403).json({ message: "Slack integration requires a Pro or Power plan.", code: "TIER_LIMIT_REACHED" });
    }

    const clientId = process.env.SLACK_CLIENT_ID;
    if (!clientId) {
      return res.status(501).json({ message: "Slack integration is not available.", code: "NOT_CONFIGURED" });
    }

    const host = validateHost(req.get("host"));
    if (!host) {
      return res.status(400).json({ message: "Invalid request host.", code: "BAD_REQUEST" });
    }
    const appUrl = `https://${host}`;

    const state = `${userId}:${signSlackState(userId)}`;
    const scopes = "chat:write,channels:read,groups:read";
    const redirectUri = `${appUrl}/api/integrations/slack/callback`;

    const url = `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;
    res.redirect(url);
  });

  // GET /api/integrations/slack/callback
  app.get(api.integrations.slack.callback.path, async (req: any, res) => {
    if (!(await channelTablesExist())) {
      return res.redirect("/?slack=error&reason=not_configured");
    }
    try {
      const { code, state, error } = req.query;

      if (error) {
        return res.redirect("/?slack=error&reason=" + encodeURIComponent(String(error)));
      }

      if (!state || !code) {
        return res.redirect("/?slack=error&reason=missing_params");
      }

      const [userId, sig] = String(state).split(":");
      if (!userId || sig !== signSlackState(userId)) {
        return res.redirect("/?slack=error&reason=invalid_state");
      }

      const clientId = process.env.SLACK_CLIENT_ID;
      const clientSecret = process.env.SLACK_CLIENT_SECRET;
      if (!clientId || !clientSecret) {
        return res.redirect("/?slack=error&reason=not_configured");
      }

      const host = validateHost(req.get("host"));
      if (!host) {
        return res.redirect("/?slack=error&reason=invalid_host");
      }
      const appUrl = `https://${host}`;
      const redirectUri = `${appUrl}/api/integrations/slack/callback`;

      const tokenResp = await fetch("https://slack.com/api/oauth.v2.access", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code: String(code),
          redirect_uri: redirectUri,
        }),
      });

      const tokenData = await tokenResp.json() as {
        ok: boolean;
        error?: string;
        access_token?: string;
        team?: { id: string; name: string };
        scope?: string;
      };

      if (!tokenData.ok || !tokenData.access_token) {
        return res.redirect("/?slack=error&reason=" + encodeURIComponent(tokenData.error || "token_exchange_failed"));
      }

      // Encrypt bot token before storage
      const encryptedToken = encryptToken(tokenData.access_token);
      if (!isValidEncryptedToken(encryptedToken)) {
        console.error("[Slack OAuth] Encrypted token failed format validation");
        return res.redirect("/?slack=error&reason=internal");
      }

      await storage.upsertSlackConnection({
        userId,
        teamId: tokenData.team?.id || "",
        teamName: tokenData.team?.name || "",
        botToken: encryptedToken,
        scope: tokenData.scope || "",
      });

      res.redirect("/?slack=connected");
    } catch (err) {
      console.error("[Slack OAuth] Callback error:", err instanceof Error ? err.message : err);
      res.redirect("/?slack=error&reason=internal");
    }
  });

  // GET /api/integrations/slack/status
  app.get(api.integrations.slack.status.path, isAuthenticated, async (req: any, res) => {
    const tablesReady = await channelTablesExist();
    if (!tablesReady) {
      return res.json({ connected: false, available: false, unavailableReason: "tables-not-ready" as const });
    }

    const oauthReady =
      Boolean(process.env.SLACK_CLIENT_ID?.trim()) &&
      Boolean(process.env.SLACK_CLIENT_SECRET?.trim());
    if (!oauthReady) {
      return res.json({ connected: false, available: false, unavailableReason: "oauth-not-configured" as const });
    }

    try {
      const userId = req.user.claims.sub;
      const connection = await storage.getSlackConnection(userId);
      if (connection) {
        res.json({ connected: true, available: true, teamName: connection.teamName });
      } else {
        res.json({ connected: false, available: true });
      }
    } catch (err) {
      console.error("[Slack] Status check failed:", err instanceof Error ? err.message : err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // GET /api/integrations/slack/channels
  const slackChannelsCache = new Map<string, { data: any[]; timestamp: number }>();

  // DELETE /api/integrations/slack
  app.delete(api.integrations.slack.disconnect.path, isAuthenticated, async (req: any, res) => {
    if (!(await channelTablesExist())) return res.status(204).send();

    const userId = req.user.claims.sub;
    slackChannelsCache.delete(userId);
    await storage.deleteSlackChannelsForUser(userId);
    await storage.deleteSlackConnection(userId);
    res.status(204).send();
  });
  app.get(api.integrations.slack.channels.path, isAuthenticated, async (req: any, res) => {
    if (!(await channelTablesExist())) {
      return res.status(404).json({ message: "No Slack connection found. Connect Slack first.", code: "NOT_FOUND" });
    }

    const userId = req.user.claims.sub;
    const connection = await storage.getSlackConnection(userId);
    if (!connection) {
      return res.status(404).json({ message: "No Slack connection found. Connect Slack first.", code: "NOT_FOUND" });
    }

    // Check cache (5 min)
    const cached = slackChannelsCache.get(userId);
    if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
      return res.json(cached.data);
    }

    try {
      const botToken = decryptToken(connection.botToken);
      const channels = await listSlackChannels(botToken);
      slackChannelsCache.set(userId, { data: channels, timestamp: Date.now() });
      res.json(channels);
    } catch (err) {
      console.error(`[Slack] Token decryption failed (userId=${userId})`);
      res.status(500).json({ message: "Failed to fetch Slack channels. Please reconnect Slack.", code: "SLACK_ERROR" });
    }
  });

  // ---------------------------------------------------------------
  // STRIPE ROUTES
  // ---------------------------------------------------------------

  // Get Stripe publishable key for frontend
  app.get("/api/stripe/config", async (req, res) => {
    try {
      const publishableKey = await getStripePublishableKey();
      res.json({ publishableKey });
    } catch (error: any) {
      console.error("Error getting Stripe config:", error);
      res.status(500).json({ message: "Could not load payment config" });
    }
  });

  // Get available subscription plans from Stripe
  app.get("/api/stripe/plans", async (req, res) => {
    try {
      // Use window function to get only the most recent product for each tier
      // This handles the case where old products from a previous Stripe account exist
      const result = await db.execute(sql`
        WITH ranked_products AS (
          SELECT 
            p.id,
            p.name,
            p.description,
            p.metadata,
            p.created,
            ROW_NUMBER() OVER (PARTITION BY p.metadata->>'tier' ORDER BY p.created DESC) as rn
          FROM stripe.products p
          WHERE p.active = true
            AND p.metadata->>'tier' IS NOT NULL
        )
        SELECT 
          rp.id as product_id,
          rp.name as product_name,
          rp.description as product_description,
          rp.metadata as product_metadata,
          pr.id as price_id,
          pr.unit_amount,
          pr.currency,
          pr.recurring
        FROM ranked_products rp
        LEFT JOIN stripe.prices pr ON pr.product = rp.id AND pr.active = true
        WHERE rp.rn = 1
        ORDER BY pr.unit_amount ASC
      `);

      const productsMap = new Map();
      for (const row of result.rows as any[]) {
        if (!productsMap.has(row.product_id)) {
          productsMap.set(row.product_id, {
            id: row.product_id,
            name: row.product_name,
            description: row.product_description,
            metadata: row.product_metadata,
            prices: [],
          });
        }
        if (row.price_id) {
          productsMap.get(row.product_id).prices.push({
            id: row.price_id,
            unit_amount: row.unit_amount,
            currency: row.currency,
            recurring: row.recurring,
          });
        }
      }

      res.json({ plans: Array.from(productsMap.values()) });
    } catch (error: any) {
      console.error("Error getting plans:", error);
      res.json({ plans: [] });
    }
  });

  // Create checkout session for subscription
  app.post("/api/stripe/checkout", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { priceId } = req.body;

      if (!priceId) {
        return res.status(400).json({ message: "Price ID is required" });
      }

      // Validate priceId belongs to a known subscription product (prevent plan spoofing)
      const validPrice = await db.execute(sql`
        SELECT pr.id, p.metadata 
        FROM stripe.prices pr
        JOIN stripe.products p ON pr.product = p.id
        WHERE pr.id = ${priceId} 
          AND pr.active = true 
          AND p.active = true
          AND (p.metadata->>'tier' IN ('pro', 'power') OR p.name ILIKE '%pro%' OR p.name ILIKE '%power%')
      `);

      if (validPrice.rows.length === 0) {
        return res.status(400).json({ message: "Invalid plan selected" });
      }

      const user = await authStorage.getUser(userId);
      if (!user?.email) {
        return res.status(400).json({ message: "User email is required for checkout" });
      }

      const stripe = await getUncachableStripeClient();

      // Get or create Stripe customer
      let customerId = user.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: user.email,
          metadata: { userId },
        });
        await authStorage.updateUser(userId, { stripeCustomerId: customer.id });
        customerId = customer.id;
      }

      // Create checkout session
      const baseUrl = `https://${process.env.REPLIT_DOMAINS?.split(',')[0]}`;
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        payment_method_types: ['card'],
        line_items: [{ price: priceId, quantity: 1 }],
        mode: 'subscription',
        success_url: `${baseUrl}/dashboard?checkout=success`,
        cancel_url: `${baseUrl}/dashboard?checkout=cancelled`,
      });

      res.json({ url: session.url });
    } catch (error: any) {
      console.error("Error creating checkout session:", error);
      res.status(500).json({ message: "Failed to create checkout session" });
    }
  });

  // Get current user's subscription status
  app.get("/api/stripe/subscription", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await authStorage.getUser(userId);

      if (!user?.stripeSubscriptionId) {
        return res.json({ subscription: null });
      }

      const result = await db.execute(sql`
        SELECT * FROM stripe.subscriptions WHERE id = ${user.stripeSubscriptionId}
      `);

      res.json({ subscription: result.rows[0] || null });
    } catch (error: any) {
      console.error("Error getting subscription:", error);
      res.json({ subscription: null });
    }
  });

  // Create customer portal session for managing subscription
  app.post("/api/stripe/portal", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await authStorage.getUser(userId);

      if (!user?.stripeCustomerId) {
        return res.status(400).json({ message: "No subscription found" });
      }

      const stripe = await getUncachableStripeClient();
      const baseUrl = `https://${process.env.REPLIT_DOMAINS?.split(',')[0]}`;

      const session = await stripe.billingPortal.sessions.create({
        customer: user.stripeCustomerId,
        return_url: `${baseUrl}/dashboard`,
      });

      res.json({ url: session.url });
    } catch (error: any) {
      console.error("Error creating portal session:", error);
      res.status(500).json({ message: "Failed to open billing portal" });
    }
  });

  // ------------------------------------------------------------------
  // SUPPORT CONTACT FORM
  // ------------------------------------------------------------------
  app.post(api.support.contact.path, isAuthenticated, contactFormRateLimiter, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await authStorage.getUser(userId);

      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }

      const input = api.support.contact.input.parse(req.body);

      const categoryLabels: Record<string, string> = {
        bug: "Bug Report",
        feature: "Feature Request",
        billing: "Billing",
        general: "General",
      };

      const resend = getResendClient();
      if (!resend) {
        console.error(`[Support] RESEND_API_KEY not set. Cannot send email.`);
        console.log(`[Support] From: ${input.email}, Category: ${input.category}, Subject: ${input.subject}`);
        console.log(`[Support] Message: ${input.message}`);
        return res.status(503).json({ message: "Email service is not configured. Please try again later or contact us directly.", code: "EMAIL_NOT_CONFIGURED" });
      }
      const fromAddress = process.env.RESEND_FROM || "onboarding@resend.dev";
      const supportEmail = process.env.SUPPORT_EMAIL;
      if (!supportEmail) {
        console.error(`[Support] SUPPORT_EMAIL not set. Cannot send email.`);
        console.log(`[Support] From: ${input.email}, Category: ${input.category}, Subject: ${input.subject}`);
        console.log(`[Support] Message: ${input.message}`);
        return res.status(503).json({ message: "Email service is not configured. Please try again later or contact us directly.", code: "EMAIL_NOT_CONFIGURED" });
      }

      const escapeHtml = (str: string) =>
        str
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;");

      const escapedEmail = escapeHtml(input.email);
      const escapedSubject = escapeHtml(input.subject);
      const escapedMessage = escapeHtml(input.message);

      const response = await resend.emails.send({
        from: fromAddress,
        to: supportEmail,
        replyTo: input.email,
        subject: `[Support - ${categoryLabels[input.category]}] ${input.subject.replace(/[\r\n]+/g, ' ').trim()}`,
        text: [
          "Support Request from FetchTheChange",
          "",
          `From: ${input.email}`,
          `User ID: ${userId}`,
          `User Tier: ${user.tier || "free"}`,
          `Category: ${categoryLabels[input.category]}`,
          `Subject: ${input.subject}`,
          "",
          "Message:",
          input.message,
        ].join("\n"),
        html: `
<h2>Support Request</h2>
<table style="border-collapse:collapse;">
  <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">From:</td><td>${escapedEmail}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">User ID:</td><td>${userId}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Tier:</td><td>${user.tier || "free"}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Category:</td><td>${categoryLabels[input.category]}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Subject:</td><td>${escapedSubject}</td></tr>
</table>
<hr/>
<h3>Message</h3>
<p style="white-space:pre-wrap;">${escapedMessage}</p>
<hr/>
<p style="color:#888;font-size:12px;">Sent via FetchTheChange Support Form</p>
        `.trim(),
      });

      if (response.error) {
        console.error("[Support] Resend error:", response.error);
        return res.status(500).json({ message: "Failed to send your message. Please try again." });
      }

      console.log(`[Support] Contact form sent for user ${userId}, Resend ID: ${response.data?.id}`);
      res.json({ success: true, message: "Your message has been sent successfully. We'll get back to you soon.", resendId: response.data?.id });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message, code: "VALIDATION_ERROR" });
      }
      console.error("[Support] Contact form error:", err);
      res.status(500).json({ message: "Failed to send your message. Please try again." });
    }
  });

  // Admin error logs endpoint (restricted to Power tier users, scoped to own monitors)
  const APP_OWNER_ID = process.env.APP_OWNER_ID;
  if (!APP_OWNER_ID) {
    console.warn("APP_OWNER_ID not set; owner-only admin endpoints will be inaccessible.");
  }
  // Lightweight count endpoint for notification badge.
  // Returns { count: 0 } instead of { message, code } on auth errors so the
  // client badge can consume every response shape uniformly without error handling.
  app.get("/api/admin/error-logs/count", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      if (!userId) {
        return res.status(401).json({ count: 0 });
      }
      const user = await authStorage.getUser(userId);
      if (!user || user.tier !== "power") {
        return res.status(403).json({ count: 0 });
      }

      const isAppOwner = userId === APP_OWNER_ID;

      const allResults = await db
        .select({ id: errorLogs.id, context: errorLogs.context })
        .from(errorLogs)
        .where(and(eq(errorLogs.resolved, false), isNull(errorLogs.deletedAt)))
        .limit(500);

      const userMonitorIds = new Set(
        (await storage.getMonitors(userId)).map((m: any) => m.id)
      );

      const count = allResults.filter((log: any) => {
        const ctx = log.context as Record<string, unknown> | null;
        const monitorId = ctx && typeof ctx.monitorId === "number" ? ctx.monitorId : undefined;
        if (monitorId !== undefined) {
          return userMonitorIds.has(monitorId);
        }
        return isAppOwner;
      }).length;

      res.json({ count });
    } catch (error: any) {
      console.error("Error fetching error log count:", error);
      res.json({ count: 0 });
    }
  });

  app.get("/api/admin/error-logs", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const user = await authStorage.getUser(userId);
      if (!user || user.tier !== "power") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const level = req.query.level as string | undefined;
      const source = req.query.source as string | undefined;
      const limitNum = Math.max(1, Math.min(Number(req.query.limit) || 100, 500));

      const conditions = [eq(errorLogs.resolved, false), isNull(errorLogs.deletedAt)];
      if (level && ["error", "warning", "info"].includes(level)) {
        conditions.push(eq(errorLogs.level, level));
      }
      if (source && (ERROR_LOG_SOURCES as readonly string[]).includes(source)) {
        conditions.push(eq(errorLogs.source, source));
      }

      let query = db.select().from(errorLogs).where(and(...conditions)).orderBy(desc(errorLogs.timestamp)).limit(limitNum);

      const allResults = await query;

      const isAppOwner = userId === APP_OWNER_ID;

      const userMonitorIds = new Set(
        (await storage.getMonitors(userId)).map((m: any) => m.id)
      );

      const filtered = allResults.filter((log: any) => {
        const ctx = log.context as Record<string, unknown> | null;
        const monitorId = ctx && typeof ctx.monitorId === "number" ? ctx.monitorId : undefined;
        if (monitorId !== undefined) {
          return userMonitorIds.has(monitorId);
        }
        return isAppOwner;
      });

      res.json(filtered);
    } catch (error: any) {
      console.error("Error fetching error logs:", error);
      res.status(500).json({ message: "Failed to fetch error logs" });
    }
  });

  app.delete("/api/admin/error-logs/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const user = await authStorage.getUser(userId);
      if (!user || user.tier !== "power") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ message: "Invalid log ID" });
      }

      const [log] = await db.select().from(errorLogs).where(and(eq(errorLogs.id, id), isNull(errorLogs.deletedAt))).limit(1);
      if (!log) {
        return res.status(404).json({ message: "Log entry not found" });
      }

      const isAppOwner = userId === APP_OWNER_ID;
      const userMonitorIds = new Set(
        (await storage.getMonitors(userId)).map((m: any) => m.id)
      );
      const ctx = log.context as Record<string, unknown> | null;
      const monitorId = ctx && typeof ctx.monitorId === "number" ? ctx.monitorId : undefined;
      if (monitorId !== undefined ? !userMonitorIds.has(monitorId) : !isAppOwner) {
        return res.status(403).json({ message: "Not authorized to delete this log entry" });
      }

      await db.update(errorLogs).set({ deletedAt: new Date() }).where(eq(errorLogs.id, id));
      res.json({ message: "Deleted" });
    } catch (error: any) {
      console.error("Error deleting error log:", error);
      res.status(500).json({ message: "Failed to delete error log" });
    }
  });

  // Batch soft-delete error log entries
  app.post("/api/admin/error-logs/batch-delete", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const user = await authStorage.getUser(userId);
      if (!user || user.tier !== "power") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const batchDeleteSchema = z.object({
        ids: z.array(z.number().int().positive()).min(1).max(500).optional(),
        filters: z.object({
          level: z.enum(["error", "warning", "info"]).optional(),
          source: errorLogSourceSchema.optional(),
        }).strict().refine(
          (data) => data.level !== undefined || data.source !== undefined,
          { message: "filters must include at least one of: level, source" },
        ).optional(),
        excludeIds: z.array(z.number().int().positive()).max(500).optional(),
      }).strict().refine(
        (data) => (data.ids !== undefined) !== (data.filters !== undefined),
        { message: "Provide either ids or filters, not both" },
      ).refine(
        (data) => !(data.ids && data.excludeIds),
        { message: "excludeIds cannot be used with ids" },
      );

      const parsed = batchDeleteSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
      }
      const { ids, filters, excludeIds } = parsed.data;

      const isAppOwner = userId === APP_OWNER_ID;
      const userMonitorIds = new Set(
        (await storage.getMonitors(userId)).map((m: any) => m.id)
      );

      const now = new Date();

      if (ids) {
        const entries = await db.select().from(errorLogs)
          .where(and(inArray(errorLogs.id, ids), isNull(errorLogs.deletedAt)));

        const authorized = entries.filter((log: any) => {
          const ctx = log.context as Record<string, unknown> | null;
          const monitorId = ctx && typeof ctx.monitorId === "number" ? ctx.monitorId : undefined;
          if (monitorId !== undefined) return userMonitorIds.has(monitorId);
          return isAppOwner;
        });

        if (authorized.length > 0) {
          const authorizedIds = authorized.map((e: any) => e.id);
          await db.update(errorLogs).set({ deletedAt: now }).where(inArray(errorLogs.id, authorizedIds));
        }
        res.json({ message: `${authorized.length} entries deleted`, count: authorized.length });
      } else if (filters) {
        const conditions = [isNull(errorLogs.deletedAt)];
        if (filters.level) {
          conditions.push(eq(errorLogs.level, filters.level));
        }
        if (filters.source) {
          conditions.push(eq(errorLogs.source, filters.source));
        }
        const excludeList = excludeIds ?? [];
        if (excludeList.length > 0) {
          conditions.push(notInArray(errorLogs.id, excludeList));
        }

        const entries = await db.select().from(errorLogs).where(and(...conditions)).orderBy(asc(errorLogs.id)).limit(500);

        const authorized = entries.filter((log: any) => {
          const ctx = log.context as Record<string, unknown> | null;
          const monitorId = ctx && typeof ctx.monitorId === "number" ? ctx.monitorId : undefined;
          if (monitorId !== undefined) return userMonitorIds.has(monitorId);
          return isAppOwner;
        });

        if (authorized.length > 0) {
          const authorizedIds = authorized.map((e: any) => e.id);
          await db.update(errorLogs).set({ deletedAt: now }).where(inArray(errorLogs.id, authorizedIds));
        }
        const hasMore = entries.length === 500;
        res.json({ message: `${authorized.length} entries deleted`, count: authorized.length, hasMore });
      }
    } catch (error: any) {
      console.error("Error batch deleting error logs:", error);
      res.status(500).json({ message: "Failed to batch delete error logs" });
    }
  });

  // Restore soft-deleted error log entries (undo)
  app.post("/api/admin/error-logs/restore", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const user = await authStorage.getUser(userId);
      if (!user || user.tier !== "power") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const isAppOwner = userId === APP_OWNER_ID;
      const userMonitorIds = new Set(
        (await storage.getMonitors(userId)).map((m: any) => m.id)
      );

      const softDeleted = await db.select().from(errorLogs).where(isNotNull(errorLogs.deletedAt)).orderBy(asc(errorLogs.id)).limit(500);

      const authorized = softDeleted.filter((log: any) => {
        const ctx = log.context as Record<string, unknown> | null;
        const monitorId = ctx && typeof ctx.monitorId === "number" ? ctx.monitorId : undefined;
        if (monitorId !== undefined) return userMonitorIds.has(monitorId);
        return isAppOwner;
      });

      if (authorized.length > 0) {
        const authorizedIds = authorized.map((e: any) => e.id);
        await db.update(errorLogs).set({ deletedAt: null }).where(inArray(errorLogs.id, authorizedIds));
      }
      const hasMore = softDeleted.length === 500;
      res.json({ message: `${authorized.length} entries restored`, count: authorized.length, hasMore });
    } catch (error: any) {
      console.error("Error restoring error logs:", error);
      res.status(500).json({ message: "Failed to restore error logs" });
    }
  });

  // Finalize soft-deleted error log entries (hard-delete)
  app.post("/api/admin/error-logs/finalize", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const user = await authStorage.getUser(userId);
      if (!user || user.tier !== "power") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const isAppOwner = userId === APP_OWNER_ID;
      const userMonitorIds = new Set(
        (await storage.getMonitors(userId)).map((m: any) => m.id)
      );

      const softDeleted = await db.select().from(errorLogs).where(isNotNull(errorLogs.deletedAt)).orderBy(asc(errorLogs.id)).limit(500);

      const authorized = softDeleted.filter((log: any) => {
        const ctx = log.context as Record<string, unknown> | null;
        const monitorId = ctx && typeof ctx.monitorId === "number" ? ctx.monitorId : undefined;
        if (monitorId !== undefined) return userMonitorIds.has(monitorId);
        return isAppOwner;
      });

      if (authorized.length > 0) {
        const authorizedIds = authorized.map((e: any) => e.id);
        await db.delete(errorLogs).where(inArray(errorLogs.id, authorizedIds));
      }
      const hasMore = softDeleted.length === 500;
      res.json({ message: `${authorized.length} entries finalized`, count: authorized.length, hasMore });
    } catch (error: any) {
      console.error("Error finalizing error logs:", error);
      res.status(500).json({ message: "Failed to finalize error logs" });
    }
  });

  // Server-side safety net: clean up orphaned soft-deleted entries older than 5 minutes
  if (softDeleteCleanupInterval) {
    clearInterval(softDeleteCleanupInterval);
  }
  softDeleteCleanupInterval = setInterval(async () => {
    try {
      const threshold = new Date(Date.now() - 5 * 60 * 1000);
      // Batch-limit the delete to avoid materializing unbounded rows via .returning()
      const rows = await db.delete(errorLogs).where(
        and(
          isNotNull(errorLogs.deletedAt),
          sql`${errorLogs.deletedAt} < ${threshold}`,
          sql`${errorLogs.id} IN (SELECT id FROM error_logs WHERE deleted_at IS NOT NULL AND deleted_at < ${threshold} LIMIT 1000)`,
        )
      ).returning({ id: errorLogs.id });
      const count = rows.length;
      if (count > 0) {
        console.warn(`Safety net: cleaned up ${count} orphaned soft-deleted error log entries`);
      }
    } catch (error) {
      console.error("Safety net cleanup error:", error);
    }
  }, 60 * 1000);

  // Admin users overview endpoint (owner-only)
  app.get("/api/admin/users-overview", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const user = await authStorage.getUser(userId);
      if (!user || user.tier !== "power") return res.status(403).json({ message: "Admin access required" });

      const isAppOwner = userId === APP_OWNER_ID;
      if (!isAppOwner) return res.status(403).json({ message: "Owner access required" });

      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      const result = await db.execute(sql`
        SELECT
          u.id,
          u.email,
          u.first_name,
          u.last_name,
          u.profile_image_url,
          u.tier,
          u.created_at,
          u.updated_at,
          GREATEST(
            m.last_monitor_check,
            bu.last_browserless_usage,
            ru.last_email_sent,
            u.updated_at
          ) AS last_activity,
          COALESCE(m.monitor_count, 0)::int AS monitor_count,
          COALESCE(m.active_monitor_count, 0)::int AS active_monitor_count,
          COALESCE(bu.browserless_usage_this_month, 0)::int AS browserless_usage_this_month,
          COALESCE(ru.emails_sent_this_month, 0)::int AS emails_sent_this_month
        FROM users u
        LEFT JOIN LATERAL (
          SELECT
            COUNT(*)::int AS monitor_count,
            COUNT(*) FILTER (WHERE mon.active = true)::int AS active_monitor_count,
            MAX(mon.last_checked) AS last_monitor_check
          FROM monitors mon
          WHERE mon.user_id = u.id
        ) m ON true
        LEFT JOIN LATERAL (
          SELECT
            COUNT(*)::int AS browserless_usage_this_month,
            MAX(bru.timestamp) AS last_browserless_usage
          FROM browserless_usage bru
          WHERE bru.user_id = u.id AND bru.timestamp >= ${monthStart}
        ) bu ON true
        LEFT JOIN LATERAL (
          SELECT
            COUNT(*)::int AS emails_sent_this_month,
            MAX(rsu.timestamp) AS last_email_sent
          FROM resend_usage rsu
          WHERE rsu.user_id = u.id AND rsu.timestamp >= ${monthStart}
        ) ru ON true
        ORDER BY last_activity DESC NULLS LAST, u.created_at DESC
      `);

      res.json(result.rows);
    } catch (error: any) {
      console.error("Error fetching users overview:", error);
      res.status(500).json({ message: "Failed to fetch users overview" });
    }
  });

  app.get("/api/admin/browserless-usage", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const user = await authStorage.getUser(userId);
      if (!user || user.tier !== "power") return res.status(403).json({ message: "Admin access required" });

      const isAppOwner = userId === APP_OWNER_ID;
      if (!isAppOwner) return res.status(403).json({ message: "Owner access required" });

      const [systemUsage, topConsumers, tierBreakdown] = await Promise.all([
        BrowserlessUsageTracker.getSystemMonthlyUsage(),
        BrowserlessUsageTracker.getTopConsumers(10),
        BrowserlessUsageTracker.getTierBreakdown(),
      ]);

      res.json({
        systemUsage,
        systemCap: BROWSERLESS_CAPS.system,
        tierCaps: { free: BROWSERLESS_CAPS.free, pro: BROWSERLESS_CAPS.pro, power: BROWSERLESS_CAPS.power },
        topConsumers,
        tierBreakdown,
        resetDate: getMonthResetDate(),
      });
    } catch (error: any) {
      console.error("Error fetching browserless usage:", error);
      res.status(500).json({ message: "Failed to fetch browserless usage" });
    }
  });

  app.get("/api/admin/resend-usage", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const user = await authStorage.getUser(userId);
      if (!user || user.tier !== "power") return res.status(403).json({ message: "Admin access required" });

      const isAppOwner = userId === APP_OWNER_ID;
      if (!isAppOwner) return res.status(403).json({ message: "Owner access required" });

      const [dailyUsage, monthlyUsage, recentHistory, failedThisMonth] = await Promise.all([
        ResendUsageTracker.getDailyUsage(),
        ResendUsageTracker.getMonthlyUsage(),
        ResendUsageTracker.getRecentHistory(7),
        ResendUsageTracker.getTotalFailed(true),
      ]);

      res.json({
        dailyUsage,
        dailyCap: RESEND_CAPS.daily,
        monthlyUsage,
        monthlyCap: RESEND_CAPS.monthly,
        failedThisMonth,
        recentHistory,
        resetDate: getResendResetDate(),
      });
    } catch (error: any) {
      console.error("Error fetching resend usage:", error);
      res.status(500).json({ message: "Failed to fetch resend usage" });
    }
  });

  app.get("/api/admin/monitor-metrics", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      if (!APP_OWNER_ID) return res.status(503).json({ message: "Admin endpoint not configured (APP_OWNER_ID missing)" });
      const user = await authStorage.getUser(userId);
      if (!user || user.tier !== "power" || userId !== APP_OWNER_ID) {
        return res.status(403).json({ message: "Owner access required" });
      }

      const [failuresByDomain, avgDurationByStage, browserlessStats, autoPauseEvents] = await Promise.all([
        db.execute(sql`
          SELECT
            SUBSTRING(m.url FROM '://([^/]+)') AS domain,
            COUNT(*) FILTER (WHERE mm.status != 'ok')::int AS failures,
            COUNT(*)::int AS total,
            ROUND(COUNT(*) FILTER (WHERE mm.status != 'ok')::numeric / GREATEST(COUNT(*), 1) * 100, 1) AS failure_rate
          FROM monitor_metrics mm
          JOIN monitors m ON mm.monitor_id = m.id
          WHERE mm.checked_at > NOW() - INTERVAL '30 days'
          GROUP BY domain
          ORDER BY failures DESC
          LIMIT 50
        `),
        db.execute(sql`
          SELECT
            stage,
            ROUND(AVG(duration_ms))::int AS avg_duration_ms,
            COUNT(*)::int AS total_checks
          FROM monitor_metrics
          WHERE checked_at > NOW() - INTERVAL '30 days'
          GROUP BY stage
          ORDER BY stage
        `),
        db.execute(sql`
          SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'ok')::int AS successes,
            COUNT(*) FILTER (WHERE status != 'ok')::int AS failures,
            ROUND(COUNT(*) FILTER (WHERE stage = 'browserless')::numeric / GREATEST(COUNT(*), 1) * 100, 1) AS browserless_ratio
          FROM monitor_metrics
          WHERE checked_at > NOW() - INTERVAL '30 days'
        `),
        db.execute(sql`
          SELECT
            m.id AS monitor_id,
            m.name AS monitor_name,
            m.url,
            m.pause_reason,
            m.consecutive_failures,
            m.last_checked
          FROM monitors m
          WHERE m.pause_reason IS NOT NULL
            AND m.last_checked > NOW() - INTERVAL '30 days'
          ORDER BY m.last_checked DESC
          LIMIT 50
        `),
      ]);

      res.json({
        failuresByDomain: failuresByDomain.rows,
        avgDurationByStage: avgDurationByStage.rows,
        browserlessStats: browserlessStats.rows[0] || {},
        autoPauseEvents: autoPauseEvents.rows,
      });
    } catch (error: any) {
      console.error("Error fetching monitor metrics:", error);
      res.status(500).json({ message: "Failed to fetch monitor metrics" });
    }
  });

  // ------------------------------------------------------------------
  // CAMPAIGN ROUTES
  // ------------------------------------------------------------------

  const { campaigns: campaignsTable, campaignRecipients: campaignRecipientsTable, users: usersTable } = await import("@shared/schema");
  const campaignEmailService = await import("./services/campaignEmail");

  // Campaign dashboard (aggregate stats) - must be before /:id routes
  app.get("/api/admin/campaigns/dashboard", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const user = await authStorage.getUser(userId);
      if (!user || user.tier !== "power") return res.status(403).json({ message: "Admin access required" });
      if (userId !== APP_OWNER_ID) return res.status(403).json({ message: "Owner access required" });

      const result = await db.execute(sql`
        SELECT
          COUNT(*)::int AS "totalCampaigns",
          COALESCE(SUM(sent_count), 0)::int AS "totalSent",
          COALESCE(SUM(opened_count), 0)::int AS "totalOpened",
          COALESCE(SUM(clicked_count), 0)::int AS "totalClicked",
          ROUND(COALESCE(AVG(CASE WHEN sent_count > 0 THEN LEAST(opened_count::numeric / sent_count * 100, 100) END), 0), 1) AS "avgOpenRate",
          ROUND(COALESCE(AVG(CASE WHEN sent_count > 0 THEN LEAST(clicked_count::numeric / sent_count * 100, 100) END), 0), 1) AS "avgClickRate"
        FROM campaigns
        WHERE status != 'draft'
      `);

      const recentCampaigns = await db
        .select()
        .from(campaignsTable)
        .orderBy(desc(campaignsTable.createdAt))
        .limit(10);

      const stats = (result.rows[0] ?? {}) as any;
      res.json({
        totalCampaigns: Number(stats?.totalCampaigns ?? 0),
        totalSent: Number(stats?.totalSent ?? 0),
        totalOpened: Number(stats?.totalOpened ?? 0),
        totalClicked: Number(stats?.totalClicked ?? 0),
        avgOpenRate: Number(stats?.avgOpenRate ?? 0),
        avgClickRate: Number(stats?.avgClickRate ?? 0),
        recentCampaigns,
      });
    } catch (error: any) {
      console.error("Error fetching campaign dashboard:", error);
      res.status(500).json({ message: "Failed to fetch campaign dashboard" });
    }
  });

  // List campaigns
  app.get("/api/admin/campaigns", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const user = await authStorage.getUser(userId);
      if (!user || user.tier !== "power") return res.status(403).json({ message: "Admin access required" });
      if (userId !== APP_OWNER_ID) return res.status(403).json({ message: "Owner access required" });

      const statusFilter = req.query.status as string | undefined;
      let results;
      if (statusFilter && ["draft", "sending", "sent", "partially_sent", "cancelled"].includes(statusFilter)) {
        results = await db
          .select()
          .from(campaignsTable)
          .where(eq(campaignsTable.status, statusFilter))
          .orderBy(desc(campaignsTable.createdAt));
      } else {
        results = await db
          .select()
          .from(campaignsTable)
          .orderBy(desc(campaignsTable.createdAt));
      }

      res.json(results);
    } catch (error: any) {
      console.error("Error fetching campaigns:", error);
      res.status(500).json({ message: "Failed to fetch campaigns" });
    }
  });

  // Get single campaign
  app.get("/api/admin/campaigns/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const user = await authStorage.getUser(userId);
      if (!user || user.tier !== "power") return res.status(403).json({ message: "Admin access required" });
      if (userId !== APP_OWNER_ID) return res.status(403).json({ message: "Owner access required" });

      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Invalid campaign ID" });
      const [campaign] = await db
        .select()
        .from(campaignsTable)
        .where(eq(campaignsTable.id, id))
        .limit(1);

      if (!campaign) return res.status(404).json({ message: "Campaign not found" });
      res.json(campaign);
    } catch (error: any) {
      console.error("Error fetching campaign:", error);
      res.status(500).json({ message: "Failed to fetch campaign" });
    }
  });

  // Create campaign
  app.post("/api/admin/campaigns", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const user = await authStorage.getUser(userId);
      if (!user || user.tier !== "power") return res.status(403).json({ message: "Admin access required" });
      if (userId !== APP_OWNER_ID) return res.status(403).json({ message: "Owner access required" });

      const { name, subject, htmlBody, textBody, filters, scheduledAt } = req.body;
      if (!name || !subject || !htmlBody) {
        return res.status(400).json({ message: "Name, subject, and HTML body are required" });
      }

      const [campaign] = await db
        .insert(campaignsTable)
        .values({
          name,
          subject,
          htmlBody,
          textBody: textBody || null,
          filters: filters || null,
          scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
          status: "draft",
        })
        .returning();

      res.status(201).json(campaign);
    } catch (error: any) {
      console.error("Error creating campaign:", error);
      res.status(500).json({ message: "Failed to create campaign" });
    }
  });

  // Update draft campaign
  app.patch("/api/admin/campaigns/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const user = await authStorage.getUser(userId);
      if (!user || user.tier !== "power") return res.status(403).json({ message: "Admin access required" });
      if (userId !== APP_OWNER_ID) return res.status(403).json({ message: "Owner access required" });

      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Invalid campaign ID" });
      const [existing] = await db
        .select()
        .from(campaignsTable)
        .where(eq(campaignsTable.id, id))
        .limit(1);

      if (!existing) return res.status(404).json({ message: "Campaign not found" });
      if (existing.status !== "draft") return res.status(400).json({ message: "Only draft campaigns can be edited" });

      const { name, subject, htmlBody, textBody, filters, scheduledAt } = req.body;
      const updates: Record<string, any> = {};
      if (name !== undefined) updates.name = name;
      if (subject !== undefined) updates.subject = subject;
      if (htmlBody !== undefined) updates.htmlBody = htmlBody;
      if (textBody !== undefined) updates.textBody = textBody;
      if (filters !== undefined) updates.filters = filters;
      if (scheduledAt !== undefined) updates.scheduledAt = scheduledAt ? new Date(scheduledAt) : null;

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ message: "No valid fields to update" });
      }

      const [updated] = await db
        .update(campaignsTable)
        .set(updates)
        .where(eq(campaignsTable.id, id))
        .returning();

      res.json(updated);
    } catch (error: any) {
      console.error("Error updating campaign:", error);
      res.status(500).json({ message: "Failed to update campaign" });
    }
  });

  // Delete draft campaign
  app.delete("/api/admin/campaigns/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const user = await authStorage.getUser(userId);
      if (!user || user.tier !== "power") return res.status(403).json({ message: "Admin access required" });
      if (userId !== APP_OWNER_ID) return res.status(403).json({ message: "Owner access required" });

      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Invalid campaign ID" });
      const [existing] = await db
        .select()
        .from(campaignsTable)
        .where(eq(campaignsTable.id, id))
        .limit(1);

      if (!existing) return res.status(404).json({ message: "Campaign not found" });
      if (existing.status !== "draft") return res.status(400).json({ message: "Only draft campaigns can be deleted" });

      // Cascade delete recipients first
      await db.delete(campaignRecipientsTable).where(eq(campaignRecipientsTable.campaignId, id));
      await db.delete(campaignsTable).where(eq(campaignsTable.id, id));
      res.status(204).send();
    } catch (error: any) {
      console.error("Error deleting campaign:", error);
      res.status(500).json({ message: "Failed to delete campaign" });
    }
  });

  // Preview campaign recipients
  app.post("/api/admin/campaigns/:id/preview", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const user = await authStorage.getUser(userId);
      if (!user || user.tier !== "power") return res.status(403).json({ message: "Admin access required" });
      if (userId !== APP_OWNER_ID) return res.status(403).json({ message: "Owner access required" });

      const { filters } = req.body;
      const preview = await campaignEmailService.previewRecipients(filters || {});
      res.json(preview);
    } catch (error: any) {
      console.error("Error previewing recipients:", error);
      res.status(500).json({ message: "Failed to preview recipients" });
    }
  });

  // Send test campaign email
  app.post("/api/admin/campaigns/:id/send-test", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const user = await authStorage.getUser(userId);
      if (!user || user.tier !== "power") return res.status(403).json({ message: "Admin access required" });
      if (userId !== APP_OWNER_ID) return res.status(403).json({ message: "Owner access required" });

      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Invalid campaign ID" });
      const [campaign] = await db
        .select()
        .from(campaignsTable)
        .where(eq(campaignsTable.id, id))
        .limit(1);

      if (!campaign) return res.status(404).json({ message: "Campaign not found" });

      const testEmail = req.body.testEmail || user.notificationEmail || user.email;
      if (!testEmail) return res.status(400).json({ message: "No email address available" });

      const result = await campaignEmailService.sendTestCampaignEmail(campaign, testEmail);
      if (result.success) {
        res.json({ success: true, resendId: result.resendId, sentTo: testEmail });
      } else {
        res.status(400).json({ success: false, error: result.error });
      }
    } catch (error: any) {
      console.error("Error sending test campaign:", error);
      res.status(500).json({ message: "Failed to send test campaign" });
    }
  });

  // Send campaign
  app.post("/api/admin/campaigns/:id/send", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const user = await authStorage.getUser(userId);
      if (!user || user.tier !== "power") return res.status(403).json({ message: "Admin access required" });
      if (userId !== APP_OWNER_ID) return res.status(403).json({ message: "Owner access required" });

      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Invalid campaign ID" });
      const result = await campaignEmailService.triggerCampaignSend(id);
      res.json({ success: true, totalRecipients: result.totalRecipients });
    } catch (error: any) {
      console.error("Error sending campaign:", error);
      res.status(400).json({ message: error.message || "Failed to send campaign" });
    }
  });

  // Cancel campaign
  app.post("/api/admin/campaigns/:id/cancel", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const user = await authStorage.getUser(userId);
      if (!user || user.tier !== "power") return res.status(403).json({ message: "Admin access required" });
      if (userId !== APP_OWNER_ID) return res.status(403).json({ message: "Owner access required" });

      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Invalid campaign ID" });
      const result = await campaignEmailService.cancelCampaign(id);
      res.json({ success: true, sentSoFar: result.sentSoFar, cancelled: result.cancelled });
    } catch (error: any) {
      console.error("Error cancelling campaign:", error);
      res.status(500).json({ message: "Failed to cancel campaign" });
    }
  });

  // Campaign analytics
  app.get("/api/admin/campaigns/:id/analytics", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const user = await authStorage.getUser(userId);
      if (!user || user.tier !== "power") return res.status(403).json({ message: "Admin access required" });
      if (userId !== APP_OWNER_ID) return res.status(403).json({ message: "Owner access required" });

      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Invalid campaign ID" });
      const [campaign] = await db
        .select()
        .from(campaignsTable)
        .where(eq(campaignsTable.id, id))
        .limit(1);

      if (!campaign) return res.status(404).json({ message: "Campaign not found" });

      // Get recipient breakdown
      const breakdownResult = await db.execute(sql`
        SELECT
          status,
          COUNT(*)::int AS count
        FROM campaign_recipients
        WHERE campaign_id = ${id}
        GROUP BY status
      `);

      const breakdown: Record<string, number> = {};
      for (const row of breakdownResult.rows as any[]) {
        breakdown[row.status] = Number(row.count);
      }

      // Get recipients list (paginated)
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 50));
      const offset = (page - 1) * limit;

      const recipients = await db
        .select()
        .from(campaignRecipientsTable)
        .where(eq(campaignRecipientsTable.campaignId, id))
        .orderBy(desc(campaignRecipientsTable.sentAt))
        .limit(limit)
        .offset(offset);

      const totalResult = await db.execute(sql`
        SELECT COUNT(*)::int AS total FROM campaign_recipients WHERE campaign_id = ${id}
      `);
      const total = Number((totalResult.rows[0] as any)?.total ?? 0);

      res.json({
        campaign,
        recipientBreakdown: breakdown,
        recipients,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      });
    } catch (error: any) {
      console.error("Error fetching campaign analytics:", error);
      res.status(500).json({ message: "Failed to fetch campaign analytics" });
    }
  });

  // Reconcile campaign counters from recipient rows
  app.post("/api/admin/campaigns/:id/reconcile", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const user = await authStorage.getUser(userId);
      if (!user || user.tier !== "power") return res.status(403).json({ message: "Admin access required" });
      if (userId !== APP_OWNER_ID) return res.status(403).json({ message: "Owner access required" });

      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Invalid campaign ID" });
      const result = await campaignEmailService.reconcileCampaignCounters(id);
      res.json({ success: true, ...result });
    } catch (error: any) {
      console.error("Error reconciling campaign counters:", error);
      res.status(500).json({ message: "Failed to reconcile counters" });
    }
  });

  // Recover campaigns whose rows were lost but whose recipients still exist.
  // Uses Resend API to fetch subject/body from a sample recipient's resend_id,
  // then reconstructs the campaign row with accurate counters.
  app.post("/api/admin/campaigns/recover", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const user = await authStorage.getUser(userId);
      if (!user || user.tier !== "power") return res.status(403).json({ message: "Admin access required" });
      if (userId !== APP_OWNER_ID) return res.status(403).json({ message: "Owner access required" });

      // Find campaign IDs referenced by recipients but missing from campaigns table
      const orphanRows = await db.execute(sql`
        SELECT DISTINCT cr.campaign_id
        FROM campaign_recipients cr
        LEFT JOIN campaigns c ON c.id = cr.campaign_id
        WHERE c.id IS NULL
      `);

      const orphanedIds = (orphanRows.rows as { campaign_id: number }[]).map(r => r.campaign_id);
      if (orphanedIds.length === 0) {
        return res.json({ recovered: 0, campaigns: [], message: "No orphaned recipients found — campaign data appears intact." });
      }

      const resend = getResendClient();
      const recovered: Array<{ id: number; name: string; subject: string; totalRecipients: number }> = [];

      for (const campaignId of orphanedIds) {
        // Aggregate counters from recipient rows
        const statsResult = await db.execute(sql`
          SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status IN ('sent','delivered','opened','clicked'))::int AS sent,
            COUNT(*) FILTER (WHERE status = 'failed' OR status = 'bounced' OR status = 'complained')::int AS failed,
            COUNT(*) FILTER (WHERE status IN ('delivered','opened','clicked'))::int AS delivered,
            COUNT(*) FILTER (WHERE status IN ('opened','clicked'))::int AS opened,
            COUNT(*) FILTER (WHERE status = 'clicked')::int AS clicked,
            MIN(sent_at) AS first_sent,
            MAX(sent_at) AS last_sent
          FROM campaign_recipients
          WHERE campaign_id = ${campaignId}
        `);

        const stats = statsResult.rows[0] as any;

        // Try to recover subject/body from Resend API using a sample resend_id
        let subject = `Recovered Campaign #${campaignId}`;
        let htmlBody = "<p>(Email body could not be recovered)</p>";

        if (resend) {
          const sampleRow = await db.execute(sql`
            SELECT resend_id FROM campaign_recipients
            WHERE campaign_id = ${campaignId} AND resend_id IS NOT NULL
            LIMIT 1
          `);

          const sampleResendId = (sampleRow.rows[0] as { resend_id: string } | undefined)?.resend_id;
          if (sampleResendId) {
            try {
              const emailData = await resend.emails.get(sampleResendId);
              if (emailData.data) {
                subject = emailData.data.subject ?? subject;
                htmlBody = emailData.data.html ?? htmlBody;
              }
            } catch (e) {
              console.warn(`[CampaignRecover] Could not fetch sample email for campaign ${campaignId}:`, e instanceof Error ? e.message : "unknown error");
            }
          }
        }

        // Determine status from counters
        const sentCount = Number(stats.sent);
        const failedCount = Number(stats.failed);
        const totalCount = Number(stats.total);
        let status: string;
        if (sentCount === 0 && failedCount === 0) {
          status = "draft";
        } else if (failedCount > 0) {
          status = "partially_sent";
        } else {
          status = "sent";
        }

        // Re-insert the campaign row with its original ID using raw SQL
        // so that the foreign key from campaign_recipients is satisfied again.
        // ON CONFLICT DO NOTHING makes retries safe if a prior attempt partially completed.
        const insertResult = await db.execute(sql`
          INSERT INTO campaigns (id, name, subject, html_body, status, type, total_recipients,
            sent_count, failed_count, delivered_count, opened_count, clicked_count,
            created_at, sent_at, completed_at)
          VALUES (
            ${campaignId},
            ${`Recovered Campaign #${campaignId}`},
            ${subject},
            ${htmlBody},
            ${status},
            'manual',
            ${Number(stats.total)},
            ${Number(stats.sent)},
            ${Number(stats.failed)},
            ${Number(stats.delivered)},
            ${Number(stats.opened)},
            ${Number(stats.clicked)},
            COALESCE(${stats.first_sent}::timestamptz, NOW()),
            ${stats.first_sent ?? null}::timestamptz,
            ${stats.last_sent ?? null}::timestamptz
          )
          ON CONFLICT (id) DO NOTHING
        `);

        // Skip if already recovered (idempotent retry)
        if (insertResult.rowCount === 0) continue;

        recovered.push({
          id: campaignId,
          name: `Recovered Campaign #${campaignId}`,
          subject,
          totalRecipients: Number(stats.total),
        });
      }

      // Advance the serial sequence past all recovered IDs so future inserts don't collide
      if (recovered.length > 0) {
        await db.execute(sql`
          SELECT setval('campaigns_id_seq', (SELECT MAX(id) FROM campaigns))
        `);
      }

      res.json({ recovered: recovered.length, campaigns: recovered });
    } catch (error: any) {
      console.error("Error recovering campaigns:", error instanceof Error ? error.message : "unknown error");
      res.status(500).json({ message: "Failed to recover campaigns" });
    }
  });

  // Public unsubscribe endpoint (no auth required)
  // GET shows a confirmation page; POST performs the actual unsubscribe.
  // This prevents link prefetchers / email scanners from triggering unsubscribes.
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  app.get("/api/campaigns/unsubscribe/:token", unauthenticatedRateLimiter, async (req: any, res) => {
    try {
      const { token } = req.params;
      if (!token || !UUID_REGEX.test(token)) return res.status(400).send("Invalid unsubscribe link.");

      const [user] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.unsubscribeToken, token))
        .limit(1);

      if (!user) {
        return res.status(404).send(`
          <!DOCTYPE html>
          <html><head><title>Unsubscribe</title><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
          <body style="font-family:system-ui,sans-serif;max-width:480px;margin:40px auto;padding:20px;text-align:center;color:#333;">
            <h2>Invalid Link</h2>
            <p>This unsubscribe link is invalid or has expired.</p>
          </body></html>
        `);
      }

      const safeToken = encodeURIComponent(token);
      res.send(`
        <!DOCTYPE html>
        <html><head><title>Unsubscribe</title><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
        <body style="font-family:system-ui,sans-serif;max-width:480px;margin:40px auto;padding:20px;text-align:center;color:#333;">
          <h2>Unsubscribe</h2>
          <p>Click the button below to unsubscribe from FetchTheChange campaign emails.</p>
          <p style="color:#666;font-size:14px;">You will continue to receive monitor change notifications.</p>
          <form method="POST" action="/api/campaigns/unsubscribe/${safeToken}/confirm">
            <button type="submit" style="margin-top:16px;padding:10px 24px;background:#4f46e5;color:#fff;border:none;border-radius:6px;font-size:16px;cursor:pointer;">
              Unsubscribe
            </button>
          </form>
        </body></html>
      `);
    } catch (error: any) {
      console.error("Error processing unsubscribe:", error);
      res.status(500).send("An error occurred. Please try again.");
    }
  });

  app.post("/api/campaigns/unsubscribe/:token/confirm", unauthenticatedRateLimiter, async (req: any, res) => {
    try {
      const { token } = req.params;
      if (!token || !UUID_REGEX.test(token)) return res.status(400).send("Invalid unsubscribe link.");

      const [user] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.unsubscribeToken, token))
        .limit(1);

      if (!user) {
        return res.status(404).send(`
          <!DOCTYPE html>
          <html><head><title>Unsubscribe</title><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
          <body style="font-family:system-ui,sans-serif;max-width:480px;margin:40px auto;padding:20px;text-align:center;color:#333;">
            <h2>Invalid Link</h2>
            <p>This unsubscribe link is invalid or has expired.</p>
          </body></html>
        `);
      }

      await db
        .update(usersTable)
        .set({ campaignUnsubscribed: true })
        .where(eq(usersTable.id, user.id));

      const safeToken = encodeURIComponent(token);
      res.send(`
        <!DOCTYPE html>
        <html><head><title>Unsubscribed</title><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
        <body style="font-family:system-ui,sans-serif;max-width:480px;margin:40px auto;padding:20px;text-align:center;color:#333;">
          <h2>Unsubscribed</h2>
          <p>You have been successfully unsubscribed from FetchTheChange campaign emails.</p>
          <p style="color:#666;font-size:14px;">You will continue to receive monitor change notifications.</p>
          <br/>
          <form method="POST" action="/api/campaigns/resubscribe/${safeToken}" style="display:inline;">
            <button type="submit" style="background:none;border:none;color:#4f46e5;text-decoration:underline;cursor:pointer;font-size:inherit;font-family:inherit;">Re-subscribe to campaign emails</button>
          </form>
        </body></html>
      `);
    } catch (error: any) {
      console.error("Error processing unsubscribe:", error);
      res.status(500).send("An error occurred. Please try again.");
    }
  });

  // Public resubscribe endpoint (no auth required)
  app.post("/api/campaigns/resubscribe/:token", unauthenticatedRateLimiter, async (req: any, res) => {
    try {
      const { token } = req.params;
      if (!token || !UUID_REGEX.test(token)) return res.status(400).json({ message: "Invalid token" });

      const [user] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.unsubscribeToken, token))
        .limit(1);

      if (!user) return res.status(404).json({ message: "Invalid token" });

      await db
        .update(usersTable)
        .set({ campaignUnsubscribed: false })
        .where(eq(usersTable.id, user.id));

      res.send(`
        <!DOCTYPE html>
        <html><head><title>Re-subscribed</title><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
        <body style="font-family:system-ui,sans-serif;max-width:480px;margin:40px auto;padding:20px;text-align:center;color:#333;">
          <h2>Re-subscribed</h2>
          <p>You have been re-subscribed to FetchTheChange campaign emails.</p>
        </body></html>
      `);
    } catch (error: any) {
      console.error("Error processing resubscribe:", error);
      res.status(500).send("An error occurred. Please try again.");
    }
  });

  // ------------------------------------------------------------------
  // AUTOMATED CAMPAIGN ROUTES
  // ------------------------------------------------------------------

  const { automatedCampaignConfigs: automatedConfigsTable } = await import("@shared/schema");
  const automatedCampaignService = await import("./services/automatedCampaigns");

  // GET /api/admin/automated-campaigns — list all configs
  app.get("/api/admin/automated-campaigns", isAuthenticated, async (req: any, res) => {
    if (!(await requireCampaignConfigsReady(res))) return;
    try {
      const userId = req.user?.claims?.sub;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const user = await authStorage.getUser(userId);
      if (!user || user.tier !== "power") return res.status(403).json({ message: "Admin access required" });
      if (userId !== APP_OWNER_ID) return res.status(403).json({ message: "Owner access required" });

      const configs = await db
        .select()
        .from(automatedConfigsTable)
        .orderBy(automatedConfigsTable.key);

      res.json(configs);
    } catch (error: any) {
      console.error("Error fetching automated campaign configs:", error);
      res.status(500).json({ message: "Failed to fetch automated campaign configs" });
    }
  });

  // PATCH /api/admin/automated-campaigns/:key — update config
  app.patch("/api/admin/automated-campaigns/:key", isAuthenticated, async (req: any, res) => {
    if (!(await requireCampaignConfigsReady(res))) return;
    try {
      const userId = req.user?.claims?.sub;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const user = await authStorage.getUser(userId);
      if (!user || user.tier !== "power") return res.status(403).json({ message: "Admin access required" });
      if (userId !== APP_OWNER_ID) return res.status(403).json({ message: "Owner access required" });

      const { key } = req.params;
      const updateSchema = z.object({
        subject: z.string().min(1).optional(),
        htmlBody: z.string().min(1).optional(),
        textBody: z.string().optional(),
        enabled: z.boolean().optional(),
      }).strict();

      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
      }

      const updates = parsed.data;
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ message: "No fields to update" });
      }

      const [updated] = await db
        .update(automatedConfigsTable)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(automatedConfigsTable.key, key))
        .returning();

      if (!updated) return res.status(404).json({ message: "Config not found" });

      res.json(updated);
    } catch (error: any) {
      console.error("Error updating automated campaign config:", error);
      res.status(500).json({ message: "Failed to update automated campaign config" });
    }
  });

  // POST /api/admin/automated-campaigns/:key/trigger — manual trigger
  const autoCampaignTriggerRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 2,
    keyGenerator: (req: any) => req.user?.claims?.sub || ipKeyGenerator(req.ip || "0.0.0.0"),
    message: { message: "Too many trigger requests. Try again later." },
  });
  app.post("/api/admin/automated-campaigns/:key/trigger", isAuthenticated, autoCampaignTriggerRateLimiter, async (req: any, res) => {
    if (!(await requireCampaignConfigsReady(res))) return;
    try {
      const userId = req.user?.claims?.sub;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const user = await authStorage.getUser(userId);
      if (!user || user.tier !== "power") return res.status(403).json({ message: "Admin access required" });
      if (userId !== APP_OWNER_ID) return res.status(403).json({ message: "Owner access required" });

      const { key } = req.params;
      const triggerSchema = z.object({
        signupAfter: z.string().datetime().optional(),
      }).strict();

      const parsed = triggerSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
      }

      const [config] = await db
        .select()
        .from(automatedConfigsTable)
        .where(eq(automatedConfigsTable.key, key))
        .limit(1);

      if (!config) return res.status(404).json({ message: "Config not found" });

      const signupAfter = parsed.data.signupAfter
        ? new Date(parsed.data.signupAfter)
        : config.lastRunAt || new Date("2025-03-19T00:00:00Z");
      const signupBefore = new Date();

      const result = await automatedCampaignService.runWelcomeCampaign({
        signupAfter,
        signupBefore,
        configId: config.id,
      });

      if ("skipped" in result) {
        res.json({ skipped: true, reason: "No new recipients" });
      } else {
        // Update lastRunAt and nextRunAt
        const now = new Date();
        const nextRunAt = automatedCampaignService.computeNextRunAt(now);
        await db
          .update(automatedConfigsTable)
          .set({ lastRunAt: now, nextRunAt, updatedAt: now })
          .where(eq(automatedConfigsTable.id, config.id));

        res.json({ campaignId: result.campaignId, totalRecipients: result.totalRecipients });
      }
    } catch (error: any) {
      console.error("Error triggering automated campaign:", error);
      res.status(500).json({ message: "Failed to trigger automated campaign" });
    }
  });

  // ---------------------------------------------------------------
  // TAGS CRUD ROUTES
  // ---------------------------------------------------------------

  app.get(api.tags.list.path, isAuthenticated, async (req: any, res) => {
    const userId = req.user.claims.sub;
    const userTags = await storage.listUserTags(userId);
    res.json(userTags);
  });

  app.post(api.tags.create.path, isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;

      // Tier check
      const user = await authStorage.getUser(userId);
      const tier = (user?.tier || "free") as UserTier;
      const limit = TAG_LIMITS[tier] ?? TAG_LIMITS.free;
      const currentCount = await storage.countUserTags(userId);

      if (currentCount >= limit) {
        console.log(`[Tags] Tag limit reached for ${tier} user ${userId} (${currentCount}/${limit})`);
        if (tier === "free") {
          return res.status(400).json({
            message: "Free plan cannot create tags. Upgrade to Pro to organise your monitors with tags.",
            code: "TAG_LIMIT_REACHED",
          });
        }
        return res.status(400).json({
          message: `You've reached your ${tier} plan limit of ${limit} tags. Upgrade to create more.`,
          code: "TAG_LIMIT_REACHED",
        });
      }

      const input = createTagSchema.parse(req.body);
      const nameLower = input.name.toLowerCase();

      // Uniqueness check
      const existing = await storage.listUserTags(userId);
      if (existing.some(t => t.nameLower === nameLower)) {
        return res.status(409).json({
          message: "A tag with this name already exists.",
          code: "TAG_NAME_CONFLICT",
        });
      }

      const tag = await storage.createTag(userId, input.name, nameLower, input.colour);
      console.log(`[Tags] Tag created: userId=${userId}, tagId=${tag.id}, tagName=${tag.name}`);
      res.status(201).json(tag);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message, code: "VALIDATION_ERROR" });
      }
      // Handle unique constraint violation (TOCTOU race on duplicate name)
      if ((err as any)?.code === "23505") {
        return res.status(409).json({
          message: "A tag with this name already exists.",
          code: "TAG_NAME_CONFLICT",
        });
      }
      throw err;
    }
  });

  app.patch(api.tags.update.path, isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const tagId = Number(req.params.id);
      if (!Number.isFinite(tagId) || tagId < 1) {
        return res.status(400).json({ message: "Invalid tag ID", code: "INVALID_INPUT" });
      }

      const existing = await storage.getTag(tagId, userId);
      if (!existing) return res.status(404).json({ message: "Not found", code: "NOT_FOUND" });

      const input = updateTagSchema.parse(req.body);
      const fields: { name?: string; nameLower?: string; colour?: string } = {};

      if (input.name !== undefined) {
        fields.name = input.name;
        fields.nameLower = input.name.toLowerCase();

        // Check uniqueness if name changed
        if (fields.nameLower !== existing.nameLower) {
          const userTags = await storage.listUserTags(userId);
          if (userTags.some(t => t.nameLower === fields.nameLower && t.id !== tagId)) {
            return res.status(409).json({
              message: "A tag with this name already exists.",
              code: "TAG_NAME_CONFLICT",
            });
          }
        }
      }

      if (input.colour !== undefined) {
        fields.colour = input.colour;
      }

      const updated = await storage.updateTag(tagId, userId, fields);
      res.json(updated);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message, code: "VALIDATION_ERROR" });
      }
      // Handle unique constraint violation (TOCTOU race on duplicate name)
      if ((err as any)?.code === "23505") {
        return res.status(409).json({
          message: "A tag with this name already exists.",
          code: "TAG_NAME_CONFLICT",
        });
      }
      throw err;
    }
  });

  app.delete(api.tags.delete.path, isAuthenticated, async (req: any, res) => {
    const userId = req.user.claims.sub;
    const tagId = Number(req.params.id);
    if (!Number.isFinite(tagId) || tagId < 1) {
      return res.status(400).json({ message: "Invalid tag ID", code: "INVALID_INPUT" });
    }

    const existing = await storage.getTag(tagId, userId);
    if (!existing) return res.status(404).json({ message: "Not found", code: "NOT_FOUND" });

    await storage.deleteTag(tagId, userId);
    console.log(`[Tags] Tag deleted: userId=${userId}, tagId=${tagId}, tagName=${existing.name}`);
    res.status(204).send();
  });

  // ---------------------------------------------------------------
  // MONITOR-TAG ASSIGNMENT ROUTE
  // ---------------------------------------------------------------

  app.put(api.monitors.setTags.path, isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const monitorId = Number(req.params.id);
      if (!Number.isFinite(monitorId) || monitorId < 1) {
        return res.status(400).json({ message: "Invalid monitor ID", code: "INVALID_INPUT" });
      }

      // Verify monitor ownership
      const monitor = await storage.getMonitor(monitorId);
      if (!monitor) return res.status(404).json({ message: "Not found", code: "NOT_FOUND" });
      if (String(monitor.userId) !== String(userId)) return res.status(403).json({ message: "Forbidden", code: "FORBIDDEN" });

      const input = setMonitorTagsSchema.parse(req.body);

      // Validate all tagIds belong to the user
      if (input.tagIds.length > 0) {
        const userTags = await storage.listUserTags(userId);
        const userTagIds = new Set(userTags.map(t => t.id));
        for (const tagId of input.tagIds) {
          if (!userTagIds.has(tagId)) {
            console.warn(`[Tags] Foreign tag assignment attempt: userId=${userId}, tagId=${tagId}, monitorId=${monitorId}`);
            return res.status(422).json({
              message: "One or more tags do not belong to your account.",
              code: "INVALID_TAG",
            });
          }
        }

        // Enforce assignment limit
        const user = await authStorage.getUser(userId);
        const tier = (user?.tier || "free") as UserTier;
        const assignLimit = TAG_ASSIGNMENT_LIMITS[tier] ?? TAG_ASSIGNMENT_LIMITS.free;
        if (input.tagIds.length > assignLimit) {
          return res.status(400).json({
            message: `Your ${tier} plan allows up to ${assignLimit} tags per monitor.`,
            code: "TAG_ASSIGNMENT_LIMIT_REACHED",
          });
        }
      }

      await storage.setMonitorTags(monitorId, input.tagIds);
      const updated = await storage.getMonitorWithTags(monitorId);
      res.json(updated);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message, code: "VALIDATION_ERROR" });
      }
      throw err;
    }
  });

  // ---------------------------------------------------------------
  // CHROME EXTENSION API ROUTES
  // ---------------------------------------------------------------
  const { default: extensionRouter } = await import("./routes/extension");
  app.use("/api/extension", extensionRouter);

  // ---------------------------------------------------------------
  // API KEY MANAGEMENT & PUBLIC REST API v1 ROUTES
  // ---------------------------------------------------------------
  if (apiKeysReady) {
    const { default: apiKeyManagementRouter } = await import("./routes/apiKeyManagement");
    app.use("/api/keys", apiKeyManagementRouter);

    const { default: v1Router } = await import("./routes/v1");
    app.use("/api/v1", v1Router);
  } else {
    console.warn("[Startup] API key routes disabled — api_keys table bootstrap failed");
  }

  // Catch-all error handler
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    ErrorLogger.error("api", err.message || "Unhandled API error", err instanceof Error ? err : null, { status: err.status || 500 });
    res.status(err.status || 500).json({ message: "Internal server error" });
  });

  return { httpServer, campaignConfigsReady };
}
