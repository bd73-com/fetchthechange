import { checkMonitor as scraperCheckMonitor, extractWithBrowserless, detectPageBlockReason, discoverSelectors, validateCssSelector, extractValueFromHtml } from "./services/scraper";
import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { setupAuth, registerAuthRoutes, isAuthenticated } from "./replit_integrations/auth";
import { authStorage } from "./replit_integrations/auth/storage";
import { TIER_LIMITS, BROWSERLESS_CAPS, RESEND_CAPS, PAUSE_THRESHOLDS, type UserTier } from "@shared/models/auth";
import { startScheduler } from "./services/scheduler";
import * as cheerio from "cheerio";
import { getUncachableStripeClient, getStripePublishableKey } from "./stripeClient";
import { sql, desc, eq, and } from "drizzle-orm";
import { db } from "./db";
import { sendNotificationEmail } from "./services/email";
import { ErrorLogger } from "./services/logger";
import { BrowserlessUsageTracker, getMonthResetDate } from "./services/browserlessTracker";
import { ResendUsageTracker, getResendResetDate } from "./services/resendTracker";
import { errorLogs, monitorMetrics } from "@shared/schema";
import {
  generalRateLimiter,
  createMonitorRateLimiter,
  checkMonitorRateLimiter,
  suggestSelectorsRateLimiter,
  emailUpdateRateLimiter,
  contactFormRateLimiter,
  unauthenticatedRateLimiter
} from "./middleware/rateLimiter";


// ------------------------------------------------------------------
// URL VALIDATION - SSRF PROTECTION (shared module)
// ------------------------------------------------------------------
import { isPrivateUrl, ssrfSafeFetch } from './utils/ssrf';

// ------------------------------------------------------------------
// 1. CHECK MONITOR FUNCTION
// ------------------------------------------------------------------
async function checkMonitor(monitor: any) {
  try {
    console.log(`Checking monitor ${monitor.id}: ${monitor.url}`);

    // Use the robust scraper service instead of broken Playwright setup
    const result = await scraperCheckMonitor(monitor);

    if (!result) {
      throw new Error("Could not fetch value from page");
    }

    return {
      changed: result.changed,
      currentValue: result.currentValue,
      previousValue: result.previousValue,
      status: result.status,
      error: result.error
    };

  } catch (error) {
    console.error("Error in checkMonitor:", error);
    throw error;
  }
}

// ------------------------------------------------------------------
// 3. ROUTE REGISTRATION
// ------------------------------------------------------------------
export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

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

  // Start Scheduler
  startScheduler();

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
  app.get("/api/test-email", isAuthenticated, async (req: any, res) => {
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
        createdAt: new Date()
      };

      console.log(`[Test Email] Sending test email to ${user.email}`);
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
  app.post("/api/monitors/:id/debug", isAuthenticated, async (req: any, res) => {
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
    const monitors = await storage.getMonitors(userId);
    res.json(monitors);
  });

  app.get(api.monitors.get.path, isAuthenticated, async (req: any, res) => {
    const monitor = await storage.getMonitor(Number(req.params.id));
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
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.patch(api.monitors.update.path, isAuthenticated, async (req: any, res) => {
    const id = Number(req.params.id);
    const existing = await storage.getMonitor(id);
    if (!existing) return res.status(404).json({ message: "Not found" });
    if (String(existing.userId) !== String(req.user.claims.sub)) return res.status(403).json({ message: "Forbidden" });

    const input = api.monitors.update.input.parse(req.body);

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
    const id = Number(req.params.id);
    const existing = await storage.getMonitor(id);
    if (!existing) return res.status(404).json({ message: "Not found" });
    if (String(existing.userId) !== String(req.user.claims.sub)) return res.status(403).json({ message: "Forbidden" });

    const result = await checkMonitor(existing);
    res.json(result);
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

      if (!process.env.RESEND_API_KEY) {
        console.error(`[Support] RESEND_API_KEY not set. Cannot send email.`);
        console.log(`[Support] From: ${input.email}, Category: ${input.category}, Subject: ${input.subject}`);
        console.log(`[Support] Message: ${input.message}`);
        return res.status(503).json({ message: "Email service is not configured. Please try again later or contact us directly." });
      }

      const { Resend } = await import("resend");
      const resend = new Resend(process.env.RESEND_API_KEY);
      const fromAddress = process.env.RESEND_FROM || "onboarding@resend.dev";
      const supportEmail = process.env.SUPPORT_EMAIL;
      if (!supportEmail) {
        console.error(`[Support] SUPPORT_EMAIL not set. Cannot send email.`);
        console.log(`[Support] From: ${input.email}, Category: ${input.category}, Subject: ${input.subject}`);
        console.log(`[Support] Message: ${input.message}`);
        return res.status(503).json({ message: "Email service is not configured. Please try again later or contact us directly." });
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
        subject: `[Support - ${categoryLabels[input.category]}] ${input.subject}`,
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
        return res.status(400).json({ message: err.errors[0].message });
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
      const limitNum = Math.min(Number(req.query.limit) || 100, 500);

      const conditions = [];
      if (level && ["error", "warning", "info"].includes(level)) {
        conditions.push(eq(errorLogs.level, level));
      }
      if (source && ["scraper", "email", "scheduler", "api"].includes(source)) {
        conditions.push(eq(errorLogs.source, source));
      }

      let query = conditions.length > 0
        ? db.select().from(errorLogs).where(and(...conditions)).orderBy(desc(errorLogs.timestamp)).limit(limitNum)
        : db.select().from(errorLogs).orderBy(desc(errorLogs.timestamp)).limit(limitNum);

      const allResults = await query;

      const isAppOwner = userId === APP_OWNER_ID;

      const userMonitorIds = new Set(
        (await storage.getMonitors(userId)).map((m: any) => m.id)
      );

      const filtered = allResults.filter((log: any) => {
        const ctx = log.context;
        const monitorId = ctx?.monitorId;
        if (monitorId != null) {
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
          CASE WHEN COALESCE(SUM(sent_count), 0) > 0
            THEN ROUND(COALESCE(SUM(opened_count), 0)::numeric / SUM(sent_count) * 100, 1)
            ELSE 0
          END AS "avgOpenRate",
          CASE WHEN COALESCE(SUM(sent_count), 0) > 0
            THEN ROUND(COALESCE(SUM(clicked_count), 0)::numeric / SUM(sent_count) * 100, 1)
            ELSE 0
          END AS "avgClickRate"
        FROM campaigns
        WHERE status != 'draft'
      `);

      const recentCampaigns = await db
        .select()
        .from(campaignsTable)
        .orderBy(desc(campaignsTable.createdAt))
        .limit(10);

      const stats = result.rows[0] as any;
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
      const limit = Math.min(100, Number(req.query.limit) || 50);
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

  // Catch-all error handler
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    ErrorLogger.error("api", err.message || "Unhandled API error", err instanceof Error ? err : null, { status: err.status || 500 });
    res.status(err.status || 500).json({ message: "Internal server error" });
  });

  return httpServer;
}