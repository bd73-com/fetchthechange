import { describe, it, expect, vi, beforeEach } from "vitest";

describe("getStripeSync concurrency", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.STRIPE_SECRET_KEY = "sk_test_abc123";
    process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_abc123";
    process.env.DATABASE_URL = "postgres://localhost/test";
  });

  it("returns the same instance when called concurrently", async () => {
    let constructCount = 0;
    vi.doMock("stripe-replit-sync", () => ({
      StripeSync: class {
        id = ++constructCount;
        postgresClient = { pool: { end: vi.fn().mockResolvedValue(undefined) } };
      },
    }));

    const { getStripeSync } = await import("./stripeClient");

    const [a, b, c] = await Promise.all([
      getStripeSync(),
      getStripeSync(),
      getStripeSync(),
    ]);

    expect(constructCount).toBe(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("resets pending promise on initialization error so retries work", async () => {
    let callCount = 0;
    vi.doMock("stripe-replit-sync", () => ({
      StripeSync: class {
        constructor() {
          callCount++;
          if (callCount === 1) {
            throw new Error("init failed");
          }
        }
        postgresClient = { pool: { end: vi.fn().mockResolvedValue(undefined) } };
      },
    }));

    const { getStripeSync } = await import("./stripeClient");

    // First call fails
    await expect(getStripeSync()).rejects.toThrow("init failed");

    // Second call should retry (not return the cached rejection)
    const instance = await getStripeSync();
    expect(instance).toBeDefined();
    expect(callCount).toBe(2);
  });

  it("returns cached instance on subsequent calls after initialization", async () => {
    let constructCount = 0;
    vi.doMock("stripe-replit-sync", () => ({
      StripeSync: class {
        id = ++constructCount;
        postgresClient = { pool: { end: vi.fn().mockResolvedValue(undefined) } };
      },
    }));

    const { getStripeSync } = await import("./stripeClient");

    const first = await getStripeSync();
    const second = await getStripeSync();

    expect(constructCount).toBe(1);
    expect(first).toBe(second);
  });
});

describe("closeStripeSync", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.STRIPE_SECRET_KEY = "sk_test_abc123";
    process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_abc123";
    process.env.DATABASE_URL = "postgres://localhost/test";
  });

  it("calls pool.end() and nullifies stripeSync when initialized", async () => {
    const mockPoolEnd = vi.fn().mockResolvedValue(undefined);
    const mockStripeSync = {
      postgresClient: { pool: { end: mockPoolEnd } },
    };

    vi.doMock("stripe-replit-sync", () => ({
      StripeSync: class {
        postgresClient = mockStripeSync.postgresClient;
      },
    }));

    const { getStripeSync, closeStripeSync } = await import("./stripeClient");

    await getStripeSync();

    await closeStripeSync();
    expect(mockPoolEnd).toHaveBeenCalledOnce();

    // Calling close again should be a no-op (stripeSync was nullified)
    await closeStripeSync();
    expect(mockPoolEnd).toHaveBeenCalledOnce(); // still 1
  });

  it("is a no-op when stripeSync was never initialized", async () => {
    const { closeStripeSync } = await import("./stripeClient");
    await expect(closeStripeSync()).resolves.toBeUndefined();
  });

  it("propagates error when pool.end() rejects", async () => {
    const mockPoolEnd = vi.fn().mockRejectedValue(new Error("pool close failed"));

    vi.doMock("stripe-replit-sync", () => ({
      StripeSync: class {
        postgresClient = { pool: { end: mockPoolEnd } };
      },
    }));

    const { getStripeSync, closeStripeSync } = await import("./stripeClient");
    await getStripeSync();

    await expect(closeStripeSync()).rejects.toThrow("pool close failed");
  });

  it("prevents getStripeSync() from resurrecting singleton after shutdown", async () => {
    vi.doMock("stripe-replit-sync", () => ({
      StripeSync: class {
        postgresClient = { pool: { end: vi.fn().mockResolvedValue(undefined) } };
      },
    }));

    const { getStripeSync, closeStripeSync } = await import("./stripeClient");
    await getStripeSync();
    await closeStripeSync();

    // After shutdown, getStripeSync should throw
    await expect(getStripeSync()).rejects.toThrow("shutting down");
  });

  it("awaits in-flight pending promise before closing pool", async () => {
    const mockPoolEnd = vi.fn().mockResolvedValue(undefined);
    let resolveInit: () => void;
    const initBarrier = new Promise<void>((r) => { resolveInit = r; });

    vi.doMock("stripe-replit-sync", () => ({
      StripeSync: class {
        postgresClient = { pool: { end: mockPoolEnd } };
      },
    }));

    const { getStripeSync, closeStripeSync } = await import("./stripeClient");

    // Start initialization but don't await it — simulate in-flight state
    const initPromise = getStripeSync();

    // Close while init is in-flight; should await the pending promise
    await closeStripeSync();

    // The pool from the initialized instance should have been closed
    expect(mockPoolEnd).toHaveBeenCalledOnce();

    // initPromise should still resolve (it was already in-flight)
    const instance = await initPromise;
    expect(instance).toBeDefined();
  });
});
