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

import { WebhookHandlers } from "./webhookHandlers";

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
