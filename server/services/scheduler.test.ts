import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoist mock variables so they're available inside vi.mock factories
// ---------------------------------------------------------------------------
const {
  mockCheckMonitor,
  mockGetAllActiveMonitors,
  mockCleanupPollutedValues,
  mockDbExecute,
  cronCallbacks,
  mockMonitorsNeedingRetry,
} = vi.hoisted(() => ({
  mockCheckMonitor: vi.fn().mockResolvedValue({ changed: false, status: "ok" }),
  mockGetAllActiveMonitors: vi.fn().mockResolvedValue([]),
  mockCleanupPollutedValues: vi.fn().mockResolvedValue(undefined),
  mockDbExecute: vi.fn().mockResolvedValue({ rowCount: 0 }),
  cronCallbacks: {} as Record<string, () => Promise<void>>,
  mockMonitorsNeedingRetry: new Set<number>(),
}));

vi.mock("../storage", () => ({
  storage: {
    getAllActiveMonitors: mockGetAllActiveMonitors,
    cleanupPollutedValues: mockCleanupPollutedValues,
  },
}));

vi.mock("./scraper", () => ({
  checkMonitor: (...args: any[]) => mockCheckMonitor(...args),
  monitorsNeedingRetry: mockMonitorsNeedingRetry,
}));

vi.mock("./notification", () => ({
  processQueuedNotifications: vi.fn().mockResolvedValue(undefined),
  processDigestCron: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./logger", () => ({
  ErrorLogger: {
    error: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../db", () => ({
  db: {
    execute: (...args: any[]) => mockDbExecute(...args),
  },
}));

vi.mock("drizzle-orm", () => ({
  sql: (strings: TemplateStringsArray, ...values: any[]) => ({ strings, values }),
}));

vi.mock("node-cron", () => ({
  default: {
    schedule: vi.fn((expression: string, callback: () => Promise<void>) => {
      cronCallbacks[expression] = callback;
    }),
  },
}));

import { startScheduler } from "./scheduler";
import { processQueuedNotifications, processDigestCron } from "./notification";
import { ErrorLogger } from "./logger";
import type { Monitor } from "@shared/schema";

function makeMonitor(overrides: Partial<Monitor> = {}): Monitor {
  return {
    id: 1,
    userId: "user1",
    name: "Test Monitor",
    url: "https://example.com",
    selector: ".price",
    frequency: "hourly",
    lastChecked: null,
    lastChanged: null,
    currentValue: null,
    lastStatus: "ok",
    lastError: null,
    active: true,
    emailEnabled: false,
    consecutiveFailures: 0,
    pauseReason: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe("startScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    // Clear captured cron callbacks
    Object.keys(cronCallbacks).forEach((k) => delete cronCallbacks[k]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls cleanupPollutedValues on start", async () => {
    await startScheduler();
    expect(mockCleanupPollutedValues).toHaveBeenCalledOnce();
  });

  it("registers all cron schedules (every-minute, notification queue, and daily cleanup)", async () => {
    await startScheduler();
    expect(cronCallbacks["* * * * *"]).toBeDefined();
    expect(cronCallbacks["*/1 * * * *"]).toBeDefined();
    expect(cronCallbacks["0 3 * * *"]).toBeDefined();
  });

  it("schedules checks for monitors that have never been checked", async () => {
    const monitor = makeMonitor({ lastChecked: null });
    mockGetAllActiveMonitors.mockResolvedValueOnce([monitor]);

    await startScheduler();
    await cronCallbacks["* * * * *"]();

    // The check is dispatched via setTimeout with jitter (0-30s)
    await vi.advanceTimersByTimeAsync(31000);

    expect(mockCheckMonitor).toHaveBeenCalledWith(monitor);
  });

  it("schedules check for hourly monitor when > 1 hour since last check", async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const monitor = makeMonitor({ frequency: "hourly", lastChecked: twoHoursAgo });
    mockGetAllActiveMonitors.mockResolvedValueOnce([monitor]);

    await startScheduler();
    await cronCallbacks["* * * * *"]();
    await vi.advanceTimersByTimeAsync(31000);

    expect(mockCheckMonitor).toHaveBeenCalledWith(monitor);
  });

  it("does NOT schedule check for hourly monitor when < 1 hour since last check", async () => {
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    const monitor = makeMonitor({ frequency: "hourly", lastChecked: thirtyMinutesAgo });
    mockGetAllActiveMonitors.mockResolvedValueOnce([monitor]);

    await startScheduler();
    await cronCallbacks["* * * * *"]();
    await vi.advanceTimersByTimeAsync(31000);

    expect(mockCheckMonitor).not.toHaveBeenCalled();
  });

  it("schedules check for daily monitor when > 24 hours since last check", async () => {
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const monitor = makeMonitor({ frequency: "daily", lastChecked: twoDaysAgo });
    mockGetAllActiveMonitors.mockResolvedValueOnce([monitor]);

    await startScheduler();
    await cronCallbacks["* * * * *"]();
    await vi.advanceTimersByTimeAsync(31000);

    expect(mockCheckMonitor).toHaveBeenCalledWith(monitor);
  });

  it("does NOT schedule check for daily monitor when < 24 hours since last check", async () => {
    const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);
    const monitor = makeMonitor({ frequency: "daily", lastChecked: twelveHoursAgo });
    mockGetAllActiveMonitors.mockResolvedValueOnce([monitor]);

    await startScheduler();
    await cronCallbacks["* * * * *"]();
    await vi.advanceTimersByTimeAsync(31000);

    expect(mockCheckMonitor).not.toHaveBeenCalled();
  });

  it("logs error when checkMonitor throws (does not crash scheduler)", async () => {
    const monitor = makeMonitor({ lastChecked: null });
    mockGetAllActiveMonitors.mockResolvedValueOnce([monitor]);
    mockCheckMonitor.mockRejectedValueOnce(new Error("Unexpected crash"));

    await startScheduler();
    await cronCallbacks["* * * * *"]();
    await vi.advanceTimersByTimeAsync(31000);

    expect(ErrorLogger.error).toHaveBeenCalledWith(
      "scheduler",
      expect.stringContaining("scheduled check failed"),
      expect.any(Error),
      expect.objectContaining({ monitorId: 1 })
    );
  });

  it("logs error when getAllActiveMonitors throws", async () => {
    mockGetAllActiveMonitors.mockRejectedValueOnce(new Error("DB down"));

    await startScheduler();
    await cronCallbacks["* * * * *"]();

    expect(ErrorLogger.error).toHaveBeenCalledWith(
      "scheduler",
      "Scheduler iteration failed",
      expect.any(Error),
      expect.objectContaining({
        errorMessage: "DB down",
        activeChecks: 0,
        phase: "fetching active monitors",
      })
    );
  });

  it("handles non-Error thrown in scheduler iteration (uses String coercion)", async () => {
    mockGetAllActiveMonitors.mockRejectedValueOnce("connection reset");

    await startScheduler();
    await cronCallbacks["* * * * *"]();

    expect(ErrorLogger.error).toHaveBeenCalledWith(
      "scheduler",
      "Scheduler iteration failed",
      null,
      expect.objectContaining({
        errorMessage: "connection reset",
        activeChecks: 0,
        phase: "fetching active monitors",
      })
    );
  });

  it("reports activeChecks > 0 when prior checks are still in-flight", async () => {
    // First iteration: start a check that never resolves (stays in-flight)
    const monitor = makeMonitor({ id: 1, lastChecked: null });
    mockGetAllActiveMonitors.mockResolvedValueOnce([monitor]);
    let resolver: () => void;
    mockCheckMonitor.mockImplementationOnce(
      () => new Promise<void>((resolve) => { resolver = resolve; })
    );

    await startScheduler();
    await cronCallbacks["* * * * *"]();
    await vi.advanceTimersByTimeAsync(31000);

    // One check is now in-flight (activeChecks === 1)
    expect(mockCheckMonitor).toHaveBeenCalledTimes(1);

    // Second iteration: getAllActiveMonitors fails while check is still running
    mockGetAllActiveMonitors.mockRejectedValueOnce(new Error("DB pool exhausted"));
    await cronCallbacks["* * * * *"]();

    expect(ErrorLogger.error).toHaveBeenCalledWith(
      "scheduler",
      "Scheduler iteration failed",
      expect.any(Error),
      expect.objectContaining({
        errorMessage: "DB pool exhausted",
        activeChecks: 1,
      })
    );

    // Clean up: resolve the hanging check and flush microtask so .finally() decrements activeChecks
    resolver!();
    await Promise.resolve();
  });
});

describe("concurrency limiting (runCheckWithLimit)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    Object.keys(cronCallbacks).forEach((k) => delete cronCallbacks[k]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("drops checks when MAX_CONCURRENT_CHECKS (10) is reached", async () => {
    // Create 12 monitors that all need checking
    const monitors = Array.from({ length: 12 }, (_, i) =>
      makeMonitor({ id: i + 1, name: `Monitor ${i + 1}`, lastChecked: null })
    );
    mockGetAllActiveMonitors.mockResolvedValueOnce(monitors);

    // Make checkMonitor hang indefinitely (never resolve) to saturate the limit
    let resolvers: Array<() => void> = [];
    mockCheckMonitor.mockImplementation(
      () => new Promise<void>((resolve) => resolvers.push(resolve))
    );

    await startScheduler();
    await cronCallbacks["* * * * *"]();

    // Advance past all jitter timers (max 30s)
    await vi.advanceTimersByTimeAsync(31000);

    // At most MAX_CONCURRENT_CHECKS (10) should have started
    expect(mockCheckMonitor.mock.calls.length).toBeLessThanOrEqual(10);

    // Clean up: resolve all pending
    resolvers.forEach((r) => r());
  });

  it("decrements active count after check completes, allowing new checks", async () => {
    // First iteration: 10 monitors fill the limit
    const monitors10 = Array.from({ length: 10 }, (_, i) =>
      makeMonitor({ id: i + 1, name: `Monitor ${i + 1}`, lastChecked: null })
    );
    mockGetAllActiveMonitors.mockResolvedValueOnce(monitors10);

    let resolvers: Array<() => void> = [];
    mockCheckMonitor.mockImplementation(
      () => new Promise<void>((resolve) => resolvers.push(resolve))
    );

    await startScheduler();
    await cronCallbacks["* * * * *"]();
    await vi.advanceTimersByTimeAsync(31000);

    // All 10 should have started
    expect(mockCheckMonitor.mock.calls.length).toBe(10);

    // Complete all checks
    resolvers.forEach((r) => r());
    await vi.advanceTimersByTimeAsync(10);

    // Second iteration: a new monitor should now be able to start
    mockCheckMonitor.mockClear();
    const newMonitor = [makeMonitor({ id: 11, name: "Monitor 11", lastChecked: null })];
    mockGetAllActiveMonitors.mockResolvedValueOnce(newMonitor);
    resolvers = [];
    mockCheckMonitor.mockImplementation(
      () => new Promise<void>((resolve) => resolvers.push(resolve))
    );

    await cronCallbacks["* * * * *"]();
    await vi.advanceTimersByTimeAsync(31000);

    // Should have started since active count is back to 0
    expect(mockCheckMonitor.mock.calls.length).toBe(1);
    resolvers.forEach((r) => r());
  });

  it("decrements active count even when checkMonitor throws", async () => {
    const monitors = [makeMonitor({ id: 1, lastChecked: null })];
    mockGetAllActiveMonitors
      .mockResolvedValueOnce(monitors)
      .mockResolvedValueOnce(monitors);

    // First call throws
    mockCheckMonitor.mockRejectedValueOnce(new Error("crash"));

    await startScheduler();
    await cronCallbacks["* * * * *"]();
    await vi.advanceTimersByTimeAsync(31000);

    expect(mockCheckMonitor).toHaveBeenCalledTimes(1);

    // Second iteration: should still be able to start (active count decremented via finally)
    mockCheckMonitor.mockClear();
    mockCheckMonitor.mockResolvedValueOnce({ changed: false, status: "ok" });

    await cronCallbacks["* * * * *"]();
    await vi.advanceTimersByTimeAsync(31000);

    expect(mockCheckMonitor).toHaveBeenCalledTimes(1);
  });
});

describe("accelerated retry for Browserless infra failures", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    Object.keys(cronCallbacks).forEach((k) => delete cronCallbacks[k]);
  });

  afterEach(() => {
    vi.useRealTimers();
    // Clear the retry set after each test
    mockMonitorsNeedingRetry.clear();
  });

  it("triggers check for monitor in retry set after 5 minutes", async () => {
    mockMonitorsNeedingRetry.add(1);

    // Last checked 6 minutes ago (> 5 min accelerated threshold)
    const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000);
    const monitor = makeMonitor({ id: 1, frequency: "daily", lastChecked: sixMinutesAgo });
    mockGetAllActiveMonitors.mockResolvedValueOnce([monitor]);

    await startScheduler();
    await cronCallbacks["* * * * *"]();
    await vi.advanceTimersByTimeAsync(31000);

    // Should be checked even though daily frequency hasn't elapsed
    expect(mockCheckMonitor).toHaveBeenCalledWith(monitor);
  });

  it("does NOT trigger accelerated check before 5 minutes", async () => {
    mockMonitorsNeedingRetry.add(1);

    // Last checked 3 minutes ago (< 5 min threshold)
    const threeMinutesAgo = new Date(Date.now() - 3 * 60 * 1000);
    const monitor = makeMonitor({ id: 1, frequency: "daily", lastChecked: threeMinutesAgo });
    mockGetAllActiveMonitors.mockResolvedValueOnce([monitor]);

    await startScheduler();
    await cronCallbacks["* * * * *"]();
    await vi.advanceTimersByTimeAsync(31000);

    // Should NOT be checked yet (daily hasn't elapsed, and retry interval not reached)
    expect(mockCheckMonitor).not.toHaveBeenCalled();
  });

  it("does NOT trigger accelerated check for monitors not in retry set", async () => {
    // Retry set is empty — monitor 1 is not in it
    const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000);
    const monitor = makeMonitor({ id: 1, frequency: "daily", lastChecked: sixMinutesAgo });
    mockGetAllActiveMonitors.mockResolvedValueOnce([monitor]);

    await startScheduler();
    await cronCallbacks["* * * * *"]();
    await vi.advanceTimersByTimeAsync(31000);

    // 6 minutes is not enough for daily schedule
    expect(mockCheckMonitor).not.toHaveBeenCalled();
  });

  it("normal hourly schedule still triggers for monitors also in retry set", async () => {
    mockMonitorsNeedingRetry.add(1);

    // Last checked 2 hours ago — both retry AND hourly would trigger
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const monitor = makeMonitor({ id: 1, frequency: "hourly", lastChecked: twoHoursAgo });
    mockGetAllActiveMonitors.mockResolvedValueOnce([monitor]);

    await startScheduler();
    await cronCallbacks["* * * * *"]();
    await vi.advanceTimersByTimeAsync(31000);

    // Check should trigger (accelerated retry condition matched first)
    expect(mockCheckMonitor).toHaveBeenCalledWith(monitor);
    // Should only be called once (not double-scheduled)
    expect(mockCheckMonitor).toHaveBeenCalledTimes(1);
  });
});

describe("daily metrics cleanup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    Object.keys(cronCallbacks).forEach((k) => delete cronCallbacks[k]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("executes DELETE for old metrics and logs when rows are deleted", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await startScheduler();
    mockDbExecute.mockResolvedValueOnce({ rowCount: 42 });
    await cronCallbacks["0 3 * * *"]();

    expect(mockDbExecute).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Pruned 42 monitor_metrics rows")
    );
    consoleSpy.mockRestore();
  });

  it("does not log when no rows are deleted", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await startScheduler();
    mockDbExecute.mockResolvedValueOnce({ rowCount: 0 });
    await cronCallbacks["0 3 * * *"]();

    expect(consoleSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("Pruned")
    );
    consoleSpy.mockRestore();
  });

  it("logs error when cleanup query fails", async () => {
    await startScheduler();
    mockDbExecute.mockRejectedValueOnce(new Error("DB timeout"));
    await cronCallbacks["0 3 * * *"]();

    expect(ErrorLogger.error).toHaveBeenCalledWith(
      "scheduler",
      "monitor_metrics cleanup failed",
      expect.any(Error),
      expect.objectContaining({
        errorMessage: "DB timeout",
        retentionDays: 90,
        table: "monitor_metrics",
      })
    );
  });

  it("handles non-Error thrown in cleanup (uses String coercion)", async () => {
    await startScheduler();
    mockDbExecute.mockRejectedValueOnce("disk full");
    await cronCallbacks["0 3 * * *"]();

    expect(ErrorLogger.error).toHaveBeenCalledWith(
      "scheduler",
      "monitor_metrics cleanup failed",
      null,
      expect.objectContaining({
        errorMessage: "disk full",
        retentionDays: 90,
        table: "monitor_metrics",
      })
    );
  });
});

describe("notification queue and digest cron (*/1 * * * *)", () => {
  const mockProcessQueuedNotifications = vi.mocked(processQueuedNotifications);
  const mockProcessDigestCron = vi.mocked(processDigestCron);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    Object.keys(cronCallbacks).forEach((k) => delete cronCallbacks[k]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls processQueuedNotifications on each tick", async () => {
    await startScheduler();
    await cronCallbacks["*/1 * * * *"]();

    expect(mockProcessQueuedNotifications).toHaveBeenCalledOnce();
  });

  it("calls processDigestCron on each tick", async () => {
    await startScheduler();
    await cronCallbacks["*/1 * * * *"]();

    expect(mockProcessDigestCron).toHaveBeenCalledOnce();
  });

  it("still calls processDigestCron when processQueuedNotifications throws", async () => {
    mockProcessQueuedNotifications.mockRejectedValueOnce(new Error("Queue DB error"));

    await startScheduler();
    await cronCallbacks["*/1 * * * *"]();

    expect(ErrorLogger.error).toHaveBeenCalledWith(
      "scheduler",
      "Queued notification processing failed",
      expect.any(Error),
      expect.objectContaining({
        errorMessage: "Queue DB error",
      })
    );
    expect(mockProcessDigestCron).toHaveBeenCalledOnce();
  });

  it("logs error when processDigestCron throws", async () => {
    mockProcessDigestCron.mockRejectedValueOnce(new Error("Digest error"));

    await startScheduler();
    await cronCallbacks["*/1 * * * *"]();

    expect(ErrorLogger.error).toHaveBeenCalledWith(
      "scheduler",
      "Digest processing failed",
      expect.any(Error),
      expect.objectContaining({
        errorMessage: "Digest error",
      })
    );
  });

  it("handles non-Error thrown in notification processing (uses String coercion)", async () => {
    mockProcessQueuedNotifications.mockRejectedValueOnce(42);

    await startScheduler();
    await cronCallbacks["*/1 * * * *"]();

    expect(ErrorLogger.error).toHaveBeenCalledWith(
      "scheduler",
      "Queued notification processing failed",
      null,
      expect.objectContaining({
        errorMessage: "42",
      })
    );
  });

  it("handles non-Error thrown in digest processing (uses String coercion)", async () => {
    mockProcessDigestCron.mockRejectedValueOnce({ code: "TIMEOUT" });

    await startScheduler();
    await cronCallbacks["*/1 * * * *"]();

    expect(ErrorLogger.error).toHaveBeenCalledWith(
      "scheduler",
      "Digest processing failed",
      null,
      expect.objectContaining({
        errorMessage: "[object Object]",
      })
    );
  });

  it("logs both errors when both processQueuedNotifications and processDigestCron throw", async () => {
    mockProcessQueuedNotifications.mockRejectedValueOnce(new Error("Queue error"));
    mockProcessDigestCron.mockRejectedValueOnce(new Error("Digest error"));

    await startScheduler();
    await cronCallbacks["*/1 * * * *"]();

    expect(ErrorLogger.error).toHaveBeenCalledTimes(2);
    expect(ErrorLogger.error).toHaveBeenCalledWith(
      "scheduler",
      "Queued notification processing failed",
      expect.any(Error),
      expect.objectContaining({
        errorMessage: "Queue error",
      })
    );
    expect(ErrorLogger.error).toHaveBeenCalledWith(
      "scheduler",
      "Digest processing failed",
      expect.any(Error),
      expect.objectContaining({
        errorMessage: "Digest error",
      })
    );
  });
});
