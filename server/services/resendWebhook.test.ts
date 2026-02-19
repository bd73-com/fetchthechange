import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Use vi.hoisted() so mocks are available when vi.mock() factories run
const { mockFrom, mockWhere, mockLimit, mockSet, mockExecute } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockWhere: vi.fn(),
  mockLimit: vi.fn(),
  mockSet: vi.fn(),
  mockExecute: vi.fn(),
}));

vi.mock("../db", () => ({
  db: {
    select: () => ({ from: mockFrom }),
    update: () => ({ set: mockSet }),
    execute: mockExecute,
  },
}));

vi.mock("@shared/schema", () => ({
  campaignRecipients: { resendId: "resendId", id: "id" },
  campaigns: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: (a: any, b: any) => ({ field: a, value: b }),
  sql: (strings: TemplateStringsArray, ...values: any[]) => ({ strings, values }),
}));

vi.mock("./logger", () => ({
  ErrorLogger: {
    error: vi.fn().mockResolvedValue(undefined),
  },
}));

import { verifyResendWebhook, handleResendWebhookEvent } from "./resendWebhook";

function makeEvent(type: string, emailId = "email_abc123") {
  return {
    type,
    created_at: new Date().toISOString(),
    data: {
      email_id: emailId,
      from: "noreply@example.com",
      to: ["user@example.com"],
      subject: "Test Campaign",
      created_at: new Date().toISOString(),
    },
  };
}

function makeRecipient(overrides: Record<string, any> = {}) {
  return {
    id: 42,
    campaignId: 10,
    userId: "user1",
    recipientEmail: "user@example.com",
    status: "sent",
    resendId: "email_abc123",
    sentAt: new Date(),
    deliveredAt: null,
    openedAt: null,
    clickedAt: null,
    failedAt: null,
    failureReason: null,
    ...overrides,
  };
}

describe("verifyResendWebhook", () => {
  const originalSecret = process.env.RESEND_WEBHOOK_SECRET;

  afterEach(() => {
    if (originalSecret !== undefined) {
      process.env.RESEND_WEBHOOK_SECRET = originalSecret;
    } else {
      delete process.env.RESEND_WEBHOOK_SECRET;
    }
  });

  it("parses payload without verification when no secret is set", async () => {
    delete process.env.RESEND_WEBHOOK_SECRET;
    const event = makeEvent("email.delivered");
    const rawBody = Buffer.from(JSON.stringify(event));

    const result = await verifyResendWebhook(rawBody, {});

    expect(result.type).toBe("email.delivered");
    expect(result.data.email_id).toBe("email_abc123");
  });

  it("throws on invalid JSON when no secret is set", async () => {
    delete process.env.RESEND_WEBHOOK_SECRET;
    const rawBody = Buffer.from("not json");

    await expect(verifyResendWebhook(rawBody, {})).rejects.toThrow();
  });

  it("extracts svix headers correctly for array values", async () => {
    delete process.env.RESEND_WEBHOOK_SECRET;

    const event = makeEvent("email.opened");
    const rawBody = Buffer.from(JSON.stringify(event));
    const headers = {
      "svix-id": ["msg_123"],
      "svix-timestamp": ["1234567890"],
      "svix-signature": ["v1,sig_abc"],
    };

    const result = await verifyResendWebhook(rawBody, headers);
    expect(result.type).toBe("email.opened");
  });
});

describe("handleResendWebhookEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset chainable mocks
    mockFrom.mockReturnValue({ where: mockWhere });
    mockWhere.mockReturnValue({ limit: mockLimit });
    mockSet.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    mockExecute.mockResolvedValue({ rows: [] });
  });

  it("returns early when event has no email_id", async () => {
    const event = makeEvent("email.delivered", "");
    event.data.email_id = "";

    await handleResendWebhookEvent(event);

    // Should not query the DB at all
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("returns silently when recipient is not found (non-campaign email)", async () => {
    mockLimit.mockResolvedValueOnce([]);

    const event = makeEvent("email.delivered", "unknown_id");
    await handleResendWebhookEvent(event);

    // Should query but not update
    expect(mockExecute).not.toHaveBeenCalled();
  });

  describe("email.delivered", () => {
    it("updates recipient status to delivered when status is 'sent'", async () => {
      const recipient = makeRecipient({ status: "sent" });
      mockLimit.mockResolvedValueOnce([recipient]);
      const whereFn = vi.fn().mockResolvedValue(undefined);
      mockSet.mockReturnValueOnce({ where: whereFn });

      await handleResendWebhookEvent(makeEvent("email.delivered"));

      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({ status: "delivered" })
      );
      expect(mockExecute).toHaveBeenCalled(); // counter update
    });

    it("does NOT update when recipient is already opened", async () => {
      const recipient = makeRecipient({ status: "opened", openedAt: new Date() });
      mockLimit.mockResolvedValueOnce([recipient]);

      await handleResendWebhookEvent(makeEvent("email.delivered"));

      // set() should NOT be called since status != "sent"
      expect(mockSet).not.toHaveBeenCalled();
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it("does NOT update when recipient is already clicked", async () => {
      const recipient = makeRecipient({ status: "clicked", clickedAt: new Date() });
      mockLimit.mockResolvedValueOnce([recipient]);

      await handleResendWebhookEvent(makeEvent("email.delivered"));

      expect(mockSet).not.toHaveBeenCalled();
    });
  });

  describe("email.opened", () => {
    it("updates recipient to opened on first open", async () => {
      const recipient = makeRecipient({ status: "delivered", deliveredAt: new Date(), openedAt: null });
      mockLimit.mockResolvedValueOnce([recipient]);
      const whereFn = vi.fn().mockResolvedValue(undefined);
      mockSet.mockReturnValueOnce({ where: whereFn });

      await handleResendWebhookEvent(makeEvent("email.opened"));

      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({ status: "opened" })
      );
      expect(mockExecute).toHaveBeenCalled();
    });

    it("does NOT update on duplicate open event", async () => {
      const recipient = makeRecipient({ status: "opened", openedAt: new Date() });
      mockLimit.mockResolvedValueOnce([recipient]);

      await handleResendWebhookEvent(makeEvent("email.opened"));

      expect(mockSet).not.toHaveBeenCalled();
    });

    it("also increments delivered_count if not previously delivered", async () => {
      const recipient = makeRecipient({ status: "sent", deliveredAt: null, openedAt: null });
      mockLimit.mockResolvedValueOnce([recipient]);
      const whereFn = vi.fn().mockResolvedValue(undefined);
      mockSet.mockReturnValueOnce({ where: whereFn });

      await handleResendWebhookEvent(makeEvent("email.opened"));

      // The SQL template for counter update should include delivered_count
      expect(mockExecute).toHaveBeenCalled();
    });
  });

  describe("email.clicked", () => {
    it("updates recipient to clicked on first click", async () => {
      const recipient = makeRecipient({
        status: "opened",
        deliveredAt: new Date(),
        openedAt: new Date(),
        clickedAt: null,
      });
      mockLimit.mockResolvedValueOnce([recipient]);
      const whereFn = vi.fn().mockResolvedValue(undefined);
      mockSet.mockReturnValueOnce({ where: whereFn });

      await handleResendWebhookEvent(makeEvent("email.clicked"));

      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({ status: "clicked" })
      );
      expect(mockExecute).toHaveBeenCalled();
    });

    it("does NOT update on duplicate click event", async () => {
      const recipient = makeRecipient({ clickedAt: new Date() });
      mockLimit.mockResolvedValueOnce([recipient]);

      await handleResendWebhookEvent(makeEvent("email.clicked"));

      expect(mockSet).not.toHaveBeenCalled();
    });

    it("also sets openedAt and deliveredAt if not previously set", async () => {
      const recipient = makeRecipient({
        status: "sent",
        deliveredAt: null,
        openedAt: null,
        clickedAt: null,
      });
      mockLimit.mockResolvedValueOnce([recipient]);
      const whereFn = vi.fn().mockResolvedValue(undefined);
      mockSet.mockReturnValueOnce({ where: whereFn });

      await handleResendWebhookEvent(makeEvent("email.clicked"));

      const setCall = mockSet.mock.calls[0][0];
      expect(setCall.status).toBe("clicked");
      expect(setCall.openedAt).toBeDefined();
      expect(setCall.deliveredAt).toBeDefined();
    });
  });

  describe("email.bounced", () => {
    it("marks recipient as bounced with failure reason", async () => {
      const recipient = makeRecipient({ status: "sent" });
      mockLimit.mockResolvedValueOnce([recipient]);
      const whereFn = vi.fn().mockResolvedValue(undefined);
      mockSet.mockReturnValueOnce({ where: whereFn });

      await handleResendWebhookEvent(makeEvent("email.bounced"));

      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "bounced",
          failureReason: "bounced",
        })
      );
      expect(mockExecute).toHaveBeenCalled();
    });
  });

  describe("email.complained", () => {
    it("marks recipient as complained with spam complaint reason", async () => {
      const recipient = makeRecipient({ status: "delivered" });
      mockLimit.mockResolvedValueOnce([recipient]);
      const whereFn = vi.fn().mockResolvedValue(undefined);
      mockSet.mockReturnValueOnce({ where: whereFn });

      await handleResendWebhookEvent(makeEvent("email.complained"));

      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "complained",
          failureReason: "spam complaint",
        })
      );
      expect(mockExecute).toHaveBeenCalled();
    });
  });

  describe("unknown event types", () => {
    it("logs but does not update for unknown event type", async () => {
      const recipient = makeRecipient();
      mockLimit.mockResolvedValueOnce([recipient]);
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await handleResendWebhookEvent(makeEvent("email.some_future_event"));

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Unhandled event type: email.some_future_event")
      );
      expect(mockSet).not.toHaveBeenCalled();
      expect(mockExecute).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });
});
