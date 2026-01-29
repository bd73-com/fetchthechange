import { checkMonitor as scraperCheckMonitor, extractWithBrowserless, getRenderedDomSnapshot, detectPageBlockReason } from "./services/scraper";
import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { setupAuth, registerAuthRoutes, isAuthenticated } from "./replit_integrations/auth";
import { startScheduler } from "./services/scheduler";
import * as cheerio from "cheerio";

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

    // If the scraper returned null, it means it's a known failure (like a block page)
    // We should return a clean success response indicating no value was found
    // rather than throwing a 500 error.
    const finalValue = result.currentValue ?? "Blocked/Unavailable";

    return {
      changed: result.changed,
      currentValue: finalValue,
      previousValue: monitor.currentValue || null
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
        extractedValue: result.value,
        debugFiles: result.debugFiles
      });
    } catch (error: any) {
      console.error("[Debug] Browserless endpoint error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Selector Debug Mode Endpoint
  app.post("/api/monitors/:id/debug", isAuthenticated, async (req: any, res) => {
    try {
      const id = Number(req.params.id);
      const monitor = await storage.getMonitor(id);
      if (!monitor) return res.status(404).json({ message: "Not found" });
      if (monitor.userId !== req.user.claims.sub) return res.status(401).json({ message: "Unauthorized" });

      const snapshot = await getRenderedDomSnapshot(monitor.url);
      const $ = cheerio.load(snapshot.htmlSnippet);
      const isClassName = !monitor.selector.startsWith('.') && !monitor.selector.startsWith('#') && !monitor.selector.includes(' ');
      const effectiveSelector = isClassName ? `.${monitor.selector}` : monitor.selector;
      const count = $(effectiveSelector).length;
      const block = detectPageBlockReason(snapshot.htmlSnippet);

      res.json({
        selector: monitor.selector,
        selectorMatches: count,
        blocked: block.blocked,
        blockReason: block.reason || null,
        pageTitle: snapshot.title,
        finalUrl: snapshot.finalUrl,
        htmlSnippet: snapshot.htmlSnippet
      });
    } catch (error: any) {
      console.error("[Debug] Selector debug endpoint error:", error);
      res.status(500).json({ message: error.message });
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
      const input = api.monitors.create.input.parse(req.body);
      const monitor = await storage.createMonitor({
        ...input,
        userId: req.user.claims.sub,
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

  return httpServer;
}