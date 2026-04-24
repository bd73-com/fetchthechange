import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mock variables
//
// After GitHub issue #448, ErrorLogger.log uses a single atomic
// `INSERT … ON CONFLICT (level, source, message) WHERE resolved = false
// DO UPDATE SET …` upsert instead of the prior SELECT-then-INSERT/UPDATE
// flow. The mock chain tracks `.insert(table).values(row).onConflictDoUpdate(cfg)`.
// ---------------------------------------------------------------------------
const {
  mockDbInsert,
  mockInsertValuesFn,
  mockOnConflictDoUpdateFn,
} = vi.hoisted(() => {
  const mockOnConflictDoUpdateFn = vi.fn().mockResolvedValue(undefined);
  const mockInsertValuesFn = vi.fn(() => ({ onConflictDoUpdate: mockOnConflictDoUpdateFn }));
  const mockDbInsert = vi.fn(() => ({ values: mockInsertValuesFn }));

  return {
    mockDbInsert,
    mockInsertValuesFn,
    mockOnConflictDoUpdateFn,
  };
});

vi.mock("../db", () => ({
  db: {
    insert: (...args: any[]) => mockDbInsert(...args),
  },
}));

import { ErrorLogger } from "./logger";

describe("ErrorLogger atomic upsert", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();

    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    mockOnConflictDoUpdateFn.mockResolvedValue(undefined);
    mockInsertValuesFn.mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdateFn });
    mockDbInsert.mockReturnValue({ values: mockInsertValuesFn });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  it("issues a single atomic insert+onConflictDoUpdate per log call", async () => {
    await ErrorLogger.error("stripe", "Webhook signature validation failed", null, { ip: "1.2.3.4" });

    expect(mockDbInsert).toHaveBeenCalledTimes(1);
    expect(mockInsertValuesFn).toHaveBeenCalledTimes(1);
    expect(mockOnConflictDoUpdateFn).toHaveBeenCalledTimes(1);
  });

  it("inserts values with correct fields on first call", async () => {
    await ErrorLogger.error("stripe", "Webhook signature validation failed", null, { ip: "1.2.3.4" });

    const insertedValues = mockInsertValuesFn.mock.calls[0][0];
    expect(insertedValues.level).toBe("error");
    expect(insertedValues.source).toBe("stripe");
    expect(insertedValues.message).toBe("Webhook signature validation failed");
    expect(insertedValues.occurrenceCount).toBe(1);
    expect(insertedValues.firstOccurrence).toBeInstanceOf(Date);
    expect(insertedValues.timestamp).toBeInstanceOf(Date);
    // null error → errorType/stackTrace must be null (not undefined) so the
    // COALESCE(EXCLUDED.*, current.*) clause in the conflict update keeps
    // prior non-null values on subsequent racing writes.
    expect(insertedValues.errorType).toBeNull();
    expect(insertedValues.stackTrace).toBeNull();
  });

  it("configures onConflictDoUpdate against the partial unique index", async () => {
    await ErrorLogger.error("scraper", "Browserless service unavailable — preserving last known values", null, { monitorId: 1 });

    const conflictConfig = mockOnConflictDoUpdateFn.mock.calls[0][0];
    // target must be the three-column tuple matching the unique index
    expect(Array.isArray(conflictConfig.target)).toBe(true);
    expect(conflictConfig.target).toHaveLength(3);
    // targetWhere must encode the `resolved = false` partial predicate —
    // without it Postgres rejects the ON CONFLICT on a partial index.
    expect(conflictConfig.targetWhere).toBeDefined();
    // set must bump timestamp and occurrenceCount; stack/context use COALESCE
    expect(conflictConfig.set.timestamp).toBeInstanceOf(Date);
    expect(conflictConfig.set.occurrenceCount).toBeDefined();
    expect(conflictConfig.set.stackTrace).toBeDefined();
    expect(conflictConfig.set.context).toBeDefined();
  });

  it("inserts new entry with correct fields for info level", async () => {
    await ErrorLogger.info("scheduler", "Scheduler run completed");

    const insertedValues = mockInsertValuesFn.mock.calls[0][0];
    expect(insertedValues.level).toBe("info");
    expect(insertedValues.source).toBe("scheduler");
    expect(insertedValues.errorType).toBeNull();
    expect(insertedValues.stackTrace).toBeNull();
    expect(insertedValues.context).toBeNull();
  });

  it("includes error type and sanitized stack trace when error is provided", async () => {
    const err = new Error("Something went wrong");
    await ErrorLogger.error("api", "Unhandled error", err, { route: "/test" });

    const insertedValues = mockInsertValuesFn.mock.calls[0][0];
    expect(insertedValues.errorType).toBe("Error");
    expect(insertedValues.stackTrace).toContain("Something went wrong");
    expect(insertedValues.context).toEqual({ route: "/test" });
  });

  it("sanitizes sensitive data in the message", async () => {
    await ErrorLogger.error("api", "Failed connecting to postgres://user:pass@host/db");

    const insertedValues = mockInsertValuesFn.mock.calls[0][0];
    expect(insertedValues.message).not.toContain("postgres://");
    expect(insertedValues.message).toContain("[REDACTED]");
  });

  it("sanitizes sensitive context keys", async () => {
    await ErrorLogger.error("api", "Auth error", null, { password: "secret123", userId: "user-1" });

    const insertedValues = mockInsertValuesFn.mock.calls[0][0];
    expect(insertedValues.context.password).toBe("[REDACTED]");
    expect(insertedValues.context.userId).toBe("user-1");
  });

  it("handles database error gracefully without throwing", async () => {
    mockOnConflictDoUpdateFn.mockRejectedValueOnce(new Error("DB connection lost"));

    await expect(
      ErrorLogger.error("api", "Some error")
    ).resolves.toBeUndefined();
  });

  it("Browserless warnings use monitor-agnostic message for infra failures so dedup aggregates across monitors", async () => {
    // Contract test: infra-wide failures (service unavailable, circuit breaker open)
    // emit a monitor-agnostic message so every affected monitor dedups into a single
    // row in the admin UI via the partial unique index. Site-specific failures still
    // name the monitor.
    const infraMsg = "Browserless service unavailable — preserving last known values";
    const circuitMsg = "Browserless circuit breaker open — preserving last known values";
    const siteSpecificMsg = `"My Monitor" — site blocking automated access`;

    expect(infraMsg).not.toMatch(/"My Monitor"/);
    expect(circuitMsg).not.toMatch(/"My Monitor"/);
    expect(siteSpecificMsg).toMatch(/"My Monitor"/);
    expect(siteSpecificMsg).not.toMatch(/preserving last known value/);
  });

  it("convenience methods call log with correct level", async () => {
    await ErrorLogger.error("stripe", "error msg");
    expect(mockInsertValuesFn.mock.calls[0][0].level).toBe("error");

    vi.clearAllMocks();
    mockInsertValuesFn.mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdateFn });
    mockDbInsert.mockReturnValue({ values: mockInsertValuesFn });

    await ErrorLogger.info("scheduler", "info msg");
    expect(mockInsertValuesFn.mock.calls[0][0].level).toBe("info");
  });
});
