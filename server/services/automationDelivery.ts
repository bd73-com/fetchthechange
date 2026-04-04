import type { Monitor, MonitorChange } from "@shared/schema";
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
        // Fire-and-forget lastDeliveredAt update
        storage.touchAutomationSubscription(sub.id).catch(() => {});
      } else {
        await ErrorLogger.warning("scheduler", `Automation delivery failed for monitor "${monitor.name}"`, {
          subscriptionId: sub.id,
          monitorId: monitor.id,
          platform: sub.platform,
          error: `HTTP ${response.status}`,
        });
      }
    } catch (err) {
      await ErrorLogger.warning("scheduler", `Automation delivery failed for monitor "${monitor.name}"`, {
        subscriptionId: sub.id,
        monitorId: monitor.id,
        platform: sub.platform,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  await Promise.allSettled(deliveries);
}
