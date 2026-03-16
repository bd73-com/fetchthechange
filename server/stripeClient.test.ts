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

    // Mock stripe-replit-sync with a proper class constructor
    vi.doMock("stripe-replit-sync", () => ({
      StripeSync: class {
        postgresClient = mockStripeSync.postgresClient;
      },
    }));

    const { getStripeSync, closeStripeSync } = await import("./stripeClient");

    // Initialize the singleton
    await getStripeSync();

    // Close it
    await closeStripeSync();
    expect(mockPoolEnd).toHaveBeenCalledOnce();

    // Calling close again should be a no-op (stripeSync was nullified)
    await closeStripeSync();
    expect(mockPoolEnd).toHaveBeenCalledOnce(); // still 1
  });

  it("is a no-op when stripeSync was never initialized", async () => {
    const { closeStripeSync } = await import("./stripeClient");
    // Should not throw
    await expect(closeStripeSync()).resolves.toBeUndefined();
  });
});
