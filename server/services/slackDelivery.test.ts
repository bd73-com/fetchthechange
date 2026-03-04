import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { deliver, listChannels } from "./slackDelivery";
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

describe("slackDelivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("deliver", () => {
    it("posts message successfully", async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ ok: true, ts: "1234567890.123456" }),
      });

      const result = await deliver(makeMonitor(), makeChange(), "C0123", "xoxb-token");
      expect(result.success).toBe(true);
      expect(result.slackTs).toBe("1234567890.123456");
    });

    it("sends correct headers and body", async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ ok: true }),
      });

      await deliver(makeMonitor(), makeChange(), "C0123", "xoxb-token");

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe("https://slack.com/api/chat.postMessage");
      expect(options.headers.Authorization).toBe("Bearer xoxb-token");
      expect(options.headers["Content-Type"]).toBe("application/json");

      const body = JSON.parse(options.body);
      expect(body.channel).toBe("C0123");
      expect(body.blocks).toBeDefined();
      expect(body.blocks.length).toBeGreaterThan(0);
    });

    it("includes Block Kit sections for monitor data", async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ ok: true }),
      });

      await deliver(makeMonitor(), makeChange(), "C0123", "xoxb-token");

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const blockTypes = body.blocks.map((b: any) => b.type);
      expect(blockTypes).toContain("header");
      expect(blockTypes).toContain("section");
      expect(blockTypes).toContain("actions");
    });

    it("handles Slack API error", async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ ok: false, error: "channel_not_found" }),
      });

      const result = await deliver(makeMonitor(), makeChange(), "C0123", "xoxb-token");
      expect(result.success).toBe(false);
      expect(result.error).toBe("channel_not_found");
    });

    it("handles network error", async () => {
      mockFetch.mockRejectedValue(new Error("Network failure"));

      const result = await deliver(makeMonitor(), makeChange(), "C0123", "xoxb-token");
      expect(result.success).toBe(false);
      expect(result.error).toBe("Network failure");
    });
  });

  describe("listChannels", () => {
    it("returns channel list", async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({
          ok: true,
          channels: [
            { id: "C001", name: "general" },
            { id: "C002", name: "alerts" },
          ],
        }),
      });

      const channels = await listChannels("xoxb-token");
      expect(channels).toHaveLength(2);
      expect(channels[0]).toEqual({ id: "C001", name: "general" });
      expect(channels[1]).toEqual({ id: "C002", name: "alerts" });
    });

    it("throws on Slack API error", async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ ok: false, error: "invalid_auth" }),
      });

      await expect(listChannels("bad-token")).rejects.toThrow("Slack API error: invalid_auth");
    });
  });
});
