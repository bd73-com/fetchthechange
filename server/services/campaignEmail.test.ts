import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Use vi.hoisted() so mocks are available when vi.mock() factories run
const {
  mockSend,
  mockDbExecute,
  mockDbFrom,
  mockDbWhere,
  mockDbLimit,
  mockDbSet,
  mockDbValues,
  mockTransaction,
} = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockDbExecute: vi.fn(),
  mockDbFrom: vi.fn(),
  mockDbWhere: vi.fn(),
  mockDbLimit: vi.fn(),
  mockDbSet: vi.fn(),
  mockDbValues: vi.fn(),
  mockTransaction: vi.fn(),
}));

vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(function () {
    return { emails: { send: mockSend } };
  }),
}));

vi.mock("../db", () => ({
  db: {
    execute: mockDbExecute,
    select: () => ({ from: mockDbFrom }),
    update: () => ({ set: mockDbSet }),
    insert: () => ({ values: mockDbValues }),
    transaction: mockTransaction,
  },
}));

vi.mock("@shared/schema", () => ({
  users: { id: "id", unsubscribeToken: "unsubscribeToken" },
  campaigns: { id: "id", status: "status" },
  campaignRecipients: { id: "id", campaignId: "campaignId", status: "status" },
  monitors: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: (a: any, b: any) => ({ field: a, value: b }),
  and: (...args: any[]) => ({ type: "and", args }),
  inArray: (a: any, b: any) => ({ type: "inArray", field: a, values: b }),
  gte: (a: any, b: any) => ({ type: "gte", field: a, value: b }),
  lte: (a: any, b: any) => ({ type: "lte", field: a, value: b }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: any[]) => ({ strings, values }),
    { join: (items: any[], sep: any) => ({ items, sep }) }
  ),
  count: vi.fn(),
  SQL: class {},
}));

vi.mock("./resendTracker", () => ({
  ResendUsageTracker: {
    canSendEmail: vi.fn().mockResolvedValue({ allowed: true }),
    recordUsage: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("./logger", () => ({
  ErrorLogger: {
    error: vi.fn().mockResolvedValue(undefined),
  },
}));

import {
  resolveRecipients,
  previewRecipients,
  sendTestCampaignEmail,
  triggerCampaignSend,
  cancelCampaign,
  reconcileCampaignCounters,
} from "./campaignEmail";

describe("sendTestCampaignEmail", () => {
  const originalApiKey = process.env.RESEND_API_KEY;
  const originalFrom = process.env.RESEND_FROM;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RESEND_API_KEY = "re_test_key";
    mockSend.mockResolvedValue({ data: { id: "email_test_123" }, error: null });
  });

  afterEach(() => {
    if (originalApiKey !== undefined) process.env.RESEND_API_KEY = originalApiKey;
    else delete process.env.RESEND_API_KEY;
    if (originalFrom !== undefined) process.env.RESEND_FROM = originalFrom;
    else delete process.env.RESEND_FROM;
  });

  const mockCampaign = {
    id: 1,
    subject: "Welcome Campaign",
    htmlBody: "<h1>Hello!</h1><p>Welcome to FetchTheChange.</p>",
    textBody: "Hello! Welcome to FetchTheChange.",
  };

  it("returns error when RESEND_API_KEY is not set", async () => {
    delete process.env.RESEND_API_KEY;

    const result = await sendTestCampaignEmail(mockCampaign, "admin@example.com");

    expect(result.success).toBe(false);
    expect(result.error).toBe("RESEND_API_KEY not configured");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("sends test email with [TEST] prefix in subject", async () => {
    const result = await sendTestCampaignEmail(mockCampaign, "admin@example.com");

    expect(result.success).toBe(true);
    expect(result.resendId).toBe("email_test_123");
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "admin@example.com",
        subject: "[TEST] Welcome Campaign",
      })
    );
  });

  it("includes TEST EMAIL banner in HTML body", async () => {
    await sendTestCampaignEmail(mockCampaign, "admin@example.com");

    const call = mockSend.mock.calls[0][0];
    expect(call.html).toContain("TEST EMAIL");
    expect(call.html).toContain("Welcome Campaign");
  });

  it("includes unsubscribe placeholder in HTML body", async () => {
    await sendTestCampaignEmail(mockCampaign, "admin@example.com");

    const call = mockSend.mock.calls[0][0];
    expect(call.html).toContain("Unsubscribe from campaign emails");
  });

  it("includes original HTML body content", async () => {
    await sendTestCampaignEmail(mockCampaign, "admin@example.com");

    const call = mockSend.mock.calls[0][0];
    expect(call.html).toContain("<h1>Hello!</h1>");
  });

  it("uses RESEND_FROM env var when set", async () => {
    process.env.RESEND_FROM = "noreply@myapp.com";

    await sendTestCampaignEmail(mockCampaign, "admin@example.com");

    const call = mockSend.mock.calls[0][0];
    expect(call.from).toBe("noreply@myapp.com");
  });

  it("falls back to onboarding@resend.dev when RESEND_FROM is not set", async () => {
    delete process.env.RESEND_FROM;

    await sendTestCampaignEmail(mockCampaign, "admin@example.com");

    const call = mockSend.mock.calls[0][0];
    expect(call.from).toBe("onboarding@resend.dev");
  });

  it("handles Resend API error response", async () => {
    mockSend.mockResolvedValueOnce({
      data: null,
      error: { message: "Invalid recipient" },
    });

    const result = await sendTestCampaignEmail(mockCampaign, "bad@example.com");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Invalid recipient");
  });

  it("handles thrown exception from Resend", async () => {
    mockSend.mockRejectedValueOnce(new Error("Network timeout"));

    const result = await sendTestCampaignEmail(mockCampaign, "admin@example.com");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Network timeout");
  });

  it("passes textBody as plain text when provided", async () => {
    await sendTestCampaignEmail(mockCampaign, "admin@example.com");

    const call = mockSend.mock.calls[0][0];
    expect(call.text).toBe("Hello! Welcome to FetchTheChange.");
  });

  it("passes undefined text when textBody is null", async () => {
    const campaignNoText = { ...mockCampaign, textBody: null };
    await sendTestCampaignEmail(campaignNoText, "admin@example.com");

    const call = mockSend.mock.calls[0][0];
    expect(call.text).toBeUndefined();
  });

  it("escapes campaign subject in HTML banner to prevent XSS", async () => {
    const xssCampaign = {
      ...mockCampaign,
      subject: '<script>alert("xss")</script>',
    };
    await sendTestCampaignEmail(xssCampaign, "admin@example.com");

    const call = mockSend.mock.calls[0][0];
    expect(call.html).not.toContain("<script>");
    expect(call.html).toContain("&lt;script&gt;");
  });
});

describe("resolveRecipients", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbSet.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  });

  it("returns recipients from DB query results", async () => {
    mockDbExecute.mockResolvedValueOnce({
      rows: [
        {
          id: "user1",
          email: "u1@example.com",
          firstName: "Alice",
          tier: "pro",
          unsubscribeToken: "token-abc",
          recipientEmail: "u1@example.com",
          monitorCount: 5,
        },
      ],
    });

    const result = await resolveRecipients({});

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("user1");
    expect(result[0].email).toBe("u1@example.com");
    expect(result[0].unsubscribeToken).toBe("token-abc");
    expect(result[0].monitorCount).toBe(5);
  });

  it("generates unsubscribe token for users missing one", async () => {
    mockDbExecute.mockResolvedValueOnce({
      rows: [
        {
          id: "user2",
          email: "u2@example.com",
          firstName: null,
          tier: "free",
          unsubscribeToken: null,
          recipientEmail: "u2@example.com",
          monitorCount: 0,
        },
      ],
    });

    const result = await resolveRecipients({});

    expect(result).toHaveLength(1);
    // Token should be generated (UUID format)
    expect(result[0].unsubscribeToken).toBeTruthy();
    expect(result[0].unsubscribeToken.length).toBeGreaterThan(0);
  });

  it("uses notificationEmail when available over regular email", async () => {
    mockDbExecute.mockResolvedValueOnce({
      rows: [
        {
          id: "user3",
          email: "regular@example.com",
          firstName: "Bob",
          tier: "pro",
          unsubscribeToken: "token-xyz",
          recipientEmail: "alerts@example.com",
          monitorCount: 3,
        },
      ],
    });

    const result = await resolveRecipients({});

    expect(result[0].email).toBe("alerts@example.com");
  });

  it("returns empty array when no users match", async () => {
    mockDbExecute.mockResolvedValueOnce({ rows: [] });

    const result = await resolveRecipients({ tier: ["power"] });

    expect(result).toHaveLength(0);
  });
});

describe("previewRecipients", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbSet.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  });

  it("returns count and first 50 users without unsubscribeToken", async () => {
    const users = Array.from({ length: 60 }, (_, i) => ({
      id: `user${i}`,
      email: `u${i}@example.com`,
      firstName: `User${i}`,
      tier: "free",
      unsubscribeToken: `token-${i}`,
      recipientEmail: `u${i}@example.com`,
      monitorCount: i,
    }));
    mockDbExecute.mockResolvedValueOnce({ rows: users });

    const result = await previewRecipients({});

    expect(result.count).toBe(60);
    expect(result.users).toHaveLength(50);
    // unsubscribeToken should be stripped
    expect(result.users[0]).not.toHaveProperty("unsubscribeToken");
    expect(result.users[0]).toHaveProperty("email");
    expect(result.users[0]).toHaveProperty("tier");
  });

  it("returns all users when fewer than 50 match", async () => {
    mockDbExecute.mockResolvedValueOnce({
      rows: [
        {
          id: "user1",
          email: "u1@example.com",
          firstName: "A",
          tier: "pro",
          unsubscribeToken: "token-1",
          recipientEmail: "u1@example.com",
          monitorCount: 2,
        },
      ],
    });

    const result = await previewRecipients({});

    expect(result.count).toBe(1);
    expect(result.users).toHaveLength(1);
  });
});

describe("cancelCampaign", () => {
  function setupTransactionMock(txExecuteResults: any[]) {
    const txExecuteCalls: any[] = [];
    let txExecuteCallNum = 0;
    mockTransaction.mockImplementation(async (cb: any) => {
      const tx = {
        execute: vi.fn().mockImplementation((query: any) => {
          txExecuteCalls.push(query);
          const result = txExecuteResults[txExecuteCallNum++];
          return Promise.resolve(result ?? { rows: [] });
        }),
        update: () => ({
          set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
        }),
      };
      return await cb(tx);
    });
    return txExecuteCalls;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbSet.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  });

  it("returns sent and cancelled counts", async () => {
    mockDbExecute.mockResolvedValueOnce({
      rows: [{ sentCount: 25, pendingCount: 75 }],
    });
    // tx.execute: 1) SELECT FOR UPDATE (non-terminal), 2) UPDATE recipients, 3) UPDATE campaigns
    setupTransactionMock([
      { rows: [{ status: "sending" }] },
      { rows: Array.from({ length: 75 }, (_, i) => ({ id: i + 1 })) },
      { rows: [] },
    ]);

    const result = await cancelCampaign(99);

    expect(result.sentSoFar).toBe(25);
    expect(result.cancelled).toBe(75);
  });

  it("returns actual transaction cancelled count, not stale pendingCount", async () => {
    // Simulate race condition: pre-transaction COUNT sees 75 pending,
    // but batch sender processes 10 between COUNT and UPDATE, so only 65 are cancelled
    mockDbExecute.mockResolvedValueOnce({
      rows: [{ sentCount: 25, pendingCount: 75 }],
    });
    setupTransactionMock([
      { rows: [{ status: "sending" }] },
      { rows: Array.from({ length: 65 }, (_, i) => ({ id: i + 1 })) }, // only 65 actually pending
      { rows: [] },
    ]);

    const result = await cancelCampaign(99);

    expect(result.sentSoFar).toBe(25);
    expect(result.cancelled).toBe(65); // actual count, not stale 75
  });

  it("handles zero pending recipients", async () => {
    mockDbExecute.mockResolvedValueOnce({
      rows: [{ sentCount: 50, pendingCount: 0 }],
    });
    // tx.execute: 1) SELECT FOR UPDATE (non-terminal), 2) UPDATE recipients (0 rows), 3) UPDATE campaigns
    setupTransactionMock([
      { rows: [{ status: "sending" }] },
      { rows: [] },
      { rows: [] },
    ]);

    const result = await cancelCampaign(99);

    expect(result.sentSoFar).toBe(50);
    expect(result.cancelled).toBe(0);
  });

  it("returns early when campaign is already in terminal status (sent)", async () => {
    mockDbExecute.mockResolvedValueOnce({
      rows: [{ sentCount: 50, pendingCount: 0 }],
    });
    // tx.execute: SELECT FOR UPDATE returns terminal status — transaction exits early
    setupTransactionMock([
      { rows: [{ status: "sent" }] },
    ]);

    const result = await cancelCampaign(99);

    expect(result.sentSoFar).toBe(50);
    expect(result.cancelled).toBe(0);
    expect(mockTransaction).toHaveBeenCalled();
  });

  it("returns early when campaign is already cancelled", async () => {
    mockDbExecute.mockResolvedValueOnce({
      rows: [{ sentCount: 30, pendingCount: 0 }],
    });
    setupTransactionMock([
      { rows: [{ status: "cancelled" }] },
    ]);

    const result = await cancelCampaign(99);

    expect(result.sentSoFar).toBe(30);
    expect(result.cancelled).toBe(0);
  });

  it("returns early when campaign is already partially_sent", async () => {
    mockDbExecute.mockResolvedValueOnce({
      rows: [{ sentCount: 20, pendingCount: 0 }],
    });
    setupTransactionMock([
      { rows: [{ status: "partially_sent" }] },
    ]);

    const result = await cancelCampaign(99);

    expect(result.sentSoFar).toBe(20);
    expect(result.cancelled).toBe(0);
  });

  it("includes failedCount in campaign update when pendingCount > 0", async () => {
    mockDbExecute.mockResolvedValueOnce({
      rows: [{ sentCount: 10, pendingCount: 40 }],
    });
    const txCalls = setupTransactionMock([
      { rows: [{ status: "sending" }] },
      { rows: Array.from({ length: 40 }, (_, i) => ({ id: i + 1 })) },
      { rows: [] },
    ]);

    await cancelCampaign(99);

    expect(mockTransaction).toHaveBeenCalled();
    // 3 tx.execute calls: SELECT FOR UPDATE, UPDATE recipients, UPDATE campaigns
    expect(txCalls).toHaveLength(3);
    // The campaign UPDATE SQL values should include a nested sql object with failed_count
    const campaignUpdate = txCalls[2];
    const nestedSql = campaignUpdate.values.find(
      (v: any) => v?.strings && v.strings.some((s: string) => s.includes("failed_count"))
    );
    expect(nestedSql).toBeDefined();
  });

  it("does not include failedCount when pendingCount is 0", async () => {
    mockDbExecute.mockResolvedValueOnce({
      rows: [{ sentCount: 50, pendingCount: 0 }],
    });
    const txCalls = setupTransactionMock([
      { rows: [{ status: "sending" }] },
      { rows: [] },
      { rows: [] },
    ]);

    await cancelCampaign(99);

    expect(mockTransaction).toHaveBeenCalled();
    // 3 tx.execute calls: SELECT FOR UPDATE, UPDATE recipients, UPDATE campaigns
    expect(txCalls).toHaveLength(3);
    // The campaign UPDATE SQL values should NOT include a nested sql object with failed_count
    const campaignUpdate = txCalls[2];
    const nestedSql = campaignUpdate.values.find(
      (v: any) => v?.strings && v.strings.some((s: string) => s.includes("failed_count"))
    );
    expect(nestedSql).toBeUndefined();
  });
});

describe("cancelCampaign — active send path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbFrom.mockReturnValue({ where: mockDbWhere });
    mockDbWhere.mockReturnValue({ limit: mockDbLimit });
    mockDbSet.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  });

  it("atomically marks pending recipients when campaign is actively sending", async () => {
    // 1) triggerCampaignSend to populate activeSends
    const draftCampaign = {
      id: 77, name: "Active", subject: "Subj", htmlBody: "<p>Hi</p>",
      textBody: null, status: "draft", filters: {},
    };
    mockDbLimit.mockResolvedValueOnce([draftCampaign]);
    // resolveRecipients
    mockDbExecute.mockResolvedValueOnce({
      rows: [{ id: "u1", email: "u1@test.com", firstName: "A", tier: "free", unsubscribeToken: "tok1", recipientEmail: "u1@test.com", monitorCount: 0 }],
    });

    // Transaction for triggerCampaignSend (claims campaign)
    mockTransaction.mockImplementationOnce(async (cb: any) => {
      const tx = {
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ ...draftCampaign, status: "sending" }]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockResolvedValue(undefined),
        }),
      };
      return await cb(tx);
    });

    // The batch loop will call db.execute for pending recipients — make it hang long enough
    // by never resolving, so the batch doesn't finish before we cancel
    let batchResolve: (v: any) => void;
    const batchPromise = new Promise((r) => { batchResolve = r; });
    mockDbExecute.mockImplementationOnce(() => batchPromise);

    await triggerCampaignSend(77);

    // 2) Now cancel while the campaign is in activeSends
    // cancelCampaign first calls db.execute to get counts
    mockDbExecute.mockResolvedValueOnce({
      rows: [{ sentCount: 0, pendingCount: 1 }],
    });

    // Then runs a transaction to mark pending as failed
    const txCalls: any[] = [];
    let txCallNum = 0;
    const txResults = [
      { rows: [] },             // SET LOCAL lock_timeout
      { rows: [{ id: 1 }] },  // UPDATE recipients RETURNING
      { rows: [] },             // UPDATE campaigns
    ];
    mockTransaction.mockImplementationOnce(async (cb: any) => {
      const tx = {
        execute: vi.fn().mockImplementation((query: any) => {
          txCalls.push(query);
          return Promise.resolve(txResults[txCallNum++] ?? { rows: [] });
        }),
      };
      return await cb(tx);
    });

    const result = await cancelCampaign(77);

    expect(result.sentSoFar).toBe(0);
    expect(result.cancelled).toBe(1); // actual count from transaction, not stale pendingCount
    expect(mockTransaction).toHaveBeenCalledTimes(2); // triggerCampaignSend + cancelCampaign
    // Verify the transaction was used (not just returning pendingCount)
    expect(txCalls.length).toBeGreaterThanOrEqual(1);

    // Clean up: resolve the hanging batch so it doesn't leak
    batchResolve!({ rows: [] });
    // Allow finalizeCampaign to finish
    mockDbExecute.mockResolvedValue({ rows: [] });
    mockTransaction.mockImplementation(async (cb: any) => {
      const tx = {
        execute: vi.fn().mockResolvedValue({ rows: [] }),
        update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
      };
      return await cb(tx);
    });
    await new Promise((r) => setTimeout(r, 50));
  });

  it("returns zero cancelled when no pending recipients remain during active send", async () => {
    // Set up an active send
    const draftCampaign = {
      id: 78, name: "Active2", subject: "Subj", htmlBody: "<p>Hi</p>",
      textBody: null, status: "draft", filters: {},
    };
    mockDbLimit.mockResolvedValueOnce([draftCampaign]);
    mockDbExecute.mockResolvedValueOnce({
      rows: [{ id: "u1", email: "u1@test.com", firstName: "A", tier: "free", unsubscribeToken: "tok1", recipientEmail: "u1@test.com", monitorCount: 0 }],
    });

    mockTransaction.mockImplementationOnce(async (cb: any) => {
      const tx = {
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ ...draftCampaign, status: "sending" }]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockResolvedValue(undefined),
        }),
      };
      return await cb(tx);
    });

    let batchResolve: (v: any) => void;
    mockDbExecute.mockImplementationOnce(() => new Promise((r) => { batchResolve = r; }));

    await triggerCampaignSend(78);

    // Cancel: all already sent, nothing pending
    mockDbExecute.mockResolvedValueOnce({
      rows: [{ sentCount: 1, pendingCount: 0 }],
    });
    mockTransaction.mockImplementationOnce(async (cb: any) => {
      const tx = {
        execute: vi.fn().mockResolvedValue({ rows: [] }), // UPDATE returns 0 rows
      };
      return await cb(tx);
    });

    const result = await cancelCampaign(78);

    expect(result.sentSoFar).toBe(1);
    expect(result.cancelled).toBe(0);

    // Clean up
    batchResolve!({ rows: [] });
    mockDbExecute.mockResolvedValue({ rows: [] });
    mockTransaction.mockImplementation(async (cb: any) => {
      const tx = {
        execute: vi.fn().mockResolvedValue({ rows: [] }),
        update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
      };
      return await cb(tx);
    });
    await new Promise((r) => setTimeout(r, 50));
  });
});

describe("triggerCampaignSend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbFrom.mockReturnValue({ where: mockDbWhere });
    mockDbWhere.mockReturnValue({ limit: mockDbLimit });
    mockDbSet.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  });

  it("throws when campaign is not found", async () => {
    mockDbLimit.mockResolvedValueOnce([]);

    await expect(triggerCampaignSend(999)).rejects.toThrow("Campaign not found");
  });

  it("throws when campaign is not in draft status", async () => {
    mockDbLimit.mockResolvedValueOnce([{
      id: 1,
      name: "Test",
      subject: "Test",
      htmlBody: "<p>Test</p>",
      textBody: null,
      status: "sent",
      filters: {},
    }]);

    await expect(triggerCampaignSend(1)).rejects.toThrow("Campaign must be in draft status to send");
  });

  it("throws when no recipients match filters", async () => {
    mockDbLimit.mockResolvedValueOnce([{
      id: 1,
      name: "Test",
      subject: "Test",
      htmlBody: "<p>Test</p>",
      textBody: null,
      status: "draft",
      filters: { tier: ["nonexistent"] },
    }]);
    // resolveRecipients query returns empty
    mockDbExecute.mockResolvedValueOnce({ rows: [] });

    await expect(triggerCampaignSend(1)).rejects.toThrow("No recipients match the campaign filters");
  });

  it("uses atomic UPDATE with status=draft guard inside transaction", async () => {
    const draftCampaign = {
      id: 1, name: "Test", subject: "Test", htmlBody: "<p>Test</p>",
      textBody: null, status: "draft", filters: {},
    };
    mockDbLimit.mockResolvedValueOnce([draftCampaign]);
    // resolveRecipients returns one user
    mockDbExecute.mockResolvedValueOnce({
      rows: [{ id: "u1", email: "u1@test.com", firstName: "A", tier: "free", unsubscribeToken: "tok1", recipientEmail: "u1@test.com", monitorCount: 0 }],
    });

    let txInsertCalled = false;
    const mockTxUpdate = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ ...draftCampaign, status: "sending" }]),
        }),
      }),
    });
    const mockTxInsert = vi.fn().mockReturnValue({
      values: vi.fn().mockImplementation(() => { txInsertCalled = true; return Promise.resolve(); }),
    });

    // First call is the triggerCampaignSend transaction
    mockTransaction.mockImplementationOnce(async (cb: any) => {
      const tx = { update: mockTxUpdate, insert: mockTxInsert };
      return await cb(tx);
    });
    // Subsequent transaction calls from async sendCampaignBatch/finalizeCampaign
    mockTransaction.mockImplementation(async (cb: any) => {
      const tx = {
        execute: vi.fn().mockResolvedValue({ rows: [] }),
        update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
      };
      return await cb(tx);
    });
    // Mock db.execute for sendCampaignBatch (pending recipients query returns empty = done)
    mockDbExecute.mockResolvedValue({ rows: [] });

    const result = await triggerCampaignSend(1);
    // Wait for the async batch sending to settle
    await new Promise((r) => setTimeout(r, 50));

    expect(result.totalRecipients).toBe(1);
    expect(mockTransaction).toHaveBeenCalled();
    expect(mockTxUpdate).toHaveBeenCalled();
    expect(txInsertCalled).toBe(true);
  });

  it("throws when atomic UPDATE returns no rows (race condition)", async () => {
    const draftCampaign = {
      id: 1, name: "Test", subject: "Test", htmlBody: "<p>Test</p>",
      textBody: null, status: "draft", filters: {},
    };
    mockDbLimit.mockResolvedValueOnce([draftCampaign]);
    mockDbExecute.mockResolvedValueOnce({
      rows: [{ id: "u1", email: "u1@test.com", firstName: "A", tier: "free", unsubscribeToken: "tok1", recipientEmail: "u1@test.com", monitorCount: 0 }],
    });

    // Simulate concurrent caller already claimed the campaign
    mockTransaction.mockImplementation(async (cb: any) => {
      const tx = {
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([]), // no rows = already claimed
            }),
          }),
        }),
        insert: vi.fn(),
      };
      return await cb(tx);
    });

    await expect(triggerCampaignSend(1)).rejects.toThrow("Campaign must be in draft status to send");
  });
});

describe("reconcileCampaignCounters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbFrom.mockReturnValue({ where: mockDbWhere });
    mockDbWhere.mockReturnValue({ limit: mockDbLimit });
    mockDbSet.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  });

  it("throws when campaign is not found", async () => {
    mockDbLimit.mockResolvedValueOnce([]);

    await expect(reconcileCampaignCounters(999)).rejects.toThrow("Campaign not found");
  });

  it("throws when campaign is actively sending", async () => {
    mockDbLimit.mockResolvedValueOnce([{
      id: 1, status: "sending", sentCount: 5, failedCount: 0, deliveredCount: 0, openedCount: 0, clickedCount: 0,
    }]);

    await expect(reconcileCampaignCounters(1)).rejects.toThrow("Cannot reconcile counters while campaign is actively sending");
  });

  it("recomputes counters from recipient rows and returns before/after", async () => {
    const campaign = {
      id: 1, totalRecipients: 12, sentCount: 10, failedCount: 2, deliveredCount: 5, openedCount: 3, clickedCount: 1,
    };
    mockDbLimit.mockResolvedValueOnce([campaign]);
    // db.execute returns recomputed counts
    mockDbExecute.mockResolvedValueOnce({
      rows: [{ totalRecipients: 12, sentCount: 8, failedCount: 4, deliveredCount: 6, openedCount: 2, clickedCount: 0 }],
    });

    const result = await reconcileCampaignCounters(1);

    expect(result.before).toEqual({
      totalRecipients: 12, sentCount: 10, failedCount: 2, deliveredCount: 5, openedCount: 3, clickedCount: 1,
    });
    expect(result.after).toEqual({
      totalRecipients: 12, sentCount: 8, failedCount: 4, deliveredCount: 6, openedCount: 2, clickedCount: 0,
    });
    // Verify db.update was called to persist the new counters
    expect(mockDbSet).toHaveBeenCalledWith({
      totalRecipients: 12, sentCount: 8, failedCount: 4, deliveredCount: 6, openedCount: 2, clickedCount: 0,
    });
  });

  it("handles null values from query by defaulting to 0", async () => {
    const campaign = {
      id: 1, totalRecipients: 5, sentCount: 5, failedCount: 1, deliveredCount: 3, openedCount: 0, clickedCount: 0,
    };
    mockDbLimit.mockResolvedValueOnce([campaign]);
    // Simulate empty campaign with no recipients
    mockDbExecute.mockResolvedValueOnce({
      rows: [{ totalRecipients: null, sentCount: null, failedCount: null, deliveredCount: null, openedCount: null, clickedCount: null }],
    });

    const result = await reconcileCampaignCounters(1);

    expect(result.after).toEqual({
      totalRecipients: 0, sentCount: 0, failedCount: 0, deliveredCount: 0, openedCount: 0, clickedCount: 0,
    });
  });
});
