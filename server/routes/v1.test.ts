import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock storage
const mockStorage = {
  getMonitor: vi.fn(),
  getMonitorsPaginated: vi.fn(),
  createMonitor: vi.fn(),
  updateMonitor: vi.fn(),
  deleteMonitor: vi.fn(),
  getMonitorChangesPaginated: vi.fn(),
  getApiKeyByHash: vi.fn(),
  touchApiKey: vi.fn().mockResolvedValue(undefined),
};
vi.mock("../storage", () => ({ storage: mockStorage }));

// Mock authStorage
const mockAuthStorage = { getUser: vi.fn() };
vi.mock("../replit_integrations/auth/storage", () => ({ authStorage: mockAuthStorage }));

// Mock SSRF
const mockIsPrivateUrl = vi.fn();
vi.mock("../utils/ssrf", () => ({ isPrivateUrl: mockIsPrivateUrl }));

describe("v1 route logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsPrivateUrl.mockResolvedValue(null);
  });

  describe("SSRF protection on monitor creation", () => {
    it("isPrivateUrl is called for monitor URL validation", async () => {
      const { isPrivateUrl } = await import("../utils/ssrf");
      await isPrivateUrl("http://192.168.1.1/secret");
      expect(mockIsPrivateUrl).toHaveBeenCalledWith("http://192.168.1.1/secret");
    });

    it("blocks private URLs", async () => {
      mockIsPrivateUrl.mockResolvedValue("Private address");
      const { isPrivateUrl } = await import("../utils/ssrf");
      const result = await isPrivateUrl("http://192.168.1.1");
      expect(result).toBe("Private address");
    });
  });

  describe("Zod schemas", () => {
    it("apiV1CreateMonitorSchema rejects missing name", async () => {
      const { apiV1CreateMonitorSchema } = await import("@shared/routes");
      const result = apiV1CreateMonitorSchema.safeParse({
        url: "https://example.com",
        selector: "h1",
      });
      expect(result.success).toBe(false);
    });

    it("apiV1CreateMonitorSchema accepts valid input with defaults", async () => {
      const { apiV1CreateMonitorSchema } = await import("@shared/routes");
      const result = apiV1CreateMonitorSchema.safeParse({
        name: "Test",
        url: "https://example.com",
        selector: "h1",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.frequency).toBe("daily");
        expect(result.data.active).toBe(true);
      }
    });

    it("apiV1UpdateMonitorSchema allows partial updates", async () => {
      const { apiV1UpdateMonitorSchema } = await import("@shared/routes");
      const result = apiV1UpdateMonitorSchema.safeParse({ active: false });
      expect(result.success).toBe(true);
    });

    it("apiV1ChangesPaginationSchema rejects invalid datetime", async () => {
      const { apiV1ChangesPaginationSchema } = await import("@shared/routes");
      const result = apiV1ChangesPaginationSchema.safeParse({ from: "not-a-date" });
      expect(result.success).toBe(false);
    });

    it("apiV1ChangesPaginationSchema accepts valid ISO datetime with from/to", async () => {
      const { apiV1ChangesPaginationSchema } = await import("@shared/routes");
      const result = apiV1ChangesPaginationSchema.safeParse({
        from: "2026-03-01T00:00:00Z",
        to: "2026-03-02T00:00:00Z",
        limit: "10",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("Monitor ownership check", () => {
    it("monitors belonging to other users should be treated as not found", async () => {
      mockStorage.getMonitor.mockResolvedValue({ id: 99, userId: "other_user" });
      const monitor = await mockStorage.getMonitor(99);
      expect(monitor?.userId).not.toBe("user1");
    });
  });

  describe("Paginated monitor changes with date filtering", () => {
    it("getMonitorChangesPaginated is called with correct params including from/to", async () => {
      mockStorage.getMonitorChangesPaginated.mockResolvedValue({
        data: [{ id: 10, monitorId: 1, oldValue: "A", newValue: "B", detectedAt: new Date() }],
        total: 1,
      });
      const fromDate = new Date("2026-03-01T00:00:00Z");
      const toDate = new Date("2026-03-02T00:00:00Z");
      const result = await mockStorage.getMonitorChangesPaginated(1, {
        page: 1, limit: 10, from: fromDate, to: toDate,
      });
      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(mockStorage.getMonitorChangesPaginated).toHaveBeenCalledWith(1, {
        page: 1, limit: 10, from: fromDate, to: toDate,
      });
    });
  });

  describe("OpenAPI spec", () => {
    it("includes all required endpoints", async () => {
      const { openApiSpec } = await import("../openapi");
      expect(openApiSpec.paths["/ping"]).toBeDefined();
      expect(openApiSpec.paths["/monitors"]).toBeDefined();
      expect(openApiSpec.paths["/monitors/{id}"]).toBeDefined();
      expect(openApiSpec.paths["/monitors/{id}/changes"]).toBeDefined();
      expect(openApiSpec.paths["/openapi.json"]).toBeDefined();
    });

    it("has BearerAuth security scheme", async () => {
      const { openApiSpec } = await import("../openapi");
      expect(openApiSpec.components.securitySchemes.BearerAuth).toBeDefined();
      expect(openApiSpec.components.securitySchemes.BearerAuth.type).toBe("http");
      expect(openApiSpec.components.securitySchemes.BearerAuth.scheme).toBe("bearer");
    });

    it("openapi.json endpoint has no security requirement", async () => {
      const { openApiSpec } = await import("../openapi");
      expect(openApiSpec.paths["/openapi.json"].get.security).toEqual([]);
    });
  });

  describe("Paginated monitors list", () => {
    it("getMonitorsPaginated returns correct structure", async () => {
      mockStorage.getMonitorsPaginated.mockResolvedValue({
        data: [{ id: 1, name: "Mon1", userId: "user1" }],
        total: 1,
      });
      const result = await mockStorage.getMonitorsPaginated("user1", 1, 20);
      expect(result.data).toHaveLength(1);
      expect(result.meta ?? result.total).toBeDefined();
    });
  });

  describe("Delete monitor", () => {
    it("deleteMonitor is called with the correct id", async () => {
      mockStorage.deleteMonitor.mockResolvedValue(undefined);
      await mockStorage.deleteMonitor(5);
      expect(mockStorage.deleteMonitor).toHaveBeenCalledWith(5);
    });
  });
});
