import { type Monitor, type MonitorChange, type NotificationPreference, type NotificationQueueEntry } from "@shared/schema";
import { storage } from "../storage";
import { sendNotificationEmail, sendDigestEmail, type EmailResult } from "./email";
import { ErrorLogger } from "./logger";

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
  // Use a simple approach: create the date and adjust
  const dt = new Date(localDateStr + "Z");
  const utcNow = new Date();
  const offsetMs = getTimezoneOffsetMs(timezone, utcNow);
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

export async function processChangeNotification(
  monitor: Monitor,
  change: MonitorChange,
  isFirstChange: boolean
): Promise<EmailResult | null> {
  if (!monitor.emailEnabled) {
    return null;
  }

  const prefs = await storage.getNotificationPreferences(monitor.id);

  if (!prefs) {
    return await sendNotificationEmail(monitor, change.oldValue, change.newValue);
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
  return await sendNotificationEmail(monitor, change.oldValue, change.newValue, emailOverride);
}

export async function processDigestBatch(
  monitor: Monitor,
  prefs: NotificationPreference
): Promise<EmailResult | null> {
  const entries = await storage.getPendingDigestEntries(monitor.id);
  if (entries.length === 0) {
    return null;
  }

  const changes: MonitorChange[] = [];
  for (const entry of entries) {
    const monitorChanges = await storage.getMonitorChanges(monitor.id);
    const change = monitorChanges.find((c) => c.id === entry.changeId);
    if (change) {
      changes.push(change);
    }
  }

  if (changes.length === 0) {
    return null;
  }

  const emailOverride = prefs.notificationEmail || undefined;
  const result = await sendDigestEmail(monitor, changes, emailOverride);

  if (result.success) {
    await storage.markQueueEntriesDelivered(entries.map((e) => e.id));
  }

  return result;
}

export async function processQueuedNotifications(): Promise<void> {
  const now = new Date();
  const readyEntries = await storage.getReadyQueueEntries(now);

  const monitorGroups = new Map<number, NotificationQueueEntry[]>();
  for (const entry of readyEntries) {
    const group = monitorGroups.get(entry.monitorId) || [];
    group.push(entry);
    monitorGroups.set(entry.monitorId, group);
  }

  const monitorIds = Array.from(monitorGroups.keys());
  for (const monitorId of monitorIds) {
    const entries = monitorGroups.get(monitorId)!;
    try {
      const monitor = await storage.getMonitor(monitorId);
      if (!monitor || !monitor.emailEnabled) {
        await storage.markQueueEntriesDelivered(entries.map((e) => e.id));
        continue;
      }

      const prefs = await storage.getNotificationPreferences(monitorId);
      if (prefs && isInQuietHours(prefs, now)) {
        continue;
      }

      for (const entry of entries) {
        const allChanges = await storage.getMonitorChanges(monitorId);
        const change = allChanges.find((c) => c.id === entry.changeId);
        if (!change) {
          await storage.markQueueEntryDelivered(entry.id);
          continue;
        }

        const emailOverride = prefs?.notificationEmail || undefined;
        const result = await sendNotificationEmail(monitor, change.oldValue, change.newValue, emailOverride);
        if (result.success) {
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
      if (!monitor || !monitor.active || !monitor.emailEnabled) {
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
