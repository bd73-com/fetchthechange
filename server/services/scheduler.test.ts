import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoist mock variables so they're available inside vi.mock factories
// ---------------------------------------------------------------------------
const {
  mockCheckMonitor,
  mockGetAllActiveMonitors,
  mockCleanupPollutedValues,
  mockDbExecute,
  mockDbUpdateSet,
  cronCallbacks,
  mockMonitorsNeedingRetry,
  mockDeliverWebhook,
} = vi.hoisted(() => ({
  mockCheckMonitor: vi.fn().mockResolvedValue({ changed: false, status: "ok" }),
  mockGetAllActiveMonitors: vi.fn().mockResolvedValue([]),
  mockCleanupPollutedValues: vi.fn().mockResolvedValue(undefined),
  mockDbExecute: vi.fn().mockResolvedValue({ rowCount: 0 }),
  mockDbUpdateSet: vi.fn(),
  cronCallbacks: {} as Record<string, Array<() => Promise<void>>>,
  mockMonitorsNeedingRetry: new Set<number>(),
  mockDeliverWebhook: vi.fn().mockResolvedValue({ success: true, statusCode: 200 }),
}));

vi.mock("../storage", () => ({
  PENDING_WEBHOOK_RETRY_QUERY_LIMIT: 500,
  storage: {
    getAllActiveMonitors: mockGetAllActiveMonitors,
    cleanupPollutedValues: mockCleanupPollutedValues,
    getPendingWebhookRetries: vi.fn().mockResolvedValue([]),
    getMonitorChannels: vi.fn().mockResolvedValue([]),
    getMonitor: vi.fn().mockResolvedValue(undefined),
    getMonitorChanges: vi.fn().mockResolvedValue([]),
    getMonitorChangeById: vi.fn().mockResolvedValue(undefined),
    updateDeliveryLog: vi.fn().mockResolvedValue(undefined),
    cleanupOldDeliveryLogs: vi.fn().mockResolvedValue(0),
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

vi.mock("./webhookDelivery", () => ({
  deliver: (...args: any[]) => mockDeliverWebhook(...args),
}));

vi.mock("./logger", () => ({
  ErrorLogger: {
    error: vi.fn().mockResolvedValue(undefined),
    warning: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../db", () => ({
  db: {
    execute: (...args: any[]) => mockDbExecute(...args),
    update: vi.fn().mockReturnValue({
      set: (...args: any[]) => {
        mockDbUpdateSet(...args);
        const whereFn = vi.fn().mockReturnValue({
          catch: vi.fn().mockReturnValue(Promise.resolve()),
          then: (resolve: any) => Promise.resolve().then(resolve),
        });
        return { where: whereFn };
      },
    }),
  },
}));

vi.mock("drizzle-orm", () => ({
  sql: (strings: TemplateStringsArray, ...values: any[]) => ({ strings, values }),
  relations: vi.fn(),
  eq: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
  lte: vi.fn(),
}));

vi.mock("./automatedCampaigns", () => ({
  processAutomatedCampaigns: vi.fn().mockResolvedValue(undefined),
}));

const { mockOnClose } = vi.hoisted(() => ({
  mockOnClose: vi.fn(),
}));

vi.mock("./browserlessCircuitBreaker", () => ({
  browserlessCircuitBreaker: {
    onClose: (...args: any[]) => mockOnClose(...args),
    isAvailable: vi.fn().mockReturnValue(true),
    recordSuccess: vi.fn(),
    recordInfraFailure: vi.fn(),
    getState: vi.fn().mockReturnValue("closed"),
    reset: vi.fn(),
  },
}));

const { mockEnsureMonitorConditionsTable } = vi.hoisted(() => ({
  mockEnsureMonitorConditionsTable: vi.fn().mockResolvedValue(true),
}));

vi.mock("./ensureTables", () => ({
  ensureMonitorConditionsTable: (...args: any[]) => mockEnsureMonitorConditionsTable(...args),
}));

vi.mock("node-cron", () => ({
  default: {
    schedule: vi.fn((expression: string, callback: () => Promise<void>) => {
      if (!cronCallbacks[expression]) cronCallbacks[expression] = [];
      cronCallbacks[expression].push(callback);
      return { stop: vi.fn() };
    }),
  },
}));

import { startScheduler, stopScheduler, retryBackoff, _resetSchedulerStarted, _resetActiveChecks } from "./scheduler";
import { processQueuedNotifications, processDigestCron } from "./notification";
import { ErrorLogger } from "./logger";
import { _resetCache } from "./notificationReady";
import cron from "node-cron";
import { storage } from "../storage";

const mockStorage = vi.mocked(storage);
import type { Monitor } from "@shared/schema";

/**
 * Flush the microtask queue so detached (void) async calls settle.
 * Needed because `vi.advanceTimersByTimeAsync` resolves timer callbacks
 * but does NOT drain microtasks spawned by fire-and-forget promises
 * (e.g. `void runCheckWithLimit(monitor)`). Each `await` yields one tick;
 * we yield enough ticks to cover the current async depth of
 * trackTimeout → runCheckWithLimit → checkMonitor → .then().
 */
async function flushPromises(ticks = 4): Promise<void> {
  for (let i = 0; i < ticks; i++) await Promise.resolve();
}

// Helper: call all callbacks registered for a cron expression
async function runCron(expression: string) {
  const callbacks = cronCallbacks[expression];
  if (!callbacks) return;
  for (const cb of callbacks) {
    await cb();
  }
}

function hasCron(expression: string): boolean {
  return !!cronCallbacks[expression] && cronCallbacks[expression].length > 0;
}

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
    healthAlertSentAt: null,
    lastHealthyAt: null,
    pendingRetryAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe("startScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    _resetSchedulerStarted();
    _resetActiveChecks();
    _resetCache();
    // Clear captured cron callbacks
    Object.keys(cronCallbacks).forEach((k) => delete (cronCallbacks as any)[k]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls ensureMonitorConditionsTable on start", async () => {
    await startScheduler();
    expect(mockEnsureMonitorConditionsTable).toHaveBeenCalledOnce();
  });

  it("continues startup when ensureMonitorConditionsTable times out", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockEnsureMonitorConditionsTable.mockImplementation(
      () => new Promise(() => {}) // never resolves
    );

    const startPromise = startScheduler();
    // Advance past the 10s timeout and the 30s background retry
    await vi.advanceTimersByTimeAsync(31000);
    await startPromise;

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("ensureMonitorConditionsTable timed out")
    );
    warnSpy.mockRestore();
    // Restore default mock so subsequent tests aren't affected
    mockEnsureMonitorConditionsTable.mockResolvedValue(true);
  });

  it("calls cleanupPollutedValues on start", async () => {
    await startScheduler();
    expect(mockCleanupPollutedValues).toHaveBeenCalledOnce();
  });

  it("continues startup and registers cron jobs when cleanupPollutedValues throws", async () => {
    mockCleanupPollutedValues.mockRejectedValueOnce(new Error("DB connection lost"));

    await startScheduler();

    expect(ErrorLogger.warning).toHaveBeenCalledWith(
      "scheduler",
      "cleanupPollutedValues failed (non-fatal)",
      expect.objectContaining({ errorMessage: "DB connection lost" })
    );
    // Cron jobs should still be registered despite the failure
    expect(hasCron("* * * * *")).toBe(true);
    expect(hasCron("*/1 * * * *")).toBe(true);
    expect(hasCron("0 3 * * *")).toBe(true);
  });

  it("registers all cron schedules (every-minute, notification queue, and daily cleanup)", async () => {
    await startScheduler();
    expect(hasCron("* * * * *")).toBe(true);
    expect(hasCron("*/1 * * * *")).toBe(true);
    expect(hasCron("0 3 * * *")).toBe(true);
  });

  it("skips notification cron when notification tables do not exist", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockDbExecute.mockRejectedValue(new Error('relation "notification_preferences" does not exist'));

    await startScheduler();

    expect(hasCron("*/1 * * * *")).toBe(false);
    expect(hasCron("* * * * *")).toBe(true);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Notification tables")
    );
    consoleSpy.mockRestore();
    // Restore default so other tests work
    mockDbExecute.mockResolvedValue({ rowCount: 0 });
  });

  it("schedules checks for monitors that have never been checked", async () => {
    const monitor = makeMonitor({ lastChecked: null });
    mockGetAllActiveMonitors.mockResolvedValueOnce([monitor]);

    await startScheduler();
    await runCron("* * * * *");

    // The check is dispatched via setTimeout with jitter (0-30s)
    await vi.advanceTimersByTimeAsync(31000);

    expect(mockCheckMonitor).toHaveBeenCalledWith(monitor);
  });

  it("schedules check for hourly monitor when > 1 hour since last check", async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const monitor = makeMonitor({ frequency: "hourly", lastChecked: twoHoursAgo });
    mockGetAllActiveMonitors.mockResolvedValueOnce([monitor]);

    await startScheduler();
    await runCron("* * * * *");
    await vi.advanceTimersByTimeAsync(31000);

    expect(mockCheckMonitor).toHaveBeenCalledWith(monitor);
  });

  it("does NOT schedule check for hourly monitor when < 1 hour since last check", async () => {
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    const monitor = makeMonitor({ frequency: "hourly", lastChecked: thirtyMinutesAgo });
    mockGetAllActiveMonitors.mockResolvedValueOnce([monitor]);

    await startScheduler();
    await runCron("* * * * *");
    await vi.advanceTimersByTimeAsync(31000);

    expect(mockCheckMonitor).not.toHaveBeenCalled();
  });

  it("schedules check for daily monitor when > 24 hours since last check", async () => {
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const monitor = makeMonitor({ frequency: "daily", lastChecked: twoDaysAgo });
    mockGetAllActiveMonitors.mockResolvedValueOnce([monitor]);

    await startScheduler();
    await runCron("* * * * *");
    await vi.advanceTimersByTimeAsync(31000);

    expect(mockCheckMonitor).toHaveBeenCalledWith(monitor);
  });

  it("does NOT schedule check for daily monitor when < 24 hours since last check", async () => {
    const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);
    const monitor = makeMonitor({ frequency: "daily", lastChecked: twelveHoursAgo });
    mockGetAllActiveMonitors.mockResolvedValueOnce([monitor]);

    await startScheduler();
    await runCron("* * * * *");
    await vi.advanceTimersByTimeAsync(31000);

    expect(mockCheckMonitor).not.toHaveBeenCalled();
  });

  it("logs error when checkMonitor throws (does not crash scheduler)", async () => {
    const monitor = makeMonitor({ lastChecked: null });
    mockGetAllActiveMonitors.mockResolvedValueOnce([monitor]);
    mockCheckMonitor.mockRejectedValueOnce(new Error("Unexpected crash"));

    await startScheduler();
    await runCron("* * * * *");
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
    await runCron("* * * * *");

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
    await runCron("* * * * *");

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
    await runCron("* * * * *");
    await vi.advanceTimersByTimeAsync(31000);

    // One check is now in-flight (activeChecks === 1)
    expect(mockCheckMonitor).toHaveBeenCalledTimes(1);

    // Second iteration: getAllActiveMonitors fails while check is still running
    mockGetAllActiveMonitors.mockRejectedValueOnce(new Error("DB pool exhausted"));
    await runCron("* * * * *");

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

  // -----------------------------------------------------------------------
  // auto-retry scheduler pickup (pendingRetryAt)
  // -----------------------------------------------------------------------

  it("triggers check for monitor with pendingRetryAt <= now", async () => {
    const monitor = makeMonitor({
      frequency: "hourly",
      lastChecked: new Date(Date.now() - 30 * 60 * 1000), // 30 min ago — not normally due
      pendingRetryAt: new Date(Date.now() - 1000), // 1 second in the past
    });
    mockGetAllActiveMonitors.mockResolvedValueOnce([monitor]);

    await startScheduler();
    await runCron("* * * * *");
    await vi.advanceTimersByTimeAsync(31000);

    expect(mockCheckMonitor).toHaveBeenCalledWith(monitor);
  });

  it("does NOT trigger check for monitor with pendingRetryAt in the future", async () => {
    const monitor = makeMonitor({
      frequency: "hourly",
      lastChecked: new Date(Date.now() - 30 * 60 * 1000), // 30 min ago — not normally due
      pendingRetryAt: new Date(Date.now() + 30 * 60 * 1000), // 30 min in the future
    });
    mockGetAllActiveMonitors.mockResolvedValueOnce([monitor]);

    await startScheduler();
    await runCron("* * * * *");
    await vi.advanceTimersByTimeAsync(31000);

    expect(mockCheckMonitor).not.toHaveBeenCalled();
  });

  it("clears pendingRetryAt after retry fires (success path)", async () => {
    const monitor = makeMonitor({
      frequency: "hourly",
      lastChecked: new Date(Date.now() - 30 * 60 * 1000),
      pendingRetryAt: new Date(Date.now() - 1000),
    });
    mockGetAllActiveMonitors.mockResolvedValueOnce([monitor]);

    await startScheduler();
    await runCron("* * * * *");
    await vi.advanceTimersByTimeAsync(31000);

    expect(mockCheckMonitor).toHaveBeenCalledWith(monitor);
    // The finally block should clear pendingRetryAt
    expect(mockDbUpdateSet).toHaveBeenCalledWith({ pendingRetryAt: null });
  });

  it("clears pendingRetryAt after retry fires (failure path)", async () => {
    mockCheckMonitor.mockRejectedValueOnce(new Error("Scrape failed"));
    const monitor = makeMonitor({
      frequency: "hourly",
      lastChecked: new Date(Date.now() - 30 * 60 * 1000),
      pendingRetryAt: new Date(Date.now() - 1000),
    });
    mockGetAllActiveMonitors.mockResolvedValueOnce([monitor]);

    await startScheduler();
    await runCron("* * * * *");
    await vi.advanceTimersByTimeAsync(31000);

    expect(mockCheckMonitor).toHaveBeenCalledWith(monitor);
    // Even on failure, pendingRetryAt should be cleared
    expect(mockDbUpdateSet).toHaveBeenCalledWith({ pendingRetryAt: null });
  });
});

describe("concurrency limiting (runCheckWithLimit)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    _resetSchedulerStarted();
    _resetActiveChecks();
    _resetCache();
    Object.keys(cronCallbacks).forEach((k) => { delete cronCallbacks[k]; });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("drops checks when MAX_CONCURRENT_CHECKS (2) is reached", async () => {
    // Create 4 monitors that all need checking
    const monitors = Array.from({ length: 4 }, (_, i) =>
      makeMonitor({ id: i + 1, name: `Monitor ${i + 1}`, lastChecked: null })
    );
    mockGetAllActiveMonitors.mockResolvedValueOnce(monitors);

    // Make checkMonitor hang indefinitely (never resolve) to saturate the limit
    let resolvers: Array<() => void> = [];
    mockCheckMonitor.mockImplementation(
      () => new Promise<void>((resolve) => resolvers.push(resolve))
    );

    await startScheduler();
    await runCron("* * * * *");

    // Advance past all jitter timers (max 30s)
    await vi.advanceTimersByTimeAsync(31000);

    // At most MAX_CONCURRENT_CHECKS (2) should have started
    expect(mockCheckMonitor.mock.calls.length).toBeLessThanOrEqual(2);

    // Clean up: resolve all pending
    resolvers.forEach((r) => { r(); });
  });

  it("decrements active count after check completes, allowing new checks", async () => {
    // First iteration: 2 monitors fill the limit
    const monitors2 = Array.from({ length: 2 }, (_, i) =>
      makeMonitor({ id: i + 1, name: `Monitor ${i + 1}`, lastChecked: null })
    );
    mockGetAllActiveMonitors.mockResolvedValueOnce(monitors2);

    let resolvers: Array<() => void> = [];
    mockCheckMonitor.mockImplementation(
      () => new Promise<void>((resolve) => resolvers.push(resolve))
    );

    await startScheduler();
    await runCron("* * * * *");
    await vi.advanceTimersByTimeAsync(31000);

    // All 2 should have started
    expect(mockCheckMonitor.mock.calls.length).toBe(2);

    // Complete all checks
    resolvers.forEach((r) => { r(); });
    await vi.advanceTimersByTimeAsync(10);

    // Second iteration: a new monitor should now be able to start
    mockCheckMonitor.mockClear();
    const newMonitor = [makeMonitor({ id: 11, name: "Monitor 11", lastChecked: null })];
    mockGetAllActiveMonitors.mockResolvedValueOnce(newMonitor);
    resolvers = [];
    mockCheckMonitor.mockImplementation(
      () => new Promise<void>((resolve) => resolvers.push(resolve))
    );

    await runCron("* * * * *");
    await vi.advanceTimersByTimeAsync(31000);

    // Should have started since active count is back to 0
    expect(mockCheckMonitor.mock.calls.length).toBe(1);
    resolvers.forEach((r) => { r(); });
  });

  it("decrements active count even when checkMonitor throws", async () => {
    const monitors = [makeMonitor({ id: 1, lastChecked: null })];
    mockGetAllActiveMonitors
      .mockResolvedValueOnce(monitors)
      .mockResolvedValueOnce(monitors);

    // First call throws
    mockCheckMonitor.mockRejectedValueOnce(new Error("crash"));

    await startScheduler();
    await runCron("* * * * *");
    await vi.advanceTimersByTimeAsync(31000);

    expect(mockCheckMonitor).toHaveBeenCalledTimes(1);

    // Second iteration: should still be able to start (active count decremented via finally)
    mockCheckMonitor.mockClear();
    mockCheckMonitor.mockResolvedValueOnce({ changed: false, status: "ok" });

    await runCron("* * * * *");
    await vi.advanceTimersByTimeAsync(31000);

    expect(mockCheckMonitor).toHaveBeenCalledTimes(1);
  });
});

describe("accelerated retry for Browserless infra failures", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    _resetSchedulerStarted();
    _resetActiveChecks();
    _resetCache();
    Object.keys(cronCallbacks).forEach((k) => { delete cronCallbacks[k]; });
    retryBackoff.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    // Clear the retry set after each test
    mockMonitorsNeedingRetry.clear();
    retryBackoff.clear();
  });

  it("triggers check for monitor in retry set after 2 minutes (base interval)", async () => {
    mockMonitorsNeedingRetry.add(1);

    // Last checked 3 minutes ago (> 2 min accelerated threshold)
    const threeMinutesAgo = new Date(Date.now() - 3 * 60 * 1000);
    const monitor = makeMonitor({ id: 1, frequency: "daily", lastChecked: threeMinutesAgo });
    mockGetAllActiveMonitors.mockResolvedValueOnce([monitor]);

    await startScheduler();
    await runCron("* * * * *");
    await vi.advanceTimersByTimeAsync(31000);

    // Should be checked even though daily frequency hasn't elapsed
    expect(mockCheckMonitor).toHaveBeenCalledWith(monitor);
  });

  it("does NOT trigger accelerated check before 2 minutes", async () => {
    mockMonitorsNeedingRetry.add(1);

    // Last checked 1 minute ago (< 2 min threshold)
    const oneMinuteAgo = new Date(Date.now() - 1 * 60 * 1000);
    const monitor = makeMonitor({ id: 1, frequency: "daily", lastChecked: oneMinuteAgo });
    mockGetAllActiveMonitors.mockResolvedValueOnce([monitor]);

    await startScheduler();
    await runCron("* * * * *");
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
    await runCron("* * * * *");
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
    await runCron("* * * * *");
    await vi.advanceTimersByTimeAsync(31000);

    // Check should trigger (accelerated retry condition matched first)
    expect(mockCheckMonitor).toHaveBeenCalledWith(monitor);
    // Should only be called once (not double-scheduled)
    expect(mockCheckMonitor).toHaveBeenCalledTimes(1);
  });

  it("backs off retry interval: 2 min → 4 min after first retry", async () => {
    mockMonitorsNeedingRetry.add(1);

    // First retry — set backoff.attempts to 1 (simulating prior retry)
    retryBackoff.set(1, { attempts: 1 });

    // Last checked 3 minutes ago — enough for base (2 min) but not backoff (4 min)
    const threeMinutesAgo = new Date(Date.now() - 3 * 60 * 1000);
    const monitor = makeMonitor({ id: 1, frequency: "daily", lastChecked: threeMinutesAgo });
    mockGetAllActiveMonitors.mockResolvedValueOnce([monitor]);

    await startScheduler();
    await runCron("* * * * *");
    await vi.advanceTimersByTimeAsync(31000);

    // 3 min < 4 min backoff interval — should NOT be checked
    expect(mockCheckMonitor).not.toHaveBeenCalled();
  });

  it("cleans up backoff entry when monitor leaves retry set", async () => {
    // Monitor was in retry set with backoff, now removed
    retryBackoff.set(1, { attempts: 3 });
    // NOT in retry set

    const threeMinutesAgo = new Date(Date.now() - 3 * 60 * 1000);
    const monitor = makeMonitor({ id: 1, frequency: "daily", lastChecked: threeMinutesAgo });
    mockGetAllActiveMonitors.mockResolvedValueOnce([monitor]);

    await startScheduler();
    await runCron("* * * * *");
    await vi.advanceTimersByTimeAsync(31000);

    // Backoff should be cleaned up
    expect(retryBackoff.has(1)).toBe(false);
  });

  it("registers onClose callback with circuit breaker", async () => {
    await startScheduler();
    expect(mockOnClose).toHaveBeenCalledOnce();
    expect(typeof mockOnClose.mock.calls[0][0]).toBe("function");
  });
});

describe("daily metrics cleanup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    _resetSchedulerStarted();
    _resetActiveChecks();
    _resetCache();
    Object.keys(cronCallbacks).forEach((k) => { delete cronCallbacks[k]; });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("executes DELETE for old metrics and logs when rows are deleted", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await startScheduler();
    mockDbExecute.mockResolvedValueOnce({ rowCount: 42 });
    await runCron("0 3 * * *");

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
    await runCron("0 3 * * *");

    expect(consoleSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("Pruned")
    );
    consoleSpy.mockRestore();
  });

  it("logs error when cleanup fails with non-transient DB error", async () => {
    await startScheduler();
    mockDbExecute.mockRejectedValueOnce(new Error('relation "monitor_metrics" does not exist'));
    await runCron("0 3 * * *");

    expect(ErrorLogger.error).toHaveBeenCalledWith(
      "scheduler",
      "monitor_metrics cleanup failed",
      expect.any(Error),
      expect.objectContaining({
        errorMessage: 'relation "monitor_metrics" does not exist',
        retentionDays: 90,
        table: "monitor_metrics",
      })
    );
  });

  it("logs warning when cleanup fails with transient DB error", async () => {
    await startScheduler();
    mockDbExecute
      .mockRejectedValueOnce(new Error("Connection terminated"))
      .mockRejectedValueOnce(new Error("Connection terminated"));
    const cronPromise = runCron("0 3 * * *");
    await vi.advanceTimersByTimeAsync(2000);
    await cronPromise;

    expect(ErrorLogger.warning).toHaveBeenCalledWith(
      "scheduler",
      "monitor_metrics cleanup failed (transient, will retry)",
      expect.objectContaining({
        errorMessage: "Connection terminated",
        retentionDays: 90,
        table: "monitor_metrics",
      })
    );
    // Verify the monitor_metrics cleanup itself didn't log an error (other cleanup tasks may)
    expect(ErrorLogger.error).not.toHaveBeenCalledWith(
      "scheduler",
      "monitor_metrics cleanup failed",
      expect.anything(),
      expect.anything()
    );
  });

  it("handles non-Error thrown in cleanup (uses String coercion)", async () => {
    await startScheduler();
    mockDbExecute.mockRejectedValueOnce("disk full");
    await runCron("0 3 * * *");

    // Non-Error values are not transient, so logged as error
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
    _resetSchedulerStarted();
    _resetActiveChecks();
    _resetCache();
    Object.keys(cronCallbacks).forEach((k) => { delete cronCallbacks[k]; });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls processQueuedNotifications on each tick", async () => {
    await startScheduler();
    await runCron("*/1 * * * *");

    expect(mockProcessQueuedNotifications).toHaveBeenCalledOnce();
  });

  it("calls processDigestCron on each tick", async () => {
    await startScheduler();
    await runCron("*/1 * * * *");

    expect(mockProcessDigestCron).toHaveBeenCalledOnce();
  });

  it("still calls processDigestCron when processQueuedNotifications throws", async () => {
    mockProcessQueuedNotifications.mockRejectedValueOnce(new Error("Queue DB error"));

    await startScheduler();
    await runCron("*/1 * * * *");

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
    await runCron("*/1 * * * *");

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
    await runCron("*/1 * * * *");

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
    await runCron("*/1 * * * *");

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
    await runCron("*/1 * * * *");

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

  it("logs warning (not error) when processQueuedNotifications fails with transient DB error", async () => {
    // Not wrapped in withDbRetry (to prevent duplicate deliveries), but
    // logSchedulerError still classifies transient errors as warnings.
    mockProcessQueuedNotifications
      .mockRejectedValueOnce(new Error("Connection terminated"));

    await startScheduler();
    await runCron("*/1 * * * *");

    expect(ErrorLogger.warning).toHaveBeenCalledWith(
      "scheduler",
      expect.stringContaining("Queued notification processing failed (transient, will retry)"),
      expect.objectContaining({
        errorMessage: "Connection terminated",
      })
    );
    expect(ErrorLogger.error).not.toHaveBeenCalled();
  });

  it("logs warning (not error) when processDigestCron fails with transient DB error", async () => {
    mockProcessDigestCron
      .mockRejectedValueOnce(new Error("Connection terminated"));

    await startScheduler();
    await runCron("*/1 * * * *");

    expect(ErrorLogger.warning).toHaveBeenCalledWith(
      "scheduler",
      expect.stringContaining("Digest processing failed (transient, will retry)"),
      expect.objectContaining({
        errorMessage: "Connection terminated",
      })
    );
    expect(ErrorLogger.error).not.toHaveBeenCalled();
  });
});

describe("stopScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    _resetSchedulerStarted();
    _resetActiveChecks();
    _resetCache();
    Object.keys(cronCallbacks).forEach((k) => { delete cronCallbacks[k]; });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls stop() on all registered cron tasks", async () => {
    await startScheduler();
    const mockedSchedule = vi.mocked(cron.schedule);
    const stopFns = mockedSchedule.mock.results.map((r) => r.value.stop);

    stopScheduler();

    for (const stop of stopFns) {
      expect(stop).toHaveBeenCalledOnce();
    }
  });

  it("resets schedulerStarted so startScheduler can be called again", async () => {
    await startScheduler();
    stopScheduler();
    // Should not throw "already started" — should register new cron jobs
    const mockedSchedule = vi.mocked(cron.schedule);
    const callsBefore = mockedSchedule.mock.calls.length;
    await startScheduler();
    expect(mockedSchedule.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it("is safe to call when no scheduler has been started", () => {
    expect(() => stopScheduler()).not.toThrow();
  });
});

describe("withDbRetry and re-entrancy guards", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    _resetSchedulerStarted();
    _resetActiveChecks();
    _resetCache();
    Object.keys(cronCallbacks).forEach((k) => { delete cronCallbacks[k]; });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries getAllActiveMonitors once on transient 'connection terminated' error", async () => {
    const monitor = makeMonitor({ lastChecked: null });
    mockGetAllActiveMonitors
      .mockRejectedValueOnce(new Error("Connection terminated due to connection timeout"))
      .mockResolvedValueOnce([monitor]);

    await startScheduler();
    // Advance past the 1s retry delay inside withDbRetry
    const cronPromise = runCron("* * * * *");
    await vi.advanceTimersByTimeAsync(2000);
    await cronPromise;
    // Advance past the jitter window (0-30s) to fire the trackTimeout
    await vi.advanceTimersByTimeAsync(31000);
    // Flush microtask queue for the detached (void) runCheckWithLimit promise
    await flushPromises();

    // Should have called getAllActiveMonitors twice (first fail, then retry)
    expect(mockGetAllActiveMonitors).toHaveBeenCalledTimes(2);
    // And the monitor check should have been scheduled
    expect(mockCheckMonitor).toHaveBeenCalledWith(monitor);
  });

  it("retries getAllActiveMonitors once on 'ECONNRESET' error", async () => {
    const monitor = makeMonitor({ lastChecked: null });
    mockGetAllActiveMonitors
      .mockRejectedValueOnce(new Error("read ECONNRESET"))
      .mockResolvedValueOnce([monitor]);

    await startScheduler();
    const cronPromise = runCron("* * * * *");
    await vi.advanceTimersByTimeAsync(2000);
    await cronPromise;
    await vi.advanceTimersByTimeAsync(31000);
    await flushPromises();

    expect(mockGetAllActiveMonitors).toHaveBeenCalledTimes(2);
    expect(mockCheckMonitor).toHaveBeenCalledWith(monitor);
  });

  it("does NOT retry on non-transient errors (e.g. syntax error)", async () => {
    mockGetAllActiveMonitors.mockRejectedValueOnce(new Error("relation 'monitors' does not exist"));

    await startScheduler();
    await runCron("* * * * *");

    expect(mockGetAllActiveMonitors).toHaveBeenCalledTimes(1);
    expect(ErrorLogger.error).toHaveBeenCalledWith(
      "scheduler",
      "Scheduler iteration failed",
      expect.any(Error),
      expect.objectContaining({ phase: "fetching active monitors" })
    );
  });

  it("logs warning when retry also fails on transient error", async () => {
    mockGetAllActiveMonitors
      .mockRejectedValueOnce(new Error("Connection terminated"))
      .mockRejectedValueOnce(new Error("Connection terminated again"));

    await startScheduler();
    const cronPromise = runCron("* * * * *");
    await vi.advanceTimersByTimeAsync(2000);
    await cronPromise;

    expect(mockGetAllActiveMonitors).toHaveBeenCalledTimes(2);
    // Transient DB errors are downgraded to warnings via logSchedulerError helper
    expect(ErrorLogger.warning).toHaveBeenCalledWith(
      "scheduler",
      expect.stringContaining("Scheduler iteration failed (transient, will retry)"),
      expect.objectContaining({ activeChecks: 0 })
    );
  });

  it("skips main cron iteration when previous iteration is still running", async () => {
    let resolveMonitors!: (value: any) => void;
    mockGetAllActiveMonitors.mockImplementationOnce(
      () => new Promise((resolve) => { resolveMonitors = resolve; })
    );

    await startScheduler();
    // Start first iteration (will block on getAllActiveMonitors)
    const firstRun = runCron("* * * * *");

    // Try to start second iteration while first is blocked
    mockGetAllActiveMonitors.mockResolvedValueOnce([]);
    await runCron("* * * * *");

    // Only one call to getAllActiveMonitors should have been made
    expect(mockGetAllActiveMonitors).toHaveBeenCalledTimes(1);

    // Unblock first iteration
    resolveMonitors([]);
    await firstRun;
  });

  it("resets main cron guard after iteration completes (allows next iteration)", async () => {
    mockGetAllActiveMonitors
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await startScheduler();
    await runCron("* * * * *");
    // First iteration done, guard should be reset

    await runCron("* * * * *");

    // Both iterations should have called getAllActiveMonitors
    expect(mockGetAllActiveMonitors).toHaveBeenCalledTimes(2);
  });

  it("resets main cron guard even when iteration fails", async () => {
    mockGetAllActiveMonitors
      .mockRejectedValueOnce(new Error("some non-transient DB error that is not retryable"))
      .mockResolvedValueOnce([]);

    await startScheduler();
    await runCron("* * * * *");
    // Guard should be reset after error

    await runCron("* * * * *");
    expect(mockGetAllActiveMonitors).toHaveBeenCalledTimes(2);
  });

  it("retries getPendingWebhookRetries on transient connection error", async () => {
    mockStorage.getPendingWebhookRetries
      .mockRejectedValueOnce(new Error("Connection terminated due to connection timeout"))
      .mockResolvedValueOnce([]);

    await startScheduler();
    // Run callbacks individually to control timing — notification cron first
    const callbacks = cronCallbacks["*/1 * * * *"];
    // Notification cron (index 0)
    await callbacks[0]();
    // Webhook cron (index 1) — will retry after 1s delay
    const webhookPromise = callbacks[1]();
    await vi.advanceTimersByTimeAsync(2000);
    await webhookPromise;

    expect(mockStorage.getPendingWebhookRetries).toHaveBeenCalledTimes(2);
    // Should NOT have logged an error since retry succeeded
    expect(ErrorLogger.error).not.toHaveBeenCalledWith(
      "scheduler",
      "Webhook retry processing failed",
      expect.anything(),
      expect.anything()
    );
  });

  it("skips webhook cron when previous iteration is still running", async () => {
    let resolveRetries!: (value: any) => void;
    mockStorage.getPendingWebhookRetries.mockImplementationOnce(
      () => new Promise((resolve) => { resolveRetries = resolve; })
    );

    await startScheduler();
    const callbacks = cronCallbacks["*/1 * * * *"];
    // Fire webhook cron (index 1) without awaiting — it blocks on getPendingWebhookRetries
    const firstRun = callbacks[1]();

    // Fire webhook cron again while first is blocked — guard should skip it
    await callbacks[1]();

    // Only one call to getPendingWebhookRetries (second was skipped by guard)
    expect(mockStorage.getPendingWebhookRetries).toHaveBeenCalledTimes(1);

    resolveRetries([]);
    await firstRun;
  });

  it("logs warning (not error) when webhook processing fails with transient DB error", async () => {
    // Both withDbRetry attempts fail with transient error
    mockStorage.getPendingWebhookRetries
      .mockRejectedValueOnce(new Error("Connection terminated"))
      .mockRejectedValueOnce(new Error("Connection terminated"));

    await startScheduler();
    const callbacks = cronCallbacks["*/1 * * * *"];
    await callbacks[0](); // notification cron
    const webhookPromise = callbacks[1]();
    await vi.advanceTimersByTimeAsync(2000);
    await webhookPromise;

    expect(ErrorLogger.warning).toHaveBeenCalledWith(
      "scheduler",
      expect.stringContaining("Webhook retry processing failed (transient, will retry)"),
      expect.objectContaining({
        errorMessage: "Connection terminated",
      })
    );
    expect(ErrorLogger.error).not.toHaveBeenCalledWith(
      "scheduler",
      expect.stringContaining("Webhook"),
      expect.anything(),
      expect.anything()
    );
  });
});

describe("webhook retry cumulative backoff", () => {

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    _resetSchedulerStarted();
    _resetActiveChecks();
    _resetCache();
    Object.keys(cronCallbacks).forEach((k) => { delete cronCallbacks[k]; });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("caps webhook retries at MAX_WEBHOOK_RETRIES_PER_TICK (10)", async () => {
    const now = Date.now();
    // Create 15 entries all past their backoff windows (attempt 1, 10s elapsed > 5s threshold)
    const entries = Array.from({ length: 15 }, (_, i) => ({
      id: i + 1,
      monitorId: i + 1,
      changeId: i + 1,
      channel: "webhook" as const,
      status: "pending" as const,
      attempt: 1,
      response: null,
      deliveredAt: null,
      createdAt: new Date(now - 10_000),
    }));
    mockStorage.getPendingWebhookRetries.mockResolvedValueOnce(entries);

    // All monitors exist with webhook channels configured
    const monitor = makeMonitor();
    mockStorage.getMonitor.mockResolvedValue(monitor);
    mockStorage.getMonitorChannels.mockResolvedValue([
      { id: 1, monitorId: 1, channel: "webhook", enabled: true, config: { url: "https://example.com/hook", secret: "whsec_test" }, createdAt: new Date() },
    ] as any);
    mockStorage.getMonitorChangeById.mockResolvedValue({
      id: 1, monitorId: 1, oldValue: "a", newValue: "b", detectedAt: new Date(), screenshot: null,
    } as any);
    await startScheduler();
    await runCron("*/1 * * * *");

    // Only 10 should have been delivered (MAX_WEBHOOK_RETRIES_PER_TICK = 10)
    expect(mockDeliverWebhook).toHaveBeenCalledTimes(10);
    // Only 10 success updates
    expect(mockStorage.updateDeliveryLog).toHaveBeenCalledTimes(10);
  });

  it("skips retry when cumulative backoff has not elapsed", async () => {
    const now = Date.now();
    // Entry created 10 seconds ago, attempt 2 → cumulative threshold is 35s
    mockStorage.getPendingWebhookRetries.mockResolvedValueOnce([
      {
        id: 1,
        monitorId: 1,
        changeId: 1,
        channel: "webhook",
        status: "pending",
        attempt: 2,
        response: null,
        deliveredAt: null,
        createdAt: new Date(now - 10_000), // 10s ago — less than 35s threshold
      },
    ]);

    await startScheduler();
    // Run all */1 cron callbacks (notification + webhook retry)
    await runCron("*/1 * * * *");

    // Should NOT have attempted to fetch the monitor (entry was skipped)
    expect(mockStorage.getMonitor).not.toHaveBeenCalled();
  });

  it("processes retry when cumulative backoff has elapsed", async () => {
    const now = Date.now();
    // Entry created 40 seconds ago, attempt 2 → cumulative threshold is 35s → should proceed
    mockStorage.getPendingWebhookRetries.mockResolvedValueOnce([
      {
        id: 1,
        monitorId: 1,
        changeId: 1,
        channel: "webhook",
        status: "pending",
        attempt: 2,
        response: null,
        deliveredAt: null,
        createdAt: new Date(now - 40_000), // 40s ago — exceeds 35s threshold
      },
    ]);
    // Monitor not found → marks as failed (simplest path to verify it ran)
    mockStorage.getMonitor.mockResolvedValueOnce(undefined);

    await startScheduler();
    await runCron("*/1 * * * *");

    expect(mockStorage.getMonitor).toHaveBeenCalledWith(1);
    expect(mockStorage.updateDeliveryLog).toHaveBeenCalledWith(1, { status: "failed" });
  });

  it("retries updateDeliveryLog with withDbRetry after successful webhook delivery", async () => {
    const now = Date.now();
    mockStorage.getPendingWebhookRetries.mockResolvedValueOnce([
      {
        id: 1,
        monitorId: 1,
        changeId: 10,
        channel: "webhook",
        status: "pending",
        attempt: 1,
        response: null,
        deliveredAt: null,
        createdAt: new Date(now - 10_000), // 10s ago — exceeds 5s threshold for attempt 1
      },
    ]);
    const monitor = makeMonitor();
    mockStorage.getMonitor.mockResolvedValueOnce(monitor);
    mockStorage.getMonitorChannels.mockResolvedValueOnce([
      { channel: "webhook", enabled: true, config: { url: "https://hook.example.com/cb", secret: "s3cret" } },
    ]);
    mockStorage.getMonitorChangeById.mockResolvedValueOnce({ id: 10, monitorId: 1 });
    mockDeliverWebhook.mockResolvedValueOnce({ success: true, statusCode: 200 });

    // First call to updateDeliveryLog fails with transient error, second succeeds
    mockStorage.updateDeliveryLog
      .mockRejectedValueOnce(new Error("Connection terminated unexpectedly"))
      .mockResolvedValueOnce(undefined);

    await startScheduler();
    const cronPromise = runCron("*/1 * * * *");
    // Advance past the 1s withDbRetry delay
    await vi.advanceTimersByTimeAsync(2000);
    await cronPromise;

    // updateDeliveryLog should have been called twice (first fail, then retry)
    expect(mockStorage.updateDeliveryLog).toHaveBeenCalledTimes(2);
    expect(mockStorage.updateDeliveryLog).toHaveBeenCalledWith(1, expect.objectContaining({
      status: "success",
      attempt: 2,
    }));
  });
});

