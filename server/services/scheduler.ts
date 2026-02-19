import cron from "node-cron";
import { storage } from "../storage";
import { checkMonitor } from "./scraper";
import { ErrorLogger } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";

const MAX_CONCURRENT_CHECKS = 10;
let activeChecks = 0;

async function runCheckWithLimit(monitor: Parameters<typeof checkMonitor>[0]) {
  if (activeChecks >= MAX_CONCURRENT_CHECKS) {
    console.debug(`[Scheduler] Concurrency limit reached, deferring monitor ${monitor.id}`);
    return;
  }
  activeChecks++;
  try {
    await checkMonitor(monitor);
  } catch (error) {
    await ErrorLogger.error("scheduler", `"${monitor.name}" — scheduled check failed. This is usually a temporary issue. If it persists, verify the URL is still valid and the selector matches the page.`, error instanceof Error ? error : null, {
      monitorId: monitor.id,
      monitorName: monitor.name,
      url: monitor.url,
      selector: monitor.selector,
    });
  } finally {
    activeChecks--;
  }
}

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
          const jitterMs = Math.floor(Math.random() * 30000);
          setTimeout(() => {
            runCheckWithLimit(monitor);
          }, jitterMs);
        }
      }
    } catch (error) {
      await ErrorLogger.error("scheduler", "Scheduler iteration failed", error instanceof Error ? error : null);
    }
  });

  // Daily cleanup: prune monitor_metrics older than 90 days to prevent unbounded growth
  cron.schedule("0 3 * * *", async () => {
    try {
      const result = await db.execute(
        sql`DELETE FROM monitor_metrics WHERE checked_at < NOW() - INTERVAL '90 days'`
      );
      const deleted = (result as any).rowCount ?? 0;
      if (deleted > 0) {
        console.log(`[Cleanup] Pruned ${deleted} monitor_metrics rows older than 90 days`);
      }
    } catch (error) {
      await ErrorLogger.error("scheduler", "monitor_metrics cleanup failed", error instanceof Error ? error : null);
    }
  });
}
