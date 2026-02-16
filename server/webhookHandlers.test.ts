import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock stripeClient module
const mockGetWebhookSecret = vi.fn();
const mockGetUncachableStripeClient = vi.fn();
const mockGetStripeSync = vi.fn();

vi.mock("./stripeClient", () => ({
  getWebhookSecret: (...args: any[]) => mockGetWebhookSecret(...args),
  getUncachableStripeClient: (...args: any[]) => mockGetUncachableStripeClient(...args),
  getStripeSync: (...args: any[]) => mockGetStripeSync(...args),
}));

vi.mock("./replit_integrations/auth/storage", () => ({
  authStorage: {
    getUserByStripeCustomerId: vi.fn().mockResolvedValue(null),
    updateUser: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("./services/logger", () => ({
  ErrorLogger: {
    error: vi.fn().mockResolvedValue(undefined),
  },
}));

import { WebhookHandlers, determineTierFromProduct } from "./webhookHandlers";
import { authStorage } from "./replit_integrations/auth/storage";

const mockAuthStorage = vi.mocked(authStorage);

describe("determineTierFromProduct", () => {
  it("returns tier from explicit metadata.tier", () => {
    expect(determineTierFromProduct({ metadata: { tier: "pro" }, name: "Anything" })).toBe("pro");
  });

  it("returns tier from metadata even if name suggests a different tier", () => {
    expect(determineTierFromProduct({ metadata: { tier: "pro" }, name: "Power Plan" })).toBe("pro");
  });

  it("returns 'power' when name contains 'power' (no metadata)", () => {
    expect(determineTierFromProduct({ metadata: {}, name: "Power User Subscription" })).toBe("power");
  });

  it("returns 'pro' when name contains 'pro' (no metadata)", () => {
    expect(determineTierFromProduct({ metadata: {}, name: "Pro Plan Monthly" })).toBe("pro");
  });

  it("returns 'power' over 'pro' when name contains both", () => {
    expect(determineTierFromProduct({ metadata: {}, name: "Professional Power Bundle" })).toBe("power");
  });

  it("returns 'free' when name matches nothing", () => {
    expect(determineTierFromProduct({ metadata: {}, name: "Basic Plan" })).toBe("free");
  });

  it("returns 'free' when name is undefined", () => {
    expect(determineTierFromProduct({ metadata: {} })).toBe("free");
  });

  it("returns 'free' when metadata is undefined and name matches nothing", () => {
    expect(determineTierFromProduct({ name: "Starter" })).toBe("free");
  });

  it("is case-insensitive for name matching", () => {
    expect(determineTierFromProduct({ metadata: {}, name: "PRO PLAN" })).toBe("pro");
    expect(determineTierFromProduct({ metadata: {}, name: "POWER PLAN" })).toBe("power");
  });

  it("ignores invalid metadata.tier and falls back to name matching", () => {
    expect(determineTierFromProduct({ metadata: { tier: "enterprise" }, name: "Pro Plan" })).toBe("pro");
    expect(determineTierFromProduct({ metadata: { tier: "admin" }, name: "Power Plan" })).toBe("power");
    expect(determineTierFromProduct({ metadata: { tier: "invalid" }, name: "Basic Plan" })).toBe("free");
  });

  it("handles null metadata gracefully", () => {
    expect(determineTierFromProduct({ metadata: null, name: "Pro Plan" })).toBe("pro");
    expect(determineTierFromProduct({ metadata: null, name: "Basic" })).toBe("free");
  });
});

describe("WebhookHandlers.processWebhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects when no webhook secret is configured", async () => {
    mockGetWebhookSecret.mockReturnValue(null);

    const payload = Buffer.from('{"type":"test"}');
    await expect(
      WebhookHandlers.processWebhook(payload, "sig_test")
    ).rejects.toThrow("Stripe webhook secret is not configured");
  });

  it("rejects when payload is not a Buffer", async () => {
    await expect(
      WebhookHandlers.processWebhook("not a buffer" as any, "sig_test")
    ).rejects.toThrow("Payload must be a Buffer");
  });

  it("rejects forged payload with invalid signature", async () => {
    mockGetWebhookSecret.mockReturnValue("whsec_test_secret");

    const mockStripe = {
      webhooks: {
        constructEvent: vi.fn().mockImplementation(() => {
          throw new Error("No signatures found matching the expected signature for payload");
        }),
      },
    };
    mockGetUncachableStripeClient.mockResolvedValue(mockStripe);

    const forgedPayload = Buffer.from(JSON.stringify({
      type: "customer.subscription.updated",
      data: { object: { customer: "cus_attacker", status: "active", items: { data: [{ price: { id: "price_power" } }] } } },
    }));

    await expect(
      WebhookHandlers.processWebhook(forgedPayload, "forged_signature")
    ).rejects.toThrow("No signatures found");

    expect(mockStripe.webhooks.constructEvent).toHaveBeenCalledWith(
      forgedPayload,
      "forged_signature",
      "whsec_test_secret"
    );
  });

  it("processes valid webhook with verified signature", async () => {
    mockGetWebhookSecret.mockReturnValue("whsec_test_secret");

    const event = {
      type: "customer.subscription.deleted",
      data: { object: { customer: "cus_123" } },
    };
    const payload = Buffer.from(JSON.stringify(event));

    const mockStripe = {
      webhooks: {
        constructEvent: vi.fn().mockReturnValue(event),
      },
    };
    mockGetUncachableStripeClient.mockResolvedValue(mockStripe);
    mockGetStripeSync.mockResolvedValue({
      processWebhook: vi.fn().mockResolvedValue(undefined),
    });

    // Should not throw — signature is "valid" (mocked)
    await WebhookHandlers.processWebhook(payload, "valid_sig");

    expect(mockStripe.webhooks.constructEvent).toHaveBeenCalledWith(
      payload,
      "valid_sig",
      "whsec_test_secret"
    );
  });
});

describe("WebhookHandlers.handleStripeEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes subscription.created to handleSubscriptionChange", async () => {
    const subscription = { customer: "cus_123", status: "active", items: { data: [{ price: { id: "price_pro" } }] } };
    // getUserByStripeCustomerId returns null, so handler exits early after logging
    await WebhookHandlers.handleStripeEvent({
      type: "customer.subscription.created",
      data: { object: subscription },
    });

    expect(mockAuthStorage.getUserByStripeCustomerId).toHaveBeenCalledWith("cus_123");
  });

  it("routes subscription.updated to handleSubscriptionChange", async () => {
    const subscription = { customer: "cus_456", status: "active", items: { data: [{ price: { id: "price_pro" } }] } };
    await WebhookHandlers.handleStripeEvent({
      type: "customer.subscription.updated",
      data: { object: subscription },
    });

    expect(mockAuthStorage.getUserByStripeCustomerId).toHaveBeenCalledWith("cus_456");
  });

  it("routes subscription.deleted to handleSubscriptionDeleted", async () => {
    const subscription = { customer: "cus_789" };
    await WebhookHandlers.handleStripeEvent({
      type: "customer.subscription.deleted",
      data: { object: subscription },
    });

    expect(mockAuthStorage.getUserByStripeCustomerId).toHaveBeenCalledWith("cus_789");
  });

  it("does not call any handler for unhandled event types", async () => {
    await WebhookHandlers.handleStripeEvent({
      type: "charge.succeeded",
      data: { object: {} },
    });

    expect(mockAuthStorage.getUserByStripeCustomerId).not.toHaveBeenCalled();
  });
});

describe("WebhookHandlers.handleSubscriptionDeleted", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("downgrades user to free tier when user exists", async () => {
    mockAuthStorage.getUserByStripeCustomerId.mockResolvedValue({
      id: "user_1",
      email: "test@example.com",
      tier: "pro",
    } as any);

    await WebhookHandlers.handleSubscriptionDeleted({
      customer: "cus_abc",
      id: "sub_123",
    });

    expect(mockAuthStorage.updateUser).toHaveBeenCalledWith("user_1", {
      tier: "free",
      stripeSubscriptionId: null,
    });
  });

  it("does nothing when user is not found", async () => {
    mockAuthStorage.getUserByStripeCustomerId.mockResolvedValue(null);

    await WebhookHandlers.handleSubscriptionDeleted({ customer: "cus_unknown" });

    expect(mockAuthStorage.updateUser).not.toHaveBeenCalled();
  });
});

describe("WebhookHandlers.handleSubscriptionChange", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("downgrades to free when subscription status is not active or trialing", async () => {
    mockAuthStorage.getUserByStripeCustomerId.mockResolvedValue({
      id: "user_2",
      email: "test@example.com",
      tier: "pro",
    } as any);

    await WebhookHandlers.handleSubscriptionChange({
      customer: "cus_def",
      status: "past_due",
      id: "sub_456",
      items: { data: [{ price: { id: "price_pro" } }] },
    });

    expect(mockAuthStorage.updateUser).toHaveBeenCalledWith("user_2", {
      tier: "free",
      stripeSubscriptionId: "sub_456",
    });
  });

  it("does nothing when user is not found by customer ID", async () => {
    mockAuthStorage.getUserByStripeCustomerId.mockResolvedValue(null);

    await WebhookHandlers.handleSubscriptionChange({
      customer: "cus_ghost",
      status: "active",
      id: "sub_789",
      items: { data: [{ price: { id: "price_pro" } }] },
    });

    expect(mockAuthStorage.updateUser).not.toHaveBeenCalled();
  });

  it("updates subscription ID without tier change when no priceId available", async () => {
    mockAuthStorage.getUserByStripeCustomerId.mockResolvedValue({
      id: "user_3",
      email: "test@example.com",
      tier: "pro",
    } as any);

    await WebhookHandlers.handleSubscriptionChange({
      customer: "cus_ghi",
      status: "active",
      id: "sub_noprice",
      items: { data: [] }, // no price items
    });

    expect(mockAuthStorage.updateUser).toHaveBeenCalledWith("user_3", {
      stripeSubscriptionId: "sub_noprice",
    });
  });

  it("determines tier from product metadata when available", async () => {
    mockAuthStorage.getUserByStripeCustomerId.mockResolvedValue({
      id: "user_4",
      email: "test@example.com",
      tier: "free",
    } as any);

    const mockStripe = {
      prices: {
        retrieve: vi.fn().mockResolvedValue({
          product: {
            id: "prod_power",
            metadata: { tier: "power" },
            name: "Power Plan",
          },
        }),
      },
    };
    mockGetUncachableStripeClient.mockResolvedValue(mockStripe);

    await WebhookHandlers.handleSubscriptionChange({
      customer: "cus_jkl",
      status: "active",
      id: "sub_power",
      items: { data: [{ price: { id: "price_power_123" } }] },
    });

    expect(mockStripe.prices.retrieve).toHaveBeenCalledWith("price_power_123", {
      expand: ["product"],
    });
    expect(mockAuthStorage.updateUser).toHaveBeenCalledWith("user_4", {
      tier: "power",
      stripeSubscriptionId: "sub_power",
    });
  });

  it("determines tier from product name containing 'pro'", async () => {
    mockAuthStorage.getUserByStripeCustomerId.mockResolvedValue({
      id: "user_5",
      email: "test@example.com",
      tier: "free",
    } as any);

    const mockStripe = {
      prices: {
        retrieve: vi.fn().mockResolvedValue({
          product: {
            id: "prod_pro",
            metadata: {},
            name: "Pro Plan Monthly",
          },
        }),
      },
    };
    mockGetUncachableStripeClient.mockResolvedValue(mockStripe);

    await WebhookHandlers.handleSubscriptionChange({
      customer: "cus_mno",
      status: "active",
      id: "sub_pro",
      items: { data: [{ price: { id: "price_pro_123" } }] },
    });

    expect(mockAuthStorage.updateUser).toHaveBeenCalledWith("user_5", {
      tier: "pro",
      stripeSubscriptionId: "sub_pro",
    });
  });

  it("determines tier from product name containing 'power'", async () => {
    mockAuthStorage.getUserByStripeCustomerId.mockResolvedValue({
      id: "user_6",
      email: "test@example.com",
      tier: "free",
    } as any);

    const mockStripe = {
      prices: {
        retrieve: vi.fn().mockResolvedValue({
          product: {
            id: "prod_power2",
            metadata: {},
            name: "Power User Subscription",
          },
        }),
      },
    };
    mockGetUncachableStripeClient.mockResolvedValue(mockStripe);

    await WebhookHandlers.handleSubscriptionChange({
      customer: "cus_pqr",
      status: "active",
      id: "sub_power2",
      items: { data: [{ price: { id: "price_power_456" } }] },
    });

    expect(mockAuthStorage.updateUser).toHaveBeenCalledWith("user_6", {
      tier: "power",
      stripeSubscriptionId: "sub_power2",
    });
  });

  it("defaults to free tier when product name doesn't match any known tier", async () => {
    mockAuthStorage.getUserByStripeCustomerId.mockResolvedValue({
      id: "user_7",
      email: "test@example.com",
      tier: "free",
    } as any);

    const mockStripe = {
      prices: {
        retrieve: vi.fn().mockResolvedValue({
          product: {
            id: "prod_unknown",
            metadata: {},
            name: "Basic Plan",
          },
        }),
      },
    };
    mockGetUncachableStripeClient.mockResolvedValue(mockStripe);

    await WebhookHandlers.handleSubscriptionChange({
      customer: "cus_stu",
      status: "active",
      id: "sub_basic",
      items: { data: [{ price: { id: "price_basic" } }] },
    });

    expect(mockAuthStorage.updateUser).toHaveBeenCalledWith("user_7", {
      tier: "free",
      stripeSubscriptionId: "sub_basic",
    });
  });

  it("handles price retrieval error gracefully and updates only subscription ID", async () => {
    mockAuthStorage.getUserByStripeCustomerId.mockResolvedValue({
      id: "user_8",
      email: "test@example.com",
      tier: "pro",
    } as any);

    const mockStripe = {
      prices: {
        retrieve: vi.fn().mockRejectedValue(new Error("Stripe API error")),
      },
    };
    mockGetUncachableStripeClient.mockResolvedValue(mockStripe);

    await WebhookHandlers.handleSubscriptionChange({
      customer: "cus_vwx",
      status: "active",
      id: "sub_error",
      items: { data: [{ price: { id: "price_broken" } }] },
    });

    // Should still update subscription ID, but not change tier
    expect(mockAuthStorage.updateUser).toHaveBeenCalledWith("user_8", {
      stripeSubscriptionId: "sub_error",
    });
  });

  it("handles trialing status as active (processes tier upgrade)", async () => {
    mockAuthStorage.getUserByStripeCustomerId.mockResolvedValue({
      id: "user_9",
      email: "test@example.com",
      tier: "free",
    } as any);

    const mockStripe = {
      prices: {
        retrieve: vi.fn().mockResolvedValue({
          product: {
            id: "prod_trial",
            metadata: { tier: "pro" },
            name: "Pro Plan",
          },
        }),
      },
    };
    mockGetUncachableStripeClient.mockResolvedValue(mockStripe);

    await WebhookHandlers.handleSubscriptionChange({
      customer: "cus_trial",
      status: "trialing",
      id: "sub_trial",
      items: { data: [{ price: { id: "price_trial" } }] },
    });

    expect(mockAuthStorage.updateUser).toHaveBeenCalledWith("user_9", {
      tier: "pro",
      stripeSubscriptionId: "sub_trial",
    });
  });
});
