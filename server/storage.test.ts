import { describe, it, expect, vi, beforeEach } from "vitest";
import { monitors, monitorChanges, monitorConditions, monitorTags, monitorMetrics, browserlessUsage, resendUsage } from "@shared/schema";

// ── Drizzle mocks ─────────────────────────────────────────────────────────────
// vi.hoisted ensures these are available when the vi.mock factories run.

const { mockTransaction, mockDbDelete, mockDbSelect, mockDbUpdate, mockChain } = vi.hoisted(() => {
  const mockChain: any = {
    from: vi.fn(),
    set: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    returning: vi.fn().mockResolvedValue([]),
  };
  // Every chaining method returns the chain itself
  mockChain.from.mockReturnValue(mockChain);
  mockChain.set.mockReturnValue(mockChain);
  mockChain.where.mockReturnValue(mockChain);
  mockChain.orderBy.mockReturnValue(mockChain);
  mockChain.limit.mockReturnValue(mockChain);

  // Make the chain thenable so `await chain` resolves to []
  mockChain.then = (resolve: any) => resolve([]);

  const mockTransaction = vi.fn();
  const mockDbDelete = vi.fn().mockReturnValue(mockChain);
  const mockDbSelect = vi.fn().mockReturnValue(mockChain);
  const mockDbUpdate = vi.fn().mockReturnValue(mockChain);

  return { mockTransaction, mockDbDelete, mockDbSelect, mockDbUpdate, mockChain };
});

vi.mock("./db", () => ({
  db: {
    delete: mockDbDelete,
    select: mockDbSelect,
    update: mockDbUpdate,
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
    mockChain.set.mockReturnValue(mockChain);
    mockChain.where.mockReturnValue(mockChain);
    mockChain.orderBy.mockReturnValue(mockChain);
    mockChain.limit.mockReturnValue(mockChain);
    mockChain.then = (resolve: any) => resolve([]);
    mockDbDelete.mockReturnValue(mockChain);
    mockDbSelect.mockReturnValue(mockChain);
    mockDbUpdate.mockReturnValue(mockChain);
  });

  describe("deleteMonitor", () => {
    // Helper: creates a mock tx with execute (for SAVEPOINT) and delete support
    function makeMockTx(deleteFn?: (callNum: number) => any) {
      let deleteCallNum = 0;
      const defaultDelete = () => ({
        where: vi.fn().mockReturnValue({ then: (r: any) => r(undefined) }),
      });
      return {
        execute: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockImplementation((table: any) => {
          deleteCallNum++;
          return deleteFn ? deleteFn(deleteCallNum) : defaultDelete();
        }),
        _tables: [] as any[],
      };
    }

    it("wraps all deletes in a db.transaction call", async () => {
      mockTransaction.mockImplementation(async (cb) => {
        await cb(makeMockTx());
      });

      await storage.deleteMonitor(42);
      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(mockDbDelete).not.toHaveBeenCalled();
    });

    it("calls tx.delete for all required tables including monitorConditions and monitorTags", async () => {
      const deletedTables: any[] = [];
      mockTransaction.mockImplementation(async (cb) => {
        const tx = makeMockTx();
        tx.delete = vi.fn().mockImplementation((table: any) => {
          deletedTables.push(table);
          return { where: vi.fn().mockReturnValue({ then: (r: any) => r(undefined) }) };
        });
        await cb(tx);
      });

      await storage.deleteMonitor(1);

      expect(deletedTables.length).toBeGreaterThanOrEqual(11);
      expect(deletedTables).toEqual(
        expect.arrayContaining([monitorConditions, monitorTags, monitorChanges, monitorMetrics, browserlessUsage, resendUsage, monitors]),
      );
    });

    it("uses SAVEPOINTs around optional table deletes and catches 42P01", async () => {
      const pgError = new Error("relation does not exist") as any;
      pgError.code = "42P01";

      const executeCalls: string[] = [];
      mockTransaction.mockImplementation(async (cb) => {
        let deleteCallNum = 0;
        const tx = {
          execute: vi.fn().mockImplementation((...args: any[]) => {
            const stmt = JSON.stringify(args[0]);
            executeCalls.push(stmt);
            return Promise.resolve(undefined);
          }),
          delete: vi.fn().mockImplementation(() => {
            deleteCallNum++;
            // Make the 3rd optional table delete fail with 42P01
            if (deleteCallNum === 3) {
              return { where: vi.fn().mockRejectedValue(pgError) };
            }
            return { where: vi.fn().mockReturnValue({ then: (r: any) => r(undefined) }) };
          }),
        };
        await cb(tx);
      });

      await expect(storage.deleteMonitor(1)).resolves.toBeUndefined();
      // Verify SAVEPOINTs are used
      expect(executeCalls.some((s) => s.includes("SAVEPOINT sp_del_optional"))).toBe(true);
      // On success: RELEASE SAVEPOINT; on 42P01: ROLLBACK TO SAVEPOINT
      expect(executeCalls.some((s) => s.includes("RELEASE SAVEPOINT sp_del_optional"))).toBe(true);
      expect(executeCalls.some((s) => s.includes("ROLLBACK TO SAVEPOINT sp_del_optional"))).toBe(true);
    });

    it("rethrows non-42P01 errors from optional table deletes", async () => {
      const connError = new Error("connection refused") as any;
      connError.code = "08006";

      mockTransaction.mockImplementation(async (cb) => {
        let deleteCallNum = 0;
        const tx = {
          execute: vi.fn().mockResolvedValue(undefined),
          delete: vi.fn().mockImplementation(() => {
            deleteCallNum++;
            if (deleteCallNum === 3) {
              return { where: vi.fn().mockRejectedValue(connError) };
            }
            return { where: vi.fn().mockReturnValue({ then: (r: any) => r(undefined) }) };
          }),
        };
        await cb(tx);
      });

      await expect(storage.deleteMonitor(1)).rejects.toThrow("connection refused");
    });

    it("does not swallow errors whose message happens to contain 'relation'", async () => {
      const fkError = new Error("foreign key constraint on relation fk_monitor") as any;
      fkError.code = "23503"; // foreign_key_violation, not 42P01

      mockTransaction.mockImplementation(async (cb) => {
        let deleteCallNum = 0;
        const tx = {
          execute: vi.fn().mockResolvedValue(undefined),
          delete: vi.fn().mockImplementation(() => {
            deleteCallNum++;
            if (deleteCallNum === 3) {
              return { where: vi.fn().mockRejectedValue(fkError) };
            }
            return { where: vi.fn().mockReturnValue({ then: (r: any) => r(undefined) }) };
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

    it("falls back to 200 when NaN is passed", async () => {
      await storage.getMonitorChanges(1, NaN);
      expect(mockChain.limit).toHaveBeenCalledWith(200);
    });

    it("falls back to 200 when Infinity is passed", async () => {
      await storage.getMonitorChanges(1, Infinity);
      expect(mockChain.limit).toHaveBeenCalledWith(200);
    });

    it("truncates float values", async () => {
      await storage.getMonitorChanges(1, 50.9);
      expect(mockChain.limit).toHaveBeenCalledWith(50);
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

  describe("downgradeHourlyMonitors", () => {
    it("calls db.update on monitors table with correct filters", async () => {
      const updateChain: any = {
        set: vi.fn(),
        where: vi.fn(),
        returning: vi.fn().mockResolvedValue([{ id: 1, name: "Monitor A" }, { id: 2, name: "Monitor B" }]),
      };
      updateChain.set.mockReturnValue(updateChain);
      updateChain.where.mockReturnValue(updateChain);
      mockDbUpdate.mockReturnValue(updateChain);

      const result = await storage.downgradeHourlyMonitors("user_123");
      expect(result.count).toBe(2);
      expect(result.monitorNames).toEqual(["Monitor A", "Monitor B"]);
      expect(mockDbUpdate).toHaveBeenCalledWith(monitors);
      expect(updateChain.set).toHaveBeenCalledWith({ frequency: "daily" });
    });

    it("returns 0 when no hourly monitors exist", async () => {
      const updateChain: any = {
        set: vi.fn(),
        where: vi.fn(),
        returning: vi.fn().mockResolvedValue([]),
      };
      updateChain.set.mockReturnValue(updateChain);
      updateChain.where.mockReturnValue(updateChain);
      mockDbUpdate.mockReturnValue(updateChain);

      const result = await storage.downgradeHourlyMonitors("user_no_hourly");
      expect(result.count).toBe(0);
      expect(result.monitorNames).toEqual([]);
    });
  });

  describe("cleanupPollutedValues — error code check", () => {
    it("wraps deletes in a db.transaction call per polluted entry", async () => {
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

      mockTransaction.mockImplementation(async (cb: any) => {
        const txChain: any = {
          where: vi.fn().mockReturnValue({ then: (r: any) => r(undefined) }),
        };
        const tx = { delete: vi.fn().mockReturnValue(txChain) };
        await cb(tx);
      });

      const result = await storage.cleanupPollutedValues();
      expect(result).toBe(1);
      expect(mockTransaction).toHaveBeenCalledTimes(1);
      // db.delete should NOT be called directly
      expect(mockDbDelete).not.toHaveBeenCalled();
    });

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

      mockTransaction.mockImplementation(async (cb: any) => {
        let deleteCallNum = 0;
        const tx = {
          delete: vi.fn().mockImplementation(() => {
            deleteCallNum++;
            if (deleteCallNum <= 2) {
              // Optional tables throw 42P01
              return { where: vi.fn().mockRejectedValue(pgError) };
            }
            return {
              where: vi.fn().mockReturnValue({ then: (r: any) => r(undefined) }),
            };
          }),
        };
        await cb(tx);
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

      // Transaction mock must execute the callback so the error propagates
      mockTransaction.mockImplementation(async (cb: any) => {
        const txChain: any = {
          where: vi.fn().mockRejectedValue(fkError),
        };
        const tx = { delete: vi.fn().mockReturnValue(txChain) };
        await cb(tx);
      });

      await expect(storage.cleanupPollutedValues()).rejects.toThrow("foreign key violation");
    });
  });
});
