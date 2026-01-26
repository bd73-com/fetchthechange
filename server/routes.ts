import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { setupAuth, registerAuthRoutes, isAuthenticated } from "./replit_integrations/auth";
import { checkMonitor } from "./services/scraper";
import { startScheduler } from "./services/scheduler";

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
      
      // Initial check (async)
      checkMonitor(monitor);
      
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
