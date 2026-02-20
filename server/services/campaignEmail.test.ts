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
} = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockDbExecute: vi.fn(),
  mockDbFrom: vi.fn(),
  mockDbWhere: vi.fn(),
  mockDbLimit: vi.fn(),
  mockDbSet: vi.fn(),
  mockDbValues: vi.fn(),
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
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbSet.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  });

  it("returns sent and cancelled counts", async () => {
    mockDbExecute.mockResolvedValueOnce({
      rows: [{ sentCount: 25, pendingCount: 75 }],
    });

    const result = await cancelCampaign(99);

    expect(result.sentSoFar).toBe(25);
    expect(result.cancelled).toBe(75);
  });

  it("handles zero pending recipients", async () => {
    mockDbExecute.mockResolvedValueOnce({
      rows: [{ sentCount: 50, pendingCount: 0 }],
    });

    const result = await cancelCampaign(99);

    expect(result.sentSoFar).toBe(50);
    expect(result.cancelled).toBe(0);
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
});
