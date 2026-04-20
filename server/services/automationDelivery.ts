import type { Monitor, MonitorChange } from "@shared/schema";
import { AUTOMATION_SUBSCRIPTION_LIMITS } from "@shared/models/auth";
import { storage } from "../storage";
import { ssrfSafeFetch } from "../utils/ssrf";
import { buildWebhookPayload } from "./webhookDelivery";

export type AutomationDeliveryOutcome =
  | { kind: "success"; statusCode: number }
  | { kind: "transient"; error: string; statusCode?: number }
  | { kind: "persistent"; error: string; statusCode: number };

/**
 * Perform a single automation delivery POST and classify the outcome.
 * Exported so the retry cron can reuse the exact same request logic and
 * error classification as the initial fire-and-forget attempt.
 */
export async function performAutomationDelivery(
  hookUrl: string,
  body: string,
): Promise<AutomationDeliveryOutcome> {
  try {
    const response = await ssrfSafeFetch(hookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "FetchTheChange-Zapier/1.0",
      },
      body,
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      return { kind: "success", statusCode: response.status };
    }
    // 5xx/429 are transient (upstream problem); 4xx are persistent (our request is wrong).
    if (response.status >= 500 || response.status === 429 || response.status === 408) {
      return { kind: "transient", error: `HTTP ${response.status}`, statusCode: response.status };
    }
    return { kind: "persistent", error: `HTTP ${response.status}`, statusCode: response.status };
  } catch (err) {
    // Network errors, aborts, DNS failures — all transient.
    const rawMsg = err instanceof Error ? err.message : String(err);
    const safeError = rawMsg.replace(/https?:\/\/[^\s)]+/g, "[redacted-url]");
    return { kind: "transient", error: safeError };
  }
}

/**
 * Deliver change events to active automation subscriptions (Zapier REST Hooks etc.).
 * Called fire-and-forget from processChangeNotification — errors are logged, never rethrown.
 *
 * Behavior on failure (see issue #456):
 *   - Transient (5xx/429/408/network): enqueue a delivery_log row with
 *     status='pending' so the automation retry cron picks it up. Does NOT
 *     bump consecutive_failures so a flaky upstream does not auto-deactivate.
 *   - Persistent (4xx): bump consecutive_failures + log failed row; no retry,
 *     since 4xx responses will not get better on retry.
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
    const outcome = await performAutomationDelivery(sub.hookUrl, body);

    if (outcome.kind === "success") {
      console.log(`[Automation] Delivered successfully (monitorId=${monitor.id}, platform=${sub.platform}, subId=${sub.id}, status=${outcome.statusCode})`);
      storage.touchAndResetAutomationSubscription(sub.id).catch((err) => {
        console.warn(`[Automation] Failed to reset failure counter for subscription ${sub.id}`, err);
      });
      return;
    }

    if (outcome.kind === "transient") {
      // Enqueue a durable retry — cron will re-attempt up to 3 times total.
      try {
        await storage.addDeliveryLog({
          monitorId: monitor.id,
          changeId: change.id,
          channel: "automation",
          status: "pending",
          attempt: 1,
          response: {
            subscriptionId: sub.id,
            platform: sub.platform,
            error: outcome.error,
            transient: true,
          },
        });
        console.warn(`[scheduler] Automation delivery transient failure — queued for retry for monitor "${monitor.name}"`, {
          subscriptionId: sub.id,
          monitorId: monitor.id,
          platform: sub.platform,
          error: outcome.error,
        });
      } catch (logErr) {
        // If we can't enqueue the retry, fall back to the old behavior to avoid losing all signal.
        console.error(`[Automation] Failed to enqueue retry delivery_log row — falling back to failure counter bump`, logErr);
        await handleDeliveryFailure(sub.id, monitor, sub.platform, outcome.error);
      }
      return;
    }

    // Persistent (4xx) — no retry; bump failure counter as before.
    await handleDeliveryFailure(sub.id, monitor, sub.platform, outcome.error);
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
    console.warn(`[scheduler] Automation subscription auto-deactivated after ${failures} consecutive failures for monitor "${monitor.name}"`, {
      subscriptionId,
      monitorId: monitor.id,
      platform,
      consecutiveFailures: failures,
      error,
    });
  } else {
    console.warn(`[scheduler] Automation delivery failed for monitor "${monitor.name}"`, {
      subscriptionId,
      monitorId: monitor.id,
      platform,
      consecutiveFailures: failures,
      error,
    });
  }
}

/**
 * Called by the automation retry cron after an enqueued delivery is finalized
 * (success, permanent failure, or retries exhausted).
 */
export async function finalizeAutomationRetry(
  subscriptionId: number,
  monitor: Monitor,
  platform: string,
  outcome: AutomationDeliveryOutcome,
): Promise<void> {
  if (outcome.kind === "success") {
    storage.touchAndResetAutomationSubscription(subscriptionId).catch((err) => {
      console.warn(`[Automation] Failed to reset failure counter for subscription ${subscriptionId}`, err);
    });
    return;
  }
  await handleDeliveryFailure(subscriptionId, monitor, platform, outcome.error);
}
