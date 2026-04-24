import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock storage
const mockGetActiveAutomationSubscriptions = vi.fn();
const mockTouchAndResetAutomationSubscription = vi.fn().mockResolvedValue(undefined);
const mockIncrementAutomationSubscriptionFailures = vi.fn().mockResolvedValue(1);
const mockDeactivateAutomationSubscription = vi.fn().mockResolvedValue(true);
const mockAddDeliveryLog = vi.fn().mockResolvedValue({ id: 1 });
vi.mock("../storage", () => ({
  storage: {
    getActiveAutomationSubscriptions: (...args: any[]) => mockGetActiveAutomationSubscriptions(...args),
    touchAndResetAutomationSubscription: (...args: any[]) => mockTouchAndResetAutomationSubscription(...args),
    incrementAutomationSubscriptionFailures: (...args: any[]) => mockIncrementAutomationSubscriptionFailures(...args),
    deactivateAutomationSubscription: (...args: any[]) => mockDeactivateAutomationSubscription(...args),
    addDeliveryLog: (...args: any[]) => mockAddDeliveryLog(...args),
  },
}));

// Mock ssrf
const mockSsrfSafeFetch = vi.fn();
vi.mock("../utils/ssrf", () => ({
  ssrfSafeFetch: (...args: any[]) => mockSsrfSafeFetch(...args),
}));

// Mock logger
const mockLoggerInfo = vi.fn().mockResolvedValue(undefined);
const mockLoggerWarning = vi.fn().mockResolvedValue(undefined);
vi.mock("./logger", () => ({
  ErrorLogger: {
    info: (...args: any[]) => mockLoggerInfo(...args),
    warning: (...args: any[]) => mockLoggerWarning(...args),
  },
}));

import { deliverToAutomationSubscriptions } from "./automationDelivery";
import type { Monitor, MonitorChange, AutomationSubscription } from "@shared/schema";

function makeMonitor(): Monitor {
  return {
    id: 42,
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
    id: 100,
    monitorId: 42,
    oldValue: "$19.99",
    newValue: "$24.99",
    detectedAt: new Date("2024-01-01T00:00:00Z"),
  };
}

function makeSub(overrides?: Partial<AutomationSubscription>): AutomationSubscription {
  return {
    id: 1,
    userId: "user1",
    platform: "zapier",
    hookUrl: "https://hooks.zapier.com/abc123",
    monitorId: null,
    active: true,
    consecutiveFailures: 0,
    createdAt: new Date(),
    deactivatedAt: null,
    lastDeliveredAt: null,
    ...overrides,
  };
}

describe("deliverToAutomationSubscriptions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIncrementAutomationSubscriptionFailures.mockResolvedValue(1);
  });

  it("returns immediately when no active subscriptions", async () => {
    mockGetActiveAutomationSubscriptions.mockResolvedValue([]);
    await deliverToAutomationSubscriptions(makeMonitor(), makeChange());
    expect(mockSsrfSafeFetch).not.toHaveBeenCalled();
  });

  it("delivers to active subscriptions with correct headers and body", async () => {
    const sub = makeSub();
    mockGetActiveAutomationSubscriptions.mockResolvedValue([sub]);
    mockSsrfSafeFetch.mockResolvedValue({ ok: true, status: 200 });

    await deliverToAutomationSubscriptions(makeMonitor(), makeChange());

    expect(mockSsrfSafeFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockSsrfSafeFetch.mock.calls[0];
    expect(url).toBe("https://hooks.zapier.com/abc123");
    expect(opts.method).toBe("POST");
    expect(opts.headers["Content-Type"]).toBe("application/json");
    expect(opts.headers["User-Agent"]).toBe("FetchTheChange-Zapier/1.0");

    // No HMAC signature — automation hook URLs are unguessable bearer tokens
    expect(opts.headers["X-FTC-Signature-256"]).toBeUndefined();

    // Verify payload includes change id for Zapier dedup
    const body = JSON.parse(opts.body);
    expect(body.id).toBe(100);
    expect(body.monitorId).toBe(42);
    expect(body.monitorName).toBe("Test Monitor");
    expect(body.event).toBe("change.detected");
  });

  it("atomically touches and resets failures on success", async () => {
    const sub = makeSub({ id: 7 });
    mockGetActiveAutomationSubscriptions.mockResolvedValue([sub]);
    mockSsrfSafeFetch.mockResolvedValue({ ok: true, status: 200 });

    await deliverToAutomationSubscriptions(makeMonitor(), makeChange());

    expect(mockTouchAndResetAutomationSubscription).toHaveBeenCalledWith(7);
  });

  it("logs success via console.log, not ErrorLogger", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockGetActiveAutomationSubscriptions.mockResolvedValue([makeSub()]);
    mockSsrfSafeFetch.mockResolvedValue({ ok: true, status: 200 });

    await deliverToAutomationSubscriptions(makeMonitor(), makeChange());

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[Automation] Delivered successfully"),
    );
    expect(mockLoggerInfo).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("queues durable retry on transient 5xx response (does NOT bump failure counter)", async () => {
    mockGetActiveAutomationSubscriptions.mockResolvedValue([makeSub({ id: 3 })]);
    mockSsrfSafeFetch.mockResolvedValue({ ok: false, status: 500 });

    await deliverToAutomationSubscriptions(makeMonitor(), makeChange());

    expect(mockAddDeliveryLog).toHaveBeenCalledWith(expect.objectContaining({
      channel: "automation",
      status: "pending",
      attempt: 1,
      response: expect.objectContaining({ subscriptionId: 3, platform: "zapier", error: "HTTP 500", transient: true }),
    }));
    expect(mockIncrementAutomationSubscriptionFailures).not.toHaveBeenCalled();
    expect(mockTouchAndResetAutomationSubscription).not.toHaveBeenCalled();
  });

  it.each([408, 429])("queues durable retry on transient HTTP %s response", async (status) => {
    mockGetActiveAutomationSubscriptions.mockResolvedValue([makeSub({ id: 3 })]);
    mockSsrfSafeFetch.mockResolvedValue({ ok: false, status });

    await deliverToAutomationSubscriptions(makeMonitor(), makeChange());

    expect(mockAddDeliveryLog).toHaveBeenCalledWith(expect.objectContaining({
      channel: "automation",
      status: "pending",
      attempt: 1,
      response: expect.objectContaining({
        subscriptionId: 3,
        platform: "zapier",
        error: `HTTP ${status}`,
        transient: true,
      }),
    }));
    expect(mockIncrementAutomationSubscriptionFailures).not.toHaveBeenCalled();
    expect(mockTouchAndResetAutomationSubscription).not.toHaveBeenCalled();
  });

  it("queues durable retry on network error (does NOT bump failure counter)", async () => {
    mockGetActiveAutomationSubscriptions.mockResolvedValue([makeSub({ id: 3 })]);
    mockSsrfSafeFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    await deliverToAutomationSubscriptions(makeMonitor(), makeChange());

    expect(mockAddDeliveryLog).toHaveBeenCalledWith(expect.objectContaining({
      channel: "automation",
      status: "pending",
      response: expect.objectContaining({ error: "ECONNREFUSED", transient: true }),
    }));
    expect(mockIncrementAutomationSubscriptionFailures).not.toHaveBeenCalled();
  });

  it("increments consecutive failures on persistent 4xx response", async () => {
    mockGetActiveAutomationSubscriptions.mockResolvedValue([makeSub({ id: 3 })]);
    mockSsrfSafeFetch.mockResolvedValue({ ok: false, status: 404 });

    await deliverToAutomationSubscriptions(makeMonitor(), makeChange());

    expect(mockIncrementAutomationSubscriptionFailures).toHaveBeenCalledWith(3);
    expect(mockAddDeliveryLog).not.toHaveBeenCalled();
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Automation delivery failed"),
      expect.objectContaining({ error: "HTTP 404", consecutiveFailures: 1 }),
    );
  });

  it("sanitizes URLs from error messages to avoid leaking hookUrl secrets", async () => {
    mockGetActiveAutomationSubscriptions.mockResolvedValue([makeSub({ id: 3 })]);
    mockSsrfSafeFetch.mockRejectedValue(new Error("SSRF blocked: https://hooks.zapier.com/secret123"));

    await deliverToAutomationSubscriptions(makeMonitor(), makeChange());

    // Sanitization now happens in the transient-retry log entry
    const logged = mockAddDeliveryLog.mock.calls[0][0];
    expect(logged.response.error).not.toContain("hooks.zapier.com");
    expect(logged.response.error).toContain("[redacted-url]");
  });

  it("deactivates subscription after reaching failure threshold (persistent 4xx)", async () => {
    mockIncrementAutomationSubscriptionFailures.mockResolvedValue(15); // equals threshold
    mockGetActiveAutomationSubscriptions.mockResolvedValue([makeSub({ id: 9 })]);
    mockSsrfSafeFetch.mockResolvedValue({ ok: false, status: 410 });

    await deliverToAutomationSubscriptions(makeMonitor(), makeChange());

    expect(mockDeactivateAutomationSubscription).toHaveBeenCalledWith(9, "user1");
    expect(mockLoggerWarning).toHaveBeenCalledWith(
      "scheduler",
      expect.stringContaining("auto-deactivated"),
      expect.objectContaining({ consecutiveFailures: 15 }),
    );
  });

  it("does not deactivate subscription on transient 5xx (retry queued instead)", async () => {
    mockIncrementAutomationSubscriptionFailures.mockResolvedValue(14); // below threshold of 15
    mockGetActiveAutomationSubscriptions.mockResolvedValue([makeSub({ id: 9 })]);
    mockSsrfSafeFetch.mockResolvedValue({ ok: false, status: 500 });

    await deliverToAutomationSubscriptions(makeMonitor(), makeChange());

    expect(mockDeactivateAutomationSubscription).not.toHaveBeenCalled();
    expect(mockAddDeliveryLog).toHaveBeenCalled();
  });

  it("delivers to multiple subscriptions in parallel", async () => {
    const subs = [makeSub({ id: 1 }), makeSub({ id: 2, hookUrl: "https://hooks.zapier.com/def456" })];
    mockGetActiveAutomationSubscriptions.mockResolvedValue(subs);
    mockSsrfSafeFetch.mockResolvedValue({ ok: true, status: 200 });

    await deliverToAutomationSubscriptions(makeMonitor(), makeChange());

    expect(mockSsrfSafeFetch).toHaveBeenCalledTimes(2);
  });

  it("one failure does not prevent other deliveries", async () => {
    const subs = [makeSub({ id: 1 }), makeSub({ id: 2, hookUrl: "https://hooks.zapier.com/def456" })];
    mockGetActiveAutomationSubscriptions.mockResolvedValue(subs);
    mockSsrfSafeFetch
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce({ ok: true, status: 200 });

    await deliverToAutomationSubscriptions(makeMonitor(), makeChange());

    expect(mockSsrfSafeFetch).toHaveBeenCalledTimes(2);
    expect(mockTouchAndResetAutomationSubscription).toHaveBeenCalledWith(2);
  });
});
