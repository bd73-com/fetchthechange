import type { Express } from "express";
import { authStorage } from "./storage";
import { isAuthenticated } from "./replitAuth";
import { z } from "zod";
import { emailUpdateRateLimiter } from "../../middleware/rateLimiter";

export function registerAuthRoutes(app: Express): void {
  app.get("/api/auth/user", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await authStorage.getUser(userId);
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  app.patch("/api/auth/user/notification-email", isAuthenticated, emailUpdateRateLimiter, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const schema = z.object({
        notificationEmail: z.string().email().nullable(),
      });
      
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid email address" });
      }

      const user = await authStorage.updateNotificationEmail(userId, parsed.data.notificationEmail);
      res.json(user);
    } catch (error) {
      console.error("Error updating notification email:", error);
      res.status(500).json({ message: "Failed to update notification email" });
    }
  });
}
