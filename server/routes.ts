import { chromium } from "playwright";
import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { setupAuth, registerAuthRoutes, isAuthenticated } from "./replit_integrations/auth";
import { startScheduler } from "./services/scheduler";

// ------------------------------------------------------------------
// 1. SCRAPER FUNCTION (Playwright)
// ------------------------------------------------------------------
async function scrapeJomashop(url: string) {
  console.log(`[Scraper] Starting browser for: ${url}`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    });

    const page = await context.newPage();

    console.log(`[Scraper] Navigating to ${url}...`);
    await page.goto(url);

    // Wait up to 15s for the price to render
    try {
        console.log("[Scraper] Waiting for .price-now selector...");
        await page.waitForSelector(".price-now", { timeout: 15000 });

        const price = await page.innerText(".price-now");
        const cleanPrice = price.trim();

        console.log(`[Scraper] Success! Found: ${cleanPrice}`);
        return cleanPrice;
    } catch (e) {
        console.log("[Scraper] Price selector not found.");
        return null; 
    }

  } catch (error) {
    console.error("[Scraper] Critical Error:", error);
    return null;
  } finally {
    await browser.close();
  }
}

// ------------------------------------------------------------------
// 2. CHECK MONITOR FUNCTION
// ------------------------------------------------------------------
async function checkMonitor(monitor: any) {
  try {
    console.log(`Checking monitor ${monitor.id}: ${monitor.url}`);

    // Get the new value
    const value = await scrapeJomashop(monitor.url);

    if (!value) {
        throw new Error("Could not fetch price from Jomashop");
    }

    const hasChanged = value !== monitor.lastValue;

    // Update Database
    await storage.updateMonitor(monitor.id, {
        lastCheck: new Date(),
        lastValue: value,
    });

    // Create Ping Record
    // (Wrapped in try/catch in case createPing is missing from your storage interface)
    try {
        if (storage.createPing) {
            await storage.createPing({
                monitorId: monitor.id,
                value: value,
                timestamp: new Date()
            });
        }
    } catch (err) {
        console.warn("Could not save ping history:", err);
    }

    // --- FIX: Return the exact shape Zod expects ---
    return {
        changed: hasChanged,
        currentValue: value,
        previousValue: monitor.lastValue || null
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
      const input = api.monitors.create.input.parse(req.body);
      const monitor = await storage.createMonitor({
        ...input,
        userId: req.user.claims.sub,
        active: input.active ?? true,
        emailEnabled: input.emailEnabled ?? true,
        frequency: input.frequency ?? "daily",
      });

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

  return httpServer;
}