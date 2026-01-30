import { checkMonitor as scraperCheckMonitor, extractWithBrowserless, detectPageBlockReason, discoverSelectors } from "./services/scraper";
import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { setupAuth, registerAuthRoutes, isAuthenticated } from "./replit_integrations/auth";
import { authStorage } from "./replit_integrations/auth/storage";
import { TIER_LIMITS, type UserTier } from "@shared/models/auth";
import { startScheduler } from "./services/scheduler";
import * as cheerio from "cheerio";
import { getUncachableStripeClient, getStripePublishableKey } from "./stripeClient";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { sendNotificationEmail } from "./services/email";

// Dev-only auth bypass middleware for testing debug/suggest endpoints
// Usage: Add header "x-dev-bypass: true" in development mode
function devAuthBypass(req: any, res: Response, next: NextFunction) {
  if (process.env.NODE_ENV === "development" && req.headers["x-dev-bypass"] === "true") {
    // In dev mode with bypass header, set a fake user
    req.user = { claims: { sub: "dev-test-user" } };
    return next();
  }
  // Otherwise use normal auth
  return isAuthenticated(req, res, next);
}

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

  // Setup Auth
  await setupAuth(app);
  registerAuthRoutes(app);

  // Start Scheduler
  startScheduler();

  // Debug Browserless Endpoint
  app.post("/api/debug/browserless", isAuthenticated, async (req: any, res) => {
    try {
      const { url, selector } = req.body;
      if (!url || !selector) {
        return res.status(400).json({ message: "URL and Selector are required" });
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
      res.status(500).json({ message: error.message });
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
        message: error.message,
        details: {
          apiKeyConfigured: !!process.env.RESEND_API_KEY
        }
      });
    }
  });

  // Selector Debug Mode Endpoint
  // Dev bypass example: curl -X POST http://localhost:5000/api/monitors/3/debug -H "x-dev-bypass: true"
  // Auth example: curl -X POST http://localhost:5000/api/monitors/3/debug -H "Cookie: connect.sid=..."
  app.post("/api/monitors/:id/debug", devAuthBypass, async (req: any, res) => {
    try {
      const id = Number(req.params.id);
      console.log(`[Debug] monitorId=${id}`);
      const monitor = await storage.getMonitor(id);
      if (!monitor) return res.status(404).json({ message: "Not found" });
      // Skip user check if dev bypass
      if (req.headers["x-dev-bypass"] !== "true" && monitor.userId !== req.user.claims.sub) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      // Static Phase
      let staticHtml = "";
      try {
        const response = await fetch(monitor.url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36' },
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
          const result = await extractWithBrowserless(monitor.url, monitor.selector);
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
      res.status(500).json({ message: error.message });
    }
  });

  // Selector suggestion endpoint
  // Dev bypass example: curl -X POST http://localhost:5000/api/monitors/3/suggest-selectors -H "x-dev-bypass: true" -H "Content-Type: application/json" -d '{"expectedText":"$3,200.00"}'
  // Auth example: curl -X POST http://localhost:5000/api/monitors/3/suggest-selectors -H "Cookie: connect.sid=..." -H "Content-Type: application/json" -d '{"expectedText":"$3,200.00"}'
  app.post("/api/monitors/:id/suggest-selectors", devAuthBypass, async (req: any, res) => {
    try {
      const id = Number(req.params.id);
      const { expectedText } = req.body || {};
      console.log(`[Suggest] monitorId=${id} expectedText="${expectedText || '(none)'}"`)
      
      const monitor = await storage.getMonitor(id);
      if (!monitor) return res.status(404).json({ message: "Not found" });
      // Skip user check if dev bypass
      if (req.headers["x-dev-bypass"] !== "true" && monitor.userId !== req.user.claims.sub) {
        return res.status(401).json({ message: "Unauthorized" });
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
      res.status(500).json({ message: `Failed to analyze page: ${errorMessage || "Unknown error"}. Please try again.` });
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
    if (monitor.userId !== req.user.claims.sub) return res.status(401).json({ message: "Unauthorized" });
    res.json(monitor);
  });

  app.post(api.monitors.create.path, isAuthenticated, async (req: any, res) => {
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
      const monitor = await storage.createMonitor({
        ...input,
        userId,
      } as any);

      // We don't await this so the UI returns immediately
      checkMonitor(monitor).catch(console.error);

      res.status(201).json(monitor);
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
    if (existing.userId !== req.user.claims.sub) return res.status(401).json({ message: "Unauthorized" });

    const input = api.monitors.update.input.parse(req.body);
    const updated = await storage.updateMonitor(id, input);
    res.json(updated);
  });

  app.delete(api.monitors.delete.path, isAuthenticated, async (req: any, res) => {
    const id = Number(req.params.id);
    const existing = await storage.getMonitor(id);
    if (!existing) return res.status(404).json({ message: "Not found" });
    if (existing.userId !== req.user.claims.sub) return res.status(401).json({ message: "Unauthorized" });

    await storage.deleteMonitor(id);
    res.status(204).send();
  });

  app.get(api.monitors.history.path, isAuthenticated, async (req: any, res) => {
    const id = Number(req.params.id);
    const existing = await storage.getMonitor(id);
    if (!existing) return res.status(404).json({ message: "Not found" });
    if (existing.userId !== req.user.claims.sub) return res.status(401).json({ message: "Unauthorized" });

    const changes = await storage.getMonitorChanges(id);
    res.json(changes);
  });

  app.post(api.monitors.check.path, isAuthenticated, async (req: any, res) => {
    const id = Number(req.params.id);
    const existing = await storage.getMonitor(id);
    if (!existing) return res.status(404).json({ message: "Not found" });
    if (existing.userId !== req.user.claims.sub) return res.status(401).json({ message: "Unauthorized" });

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
      res.status(500).json({ message: error.message || "Failed to create checkout session" });
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

  return httpServer;
}