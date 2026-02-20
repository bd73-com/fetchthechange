import { describe, it, expect } from "vitest";
import { insertMonitorSchema, monitorMetrics, monitors, campaigns, campaignRecipients, insertCampaignSchema } from "./schema";
import { users } from "./models/auth";
import { TIER_LIMITS, BROWSERLESS_CAPS, RESEND_CAPS, PAUSE_THRESHOLDS } from "./models/auth";
import { api } from "./routes";

describe("insertMonitorSchema", () => {
  const validInput = {
    name: "Price Tracker",
    url: "https://example.com/product",
    selector: ".price-value",
  };

  describe("required fields", () => {
    it("accepts valid input with all required fields", () => {
      const result = insertMonitorSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it("rejects when name is missing", () => {
      const { name, ...rest } = validInput;
      const result = insertMonitorSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it("rejects when url is missing", () => {
      const { url, ...rest } = validInput;
      const result = insertMonitorSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it("rejects when selector is missing", () => {
      const { selector, ...rest } = validInput;
      const result = insertMonitorSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });
  });

  describe("omitted fields (should not be settable via insert)", () => {
    it("strips id from input", () => {
      const result = insertMonitorSchema.safeParse({ ...validInput, id: 999 });
      expect(result.success).toBe(true);
      if (result.success) {
        expect("id" in result.data).toBe(false);
      }
    });

    it("strips userId from input", () => {
      const result = insertMonitorSchema.safeParse({ ...validInput, userId: "user_123" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect("userId" in result.data).toBe(false);
      }
    });

    it("strips lastChecked from input", () => {
      const result = insertMonitorSchema.safeParse({ ...validInput, lastChecked: new Date() });
      expect(result.success).toBe(true);
      if (result.success) {
        expect("lastChecked" in result.data).toBe(false);
      }
    });

    it("strips lastChanged from input", () => {
      const result = insertMonitorSchema.safeParse({ ...validInput, lastChanged: new Date() });
      expect(result.success).toBe(true);
      if (result.success) {
        expect("lastChanged" in result.data).toBe(false);
      }
    });

    it("strips currentValue from input", () => {
      const result = insertMonitorSchema.safeParse({ ...validInput, currentValue: "old" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect("currentValue" in result.data).toBe(false);
      }
    });

    it("strips createdAt from input", () => {
      const result = insertMonitorSchema.safeParse({ ...validInput, createdAt: new Date() });
      expect(result.success).toBe(true);
      if (result.success) {
        expect("createdAt" in result.data).toBe(false);
      }
    });

    it("strips consecutiveFailures from input", () => {
      const result = insertMonitorSchema.safeParse({ ...validInput, consecutiveFailures: 99 });
      expect(result.success).toBe(true);
      if (result.success) {
        expect("consecutiveFailures" in result.data).toBe(false);
      }
    });

    it("strips pauseReason from input", () => {
      const result = insertMonitorSchema.safeParse({ ...validInput, pauseReason: "hacked" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect("pauseReason" in result.data).toBe(false);
      }
    });
  });

  describe("optional fields with defaults", () => {
    it("accepts frequency field", () => {
      const result = insertMonitorSchema.safeParse({ ...validInput, frequency: "hourly" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.frequency).toBe("hourly");
      }
    });

    it("accepts active field set to false", () => {
      const result = insertMonitorSchema.safeParse({ ...validInput, active: false });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.active).toBe(false);
      }
    });

    it("accepts emailEnabled field set to false", () => {
      const result = insertMonitorSchema.safeParse({ ...validInput, emailEnabled: false });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.emailEnabled).toBe(false);
      }
    });

    it("strips lastStatus field (server-only)", () => {
      const result = insertMonitorSchema.safeParse({ ...validInput, lastStatus: "blocked" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).not.toHaveProperty("lastStatus");
      }
    });

    it("strips lastError field (server-only)", () => {
      const result = insertMonitorSchema.safeParse({ ...validInput, lastError: "connection failed" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).not.toHaveProperty("lastError");
      }
    });
  });

  describe("partial schema (for updates)", () => {
    const partialSchema = insertMonitorSchema.partial();

    it("accepts empty object", () => {
      expect(partialSchema.safeParse({}).success).toBe(true);
    });

    it("accepts single field update", () => {
      expect(partialSchema.safeParse({ name: "New Name" }).success).toBe(true);
    });

    it("accepts url-only update", () => {
      expect(partialSchema.safeParse({ url: "https://new.example.com" }).success).toBe(true);
    });
  });
});

describe("tier configuration constants", () => {
  it("defines free tier with 5 monitor limit", () => {
    expect(TIER_LIMITS.free).toBe(5);
  });

  it("defines pro tier with 100 monitor limit", () => {
    expect(TIER_LIMITS.pro).toBe(100);
  });

  it("defines power tier with unlimited monitors", () => {
    expect(TIER_LIMITS.power).toBe(Infinity);
  });

  it("defines browserless caps for all tiers", () => {
    expect(BROWSERLESS_CAPS.free).toBe(0);
    expect(BROWSERLESS_CAPS.pro).toBe(200);
    expect(BROWSERLESS_CAPS.power).toBe(500);
    expect(BROWSERLESS_CAPS.system).toBe(1000);
  });

  it("defines resend email caps", () => {
    expect(RESEND_CAPS.daily).toBe(100);
    expect(RESEND_CAPS.monthly).toBe(3000);
  });

  it("defines pause thresholds for all tiers", () => {
    expect(PAUSE_THRESHOLDS.free).toBe(3);
    expect(PAUSE_THRESHOLDS.pro).toBe(5);
    expect(PAUSE_THRESHOLDS.power).toBe(10);
  });

  it("pause thresholds are lower for free tier than pro and power", () => {
    expect(PAUSE_THRESHOLDS.free).toBeLessThan(PAUSE_THRESHOLDS.pro);
    expect(PAUSE_THRESHOLDS.pro).toBeLessThan(PAUSE_THRESHOLDS.power);
  });
});

describe("update input schema (api.monitors.update.input)", () => {
  const updateSchema = api.monitors.update.input;

  it("strips consecutiveFailures from update input", () => {
    const result = updateSchema.safeParse({ consecutiveFailures: 99 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("consecutiveFailures" in result.data).toBe(false);
    }
  });

  it("strips pauseReason from update input", () => {
    const result = updateSchema.safeParse({ pauseReason: "injected" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("pauseReason" in result.data).toBe(false);
    }
  });

  it("strips id from update input", () => {
    const result = updateSchema.safeParse({ id: 999 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("id" in result.data).toBe(false);
    }
  });

  it("strips userId from update input", () => {
    const result = updateSchema.safeParse({ userId: "attacker" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("userId" in result.data).toBe(false);
    }
  });

  it("allows valid fields like name, url, active", () => {
    const result = updateSchema.safeParse({
      name: "Updated",
      url: "https://new.example.com",
      active: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Updated");
      expect(result.data.url).toBe("https://new.example.com");
      expect(result.data.active).toBe(true);
    }
  });
});

describe("monitorMetrics table schema", () => {
  it("has monitorId column referencing monitors", () => {
    // Verify the table has the expected column names
    const columns = Object.keys(monitorMetrics);
    expect(columns).toContain("monitorId");
    expect(columns).toContain("stage");
    expect(columns).toContain("durationMs");
    expect(columns).toContain("status");
    expect(columns).toContain("blocked");
    expect(columns).toContain("blockReason");
    expect(columns).toContain("checkedAt");
    expect(columns).toContain("selectorCount");
  });

  it("monitors table has consecutiveFailures and pauseReason columns", () => {
    const columns = Object.keys(monitors);
    expect(columns).toContain("consecutiveFailures");
    expect(columns).toContain("pauseReason");
  });
});

describe("campaigns table schema", () => {
  it("has all expected columns", () => {
    const columns = Object.keys(campaigns);
    expect(columns).toContain("id");
    expect(columns).toContain("name");
    expect(columns).toContain("subject");
    expect(columns).toContain("htmlBody");
    expect(columns).toContain("textBody");
    expect(columns).toContain("status");
    expect(columns).toContain("filters");
    expect(columns).toContain("totalRecipients");
    expect(columns).toContain("sentCount");
    expect(columns).toContain("failedCount");
    expect(columns).toContain("deliveredCount");
    expect(columns).toContain("openedCount");
    expect(columns).toContain("clickedCount");
    expect(columns).toContain("createdAt");
    expect(columns).toContain("scheduledAt");
    expect(columns).toContain("sentAt");
    expect(columns).toContain("completedAt");
  });
});

describe("campaignRecipients table schema", () => {
  it("has all expected columns", () => {
    const columns = Object.keys(campaignRecipients);
    expect(columns).toContain("id");
    expect(columns).toContain("campaignId");
    expect(columns).toContain("userId");
    expect(columns).toContain("recipientEmail");
    expect(columns).toContain("status");
    expect(columns).toContain("resendId");
    expect(columns).toContain("sentAt");
    expect(columns).toContain("deliveredAt");
    expect(columns).toContain("openedAt");
    expect(columns).toContain("clickedAt");
    expect(columns).toContain("failedAt");
    expect(columns).toContain("failureReason");
  });
});

describe("users table campaign columns", () => {
  it("has campaignUnsubscribed column", () => {
    const columns = Object.keys(users);
    expect(columns).toContain("campaignUnsubscribed");
  });

  it("has unsubscribeToken column", () => {
    const columns = Object.keys(users);
    expect(columns).toContain("unsubscribeToken");
  });
});

describe("insertCampaignSchema", () => {
  const validCampaign = {
    name: "Weekly Update",
    subject: "What's new this week",
    htmlBody: "<h1>News</h1>",
    status: "draft",
  };

  it("accepts valid campaign input", () => {
    const result = insertCampaignSchema.safeParse(validCampaign);
    expect(result.success).toBe(true);
  });

  it("rejects when name is missing", () => {
    const { name, ...rest } = validCampaign;
    const result = insertCampaignSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects when subject is missing", () => {
    const { subject, ...rest } = validCampaign;
    const result = insertCampaignSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects when htmlBody is missing", () => {
    const { htmlBody, ...rest } = validCampaign;
    const result = insertCampaignSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("strips id from input", () => {
    const result = insertCampaignSchema.safeParse({ ...validCampaign, id: 999 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("id" in result.data).toBe(false);
    }
  });

  it("strips totalRecipients from input", () => {
    const result = insertCampaignSchema.safeParse({ ...validCampaign, totalRecipients: 100 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("totalRecipients" in result.data).toBe(false);
    }
  });

  it("strips sentCount from input", () => {
    const result = insertCampaignSchema.safeParse({ ...validCampaign, sentCount: 50 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("sentCount" in result.data).toBe(false);
    }
  });

  it("strips failedCount from input", () => {
    const result = insertCampaignSchema.safeParse({ ...validCampaign, failedCount: 5 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("failedCount" in result.data).toBe(false);
    }
  });

  it("strips deliveredCount from input", () => {
    const result = insertCampaignSchema.safeParse({ ...validCampaign, deliveredCount: 40 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("deliveredCount" in result.data).toBe(false);
    }
  });

  it("strips openedCount from input", () => {
    const result = insertCampaignSchema.safeParse({ ...validCampaign, openedCount: 30 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("openedCount" in result.data).toBe(false);
    }
  });

  it("strips clickedCount from input", () => {
    const result = insertCampaignSchema.safeParse({ ...validCampaign, clickedCount: 10 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("clickedCount" in result.data).toBe(false);
    }
  });

  it("strips createdAt from input", () => {
    const result = insertCampaignSchema.safeParse({ ...validCampaign, createdAt: new Date() });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("createdAt" in result.data).toBe(false);
    }
  });

  it("strips sentAt from input", () => {
    const result = insertCampaignSchema.safeParse({ ...validCampaign, sentAt: new Date() });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("sentAt" in result.data).toBe(false);
    }
  });

  it("strips completedAt from input", () => {
    const result = insertCampaignSchema.safeParse({ ...validCampaign, completedAt: new Date() });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("completedAt" in result.data).toBe(false);
    }
  });

  it("accepts optional textBody", () => {
    const result = insertCampaignSchema.safeParse({
      ...validCampaign,
      textBody: "Plain text version",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.textBody).toBe("Plain text version");
    }
  });

  it("accepts optional scheduledAt", () => {
    const date = new Date("2025-06-01T12:00:00Z");
    const result = insertCampaignSchema.safeParse({
      ...validCampaign,
      scheduledAt: date,
    });
    expect(result.success).toBe(true);
  });
});
