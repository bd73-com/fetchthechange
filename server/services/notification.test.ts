import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetNotificationPreferences = vi.fn().mockResolvedValue(undefined);
const mockQueueNotification = vi.fn().mockResolvedValue({ id: 1 });
const mockGetPendingDigestEntries = vi.fn().mockResolvedValue([]);
const mockGetMonitorChanges = vi.fn().mockResolvedValue([]);
const mockMarkQueueEntriesDelivered = vi.fn().mockResolvedValue(undefined);
const mockGetReadyQueueEntries = vi.fn().mockResolvedValue([]);
const mockMarkQueueEntryDelivered = vi.fn().mockResolvedValue(undefined);
const mockGetStaleQueueEntries = vi.fn().mockResolvedValue([]);
const mockGetAllDigestMonitorPreferences = vi.fn().mockResolvedValue([]);
const mockGetMonitor = vi.fn().mockResolvedValue(undefined);

vi.mock("../storage", () => ({
  storage: {
    getNotificationPreferences: (...args: any[]) => mockGetNotificationPreferences(...args),
    queueNotification: (...args: any[]) => mockQueueNotification(...args),
    getPendingDigestEntries: (...args: any[]) => mockGetPendingDigestEntries(...args),
    getMonitorChanges: (...args: any[]) => mockGetMonitorChanges(...args),
    markQueueEntriesDelivered: (...args: any[]) => mockMarkQueueEntriesDelivered(...args),
    getReadyQueueEntries: (...args: any[]) => mockGetReadyQueueEntries(...args),
    markQueueEntryDelivered: (...args: any[]) => mockMarkQueueEntryDelivered(...args),
    getStaleQueueEntries: (...args: any[]) => mockGetStaleQueueEntries(...args),
    getAllDigestMonitorPreferences: (...args: any[]) => mockGetAllDigestMonitorPreferences(...args),
    getMonitor: (...args: any[]) => mockGetMonitor(...args),
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

import {
  isInQuietHours,
  meetsThreshold,
  processChangeNotification,
  processDigestBatch,
  processQueuedNotifications,
} from "./notification";

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
    expect(mockSendNotificationEmail).toHaveBeenCalledWith(monitor, "$19.99", "$24.99");
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
    mockGetMonitorChanges.mockResolvedValue(changes);

    const monitor = makeMonitor();
    const prefs = makePrefs({ digestMode: true });

    const result = await processDigestBatch(monitor, prefs);
    expect(result).toEqual({ success: true });
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
    mockGetMonitorChanges.mockResolvedValue([makeChange({ id: 10 })]);

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
    mockGetMonitorChanges.mockResolvedValueOnce([makeChange({ id: 10 })]);
    mockSendNotificationEmail.mockResolvedValueOnce({ success: true });

    await processQueuedNotifications();
    expect(mockSendNotificationEmail).toHaveBeenCalled();
    expect(mockMarkQueueEntryDelivered).toHaveBeenCalledWith(1);
  });
});

describe("decision tree edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
