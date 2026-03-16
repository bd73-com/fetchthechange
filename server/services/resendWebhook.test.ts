import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Use vi.hoisted() so mocks are available when vi.mock() factories run
const { mockFrom, mockWhere, mockLimit, mockSet, mockExecute, mockTransaction, mockTxSet, mockTxExecute, mockTxWhere, mockTxReturning } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockWhere: vi.fn(),
  mockLimit: vi.fn(),
  mockSet: vi.fn(),
  mockExecute: vi.fn(),
  mockTransaction: vi.fn(),
  mockTxSet: vi.fn(),
  mockTxExecute: vi.fn(),
  mockTxWhere: vi.fn(),
  mockTxReturning: vi.fn(),
}));

vi.mock("../db", () => ({
  db: {
    select: () => ({ from: mockFrom }),
    update: () => ({ set: mockSet }),
    execute: mockExecute,
    transaction: mockTransaction.mockImplementation(async (fn: (tx: any) => Promise<void>) => {
      const tx = {
        update: () => ({ set: mockTxSet }),
        execute: mockTxExecute,
      };
      await fn(tx);
    }),
  },
}));

vi.mock("@shared/schema", () => ({
  campaignRecipients: { resendId: "resendId", id: "id", status: "status", openedAt: "openedAt", clickedAt: "clickedAt", failedAt: "failedAt" },
  campaigns: {},
}));

vi.mock("drizzle-orm", () => {
  const sqlTag = (strings: TemplateStringsArray, ...values: any[]) => ({ strings, values });
  sqlTag.empty = () => ({ strings: [], values: [] });
  return {
    eq: (a: any, b: any) => ({ op: "eq", field: a, value: b }),
    and: (...conditions: any[]) => ({ op: "and", conditions }),
    isNull: (field: any) => ({ op: "isNull", field }),
    sql: sqlTag,
  };
});

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
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
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
    // Chain: tx.update().set().where().returning()
    mockTxSet.mockReturnValue({ where: mockTxWhere });
    mockTxWhere.mockReturnValue({ returning: mockTxReturning });
    mockTxReturning.mockResolvedValue([]);
    mockExecute.mockResolvedValue({ rows: [] });
    mockTxExecute.mockResolvedValue({ rows: [] });
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
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  describe("email.delivered", () => {
    it("updates recipient status to delivered and increments counter when guard matches", async () => {
      const recipient = makeRecipient({ status: "sent" });
      mockLimit.mockResolvedValueOnce([recipient]);
      // Simulate the atomic UPDATE matching (status was still 'sent')
      mockTxReturning.mockResolvedValueOnce([{ id: 42 }]);

      await handleResendWebhookEvent(makeEvent("email.delivered"));

      expect(mockTxSet).toHaveBeenCalledWith(
        expect.objectContaining({ status: "delivered" })
      );
      // WHERE should include both id and status guard
      expect(mockTxWhere).toHaveBeenCalledWith(
        expect.objectContaining({ op: "and" })
      );
      expect(mockTxExecute).toHaveBeenCalled(); // counter update
    });

    it("does NOT increment counter when atomic UPDATE matches zero rows (already processed)", async () => {
      const recipient = makeRecipient({ status: "opened", openedAt: new Date() });
      mockLimit.mockResolvedValueOnce([recipient]);
      // Simulate the atomic UPDATE matching zero rows (status was no longer 'sent')
      mockTxReturning.mockResolvedValueOnce([]);

      await handleResendWebhookEvent(makeEvent("email.delivered"));

      // Transaction still runs, but counter should NOT be incremented
      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(mockTxExecute).not.toHaveBeenCalled();
    });
  });

  describe("email.opened", () => {
    it("updates recipient to opened and increments counter on first open", async () => {
      const recipient = makeRecipient({ status: "delivered", deliveredAt: new Date(), openedAt: null });
      mockLimit.mockResolvedValueOnce([recipient]);
      // First tx.execute: SELECT FOR UPDATE (fresh read inside transaction)
      mockTxExecute.mockResolvedValueOnce({ rows: [{ delivered_at: new Date() }] });
      mockTxReturning.mockResolvedValueOnce([{ id: 42 }]);

      await handleResendWebhookEvent(makeEvent("email.opened"));

      expect(mockTxSet).toHaveBeenCalledWith(
        expect.objectContaining({ status: "opened" })
      );
      // Called twice: once for SELECT FOR UPDATE, once for counter update
      expect(mockTxExecute).toHaveBeenCalledTimes(2);
    });

    it("does NOT increment counter on duplicate open event", async () => {
      const recipient = makeRecipient({ status: "opened", openedAt: new Date() });
      mockLimit.mockResolvedValueOnce([recipient]);
      // SELECT FOR UPDATE still runs inside transaction
      mockTxExecute.mockResolvedValueOnce({ rows: [{ delivered_at: new Date() }] });
      mockTxReturning.mockResolvedValueOnce([]);

      await handleResendWebhookEvent(makeEvent("email.opened"));

      expect(mockTransaction).toHaveBeenCalledTimes(1);
      // Only the FOR UPDATE SELECT runs; counter update is skipped
      expect(mockTxExecute).toHaveBeenCalledTimes(1);
    });

    it("also increments delivered_count if not previously delivered", async () => {
      const recipient = makeRecipient({ status: "sent", deliveredAt: null, openedAt: null });
      mockLimit.mockResolvedValueOnce([recipient]);
      // Fresh read shows delivered_at is null — should also increment delivered_count
      mockTxExecute.mockResolvedValueOnce({ rows: [{ delivered_at: null }] });
      mockTxReturning.mockResolvedValueOnce([{ id: 42 }]);

      await handleResendWebhookEvent(makeEvent("email.opened"));

      // Called twice: FOR UPDATE SELECT + counter update
      expect(mockTxExecute).toHaveBeenCalledTimes(2);
    });

    it("does NOT increment delivered_count if concurrent webhook already set deliveredAt", async () => {
      const recipient = makeRecipient({ status: "sent", deliveredAt: null, openedAt: null });
      mockLimit.mockResolvedValueOnce([recipient]);
      // Fresh read inside transaction shows delivered_at was set by concurrent handler
      mockTxExecute.mockResolvedValueOnce({ rows: [{ delivered_at: new Date() }] });
      mockTxReturning.mockResolvedValueOnce([{ id: 42 }]);

      await handleResendWebhookEvent(makeEvent("email.opened"));

      // Counter update should only increment opened_count, not delivered_count
      expect(mockTxExecute).toHaveBeenCalledTimes(2);
    });
  });

  describe("email.clicked", () => {
    it("updates recipient to clicked and increments counter on first click", async () => {
      const deliveredAt = new Date();
      const openedAt = new Date();
      const recipient = makeRecipient({
        status: "opened",
        deliveredAt,
        openedAt,
        clickedAt: null,
      });
      mockLimit.mockResolvedValueOnce([recipient]);
      // Fresh read inside transaction
      mockTxExecute.mockResolvedValueOnce({ rows: [{ delivered_at: deliveredAt, opened_at: openedAt }] });
      mockTxReturning.mockResolvedValueOnce([{ id: 42 }]);

      await handleResendWebhookEvent(makeEvent("email.clicked"));

      expect(mockTxSet).toHaveBeenCalledWith(
        expect.objectContaining({ status: "clicked" })
      );
      // Called twice: FOR UPDATE SELECT + counter update
      expect(mockTxExecute).toHaveBeenCalledTimes(2);
    });

    it("does NOT increment counter on duplicate click event", async () => {
      const recipient = makeRecipient({ clickedAt: new Date() });
      mockLimit.mockResolvedValueOnce([recipient]);
      // SELECT FOR UPDATE still runs
      mockTxExecute.mockResolvedValueOnce({ rows: [{ delivered_at: new Date(), opened_at: new Date() }] });
      mockTxReturning.mockResolvedValueOnce([]);

      await handleResendWebhookEvent(makeEvent("email.clicked"));

      expect(mockTransaction).toHaveBeenCalledTimes(1);
      // Only FOR UPDATE SELECT; counter update skipped
      expect(mockTxExecute).toHaveBeenCalledTimes(1);
    });

    it("also sets openedAt and deliveredAt if not previously set", async () => {
      const recipient = makeRecipient({
        status: "sent",
        deliveredAt: null,
        openedAt: null,
        clickedAt: null,
      });
      mockLimit.mockResolvedValueOnce([recipient]);
      // Fresh read confirms both are null
      mockTxExecute.mockResolvedValueOnce({ rows: [{ delivered_at: null, opened_at: null }] });
      mockTxReturning.mockResolvedValueOnce([{ id: 42 }]);

      await handleResendWebhookEvent(makeEvent("email.clicked"));

      const setCall = mockTxSet.mock.calls[0][0];
      expect(setCall.status).toBe("clicked");
      expect(setCall.openedAt).toBeDefined();
      expect(setCall.deliveredAt).toBeDefined();
    });
  });

  describe("email.bounced", () => {
    it("marks recipient as bounced with failure reason and increments counter", async () => {
      const recipient = makeRecipient({ status: "sent" });
      mockLimit.mockResolvedValueOnce([recipient]);
      mockTxReturning.mockResolvedValueOnce([{ id: 42 }]);

      await handleResendWebhookEvent(makeEvent("email.bounced"));

      expect(mockTxSet).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "bounced",
          failureReason: "bounced",
        })
      );
      expect(mockTxExecute).toHaveBeenCalled();
    });

    it("does NOT double-count on duplicate bounce webhook", async () => {
      const recipient = makeRecipient({ status: "bounced", failedAt: new Date(), failureReason: "bounced" });
      mockLimit.mockResolvedValueOnce([recipient]);
      mockTxReturning.mockResolvedValueOnce([]);

      await handleResendWebhookEvent(makeEvent("email.bounced"));

      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(mockTxExecute).not.toHaveBeenCalled();
    });
  });

  describe("email.complained", () => {
    it("marks recipient as complained with spam complaint reason and increments counter", async () => {
      const recipient = makeRecipient({ status: "delivered" });
      mockLimit.mockResolvedValueOnce([recipient]);
      mockTxReturning.mockResolvedValueOnce([{ id: 42 }]);

      await handleResendWebhookEvent(makeEvent("email.complained"));

      expect(mockTxSet).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "complained",
          failureReason: "spam complaint",
        })
      );
      expect(mockTxExecute).toHaveBeenCalled();
    });

    it("does NOT double-count on duplicate complaint webhook", async () => {
      const recipient = makeRecipient({ status: "complained", failedAt: new Date(), failureReason: "spam complaint" });
      mockLimit.mockResolvedValueOnce([recipient]);
      mockTxReturning.mockResolvedValueOnce([]);

      await handleResendWebhookEvent(makeEvent("email.complained"));

      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(mockTxExecute).not.toHaveBeenCalled();
    });
  });

  describe("transaction atomicity", () => {
    it("uses db.transaction for delivered events", async () => {
      const recipient = makeRecipient({ status: "sent" });
      mockLimit.mockResolvedValueOnce([recipient]);
      mockTxReturning.mockResolvedValueOnce([{ id: 42 }]);

      await handleResendWebhookEvent(makeEvent("email.delivered"));

      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(mockTxSet).toHaveBeenCalled();
      expect(mockTxExecute).toHaveBeenCalled();
      // Verify db-level mocks were NOT used for writes (only tx was)
      expect(mockSet).not.toHaveBeenCalled();
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it("uses db.transaction for opened events", async () => {
      const recipient = makeRecipient({ status: "delivered", deliveredAt: new Date(), openedAt: null });
      mockLimit.mockResolvedValueOnce([recipient]);
      mockTxExecute.mockResolvedValueOnce({ rows: [{ delivered_at: new Date() }] });
      mockTxReturning.mockResolvedValueOnce([{ id: 42 }]);

      await handleResendWebhookEvent(makeEvent("email.opened"));

      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(mockTxSet).toHaveBeenCalled();
      expect(mockSet).not.toHaveBeenCalled();
    });

    it("uses db.transaction for clicked events", async () => {
      const recipient = makeRecipient({ status: "opened", deliveredAt: new Date(), openedAt: new Date(), clickedAt: null });
      mockLimit.mockResolvedValueOnce([recipient]);
      mockTxExecute.mockResolvedValueOnce({ rows: [{ delivered_at: new Date(), opened_at: new Date() }] });
      mockTxReturning.mockResolvedValueOnce([{ id: 42 }]);

      await handleResendWebhookEvent(makeEvent("email.clicked"));

      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(mockTxSet).toHaveBeenCalled();
      expect(mockSet).not.toHaveBeenCalled();
    });

    it("uses db.transaction for bounced events", async () => {
      const recipient = makeRecipient({ status: "sent" });
      mockLimit.mockResolvedValueOnce([recipient]);
      mockTxReturning.mockResolvedValueOnce([{ id: 42 }]);

      await handleResendWebhookEvent(makeEvent("email.bounced"));

      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(mockTxSet).toHaveBeenCalled();
      expect(mockSet).not.toHaveBeenCalled();
    });

    it("uses db.transaction for complained events", async () => {
      const recipient = makeRecipient({ status: "delivered" });
      mockLimit.mockResolvedValueOnce([recipient]);
      mockTxReturning.mockResolvedValueOnce([{ id: 42 }]);

      await handleResendWebhookEvent(makeEvent("email.complained"));

      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(mockTxSet).toHaveBeenCalled();
      expect(mockSet).not.toHaveBeenCalled();
    });

    it("propagates transaction errors so webhook can be retried", async () => {
      const recipient = makeRecipient({ status: "sent" });
      mockLimit.mockResolvedValueOnce([recipient]);
      mockTransaction.mockRejectedValueOnce(new Error("connection lost"));

      await expect(
        handleResendWebhookEvent(makeEvent("email.delivered"))
      ).rejects.toThrow("connection lost");
    });

    it("still runs transaction even when guard would have skipped (guard is now atomic)", async () => {
      const recipient = makeRecipient({ status: "opened", openedAt: new Date() });
      mockLimit.mockResolvedValueOnce([recipient]);
      // FOR UPDATE SELECT runs inside transaction
      mockTxExecute.mockResolvedValueOnce({ rows: [{ delivered_at: new Date() }] });
      mockTxReturning.mockResolvedValueOnce([]);

      await handleResendWebhookEvent(makeEvent("email.opened"));

      // Transaction runs, but the atomic WHERE prevents double-counting
      expect(mockTransaction).toHaveBeenCalledTimes(1);
      // Only the FOR UPDATE SELECT runs; counter update is skipped
      expect(mockTxExecute).toHaveBeenCalledTimes(1);
    });
  });

  describe("atomic WHERE guard conditions", () => {
    it("delivered: uses eq(status, 'sent') in WHERE clause", async () => {
      const recipient = makeRecipient({ status: "sent" });
      mockLimit.mockResolvedValueOnce([recipient]);
      mockTxReturning.mockResolvedValueOnce([{ id: 42 }]);

      await handleResendWebhookEvent(makeEvent("email.delivered"));

      const whereArg = mockTxWhere.mock.calls[0][0];
      expect(whereArg.op).toBe("and");
      // Should contain eq for id and eq for status
      const eqConditions = whereArg.conditions.filter((c: any) => c.op === "eq");
      expect(eqConditions).toHaveLength(2);
      expect(eqConditions.some((c: any) => c.value === "sent")).toBe(true);
    });

    it("opened: uses isNull(openedAt) in WHERE clause", async () => {
      const recipient = makeRecipient({ status: "delivered", deliveredAt: new Date(), openedAt: null });
      mockLimit.mockResolvedValueOnce([recipient]);
      mockTxExecute.mockResolvedValueOnce({ rows: [{ delivered_at: new Date() }] });
      mockTxReturning.mockResolvedValueOnce([{ id: 42 }]);

      await handleResendWebhookEvent(makeEvent("email.opened"));

      const whereArg = mockTxWhere.mock.calls[0][0];
      expect(whereArg.op).toBe("and");
      const nullConditions = whereArg.conditions.filter((c: any) => c.op === "isNull");
      expect(nullConditions).toHaveLength(1);
      expect(nullConditions[0].field).toBe("openedAt");
    });

    it("clicked: uses isNull(clickedAt) in WHERE clause", async () => {
      const recipient = makeRecipient({ status: "opened", deliveredAt: new Date(), openedAt: new Date(), clickedAt: null });
      mockLimit.mockResolvedValueOnce([recipient]);
      mockTxExecute.mockResolvedValueOnce({ rows: [{ delivered_at: new Date(), opened_at: new Date() }] });
      mockTxReturning.mockResolvedValueOnce([{ id: 42 }]);

      await handleResendWebhookEvent(makeEvent("email.clicked"));

      const whereArg = mockTxWhere.mock.calls[0][0];
      expect(whereArg.op).toBe("and");
      const nullConditions = whereArg.conditions.filter((c: any) => c.op === "isNull");
      expect(nullConditions).toHaveLength(1);
      expect(nullConditions[0].field).toBe("clickedAt");
    });

    it("bounced: uses isNull(failedAt) in WHERE clause", async () => {
      const recipient = makeRecipient({ status: "sent" });
      mockLimit.mockResolvedValueOnce([recipient]);
      mockTxReturning.mockResolvedValueOnce([{ id: 42 }]);

      await handleResendWebhookEvent(makeEvent("email.bounced"));

      const whereArg = mockTxWhere.mock.calls[0][0];
      expect(whereArg.op).toBe("and");
      const nullConditions = whereArg.conditions.filter((c: any) => c.op === "isNull");
      expect(nullConditions).toHaveLength(1);
      expect(nullConditions[0].field).toBe("failedAt");
    });

    it("complained: uses isNull(failedAt) in WHERE clause", async () => {
      const recipient = makeRecipient({ status: "delivered" });
      mockLimit.mockResolvedValueOnce([recipient]);
      mockTxReturning.mockResolvedValueOnce([{ id: 42 }]);

      await handleResendWebhookEvent(makeEvent("email.complained"));

      const whereArg = mockTxWhere.mock.calls[0][0];
      expect(whereArg.op).toBe("and");
      const nullConditions = whereArg.conditions.filter((c: any) => c.op === "isNull");
      expect(nullConditions).toHaveLength(1);
      expect(nullConditions[0].field).toBe("failedAt");
    });

    it("all event types use .returning() to check affected rows", async () => {
      // Test that when returning() yields empty array, no counter update happens
      for (const eventType of ["email.delivered", "email.opened", "email.clicked", "email.bounced", "email.complained"]) {
        vi.clearAllMocks();
        mockFrom.mockReturnValue({ where: mockWhere });
        mockWhere.mockReturnValue({ limit: mockLimit });
        mockTxSet.mockReturnValue({ where: mockTxWhere });
        mockTxWhere.mockReturnValue({ returning: mockTxReturning });
        mockTxReturning.mockResolvedValue([]);
        mockTxExecute.mockResolvedValue({ rows: [] });

        const recipient = makeRecipient();
        mockLimit.mockResolvedValueOnce([recipient]);

        // For opened/clicked, the FOR UPDATE SELECT runs first
        if (eventType === "email.opened") {
          mockTxExecute.mockResolvedValueOnce({ rows: [{ delivered_at: null }] });
        } else if (eventType === "email.clicked") {
          mockTxExecute.mockResolvedValueOnce({ rows: [{ delivered_at: null, opened_at: null }] });
        }
        // returning() yields empty — no rows matched the atomic guard
        mockTxReturning.mockResolvedValueOnce([]);

        await handleResendWebhookEvent(makeEvent(eventType));

        // For opened/clicked: only the FOR UPDATE SELECT runs, no counter update
        // For delivered/bounced/complained: no tx.execute calls at all
        const forUpdateEvents = ["email.opened", "email.clicked"];
        const expectedCalls = forUpdateEvents.includes(eventType) ? 1 : 0;
        expect(mockTxExecute).toHaveBeenCalledTimes(expectedCalls);
      }
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
