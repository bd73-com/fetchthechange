import { describe, it, expect, vi, beforeEach } from "vitest";

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
});
