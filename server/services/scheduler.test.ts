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
} = vi.hoisted(() => ({
  mockCheckMonitor: vi.fn().mockResolvedValue({ changed: false, status: "ok" }),
  mockGetAllActiveMonitors: vi.fn().mockResolvedValue([]),
  mockCleanupPollutedValues: vi.fn().mockResolvedValue(undefined),
  mockDbExecute: vi.fn().mockResolvedValue({ rowCount: 0 }),
  cronCallbacks: {} as Record<string, () => Promise<void>>,
}));

vi.mock("../storage", () => ({
  storage: {
    getAllActiveMonitors: mockGetAllActiveMonitors,
    cleanupPollutedValues: mockCleanupPollutedValues,
  },
}));

vi.mock("./scraper", () => ({
  checkMonitor: (...args: any[]) => mockCheckMonitor(...args),
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

  it("registers both cron schedules (every-minute and daily cleanup)", async () => {
    await startScheduler();
    expect(cronCallbacks["* * * * *"]).toBeDefined();
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
      expect.any(Error)
    );
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
    mockDbExecute.mockResolvedValueOnce({ rowCount: 42 });
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await startScheduler();
    await cronCallbacks["0 3 * * *"]();

    expect(mockDbExecute).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Pruned 42 monitor_metrics rows")
    );
    consoleSpy.mockRestore();
  });

  it("does not log when no rows are deleted", async () => {
    mockDbExecute.mockResolvedValueOnce({ rowCount: 0 });
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await startScheduler();
    await cronCallbacks["0 3 * * *"]();

    expect(consoleSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("Pruned")
    );
    consoleSpy.mockRestore();
  });

  it("logs error when cleanup query fails", async () => {
    mockDbExecute.mockRejectedValueOnce(new Error("DB timeout"));

    await startScheduler();
    await cronCallbacks["0 3 * * *"]();

    expect(ErrorLogger.error).toHaveBeenCalledWith(
      "scheduler",
      "monitor_metrics cleanup failed",
      expect.any(Error)
    );
  });
});
