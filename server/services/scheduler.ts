import cron from "node-cron";
import { storage } from "../storage";
import { checkMonitor } from "./scraper";

export async function startScheduler() {
  console.log("Starting scheduler...");
  
  // One-time cleanup of polluted values from legacy data
  await storage.cleanupPollutedValues();

  // Run every minute to check if we need to process anything
  // This is a simple implementation. For production, maybe use a proper queue.
  // We'll filter monitors based on their 'frequency' and 'lastChecked'.
  
  cron.schedule("* * * * *", async () => {
    try {
      const monitors = await storage.getAllActiveMonitors();
      
      for (const monitor of monitors) {
        const lastChecked = monitor.lastChecked ? new Date(monitor.lastChecked) : new Date(0);
        const now = new Date();
        const diffMs = now.getTime() - lastChecked.getTime();
        const diffHours = diffMs / (1000 * 60 * 60);

        let shouldCheck = false;
        
        if (monitor.frequency === "hourly" && diffHours >= 1) {
          shouldCheck = true;
        } else if (monitor.frequency === "daily" && diffHours >= 24) {
          shouldCheck = true;
        } else if (!monitor.lastChecked) {
            shouldCheck = true;
        }

        if (shouldCheck) {
          // Process in background, don't await all sequentially blocking
          checkMonitor(monitor); 
        }
      }
    } catch (error) {
      console.error("Scheduler error:", error);
    }
  });
}
