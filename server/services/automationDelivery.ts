import type { Monitor, MonitorChange } from "@shared/schema";
import { AUTOMATION_SUBSCRIPTION_LIMITS } from "@shared/models/auth";
import { storage } from "../storage";
import { ssrfSafeFetch } from "../utils/ssrf";
import { buildWebhookPayload } from "./webhookDelivery";
import { ErrorLogger } from "./logger";

/**
 * Deliver change events to active automation subscriptions (Zapier REST Hooks etc.).
 * Called fire-and-forget from processChangeNotification — errors are logged, never rethrown.
 */
export async function deliverToAutomationSubscriptions(
  monitor: Monitor,
  change: MonitorChange,
): Promise<void> {
  const subscriptions = await storage.getActiveAutomationSubscriptions(
    monitor.userId,
    monitor.id,
  );
  if (subscriptions.length === 0) return;

  const payload = buildWebhookPayload(monitor, change);
  const body = JSON.stringify({ ...payload, id: change.id });

  const deliveries = subscriptions.map(async (sub) => {
    try {
      const response = await ssrfSafeFetch(sub.hookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "FetchTheChange-Zapier/1.0",
        },
        body,
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        const hookDomain = new URL(sub.hookUrl).hostname;
        console.log(`[Automation] Delivered successfully (monitorId=${monitor.id}, platform=${sub.platform}, domain=${hookDomain}, status=${response.status})`);
        // Fire-and-forget lastDeliveredAt + failure counter reset
        storage.touchAutomationSubscription(sub.id).catch((e) => console.warn("[Automation] Failed to touch subscription:", e.message));
        storage.resetAutomationSubscriptionFailures(sub.id).catch((e) => console.warn("[Automation] Failed to reset failure counter:", e.message));
      } else {
        await handleDeliveryFailure(sub.id, monitor, sub.platform, `HTTP ${response.status}`);
      }
    } catch (err) {
      // Sanitize error to avoid leaking hookUrl secrets in logs
      const rawMsg = err instanceof Error ? err.message : String(err);
      const safeError = rawMsg.replace(/https?:\/\/[^\s)]+/g, "[redacted-url]");
      await handleDeliveryFailure(sub.id, monitor, sub.platform, safeError);
    }
  });

  await Promise.allSettled(deliveries);
}

async function handleDeliveryFailure(
  subscriptionId: number,
  monitor: Monitor,
  platform: string,
  error: string,
): Promise<void> {
  const failures = await storage.incrementAutomationSubscriptionFailures(subscriptionId);

  if (failures >= AUTOMATION_SUBSCRIPTION_LIMITS.failureThreshold) {
    await storage.deactivateAutomationSubscription(subscriptionId, monitor.userId);
    await ErrorLogger.warning("scheduler", `Automation subscription auto-deactivated after ${failures} consecutive failures for monitor "${monitor.name}"`, {
      subscriptionId,
      monitorId: monitor.id,
      platform,
      consecutiveFailures: failures,
      error,
    });
  } else {
    await ErrorLogger.warning("scheduler", `Automation delivery failed for monitor "${monitor.name}"`, {
      subscriptionId,
      monitorId: monitor.id,
      platform,
      consecutiveFailures: failures,
      error,
    });
  }
}
