import { type Monitor, type MonitorChange, type NotificationPreference, type NotificationQueueEntry, type NotificationChannel } from "@shared/schema";
import { storage } from "../storage";
import { sendNotificationEmail, sendDigestEmail, type EmailResult } from "./email";
import { deliver as deliverWebhook, type WebhookConfig } from "./webhookDelivery";
import { deliver as deliverSlack } from "./slackDelivery";
import { decryptToken } from "../utils/encryption";
import { ErrorLogger } from "./logger";
import { evaluateConditions } from "./conditions";

export function isInQuietHours(prefs: NotificationPreference, now: Date): boolean {
  if (!prefs.quietHoursStart || !prefs.quietHoursEnd || !prefs.timezone) {
    return false;
  }

  let localTimeStr: string;
  try {
    localTimeStr = now.toLocaleTimeString("en-GB", {
      timeZone: prefs.timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return false;
  }

  const current = timeToMinutes(localTimeStr);
  const start = timeToMinutes(prefs.quietHoursStart);
  const end = timeToMinutes(prefs.quietHoursEnd);

  if (start <= end) {
    return current >= start && current < end;
  }
  // Spans midnight (e.g., 23:00 - 07:00)
  return current >= start || current < end;
}

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function getQuietHoursEndDate(prefs: NotificationPreference, now: Date): Date {
  if (!prefs.quietHoursEnd || !prefs.timezone) {
    return now;
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: prefs.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";

  const localYear = Number(get("year"));
  const localMonth = Number(get("month"));
  const localDay = Number(get("day"));
  const localHour = Number(get("hour"));
  const localMinute = Number(get("minute"));

  const [endH, endM] = prefs.quietHoursEnd.split(":").map(Number);
  const currentMinutes = localHour * 60 + localMinute;
  const endMinutes = endH * 60 + endM;

  // If end time is later today or tomorrow
  let targetDate = new Date(now);
  if (currentMinutes < endMinutes) {
    // End is later today
    const dateStr = `${localYear}-${String(localMonth).padStart(2, "0")}-${String(localDay).padStart(2, "0")}T${prefs.quietHoursEnd}:00`;
    targetDate = localDateToUTC(dateStr, prefs.timezone);
  } else {
    // End is tomorrow
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tParts = formatter.formatToParts(tomorrow);
    const tGet = (type: string) => tParts.find((p) => p.type === type)?.value ?? "0";
    const dateStr = `${tGet("year")}-${String(Number(tGet("month"))).padStart(2, "0")}-${String(Number(tGet("day"))).padStart(2, "0")}T${prefs.quietHoursEnd}:00`;
    targetDate = localDateToUTC(dateStr, prefs.timezone);
  }

  return targetDate;
}

function localDateToUTC(localDateStr: string, timezone: string): Date {
  // Create a rough UTC date and compute the offset at that point in time
  // to correctly handle DST transitions
  const dt = new Date(localDateStr + "Z");
  const offsetMs = getTimezoneOffsetMs(timezone, dt);
  return new Date(dt.getTime() - offsetMs);
}

function getTimezoneOffsetMs(timezone: string, date: Date): number {
  const utcStr = date.toLocaleString("en-US", { timeZone: "UTC" });
  const tzStr = date.toLocaleString("en-US", { timeZone: timezone });
  return new Date(tzStr).getTime() - new Date(utcStr).getTime();
}

export function getNextDigestTime(timezone: string, now: Date): Date {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  const localHour = Number(get("hour"));

  // Digest at 9:00 AM local time
  const targetHour = 9;
  let daysToAdd = 0;
  if (localHour >= targetHour) {
    daysToAdd = 1; // Next day
  }

  const targetDate = new Date(now);
  targetDate.setDate(targetDate.getDate() + daysToAdd);
  const tParts = formatter.formatToParts(targetDate);
  const tGet = (type: string) => tParts.find((p) => p.type === type)?.value ?? "0";

  const dateStr = `${tGet("year")}-${String(Number(tGet("month"))).padStart(2, "0")}-${String(Number(tGet("day"))).padStart(2, "0")}T09:00:00`;
  return localDateToUTC(dateStr, timezone);
}

export function meetsThreshold(
  oldValue: string | null,
  newValue: string | null,
  threshold: number,
  isFirstChange: boolean
): boolean {
  if (threshold === 0) return true;
  if (isFirstChange) return true;

  const oldStr = oldValue ?? "";
  const newStr = newValue ?? "";
  const diff = Math.abs(newStr.length - oldStr.length);
  return diff >= threshold;
}

export interface ChannelDeliveryResult {
  email?: EmailResult | null;
  webhook?: { success: boolean; error?: string };
  slack?: { success: boolean; error?: string };
}

function hasDeliveryFailure(result: ChannelDeliveryResult): boolean {
  if (result.email?.success === false) return true;
  if (result.webhook && !result.webhook.success) return true;
  if (result.slack && !result.slack.success) return true;
  return false;
}

async function deliverToChannels(
  monitor: Monitor,
  change: MonitorChange,
  emailOverride?: string
): Promise<ChannelDeliveryResult> {
  const result: ChannelDeliveryResult = {};
  let channels: NotificationChannel[];
  try {
    channels = await storage.getMonitorChannels(monitor.id);
  } catch {
    channels = [];
  }

  // Backwards compatibility: no channel rows → use emailEnabled boolean
  if (channels.length === 0) {
    if (monitor.emailEnabled) {
      result.email = await sendNotificationEmail(monitor, change.oldValue, change.newValue, emailOverride);
      try {
        await storage.addDeliveryLog({
          monitorId: monitor.id,
          changeId: change.id,
          channel: "email",
          status: result.email?.success ? "success" : "failed",
          deliveredAt: result.email?.success ? new Date() : null,
          response: result.email?.success ? null : { error: result.email?.error || "unknown" },
        });
      } catch { /* delivery log table may not exist yet */ }
    }
    return result;
  }

  const enabledChannels = channels.filter((c) => c.enabled);
  const deliveries = enabledChannels.map(async (ch) => {
    try {
      switch (ch.channel) {
        case "email": {
          const emailResult = await sendNotificationEmail(monitor, change.oldValue, change.newValue, emailOverride);
          result.email = emailResult;
          await storage.addDeliveryLog({
            monitorId: monitor.id,
            changeId: change.id,
            channel: "email",
            status: emailResult.success ? "success" : "failed",
            deliveredAt: emailResult.success ? new Date() : null,
            response: emailResult.success ? null : { error: emailResult.error || "unknown" },
          });
          break;
        }
        case "webhook": {
          const config = ch.config as unknown as WebhookConfig;
          if (!config?.url || !config?.secret) break;
          const webhookResult = await deliverWebhook(monitor, change, config);
          result.webhook = webhookResult;
          const urlDomain = new URL(config.url).hostname;
          if (webhookResult.success) {
            await storage.addDeliveryLog({
              monitorId: monitor.id,
              changeId: change.id,
              channel: "webhook",
              status: "success",
              deliveredAt: new Date(),
              response: { statusCode: webhookResult.statusCode },
            });
          } else {
            // Schedule retry: create a pending entry at attempt 1
            await storage.addDeliveryLog({
              monitorId: monitor.id,
              changeId: change.id,
              channel: "webhook",
              status: "pending",
              attempt: 1,
              response: { error: webhookResult.error, domain: urlDomain },
            });
            console.warn(`[Notification] Webhook delivery failed, scheduling retry (monitorId=${monitor.id}, attempt=1, error=${webhookResult.error})`);
          }
          break;
        }
        case "slack": {
          const slackConfig = ch.config as { channelId?: string; channelName?: string };
          if (!slackConfig?.channelId) break;
          try {
            const connection = await storage.getSlackConnection(monitor.userId);
            if (!connection) {
              console.warn(`[Notification] No Slack connection for user of monitor ${monitor.id}`);
              break;
            }
            const botToken = decryptToken(connection.botToken);
            const slackResult = await deliverSlack(monitor, change, slackConfig.channelId, botToken);
            result.slack = slackResult;
            await storage.addDeliveryLog({
              monitorId: monitor.id,
              changeId: change.id,
              channel: "slack",
              status: slackResult.success ? "success" : "failed",
              deliveredAt: slackResult.success ? new Date() : null,
              response: slackResult.success ? { ts: slackResult.slackTs } : { error: slackResult.error },
            });
            if (!slackResult.success) {
              console.warn(`[Notification] Slack delivery failed (monitorId=${monitor.id}, error=${slackResult.error})`);
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[Notification] Slack token decryption failed (monitorId=${monitor.id})`);
            await storage.addDeliveryLog({
              monitorId: monitor.id,
              changeId: change.id,
              channel: "slack",
              status: "failed",
              response: { error: msg },
            });
          }
          break;
        }
      }
    } catch (err) {
      await ErrorLogger.error("email", `Channel delivery failed for ${ch.channel} on monitor ${monitor.id}`, err instanceof Error ? err : null, { monitorId: monitor.id, channel: ch.channel });
    }
  });

  await Promise.allSettled(deliveries);
  return result;
}

async function deliverDigestToChannels(
  monitor: Monitor,
  changes: MonitorChange[],
  emailOverride?: string
): Promise<ChannelDeliveryResult> {
  const result: ChannelDeliveryResult = {};
  let channels: NotificationChannel[];
  try {
    channels = await storage.getMonitorChannels(monitor.id);
  } catch {
    channels = [];
  }

  // Backwards compat: no channel rows → email only via emailEnabled
  if (channels.length === 0) {
    if (monitor.emailEnabled) {
      result.email = await sendDigestEmail(monitor, changes, emailOverride);
    }
    return result;
  }

  const enabledChannels = channels.filter((c) => c.enabled);
  const deliveries = enabledChannels.map(async (ch) => {
    try {
      switch (ch.channel) {
        case "email": {
          result.email = await sendDigestEmail(monitor, changes, emailOverride);
          break;
        }
        case "webhook": {
          // For digest, send one webhook per change
          const config = ch.config as unknown as WebhookConfig;
          if (!config?.url || !config?.secret) break;
          for (const change of changes) {
            const webhookResult = await deliverWebhook(monitor, change, config);
            if (!webhookResult.success) {
              await storage.addDeliveryLog({
                monitorId: monitor.id,
                changeId: change.id,
                channel: "webhook",
                status: "pending",
                attempt: 1,
                response: { error: webhookResult.error },
              });
            } else {
              await storage.addDeliveryLog({
                monitorId: monitor.id,
                changeId: change.id,
                channel: "webhook",
                status: "success",
                deliveredAt: new Date(),
                response: { statusCode: webhookResult.statusCode },
              });
            }
          }
          break;
        }
        case "slack": {
          // For digest, send one Slack message per change
          const slackConfig = ch.config as { channelId?: string };
          if (!slackConfig?.channelId) break;
          const connection = await storage.getSlackConnection(monitor.userId);
          if (!connection) break;
          try {
            const botToken = decryptToken(connection.botToken);
            for (const change of changes) {
              const slackResult = await deliverSlack(monitor, change, slackConfig.channelId, botToken);
              await storage.addDeliveryLog({
                monitorId: monitor.id,
                changeId: change.id,
                channel: "slack",
                status: slackResult.success ? "success" : "failed",
                deliveredAt: slackResult.success ? new Date() : null,
                response: slackResult.success ? { ts: slackResult.slackTs } : { error: slackResult.error },
              });
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[Notification] Slack token decryption failed (monitorId=${monitor.id})`);
            for (const change of changes) {
              await storage.addDeliveryLog({
                monitorId: monitor.id,
                changeId: change.id,
                channel: "slack",
                status: "failed",
                response: { error: msg },
              });
            }
          }
          break;
        }
      }
    } catch (err) {
      await ErrorLogger.error("email", `Digest channel delivery failed for ${ch.channel}`, err instanceof Error ? err : null, { monitorId: monitor.id, channel: ch.channel });
    }
  });

  await Promise.allSettled(deliveries);
  return result;
}

/**
 * Checks if any notification channel is active for a monitor.
 * Returns true if at least one channel is enabled, or if using legacy emailEnabled fallback.
 */
async function hasActiveChannels(monitor: Monitor): Promise<boolean> {
  let channels: NotificationChannel[];
  try {
    channels = await storage.getMonitorChannels(monitor.id);
  } catch {
    channels = [];
  }
  if (channels.length === 0) {
    return monitor.emailEnabled;
  }
  return channels.some((c) => c.enabled);
}

export async function processChangeNotification(
  monitor: Monitor,
  change: MonitorChange,
  isFirstChange: boolean
): Promise<EmailResult | null> {
  // Check if any channel is active (backwards compat: falls back to emailEnabled)
  if (!(await hasActiveChannels(monitor))) {
    return null;
  }

  // Evaluate conditions — skip notification if conditions exist and none pass
  let conditions: Awaited<ReturnType<typeof storage.getMonitorConditions>> = [];
  try {
    conditions = await storage.getMonitorConditions(monitor.id);
  } catch (err) {
    await ErrorLogger.error(
      "scheduler",
      `Failed to load conditions for monitor ${monitor.id}, proceeding with notification`,
      err instanceof Error ? err : new Error(String(err)),
    );
    // Fall through — send notification when conditions cannot be checked
  }
  if (conditions.length > 0) {
    const passes = evaluateConditions(conditions, change.oldValue, change.newValue);
    if (!passes) {
      await ErrorLogger.info(
        "scheduler",
        `Conditions blocked notification for monitor ${monitor.id}`,
        { monitorId: monitor.id, conditionCount: conditions.length },
      );
      return null;
    }
  }

  let prefs: NotificationPreference | undefined;
  try {
    prefs = await storage.getNotificationPreferences(monitor.id);
  } catch {
    // Notification tables may not be migrated yet — fall through to send immediate notification
  }

  if (!prefs) {
    const result = await deliverToChannels(monitor, change);
    return result.email ?? null;
  }

  if (!meetsThreshold(change.oldValue, change.newValue, prefs.sensitivityThreshold, isFirstChange)) {
    console.log(`[Notification] Change below sensitivity threshold for monitor ${monitor.id} (threshold=${prefs.sensitivityThreshold})`);
    return null;
  }

  if (prefs.digestMode) {
    const tz = prefs.timezone || "UTC";
    const scheduledFor = getNextDigestTime(tz, new Date());
    await storage.queueNotification(monitor.id, change.id, "digest", scheduledFor);
    console.log(`[Notification] Queued digest notification for monitor ${monitor.id}, scheduled for ${scheduledFor.toISOString()}`);
    return null;
  }

  const now = new Date();
  if (isInQuietHours(prefs, now)) {
    const scheduledFor = getQuietHoursEndDate(prefs, now);
    await storage.queueNotification(monitor.id, change.id, "quiet_hours", scheduledFor);
    console.log(`[Notification] Queued quiet hours notification for monitor ${monitor.id}, scheduled for ${scheduledFor.toISOString()}`);
    return null;
  }

  const emailOverride = prefs.notificationEmail || undefined;
  const result = await deliverToChannels(monitor, change, emailOverride);
  return result.email ?? null;
}

export async function processDigestBatch(
  monitor: Monitor,
  prefs: NotificationPreference
): Promise<EmailResult | null> {
  const entries = await storage.getPendingDigestEntries(monitor.id);
  if (entries.length === 0) {
    return null;
  }

  const changeIds = entries.map((e) => e.changeId);
  const changes = await storage.getMonitorChangesByIds(changeIds);

  if (changes.length < entries.length) {
    const foundIds = new Set(changes.map((c) => c.id));
    const orphanedEntries = entries.filter((e) => !foundIds.has(e.changeId));
    await ErrorLogger.warning("scheduler", `Digest batch for monitor ${monitor.id}: ${orphanedEntries.length} queue entries reference deleted changes`, { monitorId: monitor.id, orphanedChangeIds: orphanedEntries.map((e) => e.changeId) });
    await storage.markQueueEntriesDelivered(orphanedEntries.map((e) => e.id));
  }

  if (changes.length === 0) {
    return null;
  }

  const emailOverride = prefs.notificationEmail || undefined;
  const result = await deliverDigestToChannels(monitor, changes, emailOverride);

  if (!hasDeliveryFailure(result)) {
    const foundIds = new Set(changes.map((c) => c.id));
    const deliveredEntries = entries.filter((e) => foundIds.has(e.changeId));
    await storage.markQueueEntriesDelivered(deliveredEntries.map((e) => e.id));
  }

  return result.email ?? null;
}

export async function processQueuedNotifications(): Promise<void> {
  const now = new Date();
  const readyEntries = await storage.getReadyQueueEntries(now);

  // Only process non-digest entries; digest entries are handled by processDigestCron
  const nonDigestEntries = readyEntries.filter((e) => e.reason !== "digest");

  const monitorGroups = new Map<number, NotificationQueueEntry[]>();
  for (const entry of nonDigestEntries) {
    const group = monitorGroups.get(entry.monitorId) || [];
    group.push(entry);
    monitorGroups.set(entry.monitorId, group);
  }

  const monitorIds = Array.from(monitorGroups.keys());
  for (const monitorId of monitorIds) {
    const entries = monitorGroups.get(monitorId)!;
    try {
      const monitor = await storage.getMonitor(monitorId);
      if (!monitor || !(await hasActiveChannels(monitor))) {
        await storage.markQueueEntriesDelivered(entries.map((e) => e.id));
        continue;
      }

      const prefs = await storage.getNotificationPreferences(monitorId);
      if (prefs && isInQuietHours(prefs, now)) {
        continue;
      }

      const changeIds = entries.map((e) => e.changeId);
      const fetchedChanges = await storage.getMonitorChangesByIds(changeIds);
      const changesById = new Map(fetchedChanges.map((c) => [c.id, c]));
      const emailOverride = prefs?.notificationEmail || undefined;

      for (const entry of entries) {
        const change = changesById.get(entry.changeId);
        if (!change) {
          await ErrorLogger.warning("scheduler", `Queued notification for monitor ${monitorId}: change ${entry.changeId} not found, marking entry ${entry.id} as delivered`, { monitorId, changeId: entry.changeId, notificationQueueId: entry.id });
          await storage.markQueueEntryDelivered(entry.id);
          continue;
        }

        const result = await deliverToChannels(monitor, change, emailOverride);
        if (!hasDeliveryFailure(result)) {
          await storage.markQueueEntryDelivered(entry.id);
        }
      }
    } catch (error) {
      await ErrorLogger.error("scheduler", `Failed to process queued notifications for monitor ${monitorId}`, error instanceof Error ? error : null, { monitorId });
    }
  }

  // Check for stale entries (older than 48 hours)
  const staleThreshold = new Date(now.getTime() - 48 * 60 * 60 * 1000);
  const staleEntries = await storage.getStaleQueueEntries(staleThreshold);
  for (const entry of staleEntries) {
    await ErrorLogger.warning("scheduler", `Queued notification ${entry.id} for monitor ${entry.monitorId} is older than 48 hours and hasn't been delivered`, { notificationQueueId: entry.id, monitorId: entry.monitorId });
  }
}

export async function processDigestCron(): Promise<void> {
  const startTime = Date.now();
  const digestPrefs = await storage.getAllDigestMonitorPreferences();

  let emailsSent = 0;
  let monitorsProcessed = 0;

  for (const prefs of digestPrefs) {
    try {
      const monitor = await storage.getMonitor(prefs.monitorId);
      if (!monitor || !monitor.active || !(await hasActiveChannels(monitor))) {
        continue;
      }

      const tz = prefs.timezone || "UTC";
      let localHour: number;
      try {
        const now = new Date();
        const hourStr = now.toLocaleString("en-US", {
          timeZone: tz,
          hour: "numeric",
          hour12: false,
        });
        localHour = Number(hourStr);
      } catch {
        continue;
      }

      if (localHour !== 9) {
        continue;
      }

      const result = await processDigestBatch(monitor, prefs);
      monitorsProcessed++;
      if (result?.success) {
        emailsSent++;
      }
    } catch (error) {
      await ErrorLogger.error("scheduler", `Failed to process digest for monitor ${prefs.monitorId}`, error instanceof Error ? error : null, { monitorId: prefs.monitorId });
    }
  }

  const duration = Date.now() - startTime;
  if (monitorsProcessed > 0) {
    console.log(`[Digest] Processed ${monitorsProcessed} monitors, sent ${emailsSent} emails in ${duration}ms`);
  }
  if (duration > 30000) {
    await ErrorLogger.warning("scheduler", `Digest batch processing slow (${duration}ms)`, { batchSize: digestPrefs.length, duration });
  }
}
