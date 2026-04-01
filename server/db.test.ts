import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
  const originalDbUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    poolConstructorArgs.length = 0;
    vi.resetModules();
  });

  afterEach(() => {
    if (originalDbUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDbUrl;
    }
  });

  it("creates pool with aggressive idle timeout for ephemeral port reclamation", async () => {
    process.env.DATABASE_URL = "postgres://localhost/test";
    await import("./db");

    expect(poolConstructorArgs).toHaveLength(1);
    const config = poolConstructorArgs[0];
    expect(config.max).toBe(5);
    expect(config.idleTimeoutMillis).toBe(15_000);
    expect(config.connectionTimeoutMillis).toBe(10_000);
  });

  it("registers an error handler on the pool", async () => {
    process.env.DATABASE_URL = "postgres://localhost/test";
    await import("./db");

    expect(mockPool.on).toHaveBeenCalledWith("error", expect.any(Function));
  });
});
