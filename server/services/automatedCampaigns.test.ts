import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoist mock variables
// ---------------------------------------------------------------------------
const {
  mockDbExecute,
  mockDbSelect,
  mockDbFrom,
  mockDbWhere,
  mockDbLimit,
  mockDbInsert,
  mockDbValues,
  mockDbReturning,
  mockDbUpdate,
  mockDbSet,
  mockDbOrderBy,
  mockTriggerCampaignSend,
  mockResolveRecipients,
  mockErrorLoggerError,
} = vi.hoisted(() => ({
  mockDbExecute: vi.fn(),
  mockDbSelect: vi.fn(),
  mockDbFrom: vi.fn(),
  mockDbWhere: vi.fn(),
  mockDbLimit: vi.fn(),
  mockDbInsert: vi.fn(),
  mockDbValues: vi.fn(),
  mockDbReturning: vi.fn(),
  mockDbUpdate: vi.fn(),
  mockDbSet: vi.fn(),
  mockDbOrderBy: vi.fn(),
  mockTriggerCampaignSend: vi.fn(),
  mockResolveRecipients: vi.fn(),
  mockErrorLoggerError: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../db", () => ({
  db: {
    execute: mockDbExecute,
    select: () => ({ from: mockDbFrom }),
    insert: () => ({ values: mockDbValues }),
    update: () => ({ set: mockDbSet }),
  },
}));

// Chain mocks for select().from().where().limit().orderBy()
mockDbFrom.mockReturnValue({ where: mockDbWhere, orderBy: mockDbOrderBy });
mockDbWhere.mockReturnValue({ limit: mockDbLimit, returning: mockDbReturning });
mockDbLimit.mockReturnValue([]);
mockDbOrderBy.mockReturnValue([]);
mockDbValues.mockReturnValue({ returning: mockDbReturning, onConflictDoNothing: vi.fn().mockResolvedValue(undefined) });
mockDbReturning.mockResolvedValue([]);
mockDbSet.mockReturnValue({ where: mockDbWhere });

vi.mock("@shared/schema", () => ({
  campaigns: { id: "id", status: "status" },
  automatedCampaignConfigs: {
    id: "id",
    key: "key",
    enabled: "enabled",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (a: any, b: any) => ({ field: a, value: b }),
  and: (...args: any[]) => ({ type: "and", args }),
  isNull: (a: any) => ({ type: "isNull", field: a }),
  lte: (a: any, b: any) => ({ type: "lte", field: a, value: b }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: any[]) => ({ strings, values }),
    { join: (items: any[], sep: any) => ({ items, sep }) }
  ),
  relations: vi.fn(),
}));

vi.mock("./campaignEmail", () => ({
  triggerCampaignSend: (...args: any[]) => mockTriggerCampaignSend(...args),
  resolveRecipients: (...args: any[]) => mockResolveRecipients(...args),
}));

vi.mock("./logger", () => ({
  ErrorLogger: {
    error: (...args: any[]) => mockErrorLoggerError(...args),
  },
}));

import { computeNextRunAt, ensureWelcomeConfig, bootstrapWelcomeCampaign, processAutomatedCampaigns, runWelcomeCampaign, WELCOME_CAMPAIGN_DEFAULTS } from "./automatedCampaigns";

describe("computeNextRunAt", () => {
  it("Jan 1 00:00 UTC → Jan 15", () => {
    const result = computeNextRunAt(new Date(Date.UTC(2025, 0, 1, 0, 0, 0)));
    expect(result).toEqual(new Date(Date.UTC(2025, 0, 15, 0, 0, 0)));
  });

  it("Jan 14 → Jan 15", () => {
    const result = computeNextRunAt(new Date(Date.UTC(2025, 0, 14, 12, 0, 0)));
    expect(result).toEqual(new Date(Date.UTC(2025, 0, 15, 0, 0, 0)));
  });

  it("Jan 15 00:00 UTC → Feb 1 (boundary: exactly on schedule day = already fired)", () => {
    const result = computeNextRunAt(new Date(Date.UTC(2025, 0, 15, 0, 0, 0)));
    expect(result).toEqual(new Date(Date.UTC(2025, 1, 1, 0, 0, 0)));
  });

  it("Jan 15 00:01 UTC → Feb 1", () => {
    const result = computeNextRunAt(new Date(Date.UTC(2025, 0, 15, 0, 1, 0)));
    expect(result).toEqual(new Date(Date.UTC(2025, 1, 1, 0, 0, 0)));
  });

  it("Jan 16 → Feb 1", () => {
    const result = computeNextRunAt(new Date(Date.UTC(2025, 0, 16, 10, 0, 0)));
    expect(result).toEqual(new Date(Date.UTC(2025, 1, 1, 0, 0, 0)));
  });

  it("Dec 15 → Jan 1 next year", () => {
    const result = computeNextRunAt(new Date(Date.UTC(2025, 11, 15, 0, 0, 0)));
    expect(result).toEqual(new Date(Date.UTC(2026, 0, 1, 0, 0, 0)));
  });

  it("Dec 31 → Jan 1 next year", () => {
    const result = computeNextRunAt(new Date(Date.UTC(2025, 11, 31, 23, 59, 59)));
    expect(result).toEqual(new Date(Date.UTC(2026, 0, 1, 0, 0, 0)));
  });

  it("Feb 28 (non-leap) → Mar 1", () => {
    const result = computeNextRunAt(new Date(Date.UTC(2025, 1, 28, 12, 0, 0)));
    expect(result).toEqual(new Date(Date.UTC(2025, 2, 1, 0, 0, 0)));
  });

  it("Mar 1 00:00 UTC → Mar 15", () => {
    const result = computeNextRunAt(new Date(Date.UTC(2025, 2, 1, 0, 0, 0)));
    expect(result).toEqual(new Date(Date.UTC(2025, 2, 15, 0, 0, 0)));
  });

  it("Mar 5 → Mar 15", () => {
    const result = computeNextRunAt(new Date(Date.UTC(2025, 2, 5, 8, 30, 0)));
    expect(result).toEqual(new Date(Date.UTC(2025, 2, 15, 0, 0, 0)));
  });

  it("always returns midnight UTC", () => {
    const result = computeNextRunAt(new Date(Date.UTC(2025, 5, 20, 14, 30, 45, 123)));
    expect(result.getUTCHours()).toBe(0);
    expect(result.getUTCMinutes()).toBe(0);
    expect(result.getUTCSeconds()).toBe(0);
    expect(result.getUTCMilliseconds()).toBe(0);
  });
});

describe("ensureWelcomeConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock chains
    mockDbFrom.mockReturnValue({ where: mockDbWhere, orderBy: mockDbOrderBy });
    mockDbWhere.mockReturnValue({ limit: mockDbLimit, returning: mockDbReturning });
    mockDbLimit.mockResolvedValue([]);
    mockDbValues.mockReturnValue({ returning: mockDbReturning, onConflictDoNothing: vi.fn().mockResolvedValue(undefined) });
    mockDbReturning.mockResolvedValue([]);
    mockDbSet.mockReturnValue({ where: mockDbWhere });
  });

  it("returns the existing config without modification if it already exists", async () => {
    const existingConfig = {
      id: 1,
      key: "welcome",
      name: "Welcome — New Members",
      subject: "Welcome to FetchTheChange",
      htmlBody: "<html>test</html>",
      textBody: "test",
      enabled: true,
      lastRunAt: new Date("2025-03-20"),
      nextRunAt: new Date("2025-04-01"),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mockDbLimit.mockResolvedValue([existingConfig]);

    const result = await ensureWelcomeConfig();
    expect(result).toEqual(existingConfig);
    // Should not have called insert
    expect(mockDbValues).not.toHaveBeenCalled();
  });

  it("inserts the welcome config if it does not exist", async () => {
    const newConfig = {
      id: 1,
      key: "welcome",
      name: WELCOME_CAMPAIGN_DEFAULTS.name,
      subject: WELCOME_CAMPAIGN_DEFAULTS.subject,
      htmlBody: WELCOME_CAMPAIGN_DEFAULTS.htmlBody,
      textBody: WELCOME_CAMPAIGN_DEFAULTS.textBody,
      enabled: true,
      lastRunAt: null,
      nextRunAt: new Date("2025-04-01"),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    // First select returns empty (no existing config), second select (after insert) returns new config
    let selectCallCount = 0;
    mockDbLimit.mockImplementation(() => {
      selectCallCount++;
      if (selectCallCount === 1) return Promise.resolve([]);
      return Promise.resolve([newConfig]);
    });

    const result = await ensureWelcomeConfig();
    expect(result).toEqual(newConfig);
    expect(mockDbValues).toHaveBeenCalled();
  });
});

describe("bootstrapWelcomeCampaign", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbFrom.mockReturnValue({ where: mockDbWhere, orderBy: mockDbOrderBy });
    mockDbWhere.mockReturnValue({ limit: mockDbLimit, returning: mockDbReturning });
    mockDbSet.mockReturnValue({ where: mockDbWhere });
    mockDbValues.mockReturnValue({ returning: mockDbReturning, onConflictDoNothing: vi.fn().mockResolvedValue(undefined) });
  });

  it("triggers a send and sets lastRunAt when lastRunAt is null", async () => {
    const config = {
      id: 1,
      key: "welcome",
      name: "Welcome — New Members",
      subject: "Welcome",
      htmlBody: "<html></html>",
      textBody: "text",
      enabled: true,
      lastRunAt: null,
      nextRunAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    // ensureWelcomeConfig returns config with lastRunAt=null
    mockDbLimit.mockResolvedValue([config]);
    // resolveRecipients returns some recipients
    mockResolveRecipients.mockResolvedValue([
      { id: "u1", email: "a@b.com", firstName: null, tier: "free", monitorCount: 0, unsubscribeToken: "tok" },
    ]);
    // campaign insert
    mockDbReturning.mockResolvedValue([{ id: 99, ...config, status: "draft", type: "automated" }]);
    // triggerCampaignSend
    mockTriggerCampaignSend.mockResolvedValue({ totalRecipients: 1 });

    await bootstrapWelcomeCampaign();

    expect(mockResolveRecipients).toHaveBeenCalled();
    expect(mockTriggerCampaignSend).toHaveBeenCalled();
  });

  it("is a no-op when lastRunAt is already set", async () => {
    const config = {
      id: 1,
      key: "welcome",
      name: "Welcome — New Members",
      subject: "Welcome",
      htmlBody: "<html></html>",
      textBody: "text",
      enabled: true,
      lastRunAt: new Date("2025-03-20"),
      nextRunAt: new Date("2025-04-01"),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mockDbLimit.mockResolvedValue([config]);

    await bootstrapWelcomeCampaign();

    // Should not have tried to resolve recipients or send
    expect(mockResolveRecipients).not.toHaveBeenCalled();
    expect(mockTriggerCampaignSend).not.toHaveBeenCalled();
  });
});

describe("WELCOME_CAMPAIGN_DEFAULTS", () => {
  it("has all required fields", () => {
    expect(WELCOME_CAMPAIGN_DEFAULTS.key).toBe("welcome");
    expect(WELCOME_CAMPAIGN_DEFAULTS.name).toBeTruthy();
    expect(WELCOME_CAMPAIGN_DEFAULTS.subject).toBeTruthy();
    expect(WELCOME_CAMPAIGN_DEFAULTS.htmlBody).toContain("FetchTheChange");
    expect(WELCOME_CAMPAIGN_DEFAULTS.textBody).toContain("FetchTheChange");
  });

  it("HTML body does not contain unsubscribe placeholder (handled by sendSingleCampaignEmail)", () => {
    expect(WELCOME_CAMPAIGN_DEFAULTS.htmlBody).not.toContain("{{unsubscribe_url}}");
  });

  it("HTML body contains extension and dashboard links", () => {
    expect(WELCOME_CAMPAIGN_DEFAULTS.htmlBody).toContain("https://ftc.bd73.com/docs/extension");
    expect(WELCOME_CAMPAIGN_DEFAULTS.htmlBody).toContain("https://ftc.bd73.com/dashboard");
  });
});

describe("runWelcomeCampaign", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbFrom.mockReturnValue({ where: mockDbWhere, orderBy: mockDbOrderBy });
    mockDbWhere.mockReturnValue({ limit: mockDbLimit, returning: mockDbReturning });
    mockDbSet.mockReturnValue({ where: mockDbWhere });
    mockDbValues.mockReturnValue({ returning: mockDbReturning, onConflictDoNothing: vi.fn().mockResolvedValue(undefined) });
  });

  it("returns { skipped: true } when zero recipients match", async () => {
    const config = {
      id: 1, key: "welcome", name: "Welcome", subject: "Welcome",
      htmlBody: "<html></html>", textBody: "text", enabled: true,
      lastRunAt: null, nextRunAt: null, createdAt: new Date(), updatedAt: new Date(),
    };
    mockDbLimit.mockResolvedValue([config]);
    mockResolveRecipients.mockResolvedValue([]);

    const result = await runWelcomeCampaign({
      signupAfter: new Date("2025-03-19"),
      signupBefore: new Date(),
      configId: 1,
    });

    expect(result).toEqual({ skipped: true });
    expect(mockTriggerCampaignSend).not.toHaveBeenCalled();
  });

  it("creates campaign and calls triggerCampaignSend when recipients exist", async () => {
    const config = {
      id: 1, key: "welcome", name: "Welcome", subject: "Welcome",
      htmlBody: "<html></html>", textBody: "text", enabled: true,
      lastRunAt: null, nextRunAt: null, createdAt: new Date(), updatedAt: new Date(),
    };
    mockDbLimit.mockResolvedValue([config]);
    mockResolveRecipients.mockResolvedValue([
      { id: "u1", email: "a@b.com", firstName: null, tier: "free", monitorCount: 0, unsubscribeToken: "tok" },
    ]);
    mockDbReturning.mockResolvedValue([{ id: 42, ...config, status: "draft", type: "automated" }]);
    mockTriggerCampaignSend.mockResolvedValue({ totalRecipients: 1 });

    const result = await runWelcomeCampaign({
      signupAfter: new Date("2025-03-19"),
      signupBefore: new Date(),
      configId: 1,
    });

    expect(result).toHaveProperty("campaignId");
    expect(result).toHaveProperty("totalRecipients", 1);
    expect(mockTriggerCampaignSend).toHaveBeenCalled();
  });

  it("throws when config not found", async () => {
    mockDbLimit.mockResolvedValue([]);

    await expect(runWelcomeCampaign({
      signupAfter: new Date("2025-03-19"),
      signupBefore: new Date(),
      configId: 999,
    })).rejects.toThrow("Automated campaign config not found");
  });
});

describe("processAutomatedCampaigns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbFrom.mockReturnValue({ where: mockDbWhere, orderBy: mockDbOrderBy });
    mockDbWhere.mockReturnValue({ limit: mockDbLimit, returning: mockDbReturning });
    mockDbSet.mockReturnValue({ where: mockDbWhere });
    mockDbValues.mockReturnValue({ returning: mockDbReturning, onConflictDoNothing: vi.fn().mockResolvedValue(undefined) });
  });

  it("skips configs where nextRunAt is in the future", async () => {
    const futureDate = new Date(Date.now() + 86400000); // tomorrow
    mockDbWhere.mockResolvedValue([
      {
        id: 1,
        key: "welcome",
        enabled: true,
        lastRunAt: new Date(),
        nextRunAt: futureDate,
        subject: "test",
        htmlBody: "<html></html>",
        textBody: null,
        name: "Welcome",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    await processAutomatedCampaigns();

    expect(mockResolveRecipients).not.toHaveBeenCalled();
  });

  it("calls runWelcomeCampaign for configs where nextRunAt <= now", async () => {
    const pastDate = new Date(Date.now() - 3600000); // 1 hour ago
    const config = {
      id: 1,
      key: "welcome",
      enabled: true,
      lastRunAt: new Date("2025-03-20"),
      nextRunAt: pastDate,
      subject: "test",
      htmlBody: "<html></html>",
      textBody: null,
      name: "Welcome",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // processAutomatedCampaigns calls select().from().where() which returns configs array
    // Then runWelcomeCampaign calls select().from().where().limit() which returns [config]
    // We need mockDbWhere to handle both: first call returns configs array (no .limit()),
    // subsequent calls return { limit: ... } chain
    let whereCallCount = 0;
    mockDbWhere.mockImplementation(() => {
      whereCallCount++;
      if (whereCallCount === 1) {
        // processAutomatedCampaigns: db.select().from().where(eq(enabled, true))
        return Promise.resolve([config]);
      }
      // All subsequent where() calls return chainable { limit, returning }
      return {
        limit: vi.fn().mockResolvedValue([config]),
        returning: vi.fn().mockResolvedValue([{ id: 50, ...config, status: "draft", type: "automated" }]),
      };
    });

    // resolveRecipients returns recipients
    mockResolveRecipients.mockResolvedValue([
      { id: "u1", email: "a@b.com", firstName: null, tier: "free", monitorCount: 0, unsubscribeToken: "tok" },
    ]);
    // campaign insert returning
    mockDbReturning.mockResolvedValue([{ id: 50, ...config, status: "draft", type: "automated" }]);
    mockTriggerCampaignSend.mockResolvedValue({ totalRecipients: 1 });

    await processAutomatedCampaigns();

    expect(mockResolveRecipients).toHaveBeenCalled();
    expect(mockTriggerCampaignSend).toHaveBeenCalled();
  });

  it("logs error and continues if one config fails", async () => {
    const pastDate = new Date(Date.now() - 3600000);
    const config = {
      id: 1,
      key: "welcome",
      enabled: true,
      lastRunAt: new Date("2025-03-20"),
      nextRunAt: pastDate,
      subject: "test",
      htmlBody: "<html></html>",
      textBody: null,
      name: "Welcome",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mockDbWhere.mockResolvedValue([config]);
    // Make the inner select fail
    mockDbLimit.mockRejectedValue(new Error("DB connection failed"));

    // Should not throw
    await processAutomatedCampaigns();

    expect(mockErrorLoggerError).toHaveBeenCalledWith(
      "scheduler",
      expect.stringContaining("'welcome' failed"),
      expect.any(Error),
      expect.objectContaining({ configKey: "welcome" }),
    );
  });
});
