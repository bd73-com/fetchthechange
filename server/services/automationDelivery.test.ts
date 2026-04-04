import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock storage
const mockGetActiveAutomationSubscriptions = vi.fn();
const mockTouchAutomationSubscription = vi.fn().mockResolvedValue(undefined);
vi.mock("../storage", () => ({
  storage: {
    getActiveAutomationSubscriptions: (...args: any[]) => mockGetActiveAutomationSubscriptions(...args),
    touchAutomationSubscription: (...args: any[]) => mockTouchAutomationSubscription(...args),
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
    createdAt: new Date(),
    lastDeliveredAt: null,
    ...overrides,
  };
}

describe("deliverToAutomationSubscriptions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    // Verify no HMAC signature header
    expect(opts.headers["X-FTC-Signature-256"]).toBeUndefined();

    // Verify payload includes change id for Zapier dedup
    const body = JSON.parse(opts.body);
    expect(body.id).toBe(100);
    expect(body.monitorId).toBe(42);
    expect(body.monitorName).toBe("Test Monitor");
    expect(body.event).toBe("change.detected");
  });

  it("calls touchAutomationSubscription on success", async () => {
    const sub = makeSub({ id: 7 });
    mockGetActiveAutomationSubscriptions.mockResolvedValue([sub]);
    mockSsrfSafeFetch.mockResolvedValue({ ok: true, status: 200 });

    await deliverToAutomationSubscriptions(makeMonitor(), makeChange());

    expect(mockTouchAutomationSubscription).toHaveBeenCalledWith(7);
  });

  it("logs info on success", async () => {
    mockGetActiveAutomationSubscriptions.mockResolvedValue([makeSub()]);
    mockSsrfSafeFetch.mockResolvedValue({ ok: true, status: 200 });

    await deliverToAutomationSubscriptions(makeMonitor(), makeChange());

    expect(mockLoggerInfo).toHaveBeenCalledWith(
      "scheduler",
      expect.stringContaining("Automation delivery succeeded"),
      expect.objectContaining({ platform: "zapier", statusCode: 200 }),
    );
  });

  it("logs warning on non-2xx response", async () => {
    mockGetActiveAutomationSubscriptions.mockResolvedValue([makeSub()]);
    mockSsrfSafeFetch.mockResolvedValue({ ok: false, status: 500 });

    await deliverToAutomationSubscriptions(makeMonitor(), makeChange());

    expect(mockLoggerWarning).toHaveBeenCalledWith(
      "scheduler",
      expect.stringContaining("Automation delivery failed"),
      expect.objectContaining({ error: "HTTP 500" }),
    );
    expect(mockTouchAutomationSubscription).not.toHaveBeenCalled();
  });

  it("logs warning on network error without throwing", async () => {
    mockGetActiveAutomationSubscriptions.mockResolvedValue([makeSub()]);
    mockSsrfSafeFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    await deliverToAutomationSubscriptions(makeMonitor(), makeChange());

    expect(mockLoggerWarning).toHaveBeenCalledWith(
      "scheduler",
      expect.stringContaining("Automation delivery failed"),
      expect.objectContaining({ error: "ECONNREFUSED" }),
    );
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
    expect(mockTouchAutomationSubscription).toHaveBeenCalledWith(2);
  });
});
