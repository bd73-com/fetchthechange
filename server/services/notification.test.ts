import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetNotificationPreferences = vi.fn().mockResolvedValue(undefined);
const mockQueueNotification = vi.fn().mockResolvedValue({ id: 1 });
const mockGetPendingDigestEntries = vi.fn().mockResolvedValue([]);
const mockGetMonitorChanges = vi.fn().mockResolvedValue([]);
const mockGetMonitorChangesByIds = vi.fn().mockResolvedValue([]);
const mockMarkQueueEntriesDelivered = vi.fn().mockResolvedValue(undefined);
const mockGetReadyQueueEntries = vi.fn().mockResolvedValue([]);
const mockMarkQueueEntryDelivered = vi.fn().mockResolvedValue(undefined);
const mockGetStaleQueueEntries = vi.fn().mockResolvedValue([]);
const mockGetAllDigestMonitorPreferences = vi.fn().mockResolvedValue([]);
const mockGetMonitor = vi.fn().mockResolvedValue(undefined);
const mockGetMonitorChannels = vi.fn().mockResolvedValue([]);
const mockAddDeliveryLog = vi.fn().mockResolvedValue({ id: 1 });
const mockGetSlackConnection = vi.fn().mockResolvedValue(undefined);
const mockGetMonitorConditions = vi.fn().mockResolvedValue([]);

vi.mock("../storage", () => ({
  storage: {
    getNotificationPreferences: (...args: any[]) => mockGetNotificationPreferences(...args),
    queueNotification: (...args: any[]) => mockQueueNotification(...args),
    getPendingDigestEntries: (...args: any[]) => mockGetPendingDigestEntries(...args),
    getMonitorChanges: (...args: any[]) => mockGetMonitorChanges(...args),
    getMonitorChangesByIds: (...args: any[]) => mockGetMonitorChangesByIds(...args),
    markQueueEntriesDelivered: (...args: any[]) => mockMarkQueueEntriesDelivered(...args),
    getReadyQueueEntries: (...args: any[]) => mockGetReadyQueueEntries(...args),
    markQueueEntryDelivered: (...args: any[]) => mockMarkQueueEntryDelivered(...args),
    getStaleQueueEntries: (...args: any[]) => mockGetStaleQueueEntries(...args),
    getAllDigestMonitorPreferences: (...args: any[]) => mockGetAllDigestMonitorPreferences(...args),
    getMonitor: (...args: any[]) => mockGetMonitor(...args),
    getMonitorChannels: (...args: any[]) => mockGetMonitorChannels(...args),
    addDeliveryLog: (...args: any[]) => mockAddDeliveryLog(...args),
    getSlackConnection: (...args: any[]) => mockGetSlackConnection(...args),
    getMonitorConditions: (...args: any[]) => mockGetMonitorConditions(...args),
  },
}));

const mockSendNotificationEmail = vi.fn().mockResolvedValue({ success: true });
const mockSendDigestEmail = vi.fn().mockResolvedValue({ success: true });

vi.mock("./email", () => ({
  sendNotificationEmail: (...args: any[]) => mockSendNotificationEmail(...args),
  sendDigestEmail: (...args: any[]) => mockSendDigestEmail(...args),
}));

vi.mock("./logger", () => ({
  ErrorLogger: {
    error: vi.fn().mockResolvedValue(undefined),
    warning: vi.fn().mockResolvedValue(undefined),
    info: vi.fn().mockResolvedValue(undefined),
  },
}));

const mockWebhookDeliver = vi.fn().mockResolvedValue({ success: true, statusCode: 200 });
vi.mock("./webhookDelivery", () => ({
  deliver: (...args: any[]) => mockWebhookDeliver(...args),
}));

const mockSlackDeliver = vi.fn().mockResolvedValue({ success: true, slackTs: "123" });
vi.mock("./slackDelivery", () => ({
  deliver: (...args: any[]) => mockSlackDeliver(...args),
}));

const mockDecryptToken = vi.fn().mockReturnValue("xoxb-decrypted-token");
vi.mock("../utils/encryption", () => ({
  decryptToken: (...args: any[]) => mockDecryptToken(...args),
}));

import {
  isInQuietHours,
  meetsThreshold,
  processChangeNotification,
  processDigestBatch,
  processQueuedNotifications,
  processDigestCron,
  getQuietHoursEndDate,
  getNextDigestTime,
} from "./notification";

import { ErrorLogger } from "./logger";

import type { Monitor, MonitorChange, NotificationPreference } from "@shared/schema";

function makeMonitor(overrides: Partial<Monitor> = {}): Monitor {
  return {
    id: 1,
    userId: "user1",
    name: "Test Monitor",
    url: "https://example.com",
    selector: ".price",
    frequency: "daily",
    lastChecked: null,
    lastChanged: null,
    currentValue: null,
    lastStatus: "ok",
    lastError: null,
    active: true,
    emailEnabled: true,
    consecutiveFailures: 0,
    pauseReason: null,
    healthAlertSentAt: null,
    lastHealthyAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeChange(overrides: Partial<MonitorChange> = {}): MonitorChange {
  return {
    id: 1,
    monitorId: 1,
    oldValue: "$19.99",
    newValue: "$24.99",
    detectedAt: new Date(),
    ...overrides,
  };
}

function makePrefs(overrides: Partial<NotificationPreference> = {}): NotificationPreference {
  return {
    id: 1,
    monitorId: 1,
    quietHoursStart: null,
    quietHoursEnd: null,
    timezone: null,
    digestMode: false,
    sensitivityThreshold: 0,
    notificationEmail: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("isInQuietHours", () => {
  it("returns false when no quiet hours are configured", () => {
    const prefs = makePrefs();
    expect(isInQuietHours(prefs, new Date())).toBe(false);
  });

  it("returns false when quiet hours start is set but end is not", () => {
    const prefs = makePrefs({ quietHoursStart: "22:00", timezone: "UTC" });
    expect(isInQuietHours(prefs, new Date())).toBe(false);
  });

  it("returns false when timezone is missing", () => {
    const prefs = makePrefs({ quietHoursStart: "22:00", quietHoursEnd: "08:00" });
    expect(isInQuietHours(prefs, new Date())).toBe(false);
  });

  it("returns true when current time is within quiet hours (same day)", () => {
    // 15:00 UTC is within 14:00 - 16:00 UTC
    const prefs = makePrefs({
      quietHoursStart: "14:00",
      quietHoursEnd: "16:00",
      timezone: "UTC",
    });
    const now = new Date("2024-01-15T15:00:00Z");
    expect(isInQuietHours(prefs, now)).toBe(true);
  });

  it("returns false when current time is outside quiet hours (same day)", () => {
    const prefs = makePrefs({
      quietHoursStart: "14:00",
      quietHoursEnd: "16:00",
      timezone: "UTC",
    });
    const now = new Date("2024-01-15T12:00:00Z");
    expect(isInQuietHours(prefs, now)).toBe(false);
  });

  it("handles midnight-spanning quiet hours (e.g., 22:00 - 08:00)", () => {
    const prefs = makePrefs({
      quietHoursStart: "22:00",
      quietHoursEnd: "08:00",
      timezone: "UTC",
    });

    // 23:00 UTC should be in quiet hours
    const lateNight = new Date("2024-01-15T23:00:00Z");
    expect(isInQuietHours(prefs, lateNight)).toBe(true);

    // 03:00 UTC should be in quiet hours
    const earlyMorning = new Date("2024-01-16T03:00:00Z");
    expect(isInQuietHours(prefs, earlyMorning)).toBe(true);

    // 12:00 UTC should NOT be in quiet hours
    const midday = new Date("2024-01-15T12:00:00Z");
    expect(isInQuietHours(prefs, midday)).toBe(false);
  });

  it("uses IANA timezone names correctly", () => {
    const prefs = makePrefs({
      quietHoursStart: "22:00",
      quietHoursEnd: "08:00",
      timezone: "America/New_York",
    });
    // 3:00 AM New York = 08:00 UTC (during standard time)
    // Should be within quiet hours in EST
    const now = new Date("2024-01-15T07:00:00Z"); // 2 AM EST
    expect(isInQuietHours(prefs, now)).toBe(true);
  });

  it("returns false for invalid timezone", () => {
    const prefs = makePrefs({
      quietHoursStart: "22:00",
      quietHoursEnd: "08:00",
      timezone: "Invalid/Timezone",
    });
    expect(isInQuietHours(prefs, new Date())).toBe(false);
  });
});

describe("meetsThreshold", () => {
  it("returns true when threshold is 0 (any change)", () => {
    expect(meetsThreshold("old", "new", 0, false)).toBe(true);
  });

  it("returns true when threshold is 0 and values are identical length", () => {
    expect(meetsThreshold("abc", "xyz", 0, false)).toBe(true);
  });

  it("always returns true for first change regardless of threshold", () => {
    expect(meetsThreshold(null, "new", 100, true)).toBe(true);
  });

  it("returns true when character length difference meets threshold", () => {
    expect(meetsThreshold("$19.99", "$24.99 (sale price!!!)", 5, false)).toBe(true);
  });

  it("returns false when character length difference is below threshold", () => {
    expect(meetsThreshold("$19.99", "$24.99", 5, false)).toBe(false);
  });

  it("handles null old value", () => {
    expect(meetsThreshold(null, "hello", 3, false)).toBe(true);
  });

  it("handles null new value", () => {
    expect(meetsThreshold("hello", null, 3, false)).toBe(true);
  });

  it("handles both null values", () => {
    expect(meetsThreshold(null, null, 0, false)).toBe(true);
  });
});

describe("processChangeNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no channel rows (backwards-compatible with emailEnabled)
    mockGetMonitorChannels.mockResolvedValue([]);
    mockAddDeliveryLog.mockResolvedValue({ id: 1 });
    mockGetMonitorConditions.mockResolvedValue([]);
  });

  it("returns null when emailEnabled is false", async () => {
    const monitor = makeMonitor({ emailEnabled: false });
    const change = makeChange();

    const result = await processChangeNotification(monitor, change, false);
    expect(result).toBeNull();
    expect(mockSendNotificationEmail).not.toHaveBeenCalled();
  });

  it("sends email directly when no preferences exist", async () => {
    mockGetNotificationPreferences.mockResolvedValueOnce(undefined);
    const monitor = makeMonitor();
    const change = makeChange();

    await processChangeNotification(monitor, change, false);
    expect(mockSendNotificationEmail).toHaveBeenCalledWith(monitor, "$19.99", "$24.99", undefined);
  });

  it("skips notification when change is below sensitivity threshold", async () => {
    mockGetNotificationPreferences.mockResolvedValueOnce(
      makePrefs({ sensitivityThreshold: 100 })
    );
    const monitor = makeMonitor();
    const change = makeChange({ oldValue: "$19.99", newValue: "$24.99" });

    const result = await processChangeNotification(monitor, change, false);
    expect(result).toBeNull();
    expect(mockSendNotificationEmail).not.toHaveBeenCalled();
  });

  it("queues for digest when digest mode is enabled", async () => {
    mockGetNotificationPreferences.mockResolvedValueOnce(
      makePrefs({ digestMode: true, timezone: "UTC" })
    );
    const monitor = makeMonitor();
    const change = makeChange();

    const result = await processChangeNotification(monitor, change, false);
    expect(result).toBeNull();
    expect(mockQueueNotification).toHaveBeenCalledWith(
      1, 1, "digest", expect.any(Date)
    );
  });

  it("queues for quiet hours when within quiet hours", async () => {
    mockGetNotificationPreferences.mockResolvedValueOnce(
      makePrefs({
        quietHoursStart: "00:00",
        quietHoursEnd: "23:59",
        timezone: "UTC",
      })
    );
    const monitor = makeMonitor();
    const change = makeChange();

    const result = await processChangeNotification(monitor, change, false);
    expect(result).toBeNull();
    expect(mockQueueNotification).toHaveBeenCalledWith(
      1, 1, "quiet_hours", expect.any(Date)
    );
  });

  it("sends email with override when specified in preferences", async () => {
    mockGetNotificationPreferences.mockResolvedValueOnce(
      makePrefs({ notificationEmail: "custom@example.com" })
    );
    const monitor = makeMonitor();
    const change = makeChange();

    await processChangeNotification(monitor, change, false);
    expect(mockSendNotificationEmail).toHaveBeenCalledWith(
      monitor, "$19.99", "$24.99", "custom@example.com"
    );
  });

  it("always notifies on first change even with high threshold", async () => {
    mockGetNotificationPreferences.mockResolvedValueOnce(
      makePrefs({ sensitivityThreshold: 10000 })
    );
    const monitor = makeMonitor();
    const change = makeChange({ oldValue: null, newValue: "$24.99" });

    await processChangeNotification(monitor, change, true);
    expect(mockSendNotificationEmail).toHaveBeenCalled();
  });

  it("falls through to immediate email when getNotificationPreferences throws (tables missing)", async () => {
    mockGetNotificationPreferences.mockRejectedValueOnce(
      new Error('relation "notification_preferences" does not exist')
    );
    const monitor = makeMonitor();
    const change = makeChange();

    await processChangeNotification(monitor, change, false);
    expect(mockSendNotificationEmail).toHaveBeenCalledWith(monitor, "$19.99", "$24.99", undefined);
  });

  it("digest takes priority over quiet hours", async () => {
    mockGetNotificationPreferences.mockResolvedValueOnce(
      makePrefs({
        digestMode: true,
        quietHoursStart: "00:00",
        quietHoursEnd: "23:59",
        timezone: "UTC",
      })
    );
    const monitor = makeMonitor();
    const change = makeChange();

    await processChangeNotification(monitor, change, false);
    expect(mockQueueNotification).toHaveBeenCalledWith(
      1, 1, "digest", expect.any(Date)
    );
  });
});

describe("processDigestBatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMonitorChannels.mockResolvedValue([]);
    mockAddDeliveryLog.mockResolvedValue({ id: 1 });
    mockGetMonitorConditions.mockResolvedValue([]);
  });

  it("returns null when no pending digest entries exist", async () => {
    mockGetPendingDigestEntries.mockResolvedValueOnce([]);
    const monitor = makeMonitor();
    const prefs = makePrefs({ digestMode: true });

    const result = await processDigestBatch(monitor, prefs);
    expect(result).toBeNull();
    expect(mockSendDigestEmail).not.toHaveBeenCalled();
  });

  it("sends digest email with all queued changes", async () => {
    const entries = [
      { id: 1, monitorId: 1, changeId: 10, reason: "digest", scheduledFor: new Date(), delivered: false, deliveredAt: null, createdAt: new Date() },
      { id: 2, monitorId: 1, changeId: 11, reason: "digest", scheduledFor: new Date(), delivered: false, deliveredAt: null, createdAt: new Date() },
    ];
    mockGetPendingDigestEntries.mockResolvedValueOnce(entries);

    const changes = [
      makeChange({ id: 10, oldValue: "$10", newValue: "$15" }),
      makeChange({ id: 11, oldValue: "$15", newValue: "$20" }),
    ];
    mockGetMonitorChangesByIds.mockResolvedValueOnce(changes);

    const monitor = makeMonitor();
    const prefs = makePrefs({ digestMode: true });

    const result = await processDigestBatch(monitor, prefs);
    expect(result).toEqual({ success: true });
    expect(mockGetMonitorChangesByIds).toHaveBeenCalledWith([10, 11]);
    expect(mockSendDigestEmail).toHaveBeenCalledWith(
      monitor,
      expect.arrayContaining([
        expect.objectContaining({ id: 10 }),
        expect.objectContaining({ id: 11 }),
      ]),
      undefined
    );
    expect(mockMarkQueueEntriesDelivered).toHaveBeenCalledWith([1, 2]);
  });

  it("uses email override from preferences", async () => {
    const entries = [
      { id: 1, monitorId: 1, changeId: 10, reason: "digest", scheduledFor: new Date(), delivered: false, deliveredAt: null, createdAt: new Date() },
    ];
    mockGetPendingDigestEntries.mockResolvedValueOnce(entries);
    mockGetMonitorChangesByIds.mockResolvedValueOnce([makeChange({ id: 10 })]);

    const monitor = makeMonitor();
    const prefs = makePrefs({ digestMode: true, notificationEmail: "custom@test.com" });

    await processDigestBatch(monitor, prefs);
    expect(mockSendDigestEmail).toHaveBeenCalledWith(
      monitor,
      expect.any(Array),
      "custom@test.com"
    );
  });
});

describe("processQueuedNotifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMonitorChannels.mockResolvedValue([]);
    mockAddDeliveryLog.mockResolvedValue({ id: 1 });
    mockGetMonitorConditions.mockResolvedValue([]);
  });

  it("does nothing when no ready entries exist", async () => {
    mockGetReadyQueueEntries.mockResolvedValueOnce([]);
    mockGetStaleQueueEntries.mockResolvedValueOnce([]);

    await processQueuedNotifications();
    expect(mockSendNotificationEmail).not.toHaveBeenCalled();
  });

  it("marks entries as delivered when monitor no longer exists", async () => {
    mockGetReadyQueueEntries.mockResolvedValueOnce([
      { id: 1, monitorId: 99, changeId: 1, reason: "quiet_hours", scheduledFor: new Date(), delivered: false, deliveredAt: null, createdAt: new Date() },
    ]);
    mockGetStaleQueueEntries.mockResolvedValueOnce([]);
    mockGetMonitor.mockResolvedValueOnce(undefined);

    await processQueuedNotifications();
    expect(mockMarkQueueEntriesDelivered).toHaveBeenCalledWith([1]);
  });

  it("skips entries still in quiet hours", async () => {
    const entry = { id: 1, monitorId: 1, changeId: 10, reason: "quiet_hours", scheduledFor: new Date(), delivered: false, deliveredAt: null, createdAt: new Date() };
    mockGetReadyQueueEntries.mockResolvedValueOnce([entry]);
    mockGetStaleQueueEntries.mockResolvedValueOnce([]);
    mockGetMonitor.mockResolvedValueOnce(makeMonitor());
    mockGetNotificationPreferences.mockResolvedValueOnce(
      makePrefs({
        quietHoursStart: "00:00",
        quietHoursEnd: "23:59",
        timezone: "UTC",
      })
    );

    await processQueuedNotifications();
    expect(mockSendNotificationEmail).not.toHaveBeenCalled();
    expect(mockMarkQueueEntryDelivered).not.toHaveBeenCalled();
  });

  it("sends email and marks delivered for ready entries outside quiet hours", async () => {
    const entry = { id: 1, monitorId: 1, changeId: 10, reason: "quiet_hours", scheduledFor: new Date(), delivered: false, deliveredAt: null, createdAt: new Date() };
    mockGetReadyQueueEntries.mockResolvedValueOnce([entry]);
    mockGetStaleQueueEntries.mockResolvedValueOnce([]);
    mockGetMonitor.mockResolvedValueOnce(makeMonitor());
    mockGetNotificationPreferences.mockResolvedValueOnce(makePrefs());
    mockGetMonitorChangesByIds.mockResolvedValueOnce([makeChange({ id: 10 })]);
    mockSendNotificationEmail.mockResolvedValueOnce({ success: true });

    await processQueuedNotifications();
    expect(mockSendNotificationEmail).toHaveBeenCalled();
    expect(mockMarkQueueEntryDelivered).toHaveBeenCalledWith(1);
  });
});

describe("decision tree edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMonitorChannels.mockResolvedValue([]);
    mockAddDeliveryLog.mockResolvedValue({ id: 1 });
    mockGetMonitorConditions.mockResolvedValue([]);
  });

  it("emailEnabled=false is the master off switch", async () => {
    // Do NOT set up mockGetNotificationPreferences — it should never be called
    const monitor = makeMonitor({ emailEnabled: false });
    const change = makeChange();

    const result = await processChangeNotification(monitor, change, false);
    expect(result).toBeNull();
    expect(mockGetNotificationPreferences).not.toHaveBeenCalled();
    expect(mockQueueNotification).not.toHaveBeenCalled();
    expect(mockSendNotificationEmail).not.toHaveBeenCalled();
  });

  it("sensitivity check happens before digest/quiet hours", async () => {
    mockGetNotificationPreferences.mockResolvedValueOnce(
      makePrefs({
        sensitivityThreshold: 1000,
        digestMode: true,
        timezone: "UTC",
      })
    );
    const monitor = makeMonitor();
    const change = makeChange({ oldValue: "a", newValue: "b" });

    const result = await processChangeNotification(monitor, change, false);
    expect(result).toBeNull();
    expect(mockQueueNotification).not.toHaveBeenCalled();
  });
});

describe("getQuietHoursEndDate", () => {
  it("returns now when quietHoursEnd is not set", () => {
    const now = new Date("2024-01-15T10:00:00Z");
    const prefs = makePrefs({ quietHoursEnd: null, timezone: "UTC" });
    expect(getQuietHoursEndDate(prefs, now).getTime()).toBe(now.getTime());
  });

  it("returns now when timezone is not set", () => {
    const now = new Date("2024-01-15T10:00:00Z");
    const prefs = makePrefs({ quietHoursEnd: "08:00", timezone: null });
    expect(getQuietHoursEndDate(prefs, now).getTime()).toBe(now.getTime());
  });

  it("returns end time later today when current time is before end (UTC)", () => {
    // At 05:00 UTC, quiet hours end at 08:00 UTC → should return 08:00 today
    const now = new Date("2024-01-15T05:00:00Z");
    const prefs = makePrefs({ quietHoursEnd: "08:00", timezone: "UTC" });
    const result = getQuietHoursEndDate(prefs, now);
    expect(result.getUTCHours()).toBe(8);
    expect(result.getUTCMinutes()).toBe(0);
    expect(result.getUTCDate()).toBe(15);
  });

  it("returns end time tomorrow when current time is after end (UTC)", () => {
    // At 10:00 UTC, quiet hours end at 08:00 → should return 08:00 tomorrow
    const now = new Date("2024-01-15T10:00:00Z");
    const prefs = makePrefs({ quietHoursEnd: "08:00", timezone: "UTC" });
    const result = getQuietHoursEndDate(prefs, now);
    expect(result.getUTCHours()).toBe(8);
    expect(result.getUTCMinutes()).toBe(0);
    expect(result.getUTCDate()).toBe(16);
  });

  it("handles non-UTC timezone", () => {
    // 03:00 UTC = 22:00 EST (previous day). Quiet end = 08:00 EST = 13:00 UTC
    const now = new Date("2024-01-15T03:00:00Z");
    const prefs = makePrefs({ quietHoursEnd: "08:00", timezone: "America/New_York" });
    const result = getQuietHoursEndDate(prefs, now);
    // 08:00 EST = 13:00 UTC on Jan 15
    expect(result.getUTCHours()).toBe(13);
    expect(result.getUTCDate()).toBe(15);
  });
});

describe("getNextDigestTime", () => {
  it("returns 9 AM today (UTC) when current time is before 9 AM", () => {
    const now = new Date("2024-01-15T05:00:00Z");
    const result = getNextDigestTime("UTC", now);
    expect(result.getUTCHours()).toBe(9);
    expect(result.getUTCMinutes()).toBe(0);
    expect(result.getUTCDate()).toBe(15);
  });

  it("returns 9 AM tomorrow (UTC) when current time is at or after 9 AM", () => {
    const now = new Date("2024-01-15T14:00:00Z");
    const result = getNextDigestTime("UTC", now);
    expect(result.getUTCHours()).toBe(9);
    expect(result.getUTCMinutes()).toBe(0);
    expect(result.getUTCDate()).toBe(16);
  });

  it("returns 9 AM tomorrow when current hour is exactly 9", () => {
    const now = new Date("2024-01-15T09:30:00Z");
    const result = getNextDigestTime("UTC", now);
    expect(result.getUTCDate()).toBe(16);
  });

  it("converts 9 AM in non-UTC timezone to correct UTC time", () => {
    // 9 AM EST = 14:00 UTC. At 10:00 UTC (5 AM EST), digest should be today at 14:00 UTC
    const now = new Date("2024-01-15T10:00:00Z");
    const result = getNextDigestTime("America/New_York", now);
    expect(result.getUTCHours()).toBe(14);
    expect(result.getUTCDate()).toBe(15);
  });
});

describe("processDigestBatch edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMonitorChannels.mockResolvedValue([]);
    mockAddDeliveryLog.mockResolvedValue({ id: 1 });
    mockGetMonitorConditions.mockResolvedValue([]);
  });

  it("returns null when queued changes can't be found in monitor changes", async () => {
    const entries = [
      { id: 1, monitorId: 1, changeId: 999, reason: "digest", scheduledFor: new Date(), delivered: false, deliveredAt: null, createdAt: new Date() },
    ];
    mockGetPendingDigestEntries.mockResolvedValueOnce(entries);
    // Return empty — the queried IDs don't exist
    mockGetMonitorChangesByIds.mockResolvedValueOnce([]);

    const monitor = makeMonitor();
    const prefs = makePrefs({ digestMode: true });

    const result = await processDigestBatch(monitor, prefs);
    expect(result).toBeNull();
    expect(mockSendDigestEmail).not.toHaveBeenCalled();
  });

  it("does not mark entries as delivered when sendDigestEmail fails", async () => {
    const entries = [
      { id: 1, monitorId: 1, changeId: 10, reason: "digest", scheduledFor: new Date(), delivered: false, deliveredAt: null, createdAt: new Date() },
    ];
    mockGetPendingDigestEntries.mockResolvedValueOnce(entries);
    mockGetMonitorChangesByIds.mockResolvedValueOnce([makeChange({ id: 10 })]);
    mockSendDigestEmail.mockResolvedValueOnce({ success: false, error: "Rate limited" });

    const monitor = makeMonitor();
    const prefs = makePrefs({ digestMode: true });

    const result = await processDigestBatch(monitor, prefs);
    expect(result).toEqual({ success: false, error: "Rate limited" });
    expect(mockMarkQueueEntriesDelivered).not.toHaveBeenCalled();
  });
});

describe("processQueuedNotifications edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMonitorChannels.mockResolvedValue([]);
    mockAddDeliveryLog.mockResolvedValue({ id: 1 });
    mockGetMonitorConditions.mockResolvedValue([]);
  });

  it("marks entries as delivered when monitor has emailEnabled=false", async () => {
    const entry = { id: 5, monitorId: 2, changeId: 10, reason: "quiet_hours", scheduledFor: new Date(), delivered: false, deliveredAt: null, createdAt: new Date() };
    mockGetReadyQueueEntries.mockResolvedValueOnce([entry]);
    mockGetStaleQueueEntries.mockResolvedValueOnce([]);
    mockGetMonitor.mockResolvedValueOnce(makeMonitor({ id: 2, emailEnabled: false }));

    await processQueuedNotifications();
    expect(mockMarkQueueEntriesDelivered).toHaveBeenCalledWith([5]);
    expect(mockSendNotificationEmail).not.toHaveBeenCalled();
  });

  it("marks entry as delivered when change no longer exists", async () => {
    const entry = { id: 3, monitorId: 1, changeId: 999, reason: "quiet_hours", scheduledFor: new Date(), delivered: false, deliveredAt: null, createdAt: new Date() };
    mockGetReadyQueueEntries.mockResolvedValueOnce([entry]);
    mockGetStaleQueueEntries.mockResolvedValueOnce([]);
    mockGetMonitor.mockResolvedValueOnce(makeMonitor());
    mockGetNotificationPreferences.mockResolvedValueOnce(makePrefs());
    // Return empty — the queried ID doesn't exist
    mockGetMonitorChangesByIds.mockResolvedValueOnce([]);

    await processQueuedNotifications();
    expect(mockMarkQueueEntryDelivered).toHaveBeenCalledWith(3);
    expect(mockSendNotificationEmail).not.toHaveBeenCalled();
  });

  it("does not mark entry as delivered when email send fails", async () => {
    const entry = { id: 1, monitorId: 1, changeId: 10, reason: "quiet_hours", scheduledFor: new Date(), delivered: false, deliveredAt: null, createdAt: new Date() };
    mockGetReadyQueueEntries.mockResolvedValueOnce([entry]);
    mockGetStaleQueueEntries.mockResolvedValueOnce([]);
    mockGetMonitor.mockResolvedValueOnce(makeMonitor());
    mockGetNotificationPreferences.mockResolvedValueOnce(makePrefs());
    mockGetMonitorChangesByIds.mockResolvedValueOnce([makeChange({ id: 10 })]);
    mockSendNotificationEmail.mockResolvedValueOnce({ success: false, error: "Rate limit" });

    await processQueuedNotifications();
    expect(mockSendNotificationEmail).toHaveBeenCalled();
    expect(mockMarkQueueEntryDelivered).not.toHaveBeenCalled();
  });

  it("passes email override from preferences for queued notifications", async () => {
    const entry = { id: 1, monitorId: 1, changeId: 10, reason: "quiet_hours", scheduledFor: new Date(), delivered: false, deliveredAt: null, createdAt: new Date() };
    mockGetReadyQueueEntries.mockResolvedValueOnce([entry]);
    mockGetStaleQueueEntries.mockResolvedValueOnce([]);
    mockGetMonitor.mockResolvedValueOnce(makeMonitor());
    mockGetNotificationPreferences.mockResolvedValueOnce(
      makePrefs({ notificationEmail: "override@test.com" })
    );
    mockGetMonitorChangesByIds.mockResolvedValueOnce([makeChange({ id: 10 })]);
    mockSendNotificationEmail.mockResolvedValueOnce({ success: true });

    await processQueuedNotifications();
    expect(mockSendNotificationEmail).toHaveBeenCalledWith(
      expect.any(Object), "$19.99", "$24.99", "override@test.com"
    );
  });

  it("warns about stale queue entries older than 48 hours", async () => {
    mockGetReadyQueueEntries.mockResolvedValueOnce([]);
    const staleEntry = { id: 7, monitorId: 3, changeId: 5, reason: "quiet_hours", scheduledFor: new Date(), delivered: false, deliveredAt: null, createdAt: new Date() };
    mockGetStaleQueueEntries.mockResolvedValueOnce([staleEntry]);

    await processQueuedNotifications();
    expect(ErrorLogger.warning).toHaveBeenCalledWith(
      "scheduler",
      expect.stringContaining("older than 48 hours"),
      expect.objectContaining({ notificationQueueId: 7, monitorId: 3 })
    );
  });

  it("groups multiple entries by monitor and processes each", async () => {
    const entries = [
      { id: 1, monitorId: 1, changeId: 10, reason: "quiet_hours", scheduledFor: new Date(), delivered: false, deliveredAt: null, createdAt: new Date() },
      { id: 2, monitorId: 1, changeId: 11, reason: "quiet_hours", scheduledFor: new Date(), delivered: false, deliveredAt: null, createdAt: new Date() },
    ];
    mockGetReadyQueueEntries.mockResolvedValueOnce(entries);
    mockGetStaleQueueEntries.mockResolvedValueOnce([]);
    mockGetMonitor.mockResolvedValueOnce(makeMonitor());
    mockGetNotificationPreferences.mockResolvedValueOnce(makePrefs());
    mockGetMonitorChangesByIds.mockResolvedValueOnce([
      makeChange({ id: 10, oldValue: "$10", newValue: "$15" }),
      makeChange({ id: 11, oldValue: "$15", newValue: "$20" }),
    ]);
    mockSendNotificationEmail.mockResolvedValue({ success: true });

    await processQueuedNotifications();
    expect(mockGetMonitorChangesByIds).toHaveBeenCalledWith([10, 11]);
    expect(mockSendNotificationEmail).toHaveBeenCalledTimes(2);
    expect(mockMarkQueueEntryDelivered).toHaveBeenCalledTimes(2);
    expect(mockMarkQueueEntryDelivered).toHaveBeenCalledWith(1);
    expect(mockMarkQueueEntryDelivered).toHaveBeenCalledWith(2);
  });

  it("skips digest entries (they are handled by processDigestCron)", async () => {
    const digestEntry = { id: 1, monitorId: 1, changeId: 10, reason: "digest", scheduledFor: new Date(), delivered: false, deliveredAt: null, createdAt: new Date() };
    mockGetReadyQueueEntries.mockResolvedValueOnce([digestEntry]);
    mockGetStaleQueueEntries.mockResolvedValueOnce([]);

    await processQueuedNotifications();
    expect(mockGetMonitor).not.toHaveBeenCalled();
    expect(mockSendNotificationEmail).not.toHaveBeenCalled();
    expect(mockMarkQueueEntryDelivered).not.toHaveBeenCalled();
  });

  it("handles errors in individual monitor processing gracefully", async () => {
    const entry = { id: 1, monitorId: 1, changeId: 10, reason: "quiet_hours", scheduledFor: new Date(), delivered: false, deliveredAt: null, createdAt: new Date() };
    mockGetReadyQueueEntries.mockResolvedValueOnce([entry]);
    mockGetStaleQueueEntries.mockResolvedValueOnce([]);
    mockGetMonitor.mockRejectedValueOnce(new Error("DB connection lost"));

    await processQueuedNotifications();
    expect(ErrorLogger.error).toHaveBeenCalledWith(
      "scheduler",
      expect.stringContaining("Failed to process queued notifications"),
      expect.any(Error),
      expect.objectContaining({ monitorId: 1 })
    );
  });
});

describe("processDigestCron", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMonitorChannels.mockResolvedValue([]);
    mockAddDeliveryLog.mockResolvedValue({ id: 1 });
    mockGetMonitorConditions.mockResolvedValue([]);
  });

  it("does nothing when no digest preferences exist", async () => {
    mockGetAllDigestMonitorPreferences.mockResolvedValueOnce([]);
    await processDigestCron();
    expect(mockGetMonitor).not.toHaveBeenCalled();
  });

  it("skips monitors that are not active", async () => {
    mockGetAllDigestMonitorPreferences.mockResolvedValueOnce([
      makePrefs({ monitorId: 1, digestMode: true, timezone: "UTC" }),
    ]);
    mockGetMonitor.mockResolvedValueOnce(makeMonitor({ active: false }));

    await processDigestCron();
    expect(mockGetPendingDigestEntries).not.toHaveBeenCalled();
  });

  it("skips monitors that have emailEnabled=false", async () => {
    mockGetAllDigestMonitorPreferences.mockResolvedValueOnce([
      makePrefs({ monitorId: 1, digestMode: true, timezone: "UTC" }),
    ]);
    mockGetMonitor.mockResolvedValueOnce(makeMonitor({ emailEnabled: false }));

    await processDigestCron();
    expect(mockGetPendingDigestEntries).not.toHaveBeenCalled();
  });

  it("skips monitors where monitor is not found", async () => {
    mockGetAllDigestMonitorPreferences.mockResolvedValueOnce([
      makePrefs({ monitorId: 99, digestMode: true, timezone: "UTC" }),
    ]);
    mockGetMonitor.mockResolvedValueOnce(undefined);

    await processDigestCron();
    expect(mockGetPendingDigestEntries).not.toHaveBeenCalled();
  });

  it("logs errors for individual monitor digest failures without crashing", async () => {
    mockGetAllDigestMonitorPreferences.mockResolvedValueOnce([
      makePrefs({ monitorId: 1, digestMode: true, timezone: "UTC" }),
    ]);
    mockGetMonitor.mockRejectedValueOnce(new Error("DB error"));

    await processDigestCron();
    expect(ErrorLogger.error).toHaveBeenCalledWith(
      "scheduler",
      expect.stringContaining("Failed to process digest"),
      expect.any(Error),
      expect.objectContaining({ monitorId: 1 })
    );
  });
});

describe("multi-channel delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMonitorChannels.mockResolvedValue([]);
    mockAddDeliveryLog.mockResolvedValue({ id: 1 });
    mockGetMonitorConditions.mockResolvedValue([]);
    mockWebhookDeliver.mockResolvedValue({ success: true, statusCode: 200 });
    mockSlackDeliver.mockResolvedValue({ success: true, slackTs: "123" });
    mockGetSlackConnection.mockResolvedValue(undefined);
    mockDecryptToken.mockReturnValue("xoxb-decrypted-token");
    mockSendNotificationEmail.mockResolvedValue({ success: true });
    mockSendDigestEmail.mockResolvedValue({ success: true });
  });

  it("backwards compatibility: no channel rows falls back to emailEnabled", async () => {
    mockGetMonitorChannels.mockResolvedValue([]);
    const monitor = makeMonitor({ emailEnabled: true });
    const change = makeChange();

    await processChangeNotification(monitor, change, false);
    expect(mockSendNotificationEmail).toHaveBeenCalled();
    expect(mockWebhookDeliver).not.toHaveBeenCalled();
    expect(mockSlackDeliver).not.toHaveBeenCalled();
  });

  it("backwards compatibility: no channel rows + emailEnabled=false sends nothing", async () => {
    mockGetMonitorChannels.mockResolvedValue([]);
    const monitor = makeMonitor({ emailEnabled: false });
    const change = makeChange();

    const result = await processChangeNotification(monitor, change, false);
    expect(result).toBeNull();
    expect(mockSendNotificationEmail).not.toHaveBeenCalled();
  });

  it("delivers to webhook when webhook channel is configured", async () => {
    mockGetMonitorChannels.mockResolvedValue([
      { id: 1, monitorId: 1, channel: "webhook", enabled: true, config: { url: "https://hooks.example.com", secret: "whsec_test" }, createdAt: new Date(), updatedAt: new Date() },
    ]);
    const monitor = makeMonitor();
    const change = makeChange();

    await processChangeNotification(monitor, change, false);
    expect(mockWebhookDeliver).toHaveBeenCalledWith(monitor, change, { url: "https://hooks.example.com", secret: "whsec_test" });
  });

  it("delivers to slack when slack channel is configured and connected", async () => {
    mockGetMonitorChannels.mockResolvedValue([
      { id: 1, monitorId: 1, channel: "slack", enabled: true, config: { channelId: "C0123", channelName: "#alerts" }, createdAt: new Date(), updatedAt: new Date() },
    ]);
    mockGetSlackConnection.mockResolvedValue({
      id: 1, userId: "user1", teamId: "T001", teamName: "Test", botToken: "encrypted", scope: "chat:write",
      createdAt: new Date(), updatedAt: new Date(),
    });
    const monitor = makeMonitor();
    const change = makeChange();

    await processChangeNotification(monitor, change, false);
    expect(mockDecryptToken).toHaveBeenCalledWith("encrypted");
    expect(mockSlackDeliver).toHaveBeenCalledWith(monitor, change, "C0123", "xoxb-decrypted-token");
  });

  it("delivers to all enabled channels in parallel", async () => {
    mockGetMonitorChannels.mockResolvedValue([
      { id: 1, monitorId: 1, channel: "email", enabled: true, config: {}, createdAt: new Date(), updatedAt: new Date() },
      { id: 2, monitorId: 1, channel: "webhook", enabled: true, config: { url: "https://hooks.example.com", secret: "whsec_test" }, createdAt: new Date(), updatedAt: new Date() },
    ]);
    const monitor = makeMonitor();
    const change = makeChange();

    await processChangeNotification(monitor, change, false);
    expect(mockSendNotificationEmail).toHaveBeenCalled();
    expect(mockWebhookDeliver).toHaveBeenCalled();
  });

  it("skips disabled channels", async () => {
    mockGetMonitorChannels.mockResolvedValue([
      { id: 1, monitorId: 1, channel: "email", enabled: true, config: {}, createdAt: new Date(), updatedAt: new Date() },
      { id: 2, monitorId: 1, channel: "webhook", enabled: false, config: { url: "https://hooks.example.com", secret: "whsec_test" }, createdAt: new Date(), updatedAt: new Date() },
    ]);
    const monitor = makeMonitor();
    const change = makeChange();

    await processChangeNotification(monitor, change, false);
    expect(mockSendNotificationEmail).toHaveBeenCalled();
    expect(mockWebhookDeliver).not.toHaveBeenCalled();
  });

  it("channel failure does not block other channels", async () => {
    mockGetMonitorChannels.mockResolvedValue([
      { id: 1, monitorId: 1, channel: "email", enabled: true, config: {}, createdAt: new Date(), updatedAt: new Date() },
      { id: 2, monitorId: 1, channel: "webhook", enabled: true, config: { url: "https://hooks.example.com", secret: "whsec_test" }, createdAt: new Date(), updatedAt: new Date() },
    ]);
    mockWebhookDeliver.mockResolvedValue({ success: false, error: "timeout" });
    const monitor = makeMonitor();
    const change = makeChange();

    await processChangeNotification(monitor, change, false);
    // Email should still be sent
    expect(mockSendNotificationEmail).toHaveBeenCalled();
    // Webhook failure should be logged
    expect(mockAddDeliveryLog).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "webhook", status: "pending" })
    );
  });

  it("logs delivery for webhook retry on failure", async () => {
    mockGetMonitorChannels.mockResolvedValue([
      { id: 1, monitorId: 1, channel: "webhook", enabled: true, config: { url: "https://hooks.example.com", secret: "whsec_test" }, createdAt: new Date(), updatedAt: new Date() },
    ]);
    mockWebhookDeliver.mockResolvedValue({ success: false, error: "Connection refused" });

    await processChangeNotification(makeMonitor(), makeChange(), false);
    expect(mockAddDeliveryLog).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "webhook",
        status: "pending",
        attempt: 1,
      })
    );
  });

  it("skips webhook delivery when config is missing url", async () => {
    mockGetMonitorChannels.mockResolvedValue([
      { id: 1, monitorId: 1, channel: "webhook", enabled: true, config: { secret: "whsec_test" }, createdAt: new Date(), updatedAt: new Date() },
    ]);

    await processChangeNotification(makeMonitor(), makeChange(), false);
    expect(mockWebhookDeliver).not.toHaveBeenCalled();
  });

  it("skips webhook delivery when config is missing secret", async () => {
    mockGetMonitorChannels.mockResolvedValue([
      { id: 1, monitorId: 1, channel: "webhook", enabled: true, config: { url: "https://hooks.example.com" }, createdAt: new Date(), updatedAt: new Date() },
    ]);

    await processChangeNotification(makeMonitor(), makeChange(), false);
    expect(mockWebhookDeliver).not.toHaveBeenCalled();
  });

  it("skips slack delivery when channelId is missing", async () => {
    mockGetMonitorChannels.mockResolvedValue([
      { id: 1, monitorId: 1, channel: "slack", enabled: true, config: { channelName: "#alerts" }, createdAt: new Date(), updatedAt: new Date() },
    ]);

    await processChangeNotification(makeMonitor(), makeChange(), false);
    expect(mockSlackDeliver).not.toHaveBeenCalled();
  });

  it("skips slack delivery when no slack connection exists for user", async () => {
    mockGetMonitorChannels.mockResolvedValue([
      { id: 1, monitorId: 1, channel: "slack", enabled: true, config: { channelId: "C0123" }, createdAt: new Date(), updatedAt: new Date() },
    ]);
    mockGetSlackConnection.mockResolvedValue(undefined);

    await processChangeNotification(makeMonitor(), makeChange(), false);
    expect(mockSlackDeliver).not.toHaveBeenCalled();
  });

  it("logs delivery failure when slack token decryption throws", async () => {
    mockGetMonitorChannels.mockResolvedValue([
      { id: 1, monitorId: 1, channel: "slack", enabled: true, config: { channelId: "C0123" }, createdAt: new Date(), updatedAt: new Date() },
    ]);
    mockGetSlackConnection.mockResolvedValue({
      id: 1, userId: "user1", teamId: "T001", teamName: "Test", botToken: "corrupted",
      scope: "chat:write", createdAt: new Date(), updatedAt: new Date(),
    });
    mockDecryptToken.mockImplementation(() => { throw new Error("Bad key"); });

    await processChangeNotification(makeMonitor(), makeChange(), false);
    expect(mockSlackDeliver).not.toHaveBeenCalled();
    expect(mockAddDeliveryLog).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "slack",
        status: "failed",
        response: expect.objectContaining({ error: "Bad key" }),
      })
    );
  });

  it("hasActiveChannels returns false when all channels are disabled", async () => {
    mockGetMonitorChannels.mockResolvedValue([
      { id: 1, monitorId: 1, channel: "email", enabled: false, config: {}, createdAt: new Date(), updatedAt: new Date() },
      { id: 2, monitorId: 1, channel: "webhook", enabled: false, config: {}, createdAt: new Date(), updatedAt: new Date() },
    ]);
    const monitor = makeMonitor({ emailEnabled: true }); // emailEnabled ignored when channel rows exist

    const result = await processChangeNotification(monitor, makeChange(), false);
    expect(result).toBeNull();
    expect(mockSendNotificationEmail).not.toHaveBeenCalled();
    expect(mockWebhookDeliver).not.toHaveBeenCalled();
  });

  it("getMonitorChannels error gracefully falls back to empty channels", async () => {
    mockGetMonitorChannels.mockRejectedValue(new Error("relation does not exist"));
    const monitor = makeMonitor({ emailEnabled: true });
    const change = makeChange();

    await processChangeNotification(monitor, change, false);
    // Falls back to emailEnabled behavior
    expect(mockSendNotificationEmail).toHaveBeenCalled();
  });

  it("backwards compat: logs delivery to delivery_log table on email send", async () => {
    mockGetMonitorChannels.mockResolvedValue([]);
    const monitor = makeMonitor({ emailEnabled: true });
    const change = makeChange();

    await processChangeNotification(monitor, change, false);
    expect(mockAddDeliveryLog).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "email",
        status: "success",
      })
    );
  });

  it("backwards compat: swallows delivery_log write errors (table may not exist)", async () => {
    mockGetMonitorChannels.mockResolvedValue([]);
    mockAddDeliveryLog.mockRejectedValue(new Error("relation does not exist"));
    const monitor = makeMonitor({ emailEnabled: true });
    const change = makeChange();

    // Should not throw even when log write fails
    await expect(processChangeNotification(monitor, change, false)).resolves.not.toThrow();
    expect(mockSendNotificationEmail).toHaveBeenCalled();
  });
});

describe("processChangeNotification with conditions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMonitorChannels.mockResolvedValue([]);
    mockAddDeliveryLog.mockResolvedValue({ id: 1 });
    mockGetMonitorConditions.mockResolvedValue([]);
  });

  it("calls getMonitorConditions for every change", async () => {
    const monitor = makeMonitor({ emailEnabled: true });
    const change = makeChange();
    mockSendNotificationEmail.mockResolvedValue({ success: true });
    await processChangeNotification(monitor, change, false);
    expect(mockGetMonitorConditions).toHaveBeenCalledWith(monitor.id);
  });

  it("returns null when conditions exist and none pass (no delivery)", async () => {
    mockGetMonitorConditions.mockResolvedValue([
      { id: 1, monitorId: 1, type: "numeric_lt", value: "0", groupIndex: 0, createdAt: new Date() },
    ]);
    const monitor = makeMonitor({ emailEnabled: true });
    const change = makeChange({ oldValue: "$49/mo", newValue: "$59/mo" });
    const result = await processChangeNotification(monitor, change, false);
    expect(result).toBeNull();
    expect(mockSendNotificationEmail).not.toHaveBeenCalled();
  });

  it("delivers normally when conditions pass", async () => {
    mockGetMonitorConditions.mockResolvedValue([
      { id: 1, monitorId: 1, type: "numeric_lt", value: "999999", groupIndex: 0, createdAt: new Date() },
    ]);
    const monitor = makeMonitor({ emailEnabled: true });
    const change = makeChange({ oldValue: "$49/mo", newValue: "$59/mo" });
    mockSendNotificationEmail.mockResolvedValue({ success: true });
    const result = await processChangeNotification(monitor, change, false);
    expect(result).toEqual({ success: true });
    expect(mockSendNotificationEmail).toHaveBeenCalled();
  });

  it("delivers normally when no conditions exist (backwards compat)", async () => {
    mockGetMonitorConditions.mockResolvedValue([]);
    const monitor = makeMonitor({ emailEnabled: true });
    const change = makeChange();
    mockSendNotificationEmail.mockResolvedValue({ success: true });
    const result = await processChangeNotification(monitor, change, false);
    expect(result).toEqual({ success: true });
  });

  it("logs info when conditions block notification", async () => {
    mockGetMonitorConditions.mockResolvedValue([
      { id: 1, monitorId: 1, type: "numeric_lt", value: "0", groupIndex: 0, createdAt: new Date() },
    ]);
    const monitor = makeMonitor({ emailEnabled: true });
    const change = makeChange({ oldValue: "$49/mo", newValue: "$59/mo" });
    await processChangeNotification(monitor, change, false);
    expect(ErrorLogger.info).toHaveBeenCalled();
  });

  it("proceeds with notification when getMonitorConditions throws", async () => {
    mockGetMonitorConditions.mockRejectedValue(new Error("DB connection failed"));
    const monitor = makeMonitor({ emailEnabled: true });
    const change = makeChange();
    mockSendNotificationEmail.mockResolvedValue({ success: true });
    const result = await processChangeNotification(monitor, change, false);
    expect(result).toEqual({ success: true });
    expect(ErrorLogger.error).toHaveBeenCalled();
    expect(mockSendNotificationEmail).toHaveBeenCalled();
  });
});

describe("multi-channel digest delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAddDeliveryLog.mockResolvedValue({ id: 1 });
    mockWebhookDeliver.mockResolvedValue({ success: true, statusCode: 200 });
    mockSlackDeliver.mockResolvedValue({ success: true, slackTs: "123" });
    mockGetSlackConnection.mockResolvedValue(undefined);
    mockDecryptToken.mockReturnValue("xoxb-decrypted-token");
    mockSendNotificationEmail.mockResolvedValue({ success: true });
    mockSendDigestEmail.mockResolvedValue({ success: true });
  });

  it("sends digest to webhook channel (one per change)", async () => {
    mockGetMonitorChannels.mockResolvedValue([
      { id: 1, monitorId: 1, channel: "webhook", enabled: true, config: { url: "https://hooks.example.com", secret: "whsec_test" }, createdAt: new Date(), updatedAt: new Date() },
    ]);
    const entries = [
      { id: 1, monitorId: 1, changeId: 10, reason: "digest", scheduledFor: new Date(), delivered: false, deliveredAt: null, createdAt: new Date() },
      { id: 2, monitorId: 1, changeId: 11, reason: "digest", scheduledFor: new Date(), delivered: false, deliveredAt: null, createdAt: new Date() },
    ];
    mockGetPendingDigestEntries.mockResolvedValueOnce(entries);
    const changes = [
      makeChange({ id: 10, oldValue: "$10", newValue: "$15" }),
      makeChange({ id: 11, oldValue: "$15", newValue: "$20" }),
    ];
    mockGetMonitorChangesByIds.mockResolvedValueOnce(changes);

    const monitor = makeMonitor();
    const prefs = makePrefs({ digestMode: true });

    await processDigestBatch(monitor, prefs);
    // Webhook should be called once per change
    expect(mockWebhookDeliver).toHaveBeenCalledTimes(2);
    // Delivery log entries should be created for each
    expect(mockAddDeliveryLog).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "webhook", status: "success" })
    );
  });

  it("sends digest to slack channel (one per change)", async () => {
    mockGetMonitorChannels.mockResolvedValue([
      { id: 1, monitorId: 1, channel: "slack", enabled: true, config: { channelId: "C0123" }, createdAt: new Date(), updatedAt: new Date() },
    ]);
    mockGetSlackConnection.mockResolvedValue({
      id: 1, userId: "user1", teamId: "T001", teamName: "Test", botToken: "encrypted",
      scope: "chat:write", createdAt: new Date(), updatedAt: new Date(),
    });
    const entries = [
      { id: 1, monitorId: 1, changeId: 10, reason: "digest", scheduledFor: new Date(), delivered: false, deliveredAt: null, createdAt: new Date() },
    ];
    mockGetPendingDigestEntries.mockResolvedValueOnce(entries);
    mockGetMonitorChangesByIds.mockResolvedValueOnce([makeChange({ id: 10 })]);

    const monitor = makeMonitor();
    const prefs = makePrefs({ digestMode: true });

    await processDigestBatch(monitor, prefs);
    expect(mockSlackDeliver).toHaveBeenCalledTimes(1);
  });
});

describe("delivery failure checks all channels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAddDeliveryLog.mockResolvedValue({ id: 1 });
    mockGetMonitorConditions.mockResolvedValue([]);
    mockGetStaleQueueEntries.mockResolvedValue([]);
    mockSendNotificationEmail.mockResolvedValue({ success: true });
    mockSendDigestEmail.mockResolvedValue({ success: true });
    mockWebhookDeliver.mockResolvedValue({ success: true, statusCode: 200 });
    mockSlackDeliver.mockResolvedValue({ success: true, slackTs: "123" });
    mockDecryptToken.mockReturnValue("xoxb-decrypted-token");
    mockGetSlackConnection.mockResolvedValue(undefined);
  });

  it("processDigestBatch does not mark delivered when webhook fails", async () => {
    mockGetMonitorChannels.mockResolvedValue([
      { id: 1, monitorId: 1, channel: "webhook", enabled: true, config: { url: "https://hooks.example.com", secret: "whsec_test" }, createdAt: new Date(), updatedAt: new Date() },
    ]);
    mockWebhookDeliver.mockResolvedValue({ success: false, error: "timeout" });
    const entries = [
      { id: 1, monitorId: 1, changeId: 10, reason: "digest", scheduledFor: new Date(), delivered: false, deliveredAt: null, createdAt: new Date() },
    ];
    mockGetPendingDigestEntries.mockResolvedValueOnce(entries);
    mockGetMonitorChangesByIds.mockResolvedValueOnce([makeChange({ id: 10 })]);

    await processDigestBatch(makeMonitor(), makePrefs({ digestMode: true }));
    expect(mockMarkQueueEntriesDelivered).not.toHaveBeenCalled();
  });

  it("processDigestBatch does not mark delivered when slack fails", async () => {
    mockGetMonitorChannels.mockResolvedValue([
      { id: 1, monitorId: 1, channel: "slack", enabled: true, config: { channelId: "C0123" }, createdAt: new Date(), updatedAt: new Date() },
    ]);
    mockGetSlackConnection.mockResolvedValue({
      id: 1, userId: "user1", teamId: "T001", teamName: "Test", botToken: "encrypted",
      scope: "chat:write", createdAt: new Date(), updatedAt: new Date(),
    });
    mockSlackDeliver.mockResolvedValue({ success: false, error: "channel_not_found" });
    const entries = [
      { id: 1, monitorId: 1, changeId: 10, reason: "digest", scheduledFor: new Date(), delivered: false, deliveredAt: null, createdAt: new Date() },
    ];
    mockGetPendingDigestEntries.mockResolvedValueOnce(entries);
    mockGetMonitorChangesByIds.mockResolvedValueOnce([makeChange({ id: 10 })]);

    await processDigestBatch(makeMonitor(), makePrefs({ digestMode: true }));
    expect(mockMarkQueueEntriesDelivered).not.toHaveBeenCalled();
  });

  it("processQueuedNotifications does not mark delivered when webhook fails", async () => {
    mockGetMonitorChannels.mockResolvedValue([
      { id: 1, monitorId: 1, channel: "webhook", enabled: true, config: { url: "https://hooks.example.com", secret: "whsec_test" }, createdAt: new Date(), updatedAt: new Date() },
    ]);
    mockWebhookDeliver.mockResolvedValue({ success: false, error: "timeout" });
    const entry = { id: 1, monitorId: 1, changeId: 10, reason: "quiet_hours" as const, scheduledFor: new Date(), delivered: false, deliveredAt: null, createdAt: new Date() };
    mockGetReadyQueueEntries.mockResolvedValueOnce([entry]);
    mockGetMonitor.mockResolvedValueOnce(makeMonitor());
    mockGetNotificationPreferences.mockResolvedValueOnce(makePrefs());
    mockGetMonitorChangesByIds.mockResolvedValueOnce([makeChange({ id: 10 })]);

    await processQueuedNotifications();
    expect(mockMarkQueueEntryDelivered).not.toHaveBeenCalled();
  });

  it("processQueuedNotifications does not mark delivered when slack fails", async () => {
    mockGetMonitorChannels.mockResolvedValue([
      { id: 1, monitorId: 1, channel: "slack", enabled: true, config: { channelId: "C0123" }, createdAt: new Date(), updatedAt: new Date() },
    ]);
    mockGetSlackConnection.mockResolvedValue({
      id: 1, userId: "user1", teamId: "T001", teamName: "Test", botToken: "encrypted",
      scope: "chat:write", createdAt: new Date(), updatedAt: new Date(),
    });
    mockSlackDeliver.mockResolvedValue({ success: false, error: "not_in_channel" });
    const entry = { id: 1, monitorId: 1, changeId: 10, reason: "quiet_hours" as const, scheduledFor: new Date(), delivered: false, deliveredAt: null, createdAt: new Date() };
    mockGetReadyQueueEntries.mockResolvedValueOnce([entry]);
    mockGetMonitor.mockResolvedValueOnce(makeMonitor());
    mockGetNotificationPreferences.mockResolvedValueOnce(makePrefs());
    mockGetMonitorChangesByIds.mockResolvedValueOnce([makeChange({ id: 10 })]);

    await processQueuedNotifications();
    expect(mockMarkQueueEntryDelivered).not.toHaveBeenCalled();
  });
});

describe("orphaned queue entry handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAddDeliveryLog.mockResolvedValue({ id: 1 });
    mockGetMonitorConditions.mockResolvedValue([]);
    mockGetMonitorChannels.mockResolvedValue([]);
    mockGetStaleQueueEntries.mockResolvedValue([]);
    mockSendDigestEmail.mockResolvedValue({ success: true });
    mockSendNotificationEmail.mockResolvedValue({ success: true });
  });

  it("processDigestBatch logs warning and marks orphaned entries as delivered", async () => {
    const entries = [
      { id: 1, monitorId: 1, changeId: 10, reason: "digest", scheduledFor: new Date(), delivered: false, deliveredAt: null, createdAt: new Date() },
      { id: 2, monitorId: 1, changeId: 11, reason: "digest", scheduledFor: new Date(), delivered: false, deliveredAt: null, createdAt: new Date() },
      { id: 3, monitorId: 1, changeId: 12, reason: "digest", scheduledFor: new Date(), delivered: false, deliveredAt: null, createdAt: new Date() },
    ];
    mockGetPendingDigestEntries.mockResolvedValueOnce(entries);
    // Only change 10 exists; 11 and 12 are orphaned
    mockGetMonitorChangesByIds.mockResolvedValueOnce([makeChange({ id: 10 })]);

    const monitor = makeMonitor();
    const prefs = makePrefs({ digestMode: true });

    await processDigestBatch(monitor, prefs);

    // Should log warning about 2 orphaned entries
    expect(ErrorLogger.warning).toHaveBeenCalledWith(
      "scheduler",
      expect.stringContaining("2 queue entries reference deleted changes"),
      expect.objectContaining({ monitorId: 1, orphanedChangeIds: [11, 12] })
    );
    // Orphaned entries should be marked delivered
    expect(mockMarkQueueEntriesDelivered).toHaveBeenCalledWith([2, 3]);
    // The valid entry should also be marked delivered (in a separate call after successful delivery)
    expect(mockMarkQueueEntriesDelivered).toHaveBeenCalledWith([1]);
  });

  it("processDigestBatch only marks valid entries as delivered on success (not orphaned ones again)", async () => {
    const entries = [
      { id: 1, monitorId: 1, changeId: 10, reason: "digest", scheduledFor: new Date(), delivered: false, deliveredAt: null, createdAt: new Date() },
      { id: 2, monitorId: 1, changeId: 999, reason: "digest", scheduledFor: new Date(), delivered: false, deliveredAt: null, createdAt: new Date() },
    ];
    mockGetPendingDigestEntries.mockResolvedValueOnce(entries);
    mockGetMonitorChangesByIds.mockResolvedValueOnce([makeChange({ id: 10 })]);

    await processDigestBatch(makeMonitor(), makePrefs({ digestMode: true }));

    // First call: orphaned entries
    expect(mockMarkQueueEntriesDelivered).toHaveBeenCalledWith([2]);
    // Second call: only valid entries
    expect(mockMarkQueueEntriesDelivered).toHaveBeenCalledWith([1]);
    expect(mockMarkQueueEntriesDelivered).toHaveBeenCalledTimes(2);
  });

  it("processQueuedNotifications logs warning for orphaned entries", async () => {
    const entry = { id: 3, monitorId: 1, changeId: 999, reason: "quiet_hours" as const, scheduledFor: new Date(), delivered: false, deliveredAt: null, createdAt: new Date() };
    mockGetReadyQueueEntries.mockResolvedValueOnce([entry]);
    mockGetMonitor.mockResolvedValueOnce(makeMonitor());
    mockGetNotificationPreferences.mockResolvedValueOnce(makePrefs());
    mockGetMonitorChangesByIds.mockResolvedValueOnce([]);

    await processQueuedNotifications();

    expect(ErrorLogger.warning).toHaveBeenCalledWith(
      "scheduler",
      expect.stringContaining("change 999 not found"),
      expect.objectContaining({ monitorId: 1, changeId: 999, notificationQueueId: 3 })
    );
    expect(mockMarkQueueEntryDelivered).toHaveBeenCalledWith(3);
  });
});
