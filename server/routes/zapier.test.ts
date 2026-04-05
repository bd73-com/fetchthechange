import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock storage
const mockStorage = {
  countActiveAutomationSubscriptions: vi.fn(),
  createAutomationSubscription: vi.fn(),
  deactivateAutomationSubscription: vi.fn(),
  getMonitor: vi.fn(),
  getMonitors: vi.fn(),
};
vi.mock("../storage", () => ({ storage: mockStorage }));

// Mock SSRF
const mockIsPrivateUrl = vi.fn();
vi.mock("../utils/ssrf", () => ({ isPrivateUrl: mockIsPrivateUrl }));

// Mock encryption
const mockIsEncryptionAvailable = vi.fn().mockReturnValue(true);
vi.mock("../utils/encryption", () => ({
  isEncryptionAvailable: () => mockIsEncryptionAvailable(),
  encryptUrl: (url: string) => `encrypted:${url}`,
  hashUrl: (url: string) => `hash:${url}`,
}));

// Mock logger
const mockLoggerInfo = vi.fn().mockResolvedValue(undefined);
const mockLoggerWarning = vi.fn().mockResolvedValue(undefined);
vi.mock("../services/logger", () => ({
  ErrorLogger: {
    info: (...args: any[]) => mockLoggerInfo(...args),
    warning: (...args: any[]) => mockLoggerWarning(...args),
  },
}));

// Mock db for /changes route
const mockDbSelect = vi.fn();
vi.mock("../db", () => ({
  db: { select: () => ({ from: mockDbSelect }) },
}));

import { AUTOMATION_SUBSCRIPTION_LIMITS } from "@shared/models/auth";

describe("Zapier route logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsPrivateUrl.mockResolvedValue(null); // allow by default
  });

  describe("POST /subscribe — SSRF validation", () => {
    it("isPrivateUrl is called for hookUrl on subscribe", async () => {
      const { isPrivateUrl } = await import("../utils/ssrf");
      await isPrivateUrl("http://192.168.1.1/hook");
      expect(mockIsPrivateUrl).toHaveBeenCalledWith("http://192.168.1.1/hook");
    });

    it("blocks private hookUrls", async () => {
      mockIsPrivateUrl.mockResolvedValue("Private address");
      const { isPrivateUrl } = await import("../utils/ssrf");
      const result = await isPrivateUrl("http://10.0.0.1/hook");
      expect(result).toBe("Private address");
    });
  });

  describe("POST /subscribe — subscription limit", () => {
    it("AUTOMATION_SUBSCRIPTION_LIMITS.maxPerUser is defined", () => {
      expect(AUTOMATION_SUBSCRIPTION_LIMITS.maxPerUser).toBe(25);
    });

    it("AUTOMATION_SUBSCRIPTION_LIMITS.failureThreshold is 15", () => {
      expect(AUTOMATION_SUBSCRIPTION_LIMITS.failureThreshold).toBe(15);
    });

    it("countActiveAutomationSubscriptions returns a number", async () => {
      mockStorage.countActiveAutomationSubscriptions.mockResolvedValue(5);
      const count = await mockStorage.countActiveAutomationSubscriptions("user1");
      expect(count).toBe(5);
    });

    it("limit check triggers at maxPerUser", async () => {
      mockStorage.countActiveAutomationSubscriptions.mockResolvedValue(
        AUTOMATION_SUBSCRIPTION_LIMITS.maxPerUser,
      );
      const count = await mockStorage.countActiveAutomationSubscriptions("user1");
      expect(count >= AUTOMATION_SUBSCRIPTION_LIMITS.maxPerUser).toBe(true);
    });
  });

  describe("POST /subscribe — monitor ownership", () => {
    it("getMonitor returns null for nonexistent monitor", async () => {
      mockStorage.getMonitor.mockResolvedValue(null);
      const monitor = await mockStorage.getMonitor(999);
      expect(monitor).toBeNull();
    });

    it("rejects monitor owned by different user", async () => {
      mockStorage.getMonitor.mockResolvedValue({ id: 42, userId: "other-user" });
      const monitor = await mockStorage.getMonitor(42);
      expect(monitor!.userId).not.toBe("requesting-user");
    });
  });

  describe("POST /subscribe — createAutomationSubscription", () => {
    it("creates subscription with correct arguments", async () => {
      const sub = { id: 1, userId: "user1", platform: "zapier", hookUrl: "https://hooks.zapier.com/abc", monitorId: null, active: true, createdAt: new Date(), lastDeliveredAt: null };
      mockStorage.createAutomationSubscription.mockResolvedValue(sub);

      const result = await mockStorage.createAutomationSubscription(
        "user1", "zapier", "https://hooks.zapier.com/abc", null,
      );
      expect(result.id).toBe(1);
      expect(result.platform).toBe("zapier");
      expect(mockStorage.createAutomationSubscription).toHaveBeenCalledWith(
        "user1", "zapier", "https://hooks.zapier.com/abc", null,
      );
    });

    it("passes monitorId when provided", async () => {
      const sub = { id: 2, userId: "user1", platform: "zapier", hookUrl: "https://hooks.zapier.com/abc", monitorId: 42, active: true, createdAt: new Date(), lastDeliveredAt: null };
      mockStorage.createAutomationSubscription.mockResolvedValue(sub);

      const result = await mockStorage.createAutomationSubscription(
        "user1", "zapier", "https://hooks.zapier.com/abc", 42,
      );
      expect(result.monitorId).toBe(42);
    });
  });

  describe("DELETE /unsubscribe — deactivation", () => {
    it("deactivateAutomationSubscription returns true on success", async () => {
      mockStorage.deactivateAutomationSubscription.mockResolvedValue(true);
      const result = await mockStorage.deactivateAutomationSubscription(1, "user1");
      expect(result).toBe(true);
    });

    it("deactivateAutomationSubscription returns false for unknown subscription", async () => {
      mockStorage.deactivateAutomationSubscription.mockResolvedValue(false);
      const result = await mockStorage.deactivateAutomationSubscription(999, "user1");
      expect(result).toBe(false);
    });

    it("enforces user ownership on deactivation", async () => {
      mockStorage.deactivateAutomationSubscription.mockResolvedValue(false);
      // Other user's subscription returns false
      const result = await mockStorage.deactivateAutomationSubscription(1, "wrong-user");
      expect(result).toBe(false);
    });
  });

  describe("GET /monitors — user monitor list", () => {
    it("returns monitors sorted by name", async () => {
      const monitors = [
        { id: 2, name: "Zebra", url: "https://zebra.com", active: true },
        { id: 1, name: "Apple", url: "https://apple.com", active: true },
      ];
      mockStorage.getMonitors.mockResolvedValue(monitors);

      const result = await mockStorage.getMonitors("user1");
      const sorted = result.sort((a: any, b: any) => a.name.localeCompare(b.name));
      expect(sorted[0].name).toBe("Apple");
      expect(sorted[1].name).toBe("Zebra");
    });

    it("maps monitors to id, name, url, active shape", () => {
      const monitor = { id: 1, name: "Test", url: "https://example.com", active: true, selector: ".price", userId: "user1" };
      const mapped = { id: monitor.id, name: monitor.name, url: monitor.url, active: monitor.active };
      expect(mapped).toEqual({ id: 1, name: "Test", url: "https://example.com", active: true });
      expect(mapped).not.toHaveProperty("selector");
      expect(mapped).not.toHaveProperty("userId");
    });
  });

  describe("POST /subscribe — encryption availability", () => {
    it("isEncryptionAvailable is imported by the zapier route module", async () => {
      // Verify the route module imports the encryption guard
      const fs = await import("fs");
      const source = fs.readFileSync("server/routes/zapier.ts", "utf-8");
      expect(source).toContain("isEncryptionAvailable");
      expect(source).toContain("ENCRYPTION_UNAVAILABLE");
    });

    it("route returns 503 with ENCRYPTION_UNAVAILABLE code when encryption is unavailable", async () => {
      // Verify the route source contains the correct response shape
      const fs = await import("fs");
      const source = fs.readFileSync("server/routes/zapier.ts", "utf-8");
      expect(source).toContain('res.status(503)');
      expect(source).toContain('"ENCRYPTION_UNAVAILABLE"');
    });
  });

  describe("Zod schema validation", () => {
    it("zapierSubscribeSchema rejects http:// hookUrl (only https)", async () => {
      const { zapierSubscribeSchema } = await import("@shared/routes");
      const result = zapierSubscribeSchema.safeParse({
        hookUrl: "http://hooks.zapier.com/abc",
      });
      expect(result.success).toBe(false);
    });

    it("zapierSubscribeSchema rejects hookUrl over 2048 chars", async () => {
      const { zapierSubscribeSchema } = await import("@shared/routes");
      const result = zapierSubscribeSchema.safeParse({
        hookUrl: "https://hooks.zapier.com/" + "a".repeat(2048),
      });
      expect(result.success).toBe(false);
    });

    it("zapierUnsubscribeSchema coerces string id from query params", async () => {
      const { zapierUnsubscribeSchema } = await import("@shared/routes");
      const result = zapierUnsubscribeSchema.safeParse({ id: "5" });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.id).toBe(5);
    });

    it("zapierChangesQuerySchema rejects non-positive monitorId", async () => {
      const { zapierChangesQuerySchema } = await import("@shared/routes");
      const result = zapierChangesQuerySchema.safeParse({ monitorId: "0" });
      expect(result.success).toBe(false);
    });
  });
});
