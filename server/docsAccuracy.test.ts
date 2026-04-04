import { describe, it, expect, beforeAll } from "vitest";
import { createHmac } from "node:crypto";
import { signPayload, buildWebhookPayload, type WebhookPayload } from "./services/webhookDelivery";
import type { Monitor, MonitorChange } from "@shared/schema";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Tests that verify documentation accuracy against the actual codebase.
 * These ensure the /docs/webhooks page, Support FAQ, Pricing, UpgradeDialog,
 * and BlogComparison pages stay in sync with production behaviour.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readClientFile(relativePath: string): string {
  return fs.readFileSync(
    path.resolve(__dirname, "..", "client", "src", relativePath),
    "utf-8"
  );
}

function sliceSection(source: string, startToken: string, endToken: string): string {
  const start = source.indexOf(startToken);
  expect(start, `Missing start token: ${startToken}`).toBeGreaterThanOrEqual(0);
  const end = source.indexOf(endToken, start + startToken.length);
  expect(end, `Missing end token: ${endToken}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

function makeMonitor(): Monitor {
  return {
    id: 42,
    userId: "user1",
    name: "Competitor pricing page",
    url: "https://example.com/pricing",
    selector: ".price",
    frequency: "daily",
    lastChecked: null,
    lastChanged: null,
    currentValue: null,
    lastStatus: "ok",
    lastError: null,
    active: true,
    emailEnabled: true,
    consecutiveFailures: 0,
    pauseReason: null,
    healthAlertSentAt: null,
    lastHealthyAt: null,
    createdAt: new Date(),
  };
}

function makeChange(): MonitorChange {
  return {
    id: 1,
    monitorId: 42,
    oldValue: "$49/mo",
    newValue: "$59/mo",
    detectedAt: new Date("2025-11-14T09:03:22.000Z"),
  };
}

// ---------------------------------------------------------------------------
// Docs webhook payload example vs actual WebhookPayload type
// ---------------------------------------------------------------------------

describe("DocsWebhooks payload example accuracy", () => {
  const docsSource = readClientFile("pages/DocsWebhooks.tsx");
  let examplePayload: WebhookPayload;

  beforeAll(() => {
    const jsonMatch = docsSource.match(
      /\{[^`]*"event"\s*:\s*"change\.detected"[^`]*\}/s
    );
    expect(jsonMatch, "JSON payload example not found in DocsWebhooks.tsx").not.toBeNull();
    examplePayload = JSON.parse(jsonMatch![0]) as WebhookPayload;
  });

  it("example payload has exactly the same keys as WebhookPayload", () => {
    const expectedKeys: (keyof WebhookPayload)[] = [
      "event",
      "monitorId",
      "monitorName",
      "url",
      "oldValue",
      "newValue",
      "detectedAt",
      "timestamp",
    ];
    expect(Object.keys(examplePayload).sort()).toEqual(
      [...expectedKeys].sort()
    );
  });

  it("example event field is 'change.detected'", () => {
    expect(examplePayload.event).toBe("change.detected");
  });

  it("example monitorId is a number", () => {
    expect(typeof examplePayload.monitorId).toBe("number");
  });

  it("example detectedAt is a valid ISO 8601 string", () => {
    const d = new Date(examplePayload.detectedAt);
    expect(d.toISOString()).toBe(examplePayload.detectedAt);
  });

  it("example timestamp is a valid ISO 8601 string", () => {
    const d = new Date(examplePayload.timestamp);
    expect(d.toISOString()).toBe(examplePayload.timestamp);
  });

  it("buildWebhookPayload output matches the documented field set", () => {
    const payload = buildWebhookPayload(makeMonitor(), makeChange());
    expect(Object.keys(payload).sort()).toEqual(
      Object.keys(examplePayload).sort()
    );
    // Values should match for the static fields
    expect(payload.event).toBe(examplePayload.event);
    expect(payload.monitorId).toBe(examplePayload.monitorId);
    expect(payload.monitorName).toBe(examplePayload.monitorName);
    expect(payload.url).toBe(examplePayload.url);
    expect(payload.oldValue).toBe(examplePayload.oldValue);
    expect(payload.newValue).toBe(examplePayload.newValue);
  });
});

// ---------------------------------------------------------------------------
// Docs Node.js verification example vs actual signPayload
// ---------------------------------------------------------------------------

describe("DocsWebhooks signature verification example", () => {
  const docsSource = readClientFile("pages/DocsWebhooks.tsx");

  it("documents the correct signature header name (X-FTC-Signature-256)", () => {
    expect(docsSource).toContain("X-FTC-Signature-256");
  });

  it("Node.js verification example produces the same result as signPayload", () => {
    // Reproduce the documented Node.js verification logic
    const secret = "test-secret-for-docs";
    const rawBody = JSON.stringify({ event: "change.detected", test: true });

    // signPayload from the actual codebase
    const actualSignature = signPayload(rawBody, secret);

    // Documented verification logic
    const expected =
      "sha256=" +
      createHmac("sha256", secret).update(rawBody).digest("hex");

    expect(actualSignature).toBe(expected);
  });

  it("documents sha256= prefix format matching actual signPayload output", () => {
    const sig = signPayload('{"test":"data"}', "secret");
    expect(sig).toMatch(/^sha256=[a-f0-9]{64}$/);
    // Docs should reference the same prefix
    expect(docsSource).toContain('"sha256="');
  });
});

// ---------------------------------------------------------------------------
// Support FAQ content accuracy
// ---------------------------------------------------------------------------

describe("Support FAQ documentation accuracy", () => {
  const supportSource = readClientFile("pages/Support.tsx");

  it("has a Notification Preferences FAQ section", () => {
    expect(supportSource).toContain('"Notification Preferences"');
  });

  it("has a Webhooks & Slack FAQ section", () => {
    expect(supportSource).toContain('"Webhooks & Slack"');
  });

  it("Notification Preferences section has 5 FAQ items", () => {
    const section = sliceSection(supportSource, '"Notification Preferences"', '"Tags"');
    const questionCount = (section.match(/question:/g) || []).length;
    expect(questionCount).toBe(5);
  });

  it("has a Tags FAQ section", () => {
    expect(supportSource).toContain('"Tags"');
  });

  it("Tags section has 5 FAQ items", () => {
    const section = sliceSection(supportSource, '"Tags"', '"Monitor Health"');
    const questionCount = (section.match(/question:/g) || []).length;
    expect(questionCount).toBe(5);
  });

  it("Webhooks & Slack section has 8 FAQ items", () => {
    const section = sliceSection(supportSource, '"Webhooks & Slack"', '"API Access"');
    const questionCount = (section.match(/question:/g) || []).length;
    expect(questionCount).toBe(8);
  });

  it("API Access section has 5 FAQ items", () => {
    const section = sliceSection(supportSource, '"API Access"', '"Zapier & Make"');
    const questionCount = (section.match(/question:/g) || []).length;
    expect(questionCount).toBe(5);
  });

  it("has a Zapier & Make FAQ section", () => {
    expect(supportSource).toContain('"Zapier & Make"');
  });

  it("Zapier & Make section has 6 FAQ items", () => {
    const section = sliceSection(supportSource, '"Zapier & Make"', '"Troubleshooting"');
    const questionCount = (section.match(/question:/g) || []).length;
    expect(questionCount).toBe(6);
  });

  it("references the correct signature header in FAQ", () => {
    expect(supportSource).toContain("X-FTC-Signature-256");
  });

  it("references the correct webhook payload fields in FAQ", () => {
    expect(supportSource).toContain("change.detected");
    expect(supportSource).toContain("monitorId");
    expect(supportSource).toContain("monitorName");
    expect(supportSource).toContain("oldValue");
    expect(supportSource).toContain("newValue");
    expect(supportSource).toContain("detectedAt");
    expect(supportSource).toContain("timestamp");
  });

  it("preserves the original General section", () => {
    expect(supportSource).toContain('"General"');
    expect(supportSource).toContain("What is FetchTheChange?");
  });

  it("preserves the original Troubleshooting section", () => {
    expect(supportSource).toContain('"Troubleshooting"');
    expect(supportSource).toContain("selector not found");
  });

  it("preserves the original Account & Billing section", () => {
    expect(supportSource).toContain('"Account & Billing"');
    expect(supportSource).toContain("How do I upgrade my plan?");
  });

  it("has a Monitor Health FAQ section", () => {
    expect(supportSource).toContain('"Monitor Health"');
  });

  it("Monitor Health section has 6 FAQ items", () => {
    const section = sliceSection(supportSource, '"Monitor Health"', '"Alert Conditions"');
    const questionCount = (section.match(/question:/g) || []).length;
    expect(questionCount).toBe(6);
  });

  it("has an Alert Conditions FAQ section", () => {
    expect(supportSource).toContain('"Alert Conditions"');
  });

  it("Alert Conditions section has 7 FAQ items", () => {
    const section = sliceSection(supportSource, '"Alert Conditions"', '"Webhooks & Slack"');
    const questionCount = (section.match(/question:/g) || []).length;
    expect(questionCount).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// Pricing page feature lists
// ---------------------------------------------------------------------------

describe("Pricing page feature list accuracy", () => {
  const pricingSource = readClientFile("pages/Pricing.tsx");

  it("Free plan does not list webhook or Slack features", () => {
    const freeSection = sliceSection(pricingSource, '"Free"', '"Pro"');
    expect(freeSection).not.toContain("Webhook");
    expect(freeSection).not.toContain("Slack");
    expect(freeSection).not.toContain("Quiet hours");
  });

  it("Pro plan lists webhook delivery", () => {
    const proSection = sliceSection(pricingSource, '"Pro"', '"Power"');
    expect(proSection).toContain("Webhook delivery (HMAC-signed)");
  });

  it("Pro plan lists Slack integration", () => {
    const proSection = sliceSection(pricingSource, '"Pro"', '"Power"');
    expect(proSection).toContain("Slack integration");
  });

  it("Pro plan lists quiet hours & daily digest mode", () => {
    const proSection = sliceSection(pricingSource, '"Pro"', '"Power"');
    expect(proSection).toContain("Quiet hours & daily digest mode");
  });

  it("Pro plan lists per-monitor notification email override", () => {
    const proSection = sliceSection(pricingSource, '"Pro"', '"Power"');
    expect(proSection).toContain("Per-monitor notification email override");
  });

  it("Pro plan does NOT list sensitivity threshold", () => {
    const proSection = sliceSection(pricingSource, '"Pro"', '"Power"');
    expect(proSection).not.toContain("sensitivity threshold");
  });

  it("Power plan lists sensitivity threshold", () => {
    const powerStart = pricingSource.indexOf('"Power"');
    const powerSection = pricingSource.slice(powerStart);
    expect(powerSection).toContain("Change sensitivity threshold");
  });

  it("Power plan lists webhook, Slack, and notification features", () => {
    const powerStart = pricingSource.indexOf('"Power"');
    const powerSection = pricingSource.slice(powerStart);
    expect(powerSection).toContain("Webhook delivery (HMAC-signed)");
    expect(powerSection).toContain("Slack integration");
    expect(powerSection).toContain("Quiet hours & daily digest mode");
    expect(powerSection).toContain("Per-monitor notification email override");
  });

  it("Power plan lists monitor health alerts", () => {
    const powerStart = pricingSource.indexOf('"Power"');
    const powerSection = pricingSource.slice(powerStart);
    expect(powerSection).toContain("Monitor health alerts");
  });

  it("Free and Pro plans do not list monitor health alerts", () => {
    const freeToPower = pricingSource.slice(0, pricingSource.indexOf('"Power"'));
    expect(freeToPower).not.toContain("Monitor health alerts");
  });

  it("Power plan lists Zapier integration", () => {
    const powerStart = pricingSource.indexOf('"Power"');
    const powerSection = pricingSource.slice(powerStart);
    expect(powerSection).toContain("Zapier");
  });

  it("Free and Pro plans do not list Zapier integration", () => {
    const freeToPower = pricingSource.slice(0, pricingSource.indexOf('"Power"'));
    expect(freeToPower).not.toContain("Zapier");
  });

  it("Free plan mentions 1 condition limit", () => {
    const freeSection = sliceSection(pricingSource, '"Free"', '"Pro"');
    expect(freeSection).toContain("condition");
  });

  it("Pro plan lists unlimited alert conditions", () => {
    const proSection = sliceSection(pricingSource, '"Pro"', '"Power"');
    expect(proSection).toContain("conditions");
  });

  it("Power plan lists alert conditions with AND/OR logic", () => {
    const powerStart = pricingSource.indexOf('"Power"');
    const powerSection = pricingSource.slice(powerStart);
    expect(powerSection).toContain("AND/OR");
  });
});

// ---------------------------------------------------------------------------
// UpgradeDialog feature lists
// ---------------------------------------------------------------------------

describe("UpgradeDialog feature list consistency with Pricing", () => {
  const upgradeSource = readClientFile("components/UpgradeDialog.tsx");

  it("pro features include webhook & Slack", () => {
    const proSection = sliceSection(upgradeSource, "pro: [", "],");
    expect(proSection).toContain("webhook & Slack");
  });

  it("power features include webhook & Slack", () => {
    const powerSection = sliceSection(upgradeSource, "power: [", "],");
    expect(powerSection).toContain("webhook & Slack");
  });

  it("power features include sensitivity threshold", () => {
    const powerSection = sliceSection(upgradeSource, "power: [", "],");
    expect(powerSection).toContain("sensitivity threshold");
  });

  it("pro features do NOT include sensitivity threshold", () => {
    const proSection = sliceSection(upgradeSource, "pro: [", "],");
    expect(proSection).not.toContain("sensitivity threshold");
  });

  it("power features include monitor health alerts", () => {
    const powerSection = sliceSection(upgradeSource, "power: [", "],");
    expect(powerSection).toContain("health alerts");
  });

  it("pro features do not include monitor health alerts", () => {
    const proSection = sliceSection(upgradeSource, "pro: [", "],");
    expect(proSection).not.toContain("health alerts");
  });

  it("power features include Zapier", () => {
    const powerSection = sliceSection(upgradeSource, "power: [", "],");
    expect(powerSection).toContain("Zapier");
  });

  it("pro features do not include Zapier", () => {
    const proSection = sliceSection(upgradeSource, "pro: [", "],");
    expect(proSection).not.toContain("Zapier");
  });

  it("pro features include unlimited alert conditions", () => {
    const proSection = sliceSection(upgradeSource, "pro: [", "],");
    expect(proSection).toContain("conditions");
  });

  it("power features include alert conditions with AND/OR", () => {
    const powerSection = sliceSection(upgradeSource, "power: [", "],");
    expect(powerSection).toContain("AND/OR");
  });
});

// ---------------------------------------------------------------------------
// BlogComparison page corrections
// ---------------------------------------------------------------------------

describe("BlogComparison integration claims", () => {
  const blogSource = readClientFile("pages/BlogComparison.tsx");

  it("FetchTheChange integrations cell lists Email, webhooks, Slack", () => {
    expect(blogSource).toContain("Email, webhooks, Slack");
  });

  it("does NOT claim FetchTheChange is email-only", () => {
    expect(blogSource).not.toContain("email only for now");
    expect(blogSource).not.toContain("(email only");
  });

  it("mentions webhook and Slack integrations in strengths list", () => {
    expect(blogSource).toContain(
      "Webhook and Slack integrations on top of email"
    );
  });
});

// ---------------------------------------------------------------------------
// App.tsx route registration
// ---------------------------------------------------------------------------

describe("App.tsx webhook docs route", () => {
  const appSource = readClientFile("App.tsx");

  it("imports DocsWebhooks page", () => {
    expect(appSource).toContain('import DocsWebhooks from "@/pages/DocsWebhooks"');
  });

  it("registers /docs/webhooks route", () => {
    expect(appSource).toContain('/docs/webhooks');
    expect(appSource).toContain("DocsWebhooks");
  });
});

describe("App.tsx Zapier and Make docs routes", () => {
  const appSource = readClientFile("App.tsx");

  it("registers /docs/zapier route", () => {
    expect(appSource).toContain('/docs/zapier');
    expect(appSource).toContain("DocsZapier");
  });

  it("registers /docs/make route", () => {
    expect(appSource).toContain('/docs/make');
    expect(appSource).toContain("DocsMake");
  });
});
