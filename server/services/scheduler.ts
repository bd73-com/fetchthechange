import cron from "node-cron";
import { storage } from "../storage";
import { checkMonitor, monitorsNeedingRetry } from "./scraper";
import { processQueuedNotifications, processDigestCron } from "./notification";
import { deliver as deliverWebhook, type WebhookConfig } from "./webhookDelivery";
import { ErrorLogger } from "./logger";
import { notificationTablesExist } from "./notificationReady";
import { browserlessCircuitBreaker } from "./browserlessCircuitBreaker";
import { ensureMonitorConditionsTable } from "./ensureTables";
import { db } from "../db";
import { sql } from "drizzle-orm";

const MAX_CONCURRENT_CHECKS = 10;
const BASE_RETRY_MS = 2 * 60 * 1000; // 2 minutes
const MAX_RETRY_MS = 15 * 60 * 1000; // 15 minutes
let activeChecks = 0;

/** Per-monitor backoff tracker for accelerated retries. */
export const retryBackoff = new Map<number, { attempts: number }>();

async function runCheckWithLimit(monitor: Parameters<typeof checkMonitor>[0]): Promise<boolean> {
  if (activeChecks >= MAX_CONCURRENT_CHECKS) {
    console.debug(`[Scheduler] Concurrency limit reached, deferring monitor ${monitor.id}`);
    return false;
  }
  activeChecks++;
  try {
    await checkMonitor(monitor);
    return true;
  } catch (error) {
    await ErrorLogger.error("scheduler", `"${monitor.name}" — scheduled check failed. This is usually a temporary issue. If it persists, verify the URL is still valid and the selector matches the page.`, error instanceof Error ? error : null, {
      monitorId: monitor.id,
      monitorName: monitor.name,
      url: monitor.url,
      selector: monitor.selector,
    });
    return true;
  } finally {
    activeChecks--;
  }
}

export async function startScheduler() {
  console.log("Starting scheduler...");

  // Ensure monitor_conditions table exists — routes.ts calls this too, but
  // the scheduler may start before routes finish or the routes call may have
  // failed due to a transient DB error. Use a timeout so a hung DB connection
  // doesn't block scheduler startup indefinitely.
  const tableReady = await Promise.race([
    ensureMonitorConditionsTable(),
    new Promise<boolean>(resolve => setTimeout(() => {
      console.warn("[Scheduler] ensureMonitorConditionsTable timed out after 10s — continuing startup");
      resolve(false);
    }, 10000)),
  ]);
  if (!tableReady) {
    // Retry in background so table/index creation can complete
    setTimeout(() => ensureMonitorConditionsTable().catch(() => {}), 30000);
  }

  // One-time cleanup of polluted values from legacy data
  await storage.cleanupPollutedValues();

  // Wire circuit breaker recovery: immediately retry pending monitors when Browserless comes back
  browserlessCircuitBreaker.onClose(() => {
    storage.getAllActiveMonitors().then((allMonitors) => {
      const pendingIds = Array.from(monitorsNeedingRetry);
      const pendingMonitors = allMonitors.filter(m => pendingIds.includes(m.id));
      for (const monitor of pendingMonitors) {
        const jitterMs = Math.floor(Math.random() * 5000);
        setTimeout(() => runCheckWithLimit(monitor), jitterMs);
      }
      // Reset backoff for all retried monitors
      for (const id of pendingIds) {
        retryBackoff.delete(id);
      }
    }).catch(() => {}); // best-effort
  });

  // Run every minute to check if we need to process anything
  // This is a simple implementation. For production, maybe use a proper queue.
  // We'll filter monitors based on their 'frequency' and 'lastChecked'.

  cron.schedule("* * * * *", async () => {
    try {
      const monitors = await storage.getAllActiveMonitors();

      for (const monitor of monitors) {
        try {
          const lastChecked = monitor.lastChecked ? new Date(monitor.lastChecked) : new Date(0);
          const now = new Date();
          const diffMs = now.getTime() - lastChecked.getTime();
          const diffHours = diffMs / (1000 * 60 * 60);

          let shouldCheck = false;

          // Accelerated retry: monitors affected by Browserless infra failures
          // get retried with exponential backoff (2 min → 4 min → 8 min → 15 min cap)
          if (monitorsNeedingRetry.has(monitor.id)) {
            const backoff = retryBackoff.get(monitor.id) ?? { attempts: 0 };
            const interval = Math.min(BASE_RETRY_MS * Math.pow(2, backoff.attempts), MAX_RETRY_MS);
            if (diffMs >= interval) {
              shouldCheck = true;
            }
          } else {
            // Clean up backoff entry if monitor is no longer in retry set
            retryBackoff.delete(monitor.id);
          }

          if (!shouldCheck) {
            if (monitor.frequency === "hourly" && diffHours >= 1) {
              shouldCheck = true;
            } else if (monitor.frequency === "daily" && diffHours >= 24) {
              shouldCheck = true;
            } else if (!monitor.lastChecked) {
              shouldCheck = true;
            }
          }

          if (shouldCheck) {
            const jitterMs = Math.floor(Math.random() * 30000);
            setTimeout(() => {
              void runCheckWithLimit(monitor).then((started) => {
                if (!started || !monitorsNeedingRetry.has(monitor.id)) return;
                const b = retryBackoff.get(monitor.id) ?? { attempts: 0 };
                retryBackoff.set(monitor.id, { attempts: b.attempts + 1 });
              });
            }, jitterMs);
          }
        } catch (monitorError) {
          // Isolate per-monitor failures so one bad monitor can't crash the iteration
          console.error(`[Scheduler] Error processing monitor ${monitor.id}:`, monitorError instanceof Error ? monitorError.message : monitorError);
        }
      }
    } catch (error) {
      await ErrorLogger.error("scheduler", "Scheduler iteration failed", error instanceof Error ? error : null, {
        errorMessage: error instanceof Error ? error.message : String(error),
        activeChecks,
        phase: "fetching active monitors",
      });
    }
  });

  // Process queued notifications (quiet hours + digest delivery) every minute,
  // but only if the notification tables have been migrated
  const hasNotificationTables = await notificationTablesExist();
  if (!hasNotificationTables) {
    console.warn("[Scheduler] Notification tables (notification_preferences, notification_queue) do not exist yet — skipping notification cron. Run `npm run schema:push` to create them.");
  } else {
    let notificationCronRunning = false;
    cron.schedule("*/1 * * * *", async () => {
      if (notificationCronRunning) return;
      notificationCronRunning = true;
      try {
        try {
          await processQueuedNotifications();
        } catch (error) {
          await ErrorLogger.error("scheduler", "Queued notification processing failed", error instanceof Error ? error : null, {
            errorMessage: error instanceof Error ? error.message : String(error),
          });
        }
        try {
          await processDigestCron();
        } catch (error) {
          await ErrorLogger.error("scheduler", "Digest processing failed", error instanceof Error ? error : null, {
            errorMessage: error instanceof Error ? error.message : String(error),
          });
        }
      } finally {
        notificationCronRunning = false;
      }
    });

    // Webhook retry cron: every minute, process pending webhook deliveries
    cron.schedule("*/1 * * * *", async () => {
      try {
        const pendingRetries = await storage.getPendingWebhookRetries();
        const now = Date.now();

        // Backoff windows: attempt 1 → 5s, attempt 2 → 30s, attempt 3 → 120s
        const backoffMs: Record<number, number> = { 1: 5000, 2: 30000, 3: 120000 };

        for (const entry of pendingRetries) {
          const elapsed = now - new Date(entry.createdAt).getTime();
          const requiredWait = backoffMs[entry.attempt] || 120000;
          if (elapsed < requiredWait) continue;

          const monitor = await storage.getMonitor(entry.monitorId);
          if (!monitor) {
            await storage.updateDeliveryLog(entry.id, { status: "failed" });
            continue;
          }

          const channels = await storage.getMonitorChannels(monitor.id);
          const webhookChannel = channels.find((c) => c.channel === "webhook" && c.enabled);
          if (!webhookChannel) {
            await storage.updateDeliveryLog(entry.id, { status: "failed" });
            continue;
          }

          const config = webhookChannel.config as unknown as WebhookConfig;
          if (!config?.url || !config?.secret) {
            await storage.updateDeliveryLog(entry.id, { status: "failed" });
            continue;
          }

          const allChanges = await storage.getMonitorChanges(monitor.id);
          const change = allChanges.find((c) => c.id === entry.changeId);
          if (!change) {
            await storage.updateDeliveryLog(entry.id, { status: "failed" });
            continue;
          }

          const result = await deliverWebhook(monitor, change, config);
          const nextAttempt = entry.attempt + 1;

          if (result.success) {
            await storage.updateDeliveryLog(entry.id, {
              status: "success",
              attempt: nextAttempt,
              deliveredAt: new Date(),
              response: { statusCode: result.statusCode } as Record<string, unknown>,
            });
          } else if (nextAttempt >= 3) {
            const urlDomain = new URL(config.url).hostname;
            await storage.updateDeliveryLog(entry.id, {
              status: "failed",
              attempt: nextAttempt,
              response: { error: result.error } as Record<string, unknown>,
            });
            console.error(`[Webhook] Delivery failed after all retries (monitorId=${monitor.id}, domain=${urlDomain})`);
          } else {
            await storage.updateDeliveryLog(entry.id, {
              status: "pending",
              attempt: nextAttempt,
              response: { error: result.error } as Record<string, unknown>,
            });
            console.warn(`[Webhook] Delivery failed, scheduling retry (monitorId=${monitor.id}, attempt=${nextAttempt}, error=${result.error})`);
          }
        }
      } catch (error) {
        await ErrorLogger.error("scheduler", "Webhook retry processing failed", error instanceof Error ? error : null, {
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

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
      await ErrorLogger.error("scheduler", "monitor_metrics cleanup failed", error instanceof Error ? error : null, {
        errorMessage: error instanceof Error ? error.message : String(error),
        retentionDays: 90,
        table: "monitor_metrics",
      });
    }

    // Delivery log cleanup: prune entries older than 30 days
    try {
      const olderThan = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const entriesDeleted = await storage.cleanupOldDeliveryLogs(olderThan);
      if (entriesDeleted > 0) {
        console.log(`[Cleanup] Pruned ${entriesDeleted} delivery_log rows older than 30 days`);
      }
    } catch (error) {
      await ErrorLogger.error("scheduler", "delivery_log cleanup failed", error instanceof Error ? error : null, {
        errorMessage: error instanceof Error ? error.message : String(error),
        retentionDays: 30,
        table: "delivery_log",
      });
    }

    // Notification queue cleanup: prune permanently failed entries older than 7 days
    try {
      const deleted = await storage.cleanupPermanentlyFailedQueueEntries(
        new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      );
      if (deleted > 0) {
        console.log(`[Cleanup] Pruned ${deleted} permanently failed notification_queue rows older than 7 days`);
      }
    } catch (error) {
      await ErrorLogger.error("scheduler", "notification_queue cleanup failed", error instanceof Error ? error : null, {
        errorMessage: error instanceof Error ? error.message : String(error),
        retentionDays: 7,
        table: "notification_queue",
      });
    }
  });
}
