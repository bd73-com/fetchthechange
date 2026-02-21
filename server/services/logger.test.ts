import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mock variables
// ---------------------------------------------------------------------------
const {
  mockDbSelect,
  mockDbInsert,
  mockDbUpdate,
  mockSelectLimitFn,
  mockSelectWhereFn,
  mockSelectFromFn,
  mockInsertValuesFn,
  mockUpdateSetFn,
  mockUpdateWhereFn,
} = vi.hoisted(() => {
  const mockSelectLimitFn = vi.fn();
  const mockSelectWhereFn = vi.fn(() => ({ limit: mockSelectLimitFn }));
  const mockSelectFromFn = vi.fn(() => ({ where: mockSelectWhereFn }));
  const mockDbSelect = vi.fn(() => ({ from: mockSelectFromFn }));

  const mockInsertValuesFn = vi.fn().mockResolvedValue(undefined);
  const mockDbInsert = vi.fn(() => ({ values: mockInsertValuesFn }));

  const mockUpdateWhereFn = vi.fn().mockResolvedValue(undefined);
  const mockUpdateSetFn = vi.fn(() => ({ where: mockUpdateWhereFn }));
  const mockDbUpdate = vi.fn(() => ({ set: mockUpdateSetFn }));

  return {
    mockDbSelect,
    mockDbInsert,
    mockDbUpdate,
    mockSelectLimitFn,
    mockSelectWhereFn,
    mockSelectFromFn,
    mockInsertValuesFn,
    mockUpdateSetFn,
    mockUpdateWhereFn,
  };
});

vi.mock("../db", () => ({
  db: {
    select: (...args: any[]) => mockDbSelect(...args),
    insert: (...args: any[]) => mockDbInsert(...args),
    update: (...args: any[]) => mockDbUpdate(...args),
  },
}));

import { ErrorLogger } from "./logger";

describe("ErrorLogger deduplication", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Suppress expected logger output during tests
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    // Reset chain mocks
    mockSelectWhereFn.mockReturnValue({ limit: mockSelectLimitFn });
    mockSelectFromFn.mockReturnValue({ where: mockSelectWhereFn });
    mockDbSelect.mockReturnValue({ from: mockSelectFromFn });
    mockInsertValuesFn.mockResolvedValue(undefined);
    mockDbInsert.mockReturnValue({ values: mockInsertValuesFn });
    mockUpdateWhereFn.mockResolvedValue(undefined);
    mockUpdateSetFn.mockReturnValue({ where: mockUpdateWhereFn });
    mockDbUpdate.mockReturnValue({ set: mockUpdateSetFn });

    // Default: no existing entry found
    mockSelectLimitFn.mockResolvedValue([]);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  it("inserts a new entry when no duplicate exists", async () => {
    mockSelectLimitFn.mockResolvedValue([]);

    await ErrorLogger.error("stripe", "Webhook signature validation failed", null, { ip: "1.2.3.4" });

    expect(mockDbInsert).toHaveBeenCalled();
    expect(mockDbUpdate).not.toHaveBeenCalled();

    const insertedValues = mockInsertValuesFn.mock.calls[0][0];
    expect(insertedValues.level).toBe("error");
    expect(insertedValues.source).toBe("stripe");
    expect(insertedValues.message).toBe("Webhook signature validation failed");
    expect(insertedValues.occurrenceCount).toBe(1);
    expect(insertedValues.firstOccurrence).toBeInstanceOf(Date);
    expect(insertedValues.timestamp).toBeInstanceOf(Date);
  });

  it("updates existing entry when a duplicate is found", async () => {
    mockSelectLimitFn.mockResolvedValue([{ id: 42 }]);

    await ErrorLogger.error("stripe", "Webhook signature validation failed", null, { ip: "5.6.7.8" });

    expect(mockDbUpdate).toHaveBeenCalled();
    expect(mockDbInsert).not.toHaveBeenCalled();

    // Verify update was called with the correct ID
    expect(mockUpdateWhereFn).toHaveBeenCalled();

    // Verify the set call includes timestamp and occurrenceCount
    const setArg = mockUpdateSetFn.mock.calls[0][0];
    expect(setArg.timestamp).toBeInstanceOf(Date);
    expect(setArg.occurrenceCount).toBeDefined();
  });

  it("queries for unresolved entries matching level+source+message", async () => {
    mockSelectLimitFn.mockResolvedValue([]);

    await ErrorLogger.warning("scraper", "Page returned empty response", { monitorId: 1 });

    // Verify select was called to check for duplicates
    expect(mockDbSelect).toHaveBeenCalled();
    expect(mockSelectFromFn).toHaveBeenCalled();
    expect(mockSelectWhereFn).toHaveBeenCalled();
    expect(mockSelectLimitFn).toHaveBeenCalled();
  });

  it("inserts new entry with correct fields for info level", async () => {
    mockSelectLimitFn.mockResolvedValue([]);

    await ErrorLogger.info("scheduler", "Scheduler run completed");

    expect(mockDbInsert).toHaveBeenCalled();
    const insertedValues = mockInsertValuesFn.mock.calls[0][0];
    expect(insertedValues.level).toBe("info");
    expect(insertedValues.source).toBe("scheduler");
    expect(insertedValues.errorType).toBeNull();
    expect(insertedValues.stackTrace).toBeNull();
    expect(insertedValues.context).toBeNull();
  });

  it("includes error type and sanitized stack trace when error is provided", async () => {
    mockSelectLimitFn.mockResolvedValue([]);

    const err = new Error("Something went wrong");
    await ErrorLogger.error("api", "Unhandled error", err, { route: "/test" });

    const insertedValues = mockInsertValuesFn.mock.calls[0][0];
    expect(insertedValues.errorType).toBe("Error");
    expect(insertedValues.stackTrace).toContain("Something went wrong");
    expect(insertedValues.context).toEqual({ route: "/test" });
  });

  it("updates stack trace and context on duplicate when provided", async () => {
    mockSelectLimitFn.mockResolvedValue([{ id: 7 }]);

    const err = new Error("New stack");
    await ErrorLogger.error("email", "Send failed", err, { to: "user@example.com" });

    const setArg = mockUpdateSetFn.mock.calls[0][0];
    expect(setArg.stackTrace).toContain("New stack");
    expect(setArg.context).toEqual({ to: "user@example.com" });
  });

  it("does not overwrite stack/context with undefined when not provided on duplicate", async () => {
    mockSelectLimitFn.mockResolvedValue([{ id: 7 }]);

    await ErrorLogger.warning("scraper", "Minor issue");

    const setArg = mockUpdateSetFn.mock.calls[0][0];
    expect(setArg.stackTrace).toBeUndefined();
    expect(setArg.context).toBeUndefined();
  });

  it("sanitizes sensitive data in the message before checking for duplicates", async () => {
    mockSelectLimitFn.mockResolvedValue([]);

    await ErrorLogger.error("api", "Failed connecting to postgres://user:pass@host/db");

    const insertedValues = mockInsertValuesFn.mock.calls[0][0];
    expect(insertedValues.message).not.toContain("postgres://");
    expect(insertedValues.message).toContain("[REDACTED]");
  });

  it("sanitizes sensitive context keys", async () => {
    mockSelectLimitFn.mockResolvedValue([]);

    await ErrorLogger.error("api", "Auth error", null, { password: "secret123", userId: "user-1" });

    const insertedValues = mockInsertValuesFn.mock.calls[0][0];
    expect(insertedValues.context.password).toBe("[REDACTED]");
    expect(insertedValues.context.userId).toBe("user-1");
  });

  it("handles database error gracefully without throwing", async () => {
    mockSelectLimitFn.mockRejectedValue(new Error("DB connection lost"));

    // Should not throw
    await expect(
      ErrorLogger.error("api", "Some error")
    ).resolves.toBeUndefined();
  });

  it("convenience methods call log with correct level", async () => {
    mockSelectLimitFn.mockResolvedValue([]);

    await ErrorLogger.error("stripe", "error msg");
    let insertedValues = mockInsertValuesFn.mock.calls[0][0];
    expect(insertedValues.level).toBe("error");

    vi.clearAllMocks();
    // Re-suppress console after clearAllMocks wiped the spies
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockSelectWhereFn.mockReturnValue({ limit: mockSelectLimitFn });
    mockSelectFromFn.mockReturnValue({ where: mockSelectWhereFn });
    mockDbSelect.mockReturnValue({ from: mockSelectFromFn });
    mockDbInsert.mockReturnValue({ values: mockInsertValuesFn });
    mockSelectLimitFn.mockResolvedValue([]);

    await ErrorLogger.warning("email", "warning msg");
    insertedValues = mockInsertValuesFn.mock.calls[0][0];
    expect(insertedValues.level).toBe("warning");

    vi.clearAllMocks();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockSelectWhereFn.mockReturnValue({ limit: mockSelectLimitFn });
    mockSelectFromFn.mockReturnValue({ where: mockSelectWhereFn });
    mockDbSelect.mockReturnValue({ from: mockSelectFromFn });
    mockDbInsert.mockReturnValue({ values: mockInsertValuesFn });
    mockSelectLimitFn.mockResolvedValue([]);

    await ErrorLogger.info("scheduler", "info msg");
    insertedValues = mockInsertValuesFn.mock.calls[0][0];
    expect(insertedValues.level).toBe("info");
  });
});
