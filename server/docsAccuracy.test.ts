import { describe, it, expect } from "vitest";
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

  // Extract the JSON example from the docs page source
  const jsonMatch = docsSource.match(
    /\{[^`]*"event"\s*:\s*"change\.detected"[^`]*\}/s
  );

  it("contains a JSON payload example", () => {
    expect(jsonMatch).not.toBeNull();
  });

  const examplePayload = jsonMatch ? JSON.parse(jsonMatch[0]) : null;

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
    expect(Object.keys(examplePayload!).sort()).toEqual(
      [...expectedKeys].sort()
    );
  });

  it("example event field is 'change.detected'", () => {
    expect(examplePayload!.event).toBe("change.detected");
  });

  it("example monitorId is a number", () => {
    expect(typeof examplePayload!.monitorId).toBe("number");
  });

  it("example detectedAt is a valid ISO 8601 string", () => {
    const d = new Date(examplePayload!.detectedAt);
    expect(d.toISOString()).toBe(examplePayload!.detectedAt);
  });

  it("example timestamp is a valid ISO 8601 string", () => {
    const d = new Date(examplePayload!.timestamp);
    expect(d.toISOString()).toBe(examplePayload!.timestamp);
  });

  it("buildWebhookPayload output matches the documented field set", () => {
    const payload = buildWebhookPayload(makeMonitor(), makeChange());
    expect(Object.keys(payload).sort()).toEqual(
      Object.keys(examplePayload!).sort()
    );
    // Values should match for the static fields
    expect(payload.event).toBe(examplePayload!.event);
    expect(payload.monitorId).toBe(examplePayload!.monitorId);
    expect(payload.monitorName).toBe(examplePayload!.monitorName);
    expect(payload.url).toBe(examplePayload!.url);
    expect(payload.oldValue).toBe(examplePayload!.oldValue);
    expect(payload.newValue).toBe(examplePayload!.newValue);
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
    // Extract the section between title "Notification Preferences" and the next section
    const sectionStart = supportSource.indexOf('"Notification Preferences"');
    const sectionEnd = supportSource.indexOf('"Webhooks & Slack"');
    const section = supportSource.slice(sectionStart, sectionEnd);
    const questionCount = (section.match(/question:/g) || []).length;
    expect(questionCount).toBe(5);
  });

  it("Webhooks & Slack section has 8 FAQ items", () => {
    const sectionStart = supportSource.indexOf('"Webhooks & Slack"');
    const sectionEnd = supportSource.indexOf('"Troubleshooting"');
    const section = supportSource.slice(sectionStart, sectionEnd);
    const questionCount = (section.match(/question:/g) || []).length;
    expect(questionCount).toBe(8);
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
});

// ---------------------------------------------------------------------------
// Pricing page feature lists
// ---------------------------------------------------------------------------

describe("Pricing page feature list accuracy", () => {
  const pricingSource = readClientFile("pages/Pricing.tsx");

  it("Free plan does not list webhook or Slack features", () => {
    // Extract the Free plan block (from "Free" to the next plan "Pro")
    const freeStart = pricingSource.indexOf('"Free"');
    const proStart = pricingSource.indexOf('"Pro"');
    const freeSection = pricingSource.slice(freeStart, proStart);
    expect(freeSection).not.toContain("Webhook");
    expect(freeSection).not.toContain("Slack");
    expect(freeSection).not.toContain("Quiet hours");
  });

  it("Pro plan lists webhook delivery", () => {
    const proStart = pricingSource.indexOf('"Pro"');
    const powerStart = pricingSource.indexOf('"Power"');
    const proSection = pricingSource.slice(proStart, powerStart);
    expect(proSection).toContain("Webhook delivery (HMAC-signed)");
  });

  it("Pro plan lists Slack integration", () => {
    const proStart = pricingSource.indexOf('"Pro"');
    const powerStart = pricingSource.indexOf('"Power"');
    const proSection = pricingSource.slice(proStart, powerStart);
    expect(proSection).toContain("Slack integration");
  });

  it("Pro plan lists quiet hours & daily digest mode", () => {
    const proStart = pricingSource.indexOf('"Pro"');
    const powerStart = pricingSource.indexOf('"Power"');
    const proSection = pricingSource.slice(proStart, powerStart);
    expect(proSection).toContain("Quiet hours & daily digest mode");
  });

  it("Pro plan lists per-monitor notification email override", () => {
    const proStart = pricingSource.indexOf('"Pro"');
    const powerStart = pricingSource.indexOf('"Power"');
    const proSection = pricingSource.slice(proStart, powerStart);
    expect(proSection).toContain("Per-monitor notification email override");
  });

  it("Pro plan does NOT list sensitivity threshold", () => {
    const proStart = pricingSource.indexOf('"Pro"');
    const powerStart = pricingSource.indexOf('"Power"');
    const proSection = pricingSource.slice(proStart, powerStart);
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
});

// ---------------------------------------------------------------------------
// UpgradeDialog feature lists
// ---------------------------------------------------------------------------

describe("UpgradeDialog feature list consistency with Pricing", () => {
  const upgradeSource = readClientFile("components/UpgradeDialog.tsx");

  it("pro features include webhook & Slack", () => {
    const proStart = upgradeSource.indexOf("pro: [");
    const proEnd = upgradeSource.indexOf("],", proStart);
    const proSection = upgradeSource.slice(proStart, proEnd);
    expect(proSection).toContain("webhook & Slack");
  });

  it("power features include webhook & Slack", () => {
    const powerStart = upgradeSource.indexOf("power: [");
    const powerEnd = upgradeSource.indexOf("],", powerStart);
    const powerSection = upgradeSource.slice(powerStart, powerEnd);
    expect(powerSection).toContain("webhook & Slack");
  });

  it("power features include sensitivity threshold", () => {
    const powerStart = upgradeSource.indexOf("power: [");
    const powerEnd = upgradeSource.indexOf("],", powerStart);
    const powerSection = upgradeSource.slice(powerStart, powerEnd);
    expect(powerSection).toContain("sensitivity threshold");
  });

  it("pro features do NOT include sensitivity threshold", () => {
    const proStart = upgradeSource.indexOf("pro: [");
    const proEnd = upgradeSource.indexOf("],", proStart);
    const proSection = upgradeSource.slice(proStart, proEnd);
    expect(proSection).not.toContain("sensitivity threshold");
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
