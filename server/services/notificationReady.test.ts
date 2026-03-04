import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecute = vi.fn();

vi.mock("../db", () => ({
  db: {
    execute: (...args: any[]) => mockExecute(...args),
  },
}));

import { notificationTablesExist, _resetCache } from "./notificationReady";

describe("notificationTablesExist", () => {
  beforeEach(() => {
    _resetCache();
    mockExecute.mockReset();
  });

  it("returns true when both tables exist", async () => {
    mockExecute.mockResolvedValue([]);
    expect(await notificationTablesExist()).toBe(true);
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });

  it("returns false when query throws (tables missing)", async () => {
    mockExecute.mockRejectedValue(new Error('relation "notification_preferences" does not exist'));
    expect(await notificationTablesExist()).toBe(false);
  });

  it("caches positive result and skips subsequent DB calls", async () => {
    mockExecute.mockResolvedValue([]);
    await notificationTablesExist();
    expect(mockExecute).toHaveBeenCalledTimes(2);

    mockExecute.mockReset();
    expect(await notificationTablesExist()).toBe(true);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("does not cache negative result — re-checks on next call", async () => {
    mockExecute.mockRejectedValueOnce(new Error("missing table"));
    expect(await notificationTablesExist()).toBe(false);

    mockExecute.mockResolvedValue([]);
    expect(await notificationTablesExist()).toBe(true);
  });

  it("returns false when only the second table check fails", async () => {
    mockExecute
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('relation "notification_queue" does not exist'));
    expect(await notificationTablesExist()).toBe(false);
  });
});
