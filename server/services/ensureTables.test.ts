import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecute = vi.fn();

vi.mock("../db", () => ({
  db: {
    execute: (...args: any[]) => mockExecute(...args),
  },
}));

import { ensureErrorLogColumns, ensureApiKeysTable, ensureChannelTables } from "./ensureTables";

describe("ensureErrorLogColumns", () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  it("executes 3 ALTER TABLE statements without throwing", async () => {
    mockExecute.mockResolvedValue([]);
    await ensureErrorLogColumns();
    expect(mockExecute).toHaveBeenCalledTimes(3);
  });

  it("catches errors and does not throw", async () => {
    mockExecute.mockRejectedValue(new Error("permission denied"));
    await expect(ensureErrorLogColumns()).resolves.toBeUndefined();
  });

  it("logs a warning when an error occurs", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockExecute.mockRejectedValue(new Error("permission denied"));
    await ensureErrorLogColumns();
    expect(warnSpy).toHaveBeenCalledWith(
      "Could not ensure error_logs columns:",
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });
});

describe("ensureApiKeysTable", () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  it("returns true when CREATE TABLE and CREATE INDEX succeed", async () => {
    mockExecute.mockResolvedValue([]);
    const result = await ensureApiKeysTable();
    expect(result).toBe(true);
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });

  it("returns false and logs error when db.execute fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockExecute.mockRejectedValue(new Error("relation does not exist"));
    const result = await ensureApiKeysTable();
    expect(result).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(
      "Could not ensure api_keys table — API key routes will be disabled:",
      expect.any(Error),
    );
    errorSpy.mockRestore();
  });
});

describe("ensureChannelTables", () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  it("executes all CREATE TABLE and CREATE INDEX statements without throwing", async () => {
    mockExecute.mockResolvedValue([]);
    await ensureChannelTables();
    // 3 CREATE TABLE + 1 CREATE INDEX + 1 CREATE UNIQUE INDEX + 1 CREATE INDEX = 6
    expect(mockExecute).toHaveBeenCalledTimes(6);
  });

  it("catches errors and does not throw", async () => {
    mockExecute.mockRejectedValue(new Error("connection refused"));
    await expect(ensureChannelTables()).resolves.toBeUndefined();
  });

  it("logs error when table creation fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockExecute.mockRejectedValue(new Error("connection refused"));
    await ensureChannelTables();
    expect(errorSpy).toHaveBeenCalledWith(
      "Could not ensure notification channel tables:",
      expect.any(Error),
    );
    errorSpy.mockRestore();
  });
});
