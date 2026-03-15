import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Drizzle mocks ─────────────────────────────────────────────────────────────
// vi.hoisted ensures these are available when the vi.mock factories run.

const { mockTransaction, mockDbDelete, mockDbSelect, mockChain } = vi.hoisted(() => {
  const mockChain: any = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    returning: vi.fn().mockResolvedValue([]),
  };
  // Every chaining method returns the chain itself
  mockChain.from.mockReturnValue(mockChain);
  mockChain.where.mockReturnValue(mockChain);
  mockChain.orderBy.mockReturnValue(mockChain);
  mockChain.limit.mockReturnValue(mockChain);

  // Make the chain thenable so `await chain` resolves to []
  mockChain.then = (resolve: any) => resolve([]);

  const mockTransaction = vi.fn();
  const mockDbDelete = vi.fn().mockReturnValue(mockChain);
  const mockDbSelect = vi.fn().mockReturnValue(mockChain);

  return { mockTransaction, mockDbDelete, mockDbSelect, mockChain };
});

vi.mock("./db", () => ({
  db: {
    delete: mockDbDelete,
    select: mockDbSelect,
    transaction: mockTransaction,
  },
}));

vi.mock("./services/notificationReady", () => ({
  notificationTablesExist: vi.fn().mockResolvedValue(true),
}));

// Must import after mocks
import { DatabaseStorage } from "./storage";

describe("DatabaseStorage", () => {
  let storage: DatabaseStorage;

  beforeEach(() => {
    storage = new DatabaseStorage();
    vi.clearAllMocks();

    // Reset default implementations
    mockChain.from.mockReturnValue(mockChain);
    mockChain.where.mockReturnValue(mockChain);
    mockChain.orderBy.mockReturnValue(mockChain);
    mockChain.limit.mockReturnValue(mockChain);
    mockChain.then = (resolve: any) => resolve([]);
    mockDbDelete.mockReturnValue(mockChain);
    mockDbSelect.mockReturnValue(mockChain);
  });

  describe("deleteMonitor", () => {
    it("wraps all deletes in a db.transaction call", async () => {
      mockTransaction.mockImplementation(async (cb) => {
        const txChain: any = {
          where: vi.fn().mockReturnValue({ then: (r: any) => r(undefined) }),
        };
        const tx = { delete: vi.fn().mockReturnValue(txChain) };
        await cb(tx);
      });

      await storage.deleteMonitor(42);
      expect(mockTransaction).toHaveBeenCalledTimes(1);
      // db.delete should NOT be called directly
      expect(mockDbDelete).not.toHaveBeenCalled();
    });

    it("calls tx.delete for all required tables including monitorConditions and monitorTags", async () => {
      const deletedTables: any[] = [];
      mockTransaction.mockImplementation(async (cb) => {
        const txChain: any = {
          where: vi.fn().mockReturnValue({ then: (r: any) => r(undefined) }),
        };
        const tx = {
          delete: vi.fn().mockImplementation((table: any) => {
            deletedTables.push(table);
            return txChain;
          }),
        };
        await cb(tx);
      });

      await storage.deleteMonitor(1);

      // Should delete from at least 11 tables:
      // notificationQueue, notificationPreferences, deliveryLog, notificationChannels,
      // monitorConditions, monitorTags, monitorChanges, monitorMetrics,
      // browserlessUsage, resendUsage, monitors
      expect(deletedTables.length).toBeGreaterThanOrEqual(11);
    });

    it("catches 42P01 (undefined_table) errors for optional tables", async () => {
      const pgError = new Error("relation does not exist") as any;
      pgError.code = "42P01";

      let deleteCallNum = 0;
      mockTransaction.mockImplementation(async (cb) => {
        const tx = {
          delete: vi.fn().mockImplementation(() => {
            deleteCallNum++;
            // 3rd and 4th calls are the for-loop over optional tables
            if (deleteCallNum === 3 || deleteCallNum === 4) {
              return { where: vi.fn().mockRejectedValue(pgError) };
            }
            return {
              where: vi.fn().mockReturnValue({ then: (r: any) => r(undefined) }),
            };
          }),
        };
        await cb(tx);
      });

      await expect(storage.deleteMonitor(1)).resolves.toBeUndefined();
    });

    it("rethrows non-42P01 errors from optional table deletes", async () => {
      const connError = new Error("connection refused") as any;
      connError.code = "08006";

      let deleteCallNum = 0;
      mockTransaction.mockImplementation(async (cb) => {
        const tx = {
          delete: vi.fn().mockImplementation(() => {
            deleteCallNum++;
            if (deleteCallNum === 3) {
              return { where: vi.fn().mockRejectedValue(connError) };
            }
            return {
              where: vi.fn().mockReturnValue({ then: (r: any) => r(undefined) }),
            };
          }),
        };
        await cb(tx);
      });

      await expect(storage.deleteMonitor(1)).rejects.toThrow("connection refused");
    });

    it("does not swallow errors whose message happens to contain 'relation'", async () => {
      // Pre-fix code checked err.message.includes("relation") which would swallow this
      const fkError = new Error("foreign key constraint on relation fk_monitor") as any;
      fkError.code = "23503"; // foreign_key_violation, not 42P01

      let deleteCallNum = 0;
      mockTransaction.mockImplementation(async (cb) => {
        const tx = {
          delete: vi.fn().mockImplementation(() => {
            deleteCallNum++;
            if (deleteCallNum === 3) {
              return { where: vi.fn().mockRejectedValue(fkError) };
            }
            return {
              where: vi.fn().mockReturnValue({ then: (r: any) => r(undefined) }),
            };
          }),
        };
        await cb(tx);
      });

      await expect(storage.deleteMonitor(1)).rejects.toThrow("foreign key constraint");
    });
  });

  describe("getMonitorChanges", () => {
    it("applies a default limit of 200", async () => {
      await storage.getMonitorChanges(1);
      expect(mockChain.limit).toHaveBeenCalledWith(200);
    });

    it("accepts a custom limit parameter", async () => {
      await storage.getMonitorChanges(1, 50);
      expect(mockChain.limit).toHaveBeenCalledWith(50);
    });

    it("clamps limit to 200 when a larger value is passed", async () => {
      await storage.getMonitorChanges(1, 500);
      expect(mockChain.limit).toHaveBeenCalledWith(200);
    });

    it("clamps limit to 1 when zero is passed", async () => {
      await storage.getMonitorChanges(1, 0);
      expect(mockChain.limit).toHaveBeenCalledWith(1);
    });

    it("clamps limit to 1 when a negative value is passed", async () => {
      await storage.getMonitorChanges(1, -5);
      expect(mockChain.limit).toHaveBeenCalledWith(1);
    });

    it("orders results by detectedAt descending", async () => {
      await storage.getMonitorChanges(1);
      expect(mockChain.orderBy).toHaveBeenCalled();
    });

    it("filters by monitorId", async () => {
      await storage.getMonitorChanges(42);
      expect(mockChain.where).toHaveBeenCalled();
    });
  });

  describe("cleanupPollutedValues — error code check", () => {
    it("catches 42P01 errors when deleting referencing rows for polluted history", async () => {
      const pollutedRow = { id: 99, monitorId: 1, oldValue: "Blocked/Unavailable", newValue: "ok" };

      // First select: no polluted monitors; second select: one polluted history entry
      let selectCallNum = 0;
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            selectCallNum++;
            return {
              then: (resolve: any) => {
                if (selectCallNum === 1) resolve([]);       // no polluted monitors
                else if (selectCallNum === 2) resolve([pollutedRow]);
                else resolve([]);
              },
            };
          }),
        }),
      });

      const pgError = new Error("relation does not exist") as any;
      pgError.code = "42P01";

      let deleteCallNum = 0;
      mockDbDelete.mockImplementation(() => {
        deleteCallNum++;
        if (deleteCallNum <= 2) {
          // Optional tables throw 42P01
          return { where: vi.fn().mockRejectedValue(pgError) };
        }
        return {
          where: vi.fn().mockReturnValue({ then: (r: any) => r(undefined) }),
        };
      });

      const result = await storage.cleanupPollutedValues();
      expect(result).toBe(1); // cleaned 1 polluted history entry
    });

    it("rethrows non-42P01 errors in cleanupPollutedValues", async () => {
      const pollutedRow = { id: 99, monitorId: 1, oldValue: "Blocked/Unavailable", newValue: "ok" };

      let selectCallNum = 0;
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            selectCallNum++;
            return {
              then: (resolve: any) => {
                if (selectCallNum === 1) resolve([]);
                else if (selectCallNum === 2) resolve([pollutedRow]);
                else resolve([]);
              },
            };
          }),
        }),
      });

      const fkError = new Error("foreign key violation on relation fk_foo") as any;
      fkError.code = "23503";

      mockDbDelete.mockImplementation(() => ({
        where: vi.fn().mockRejectedValue(fkError),
      }));

      await expect(storage.cleanupPollutedValues()).rejects.toThrow("foreign key violation");
    });
  });
});
