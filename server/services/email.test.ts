import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Shared mock for Resend's emails.send - configured per test
const mockSend = vi.fn().mockResolvedValue({ data: { id: "email_123" }, error: null });

// Mock dependencies before importing
vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(function () {
    return { emails: { send: mockSend } };
  }),
}));

vi.mock("../replit_integrations/auth/storage", () => ({
  authStorage: {
    getUser: vi.fn().mockResolvedValue({
      id: "user1",
      email: "user@example.com",
      notificationEmail: null,
      tier: "free",
    }),
  },
}));

vi.mock("./logger", () => ({
  ErrorLogger: {
    error: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("./resendTracker", () => ({
  ResendUsageTracker: {
    canSendEmail: vi.fn().mockResolvedValue({ allowed: true }),
    recordUsage: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../db", () => ({
  db: {
    execute: vi.fn().mockResolvedValue({ rows: [{ count: 0 }] }),
  },
}));

vi.mock("drizzle-orm", () => ({
  sql: (strings: TemplateStringsArray, ...values: any[]) => ({ strings, values }),
}));

import { sendAutoPauseEmail } from "./email";
import { authStorage } from "../replit_integrations/auth/storage";
import { ResendUsageTracker } from "./resendTracker";
import { ErrorLogger } from "./logger";
import type { Monitor } from "@shared/schema";

function makeMonitor(overrides: Partial<Monitor> = {}): Monitor {
  return {
    id: 1,
    userId: "user1",
    name: "Test Monitor",
    url: "https://example.com",
    selector: ".price",
    frequency: "daily",
    lastChecked: null,
    lastChanged: null,
    currentValue: null,
    lastStatus: "ok",
    lastError: null,
    active: false,
    emailEnabled: true,
    consecutiveFailures: 3,
    pauseReason: "Auto-paused after 3 consecutive failures",
    createdAt: new Date(),
    ...overrides,
  };
}

describe("sendAutoPauseEmail", () => {
  const originalResendKey = process.env.RESEND_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RESEND_API_KEY = "re_test_key";
    // Reset default successful send
    mockSend.mockResolvedValue({ data: { id: "email_123" }, error: null });
  });

  afterEach(() => {
    if (originalResendKey !== undefined) {
      process.env.RESEND_API_KEY = originalResendKey;
    } else {
      delete process.env.RESEND_API_KEY;
    }
  });

  it("returns early when Resend usage cap is reached", async () => {
    vi.mocked(ResendUsageTracker.canSendEmail).mockResolvedValueOnce({
      allowed: false,
      reason: "Monthly cap reached",
    });

    const result = await sendAutoPauseEmail(makeMonitor(), 3, "timeout");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Monthly cap reached");
    // Should not attempt to send
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("returns early when RESEND_API_KEY is not set", async () => {
    delete process.env.RESEND_API_KEY;

    const result = await sendAutoPauseEmail(makeMonitor(), 3, "timeout");

    expect(result.success).toBe(false);
    expect(result.error).toBe("RESEND_API_KEY not configured");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("returns error when user has no email", async () => {
    vi.mocked(authStorage.getUser).mockResolvedValueOnce({
      id: "user1",
      email: null,
      firstName: null,
      lastName: null,
      profileImageUrl: null,
      tier: "free",
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      notificationEmail: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await sendAutoPauseEmail(makeMonitor(), 3, "timeout");

    expect(result.success).toBe(false);
    expect(result.error).toBe("User has no email address");
  });

  it("sends email with correct subject and failure count", async () => {
    mockSend.mockResolvedValueOnce({ data: { id: "email_456" }, error: null });

    const monitor = makeMonitor({ name: "Price Tracker" });
    const result = await sendAutoPauseEmail(monitor, 5, "DNS resolution failed");

    expect(result.success).toBe(true);
    expect(result.id).toBe("email_456");
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "user@example.com",
        subject: expect.stringContaining("Price Tracker"),
        text: expect.stringContaining("5 consecutive failures"),
        html: expect.stringContaining("5"),
      })
    );
  });

  it("uses notificationEmail when available", async () => {
    vi.mocked(authStorage.getUser).mockResolvedValueOnce({
      id: "user1",
      email: "user@example.com",
      firstName: null,
      lastName: null,
      profileImageUrl: null,
      tier: "free",
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      notificationEmail: "alerts@example.com",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await sendAutoPauseEmail(makeMonitor(), 3, "timeout");

    expect(result.success).toBe(true);
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ to: "alerts@example.com" })
    );
  });

  it("includes last error in email body", async () => {
    await sendAutoPauseEmail(makeMonitor(), 3, "Connection refused");

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("Connection refused"),
        html: expect.stringContaining("Connection refused"),
      })
    );
  });

  it("records usage on successful send", async () => {
    mockSend.mockResolvedValueOnce({ data: { id: "email_200" }, error: null });

    await sendAutoPauseEmail(makeMonitor(), 3, "timeout");

    expect(ResendUsageTracker.recordUsage).toHaveBeenCalledWith(
      "user1", 1, "user@example.com", "email_200", true
    );
  });

  it("records failed usage when Resend returns an error", async () => {
    mockSend.mockResolvedValueOnce({
      data: null,
      error: { message: "Invalid recipient" },
    });

    const result = await sendAutoPauseEmail(makeMonitor(), 3, "timeout");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Invalid recipient");
    expect(ResendUsageTracker.recordUsage).toHaveBeenCalledWith(
      "user1", 1, "user@example.com", undefined, false
    );
  });

  it("handles thrown exceptions from Resend gracefully", async () => {
    mockSend.mockRejectedValueOnce(new Error("Network error"));

    const result = await sendAutoPauseEmail(makeMonitor(), 3, "timeout");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Network error");
    expect(ErrorLogger.error).toHaveBeenCalledWith(
      "email",
      expect.stringContaining("auto-pause email failed"),
      expect.any(Error),
      expect.objectContaining({ monitorId: 1 })
    );
  });

  it("sanitizes monitor name in subject to prevent header injection", async () => {
    const monitor = makeMonitor({ name: "Evil\r\nBcc: hacker@evil.com" });
    await sendAutoPauseEmail(monitor, 3, "timeout");

    const call = mockSend.mock.calls[0][0];
    // Subject should not contain newlines
    expect(call.subject).not.toMatch(/[\r\n]/);
  });

  it("escapes HTML in monitor name for html email body", async () => {
    const monitor = makeMonitor({ name: '<script>alert("xss")</script>' });
    await sendAutoPauseEmail(monitor, 3, "timeout");

    const call = mockSend.mock.calls[0][0];
    expect(call.html).not.toContain("<script>");
    expect(call.html).toContain("&lt;script&gt;");
  });
});
