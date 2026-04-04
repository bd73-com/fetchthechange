import cron from "node-cron";
import { storage, PENDING_WEBHOOK_RETRY_QUERY_LIMIT } from "../storage";
import { checkMonitor, monitorsNeedingRetry } from "./scraper";
import { processQueuedNotifications, processDigestCron } from "./notification";
import { deliver as deliverWebhook, type WebhookConfig } from "./webhookDelivery";
import { ErrorLogger } from "./logger";
import { notificationTablesExist } from "./notificationReady";
import { browserlessCircuitBreaker } from "./browserlessCircuitBreaker";
import { ensureMonitorConditionsTable } from "./ensureTables";
import { processAutomatedCampaigns } from "./automatedCampaigns";
import { isTransientDbError } from "../utils/dbErrors";
import { db } from "../db";
import { eq, sql } from "drizzle-orm";
import { monitors } from "@shared/schema";

// Keep below DB pool max (5, see db.ts) to leave headroom for cron jobs and
// API requests. Browser POOL_MAX is 1 (browserPool.ts), so the second
// concurrent check creates an ephemeral browser connection if needed.
const MAX_CONCURRENT_CHECKS = 2;
const BASE_RETRY_MS = 2 * 60 * 1000; // 2 minutes
const MAX_RETRY_MS = 15 * 60 * 1000; // 15 minutes
let activeChecks = 0;
let schedulerStarted = false;
const cronTasks: ReturnType<typeof cron.schedule>[] = [];
const pendingTimeouts = new Set<ReturnType<typeof setTimeout>>();


/** Retry a DB operation once after a 1 s delay on transient connection errors. */
async function withDbRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isTransientDbError(err)) {
      await new Promise((r) => {
        trackTimeout(() => r(undefined), 1000);
      });
      return fn();
    }
    throw err;
  }
}

/** Log a caught error as warning (transient) or error (non-transient) based on isTransientDbError. */
async function logSchedulerError(
  message: string,
  error: unknown,
  context?: Record<string, any>,
): Promise<void> {
  try {
    if (isTransientDbError(error)) {
      await ErrorLogger.warning("scheduler", `${message} (transient, will retry)`, {
        errorMessage: error instanceof Error ? error.message : String(error),
        ...context,
      });
    } else {
      await ErrorLogger.error("scheduler", message, error instanceof Error ? error : null, {
        errorMessage: error instanceof Error ? error.message : String(error),
        ...context,
      });
    }
  } catch {
    // If logging itself fails (e.g., logging DB also down), don't mask the original error
    console.error(`[Scheduler] Failed to log error: ${message}`, error instanceof Error ? error.message : error);
  }
}

/** Schedule a callback with automatic cleanup from pendingTimeouts when it fires. */
function trackTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout> {
  const handle = setTimeout(() => {
    pendingTimeouts.delete(handle);
    callback();
  }, delayMs);
  pendingTimeouts.add(handle);
  return handle;
}

/**
 * Wait until all in-flight monitor checks complete, or until timeout.
 * Used during graceful shutdown to avoid closing the DB pool while checks are running.
 */
export function waitForActiveChecks(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      if (activeChecks === 0 || Date.now() - start > timeoutMs) {
        resolve();
      } else {
        setTimeout(check, 100);
      }
    };
    check();
  });
}

/** @internal Test-only reset for the idempotency guard */
export function _resetSchedulerStarted() {
  schedulerStarted = false;
  activeChecks = 0;
}

/** @internal Test-only reset for the active checks counter */
export function _resetActiveChecks() {
  activeChecks = 0;
}

/** Per-monitor backoff tracker for accelerated retries. */
export const retryBackoff = new Map<number, { attempts: number }>();

async function runCheckWithLimit(monitor: Parameters<typeof checkMonitor>[0]): Promise<boolean> {
  if (activeChecks >= MAX_CONCURRENT_CHECKS) {
    console.debug(`[Scheduler] Concurrency limit reached, deferring monitor ${monitor.id}`);
    return false;
  }

  const hadPendingRetry = !!(
    monitor.pendingRetryAt && new Date(monitor.pendingRetryAt) <= new Date()
  );

  activeChecks++;
  try {
    await checkMonitor(monitor);
    if (hadPendingRetry) {
      console.log(`[AutoRetry] Monitor ${monitor.id} — retry completed`);
    }
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
    if (hadPendingRetry) {
      try {
        await db.update(monitors)
          .set({ pendingRetryAt: null })
          .where(eq(monitors.id, monitor.id));
      } catch (err: unknown) {
        console.error(`[AutoRetry] Failed to clear pendingRetryAt for monitor ${monitor.id}:`,
          err instanceof Error ? err.message : err);
      }
    }
  }
}

export async function startScheduler() {
  if (schedulerStarted) {
    console.log("Scheduler already started, skipping duplicate registration");
    return;
  }
  console.log("Starting scheduler...");

  // Ensure monitor_conditions table exists — routes.ts calls this too, but
  // the scheduler may start before routes finish or the routes call may have
  // failed due to a transient DB error. Use a timeout so a hung DB connection
  // doesn't block scheduler startup indefinitely.
  const tableReady = await Promise.race([
    ensureMonitorConditionsTable(),
    new Promise<boolean>(resolve => {
      trackTimeout(() => {
        console.warn("[Scheduler] ensureMonitorConditionsTable timed out after 10s — continuing startup");
        resolve(false);
      }, 10000);
    }),
  ]);
  if (!tableReady) {
    // Retry in background so table/index creation can complete
    trackTimeout(() => { ensureMonitorConditionsTable().catch(() => {}); }, 30000);
  }

  // One-time cleanup of polluted values from legacy data (non-fatal — must not block cron registration)
  try {
    await storage.cleanupPollutedValues();
  } catch (error) {
    await ErrorLogger.warning("scheduler", "cleanupPollutedValues failed (non-fatal)", { errorMessage: error instanceof Error ? error.message : String(error) });
  }

  // Wire circuit breaker recovery: immediately retry pending monitors when Browserless comes back
  browserlessCircuitBreaker.onClose(() => {
    storage.getAllActiveMonitors().then((allMonitors) => {
      const pendingIds = Array.from(monitorsNeedingRetry);
      const pendingMonitors = allMonitors.filter(m => pendingIds.includes(m.id));
      for (const monitor of pendingMonitors) {
        const jitterMs = Math.floor(Math.random() * 5000);
        trackTimeout(() => { void runCheckWithLimit(monitor); }, jitterMs);
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

  let mainCronRunning = false;
  cronTasks.push(cron.schedule("* * * * *", async () => {
    if (mainCronRunning) return;
    mainCronRunning = true;
    try {
      const monitors = await withDbRetry(() => storage.getAllActiveMonitors());

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

          // Auto-retry: fire if pendingRetryAt window has elapsed
          if (!shouldCheck && monitor.pendingRetryAt && new Date(monitor.pendingRetryAt) <= now) {
            shouldCheck = true;
          }

          if (shouldCheck) {
            const jitterMs = Math.floor(Math.random() * 30000);
            trackTimeout(() => {
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
      await logSchedulerError("Scheduler iteration failed", error, { activeChecks, phase: "fetching active monitors" });
    } finally {
      mainCronRunning = false;
    }
  }));

  // Process queued notifications (quiet hours + digest delivery) every minute,
  // but only if the notification tables have been migrated
  const hasNotificationTables = await notificationTablesExist();
  if (!hasNotificationTables) {
    console.warn("[Scheduler] Notification tables (notification_preferences, notification_queue) do not exist yet — skipping notification cron. Run `npm run schema:push` to create them.");
  } else {
    let notificationCronRunning = false;
    cronTasks.push(cron.schedule("*/1 * * * *", async () => {
      if (notificationCronRunning) return;
      notificationCronRunning = true;
      try {
        try {
          // Not wrapped in withDbRetry: these functions deliver notifications
          // before marking entries as delivered. Retrying the entire function
          // could cause duplicate email/webhook/Slack deliveries.
          await processQueuedNotifications();
        } catch (error) {
          await logSchedulerError("Queued notification processing failed", error);
        }
        try {
          await processDigestCron();
        } catch (error) {
          await logSchedulerError("Digest processing failed", error);
        }
      } finally {
        notificationCronRunning = false;
      }
    }));

    // Webhook retry cron: every minute, process pending webhook deliveries
    // Cap per-tick deliveries to limit ephemeral port usage while still draining
    // backlogs within a few minutes after a server restart.
    const MAX_WEBHOOK_RETRIES_PER_TICK = 10;
    const WEBHOOK_BACKLOG_WARN_INTERVAL_MS = 15 * 60 * 1000;
    let lastWebhookBacklogWarnAt = 0;
    let webhookCronRunning = false;
    cronTasks.push(cron.schedule("*/1 * * * *", async () => {
      if (webhookCronRunning) return;
      webhookCronRunning = true;
      try {
        const pendingRetries = await withDbRetry(() => storage.getPendingWebhookRetries());
        if (pendingRetries.length >= PENDING_WEBHOOK_RETRY_QUERY_LIMIT) {
          const nowMs = Date.now();
          if (nowMs - lastWebhookBacklogWarnAt >= WEBHOOK_BACKLOG_WARN_INTERVAL_MS) {
            lastWebhookBacklogWarnAt = nowMs;
            console.warn(`[Webhook] Storage query limit reached (${pendingRetries.length}/${PENDING_WEBHOOK_RETRY_QUERY_LIMIT}) — additional pending retries may be queued beyond this batch`);
          }
        }
        const now = Date.now();

        // Cumulative backoff windows from creation: attempt 1 → 5s, attempt 2 → 35s, attempt 3 → 155s
        // These are cumulative so that elapsed time from creation correctly gates each retry.
        // Note: attempt starts at 1 (schema default), so attempt=0 never occurs. The fallback
        // value (155000) handles any unexpected attempt values defensively.
        const cumulativeBackoffMs: Record<number, number> = { 1: 5000, 2: 35000, 3: 155000 };

        let delivered = 0;
        for (const entry of pendingRetries) {
          if (delivered >= MAX_WEBHOOK_RETRIES_PER_TICK) break;

          const elapsed = now - new Date(entry.createdAt).getTime();
          const requiredWait = cumulativeBackoffMs[entry.attempt] || 155000;
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

          const change = await storage.getMonitorChangeById(entry.changeId);
          if (!change || change.monitorId !== monitor.id) {
            await storage.updateDeliveryLog(entry.id, { status: "failed" });
            continue;
          }

          const result = await deliverWebhook(monitor, change, config);
          delivered++;
          const nextAttempt = entry.attempt + 1;

          if (result.success) {
            try {
              await withDbRetry(() => storage.updateDeliveryLog(entry.id, {
                status: "success",
                attempt: nextAttempt,
                deliveredAt: new Date(),
                response: { statusCode: result.statusCode } as Record<string, unknown>,
              }));
            } catch (dbErr) {
              console.error(`[Webhook] Delivered successfully but failed to update delivery log (entryId=${entry.id}, monitorId=${monitor.id}): ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`);
              throw dbErr;
            }
          } else if (nextAttempt >= 3) {
            const urlDomain = new URL(config.url).hostname;
            await withDbRetry(() => storage.updateDeliveryLog(entry.id, {
              status: "failed",
              attempt: nextAttempt,
              response: { error: result.error } as Record<string, unknown>,
            }));
            console.error(`[Webhook] Delivery failed after all retries (monitorId=${monitor.id}, domain=${urlDomain})`);
          } else {
            await withDbRetry(() => storage.updateDeliveryLog(entry.id, {
              status: "pending",
              attempt: nextAttempt,
              response: { error: result.error } as Record<string, unknown>,
            }));
            console.warn(`[Webhook] Delivery failed, scheduling retry (monitorId=${monitor.id}, attempt=${nextAttempt}, error=${result.error})`);
          }
        }
      } catch (error) {
        await logSchedulerError("Webhook retry processing failed", error);
      } finally {
        webhookCronRunning = false;
      }
    }));
  }

  // Daily cleanup: prune monitor_metrics older than 90 days to prevent unbounded growth
  // All cleanup operations are best-effort background tasks — transient DB failures
  // are logged as warnings since the next daily run will catch up.
  cronTasks.push(cron.schedule("0 3 * * *", async () => {
    try {
      const result = await withDbRetry(() => db.execute(
        sql`DELETE FROM monitor_metrics WHERE checked_at < NOW() - INTERVAL '90 days'`
      ));
      const deleted = (result as any).rowCount ?? 0;
      if (deleted > 0) {
        console.log(`[Cleanup] Pruned ${deleted} monitor_metrics rows older than 90 days`);
      }
    } catch (error) {
      await logSchedulerError("monitor_metrics cleanup failed", error, { retentionDays: 90, table: "monitor_metrics" });
    }

    // Delivery log cleanup: prune entries older than 30 days
    try {
      const olderThan = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const entriesDeleted = await withDbRetry(() => storage.cleanupOldDeliveryLogs(olderThan));
      if (entriesDeleted > 0) {
        console.log(`[Cleanup] Pruned ${entriesDeleted} delivery_log rows older than 30 days`);
      }
    } catch (error) {
      await logSchedulerError("delivery_log cleanup failed", error, { retentionDays: 30, table: "delivery_log" });
    }

    // Notification queue cleanup: prune permanently failed entries older than 7 days
    try {
      const deleted = await withDbRetry(() => storage.cleanupPermanentlyFailedQueueEntries(
        new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      ));
      if (deleted > 0) {
        console.log(`[Cleanup] Pruned ${deleted} permanently failed notification_queue rows older than 7 days`);
      }
    } catch (error) {
      await logSchedulerError("notification_queue cleanup failed", error, { retentionDays: 7, table: "notification_queue" });
    }

    // Automation subscriptions cleanup: hard-delete inactive subscriptions older than 90 days
    try {
      const olderThan = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const deleted = await withDbRetry(() => storage.cleanupStaleAutomationSubscriptions(olderThan));
      if (deleted > 0) {
        console.log(`[Cleanup] Pruned ${deleted} inactive automation_subscriptions rows older than 90 days`);
      }
    } catch (error) {
      await logSchedulerError("automation_subscriptions cleanup failed", error, { retentionDays: 90, table: "automation_subscriptions" });
    }
  }));

  // Automated campaigns: run at midnight UTC on the 1st and 15th of each month
  cronTasks.push(cron.schedule("0 0 1,15 * *", async () => {
    try {
      await processAutomatedCampaigns();
    } catch (error) {
      await ErrorLogger.error("scheduler", "Automated campaign processing failed",
        error instanceof Error ? error : null,
        { errorMessage: error instanceof Error ? error.message : String(error) }
      );
    }
  }, { timezone: "UTC" }));

  schedulerStarted = true;
}

/** Stop all cron tasks and pending timers registered by the scheduler. Call before closing the DB pool. */
export function stopScheduler(): void {
  for (const task of cronTasks) {
    task.stop();
  }
  cronTasks.length = 0;
  pendingTimeouts.forEach((handle) => { clearTimeout(handle); });
  pendingTimeouts.clear();
  retryBackoff.clear();
  schedulerStarted = false;
}
