import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecute = vi.fn();

vi.mock("../db", () => ({
  db: {
    execute: (...args: any[]) => mockExecute(...args),
  },
}));

import { notificationTablesExist, channelTablesExist, _resetCache } from "./notificationReady";

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
    mockExecute.mockRejectedValueOnce(new Error('relation "notification_preferences" does not exist'));
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

  it("rethrows non-relation errors (connection, auth, timeout)", async () => {
    mockExecute.mockRejectedValue(new Error("connection refused"));
    await expect(notificationTablesExist()).rejects.toThrow("connection refused");
  });
});

describe("channelTablesExist", () => {
  beforeEach(() => {
    _resetCache();
    mockExecute.mockReset();
  });

  it("returns true when all three tables exist", async () => {
    mockExecute.mockResolvedValue([]);
    expect(await channelTablesExist()).toBe(true);
    // notification_channels, delivery_log, slack_connections
    expect(mockExecute).toHaveBeenCalledTimes(3);
  });

  it("returns false when notification_channels table is missing", async () => {
    mockExecute.mockRejectedValueOnce(new Error('relation "notification_channels" does not exist'));
    expect(await channelTablesExist()).toBe(false);
  });

  it("returns false when delivery_log table is missing", async () => {
    mockExecute
      .mockResolvedValueOnce([]) // notification_channels OK
      .mockRejectedValueOnce(new Error('relation "delivery_log" does not exist'));
    expect(await channelTablesExist()).toBe(false);
  });

  it("returns false when slack_connections table is missing", async () => {
    mockExecute
      .mockResolvedValueOnce([]) // notification_channels OK
      .mockResolvedValueOnce([]) // delivery_log OK
      .mockRejectedValueOnce(new Error('relation "slack_connections" does not exist'));
    expect(await channelTablesExist()).toBe(false);
  });

  it("caches positive result and skips subsequent DB calls", async () => {
    mockExecute.mockResolvedValue([]);
    await channelTablesExist();
    expect(mockExecute).toHaveBeenCalledTimes(3);

    mockExecute.mockReset();
    expect(await channelTablesExist()).toBe(true);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("does not cache negative result — re-checks on next call", async () => {
    mockExecute.mockRejectedValueOnce(new Error('relation "notification_channels" does not exist'));
    expect(await channelTablesExist()).toBe(false);

    mockExecute.mockResolvedValue([]);
    expect(await channelTablesExist()).toBe(true);
  });

  it("rethrows non-relation errors", async () => {
    mockExecute.mockRejectedValue(new Error("connection refused"));
    await expect(channelTablesExist()).rejects.toThrow("connection refused");
  });

  it("has independent cache from notificationTablesExist", async () => {
    // Confirm channelTablesExist after notificationTablesExist is cached
    mockExecute.mockResolvedValue([]);
    await notificationTablesExist(); // caches
    mockExecute.mockReset();

    // channelTablesExist should still query (its own cache is empty)
    mockExecute.mockResolvedValue([]);
    await channelTablesExist();
    expect(mockExecute).toHaveBeenCalledTimes(3);
  });
});
