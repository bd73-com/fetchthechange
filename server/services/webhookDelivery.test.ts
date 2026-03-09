import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";

// Mock ssrf module
const mockIsPrivateUrl = vi.fn().mockResolvedValue(null);
const mockSsrfSafeFetch = vi.fn();
vi.mock("../utils/ssrf", () => ({
  isPrivateUrl: (...args: any[]) => mockIsPrivateUrl(...args),
  ssrfSafeFetch: (...args: any[]) => mockSsrfSafeFetch(...args),
}));

// Alias for tests that reference mockFetch
const mockFetch = mockSsrfSafeFetch;

import {
  deliver,
  buildWebhookPayload,
  signPayload,
  generateWebhookSecret,
  redactSecret,
  type WebhookConfig,
} from "./webhookDelivery";
import type { Monitor, MonitorChange } from "@shared/schema";

function makeMonitor(): Monitor {
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
    monitorId: 1,
    oldValue: "$19.99",
    newValue: "$24.99",
    detectedAt: new Date("2024-01-01T00:00:00Z"),
  };
}

const testConfig: WebhookConfig = {
  url: "https://hooks.example.com/webhook",
  secret: "whsec_abc123",
  headers: {},
};

describe("webhookDelivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsPrivateUrl.mockResolvedValue(null);
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
    });
  });

  describe("buildWebhookPayload", () => {
    it("builds correct payload structure", () => {
      const monitor = makeMonitor();
      const change = makeChange();
      const payload = buildWebhookPayload(monitor, change);

      expect(payload.event).toBe("change.detected");
      expect(payload.monitorId).toBe(1);
      expect(payload.monitorName).toBe("Test Monitor");
      expect(payload.url).toBe("https://example.com");
      expect(payload.oldValue).toBe("$19.99");
      expect(payload.newValue).toBe("$24.99");
      expect(payload.detectedAt).toBeDefined();
      expect(payload.timestamp).toBeDefined();
    });
  });

  describe("signPayload", () => {
    it("computes correct HMAC-SHA256 signature", () => {
      const body = '{"test":"data"}';
      const secret = "test-secret";
      const signature = signPayload(body, secret);

      const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
      expect(signature).toBe(expected);
    });

    it("produces different signatures for different secrets", () => {
      const body = '{"test":"data"}';
      const sig1 = signPayload(body, "secret1");
      const sig2 = signPayload(body, "secret2");
      expect(sig1).not.toBe(sig2);
    });
  });

  describe("generateWebhookSecret", () => {
    it("generates secret with whsec_ prefix", () => {
      const secret = generateWebhookSecret();
      expect(secret).toMatch(/^whsec_[a-f0-9]{64}$/);
    });

    it("generates unique secrets", () => {
      const a = generateWebhookSecret();
      const b = generateWebhookSecret();
      expect(a).not.toBe(b);
    });
  });

  describe("redactSecret", () => {
    it("returns redacted placeholder", () => {
      expect(redactSecret("whsec_abc123")).toBe("whsec_****...****");
    });
  });

  describe("deliver", () => {
    it("succeeds on 200 response", async () => {
      const result = await deliver(makeMonitor(), makeChange(), testConfig);
      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
    });

    it("sends correct headers", async () => {
      await deliver(makeMonitor(), makeChange(), testConfig);

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe("https://hooks.example.com/webhook");
      expect(options.headers["Content-Type"]).toBe("application/json");
      expect(options.headers["User-Agent"]).toBe("FetchTheChange-Webhook/1.0");
      expect(options.headers["X-FTC-Signature-256"]).toMatch(/^sha256=[a-f0-9]+$/);
    });

    it("blocks private URLs via SSRF check", async () => {
      mockIsPrivateUrl.mockResolvedValue("Private IP detected");

      const result = await deliver(makeMonitor(), makeChange(), testConfig);
      expect(result.success).toBe(false);
      expect(result.error).toContain("SSRF blocked");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("handles non-ok response", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500 });

      const result = await deliver(makeMonitor(), makeChange(), testConfig);
      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(500);
      expect(result.error).toBe("HTTP 500");
    });

    it("handles timeout/abort", async () => {
      mockFetch.mockRejectedValue(new Error("The operation was aborted"));

      const result = await deliver(makeMonitor(), makeChange(), testConfig);
      expect(result.success).toBe(false);
      expect(result.error).toContain("timed out");
    });

    it("handles network error", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      const result = await deliver(makeMonitor(), makeChange(), testConfig);
      expect(result.success).toBe(false);
      expect(result.error).toBe("Network error");
    });

    it("includes custom headers from config", async () => {
      const config: WebhookConfig = {
        ...testConfig,
        headers: { "X-Custom": "value" },
      };
      await deliver(makeMonitor(), makeChange(), config);

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers["X-Custom"]).toBe("value");
    });

    it("security headers cannot be overridden by custom headers", async () => {
      const config: WebhookConfig = {
        ...testConfig,
        headers: { "Content-Type": "text/plain", "User-Agent": "CustomAgent", "X-FTC-Signature-256": "forged" },
      };
      await deliver(makeMonitor(), makeChange(), config);

      const [, options] = mockFetch.mock.calls[0];
      // Security headers are applied after custom headers and cannot be overridden
      expect(options.headers["Content-Type"]).toBe("application/json");
      expect(options.headers["User-Agent"]).toBe("FetchTheChange-Webhook/1.0");
      expect(options.headers["X-FTC-Signature-256"]).toMatch(/^sha256=[a-f0-9]+$/);
    });

    it("handles 3xx redirect response as non-ok", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 301 });

      const result = await deliver(makeMonitor(), makeChange(), testConfig);
      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(301);
      expect(result.error).toBe("HTTP 301");
    });

    it("uses ssrfSafeFetch for SSRF-safe request handling", async () => {
      await deliver(makeMonitor(), makeChange(), testConfig);
      expect(mockSsrfSafeFetch).toHaveBeenCalledOnce();
    });

    it("sends POST with abort signal", async () => {
      await deliver(makeMonitor(), makeChange(), testConfig);
      const [, options] = mockFetch.mock.calls[0];
      expect(options.method).toBe("POST");
      expect(options.signal).toBeDefined();
    });

    it("handles null oldValue and newValue in payload", async () => {
      const change = makeChange();
      change.oldValue = null;
      change.newValue = null;

      await deliver(makeMonitor(), change, testConfig);
      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.oldValue).toBeNull();
      expect(body.newValue).toBeNull();
    });
  });
});
