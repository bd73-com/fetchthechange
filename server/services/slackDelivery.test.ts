import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

describe("slackDelivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("deliver", () => {
    it("posts message successfully", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true, ts: "1234567890.123456" }),
      });

      const result = await deliver(makeMonitor(), makeChange(), "C0123", "xoxb-token");
      expect(result.success).toBe(true);
      expect(result.slackTs).toBe("1234567890.123456");
    });

    it("sends correct headers and body", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
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

    it("passes AbortSignal timeout to fetch", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      });

      await deliver(makeMonitor(), makeChange(), "C0123", "xoxb-token");

      const options = mockFetch.mock.calls[0][1];
      expect(options.signal).toBeDefined();
    });

    it("returns clean error on HTTP 502 from Slack", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 502,
      });

      const result = await deliver(makeMonitor(), makeChange(), "C0123", "xoxb-token");
      expect(result.success).toBe(false);
      expect(result.error).toBe("slack_http_502");
    });

    it("includes Block Kit sections for monitor data", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
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
        ok: true,
        json: () => Promise.resolve({ ok: false, error: "channel_not_found" }),
      });

      const result = await deliver(makeMonitor(), makeChange(), "C0123", "xoxb-token");
      expect(result.success).toBe(false);
      expect(result.error).toBe("channel_not_found");
    });

    it("auto-joins channel on not_in_channel and retries successfully", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ok: false, error: "not_in_channel" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ok: true }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ok: true, ts: "9999.0001" }),
        });

      const result = await deliver(makeMonitor(), makeChange(), "C0123", "xoxb-token");
      expect(result.success).toBe(true);
      expect(result.slackTs).toBe("9999.0001");

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(mockFetch.mock.calls[0][0]).toBe("https://slack.com/api/chat.postMessage");
      expect(mockFetch.mock.calls[1][0]).toBe("https://slack.com/api/conversations.join");
      expect(mockFetch.mock.calls[2][0]).toBe("https://slack.com/api/chat.postMessage");
    });

    it("returns error when retry after auto-join still fails", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ok: false, error: "not_in_channel" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ok: true }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ok: false, error: "token_revoked" }),
        });

      const result = await deliver(makeMonitor(), makeChange(), "C0123", "xoxb-token");
      expect(result.success).toBe(false);
      expect(result.error).toBe("token_revoked");
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("sends correct channel and token in conversations.join call", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ok: false, error: "not_in_channel" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ok: true }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ok: true, ts: "1111.2222" }),
        });

      await deliver(makeMonitor(), makeChange(), "C0123", "xoxb-token");

      const [joinUrl, joinOpts] = mockFetch.mock.calls[1];
      expect(joinUrl).toBe("https://slack.com/api/conversations.join");
      expect(joinOpts.headers.Authorization).toBe("Bearer xoxb-token");
      expect(JSON.parse(joinOpts.body)).toEqual({ channel: "C0123" });
    });

    it("catches network error during join attempt", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ok: false, error: "not_in_channel" }),
        })
        .mockRejectedValueOnce(new Error("Connection reset"));

      const result = await deliver(makeMonitor(), makeChange(), "C0123", "xoxb-token");
      expect(result.success).toBe(false);
      expect(result.error).toBe("Connection reset");
    });

    it("deduplicates concurrent join attempts for the same channel", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ok: false, error: "not_in_channel" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ok: false, error: "not_in_channel" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ok: true }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ok: true, ts: "1111" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ok: true, ts: "2222" }),
        });

      const [result1, result2] = await Promise.all([
        deliver(makeMonitor(), makeChange(), "C0123", "xoxb-token"),
        deliver(makeMonitor(), makeChange(), "C0123", "xoxb-token"),
      ]);

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      const joinCalls = mockFetch.mock.calls.filter(
        (c) => c[0] === "https://slack.com/api/conversations.join"
      );
      expect(joinCalls).toHaveLength(1);
    });

    it("does not deduplicate joins across different bot tokens", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ok: false, error: "not_in_channel" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ok: false, error: "not_in_channel" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ok: true }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ok: true }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ok: true, ts: "1111" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ok: true, ts: "2222" }),
        });

      const [result1, result2] = await Promise.all([
        deliver(makeMonitor(), makeChange(), "C0123", "xoxb-token-A"),
        deliver(makeMonitor(), makeChange(), "C0123", "xoxb-token-B"),
      ]);

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      const joinCalls = mockFetch.mock.calls.filter(
        (c) => c[0] === "https://slack.com/api/conversations.join"
      );
      expect(joinCalls).toHaveLength(2);
    });

    it("returns error when auto-join fails (e.g. private channel)", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ok: false, error: "not_in_channel" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ok: false, error: "method_not_supported_for_channel_type" }),
        });

      const result = await deliver(makeMonitor(), makeChange(), "C0123", "xoxb-token");
      expect(result.success).toBe(false);
      expect(result.error).toBe("method_not_supported_for_channel_type");
      expect(mockFetch).toHaveBeenCalledTimes(2);
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
        ok: true,
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
        ok: true,
        json: () => Promise.resolve({ ok: false, error: "invalid_auth" }),
      });

      await expect(listChannels("bad-token")).rejects.toThrow("Slack API error: invalid_auth");
    });

    it("throws on HTTP failure with status code", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 502,
      });

      await expect(listChannels("xoxb-token")).rejects.toThrow("slack_http_502");
      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[1].signal).toBeInstanceOf(AbortSignal);
    });

    it("returns empty array when channels key is missing from response", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      });

      const channels = await listChannels("xoxb-token");
      expect(channels).toEqual([]);
    });

    it("returns empty array when channels is empty", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true, channels: [] }),
      });

      const channels = await listChannels("xoxb-token");
      expect(channels).toEqual([]);
    });

    it("paginates through multiple pages using cursor", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            channels: [{ id: "C001", name: "general" }],
            response_metadata: { next_cursor: "cursor_page2" },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            channels: [{ id: "C002", name: "alerts" }],
            response_metadata: { next_cursor: "" },
          }),
        });

      const channels = await listChannels("xoxb-token");
      expect(channels).toHaveLength(2);
      expect(channels).toEqual([
        { id: "C001", name: "general" },
        { id: "C002", name: "alerts" },
      ]);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      // Second call should include cursor param
      const secondUrl = mockFetch.mock.calls[1][0] as string;
      expect(secondUrl).toContain("cursor=cursor_page2");
    });

    it("throws when maxPages (10) reached with cursor still present", async () => {
      // Every page returns a non-empty cursor
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          ok: true,
          channels: [{ id: "C001", name: "ch" }],
          response_metadata: { next_cursor: "more" },
        }),
      });

      await expect(listChannels("xoxb-token")).rejects.toThrow("pagination_truncated_after_10_pages");
      expect(mockFetch).toHaveBeenCalledTimes(10);
    });

    it("throws on 429 rate limit during channel listing", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
      });

      await expect(listChannels("xoxb-token")).rejects.toThrow("Slack API error: ratelimited");
    });

    it("stops when next_cursor is undefined (no response_metadata)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          ok: true,
          channels: [{ id: "C001", name: "general" }],
        }),
      });

      const channels = await listChannels("xoxb-token");
      expect(channels).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("rate limit retry", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    function mockHeaders(retryAfter?: string) {
      return { get: (key: string) => key === "Retry-After" ? (retryAfter ?? null) : null };
    }

    it("retries once on ratelimited error and succeeds", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ok: false, error: "ratelimited" }),
          headers: mockHeaders("1"),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ok: true, ts: "after-retry" }),
        });

      const promise = deliver(makeMonitor(), makeChange(), "C0123", "xoxb-token");
      await vi.advanceTimersByTimeAsync(1000);
      const result = await promise;
      expect(result.success).toBe(true);
      expect(result.slackTs).toBe("after-retry");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("caps Retry-After delay at 5 seconds", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ok: false, error: "ratelimited" }),
          headers: mockHeaders("999"),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ok: true, ts: "capped" }),
        });

      const promise = deliver(makeMonitor(), makeChange(), "C0123", "xoxb-token");
      // Only 5s should be needed, not 999s
      await vi.advanceTimersByTimeAsync(5000);
      const result = await promise;
      expect(result.success).toBe(true);
      expect(result.slackTs).toBe("capped");
    });

    it("returns error when retry after rate-limit also fails with HTTP error", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ok: false, error: "ratelimited" }),
          headers: mockHeaders("1"),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
        });

      const promise = deliver(makeMonitor(), makeChange(), "C0123", "xoxb-token");
      await vi.advanceTimersByTimeAsync(1000);
      const result = await promise;
      expect(result.success).toBe(false);
      expect(result.error).toBe("slack_http_503");
    });

    it("defaults Retry-After to 1 second when header is missing", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ok: false, error: "ratelimited" }),
          headers: mockHeaders(),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ok: true, ts: "default-retry" }),
        });

      const promise = deliver(makeMonitor(), makeChange(), "C0123", "xoxb-token");
      await vi.advanceTimersByTimeAsync(1000);
      const result = await promise;
      expect(result.success).toBe(true);
      expect(result.slackTs).toBe("default-retry");
    });

    it("handles HTTP 429 rate limit response and retries", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: mockHeaders("2"),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ok: true, ts: "after-429" }),
        });

      const promise = deliver(makeMonitor(), makeChange(), "C0123", "xoxb-token");
      await vi.advanceTimersByTimeAsync(2000);
      const result = await promise;
      expect(result.success).toBe(true);
      expect(result.slackTs).toBe("after-429");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("joinChannel rate limit retry", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    function mockHeaders(retryAfter?: string) {
      return { get: (key: string) => key === "Retry-After" ? (retryAfter ?? null) : null };
    }

    it("retries conversations.join on 429 and succeeds", async () => {
      mockFetch
        // First postMessage → not_in_channel
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ok: false, error: "not_in_channel" }),
        })
        // First join → 429 rate limited
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: mockHeaders("2"),
        })
        // Retry join → success
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ok: true }),
        })
        // Retry postMessage → success
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ok: true, ts: "after-join-retry" }),
        });

      const promise = deliver(makeMonitor(), makeChange(), "C0123", "xoxb-token");
      await vi.advanceTimersByTimeAsync(2000);
      const result = await promise;
      expect(result.success).toBe(true);
      expect(result.slackTs).toBe("after-join-retry");
      expect(mockFetch).toHaveBeenCalledTimes(4);
      // Verify the join calls targeted conversations.join
      expect(mockFetch.mock.calls[1][0]).toBe("https://slack.com/api/conversations.join");
      expect(mockFetch.mock.calls[2][0]).toBe("https://slack.com/api/conversations.join");
    });

    it("returns failure when join retry also fails", async () => {
      mockFetch
        // First postMessage → not_in_channel
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ok: false, error: "not_in_channel" }),
        })
        // First join → JSON-level ratelimited
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ok: false, error: "ratelimited" }),
          headers: mockHeaders("1"),
        })
        // Retry join → HTTP 503
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
        });

      const promise = deliver(makeMonitor(), makeChange(), "C0123", "xoxb-token");
      await vi.advanceTimersByTimeAsync(1000);
      const result = await promise;
      expect(result.success).toBe(false);
      expect(result.error).toBe("slack_http_503");
    });
  });

  describe("deliver edge cases", () => {
    it("handles null oldValue and newValue", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      });

      const change = makeChange();
      change.oldValue = null;
      change.newValue = null;

      const result = await deliver(makeMonitor(), change, "C0123", "xoxb-token");
      expect(result.success).toBe(true);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      // null values should display as "(empty)" in blocks
      const blockTexts = body.blocks.map((b: any) => JSON.stringify(b));
      expect(blockTexts.some((t: string) => t.includes("(empty)"))).toBe(true);
    });

    it("handles missing error field in Slack response", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: false }),
      });

      const result = await deliver(makeMonitor(), makeChange(), "C0123", "xoxb-token");
      expect(result.success).toBe(false);
      expect(result.error).toBe("Unknown Slack API error");
    });

    it("handles non-Error thrown by fetch", async () => {
      mockFetch.mockRejectedValue("string error");

      const result = await deliver(makeMonitor(), makeChange(), "C0123", "xoxb-token");
      expect(result.success).toBe(false);
      expect(result.error).toBe("string error");
    });
  });
});
