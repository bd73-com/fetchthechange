import { describe, it, expect, vi, beforeEach } from "vitest";

const poolConstructorArgs: any[] = [];
const mockPool = {
  on: vi.fn(),
};

vi.mock("pg", () => ({
  default: {
    Pool: class MockPool {
      on = mockPool.on;
      constructor(opts: any) {
        poolConstructorArgs.push(opts);
      }
    },
  },
}));

vi.mock("drizzle-orm/node-postgres", () => ({
  drizzle: vi.fn().mockReturnValue({}),
}));

vi.mock("@shared/schema", () => ({}));

describe("db pool configuration", () => {
  beforeEach(() => {
    poolConstructorArgs.length = 0;
    vi.resetModules();
  });

  it("creates pool with aggressive idle timeout for ephemeral port reclamation", async () => {
    process.env.DATABASE_URL = "postgres://localhost/test";
    await import("./db");

    expect(poolConstructorArgs).toHaveLength(1);
    const config = poolConstructorArgs[0];
    expect(config.max).toBe(3);
    expect(config.idleTimeoutMillis).toBe(10_000);
    expect(config.connectionTimeoutMillis).toBe(5_000);
  });

  it("registers an error handler on the pool", async () => {
    process.env.DATABASE_URL = "postgres://localhost/test";
    await import("./db");

    expect(mockPool.on).toHaveBeenCalledWith("error", expect.any(Function));
  });
});
