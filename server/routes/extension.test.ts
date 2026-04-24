import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const TEST_SECRET = "a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1";

// Mock storage
const mockStorage = {
  getMonitorCount: vi.fn(),
  createMonitor: vi.fn(),
};
vi.mock("../storage", () => ({ storage: mockStorage }));

// Mock authStorage
const mockAuthStorage = { getUser: vi.fn() };
vi.mock("../replit_integrations/auth/storage", () => ({
  authStorage: mockAuthStorage,
}));

// Mock monitorValidation
const mockCheckMonitorLimit = vi.fn();
const mockCheckFrequencyTier = vi.fn().mockReturnValue(null);
const mockValidateMonitorInput = vi.fn();
vi.mock("../services/monitorValidation", () => ({
  checkMonitorLimit: (...args: any[]) => mockCheckMonitorLimit(...args),
  checkFrequencyTier: (...args: any[]) => mockCheckFrequencyTier(...args),
  validateMonitorInput: (...args: any[]) => mockValidateMonitorInput(...args),
}));

// Mock urlUtils
const mockSafeHostname = vi.fn().mockReturnValue("example.com");
vi.mock("../utils/urlUtils", () => ({
  safeHostname: (...args: any[]) => mockSafeHostname(...args),
}));

// Mock scraper
const mockScraperCheckMonitor = vi.fn().mockResolvedValue(undefined);
vi.mock("../services/scraper", () => ({
  checkMonitor: (...args: any[]) => mockScraperCheckMonitor(...args),
}));

// Mock notification (seedDefaultEmailChannel)
vi.mock("../services/notification", () => ({
  seedDefaultEmailChannel: vi.fn().mockResolvedValue(undefined),
}));

// Mock isAuthenticated — just calls next()
vi.mock("../replit_integrations/auth", () => ({
  isAuthenticated: (_req: any, _res: any, next: any) => next(),
}));

// Mock extensionAuth — attaches extensionUser from Authorization header
vi.mock("../middleware/extensionAuth", async () => {
  const { verify } = await import("../utils/extensionToken");
  return {
    extensionAuth: (req: any, res: any, next: any) => {
      const auth = req.headers?.authorization;
      if (!auth?.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Unauthorized", code: "INVALID_EXTENSION_TOKEN" });
      }
      const result = verify(auth.slice(7));
      if (!result) {
        return res.status(401).json({ error: "Invalid token", code: "INVALID_EXTENSION_TOKEN" });
      }
      req.extensionUser = { id: result.userId, tier: result.tier };
      next();
    },
  };
});

// Mock rate limiter — just calls next()
vi.mock("../middleware/rateLimiter", () => ({
  createMonitorRateLimiter: (_req: any, _res: any, next: any) => next(),
}));

import { sign } from "../utils/extensionToken";
import express from "express";

// Helper: create an express app with the extension router mounted
async function createApp() {
  const app = express();
  app.use(express.json());
  const mod = await import("./extension");
  app.use("/api/extension", mod.default);
  return app;
}

// Helper: make a request to the express app
async function makeRequest(
  app: express.Express,
  method: "get" | "post",
  path: string,
  opts: { headers?: Record<string, string>; body?: any } = {}
): Promise<{ status: number; body: any }> {
  return new Promise((resolve) => {
    const http = require("http");
    const server = app.listen(0, () => {
      const port = (server.address() as any).port;
      const url = `http://127.0.0.1:${port}${path}`;
      const bodyStr = opts.body ? JSON.stringify(opts.body) : undefined;
      const reqOpts: any = {
        method: method.toUpperCase(),
        headers: {
          "Content-Type": "application/json",
          ...opts.headers,
        },
      };
      const req = http.request(url, reqOpts, (res: any) => {
        let data = "";
        res.on("data", (chunk: string) => (data += chunk));
        res.on("end", () => {
          server.close();
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      });
      if (bodyStr) req.write(bodyStr);
      req.end();
    });
  });
}

describe("extension routes", () => {
  beforeEach(() => {
    vi.stubEnv("EXTENSION_JWT_SECRET", TEST_SECRET);
    vi.clearAllMocks();
    mockCheckMonitorLimit.mockResolvedValue(null);
    mockCheckFrequencyTier.mockReturnValue(null);
    mockValidateMonitorInput.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("POST /api/extension/token", () => {
    it("issues a JWT for an authenticated user", async () => {
      mockAuthStorage.getUser.mockResolvedValue({
        id: "user-1",
        tier: "pro",
        email: "test@example.com",
      });

      const app = express();
      app.use(express.json());
      // Simulate isAuthenticated attaching user
      app.use((req: any, _res: any, next: any) => {
        req.user = { claims: { sub: "user-1" } };
        next();
      });
      const mod = await import("./extension");
      app.use("/api/extension", mod.default);

      const res = await makeRequest(app, "post", "/api/extension/token");

      expect(res.status).toBe(200);
      expect(typeof res.body.token).toBe("string");
      expect(res.body.token.split(".")).toHaveLength(3);
      expect(res.body.expiresAt).toBeDefined();
    });

    it("defaults to free tier when user has no tier", async () => {
      mockAuthStorage.getUser.mockResolvedValue({
        id: "user-1",
        tier: null,
      });

      const app = express();
      app.use(express.json());
      app.use((req: any, _res: any, next: any) => {
        req.user = { claims: { sub: "user-1" } };
        next();
      });
      const mod = await import("./extension");
      app.use("/api/extension", mod.default);

      const res = await makeRequest(app, "post", "/api/extension/token");

      expect(res.status).toBe(200);
      // Verify the token contains "free" tier
      const decoded = JSON.parse(
        Buffer.from(res.body.token.split(".")[1], "base64url").toString()
      );
      expect(decoded.tier).toBe("free");
    });
  });

  describe("GET /api/extension/verify", () => {
    it("returns user info for valid token", async () => {
      mockAuthStorage.getUser.mockResolvedValue({
        id: "user-1",
        tier: "pro",
        email: "test@example.com",
      });

      const token = sign("user-1", "pro");
      const app = await createApp();

      const res = await makeRequest(app, "get", "/api/extension/verify", {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        userId: "user-1",
        tier: "pro",
        email: "test@example.com",
      });
    });

    it("returns 404 when user not found in DB", async () => {
      mockAuthStorage.getUser.mockResolvedValue(null);

      const token = sign("deleted-user", "free");
      const app = await createApp();

      const res = await makeRequest(app, "get", "/api/extension/verify", {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(404);
      expect(res.body.message).toBe("User not found");
      expect(res.body.code).toBe("USER_NOT_FOUND");
    });

    it("returns 401 without token", async () => {
      const app = await createApp();

      const res = await makeRequest(app, "get", "/api/extension/verify");

      expect(res.status).toBe(401);
      expect(res.body.code).toBe("INVALID_EXTENSION_TOKEN");
    });

    it("uses token tier as fallback when user.tier is null", async () => {
      mockAuthStorage.getUser.mockResolvedValue({
        id: "user-1",
        tier: null,
        email: "",
      });

      const token = sign("user-1", "pro");
      const app = await createApp();

      const res = await makeRequest(app, "get", "/api/extension/verify", {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
      expect(res.body.tier).toBe("pro");
    });
  });

  describe("POST /api/extension/monitors", () => {
    const validBody = {
      name: "Test Monitor",
      url: "https://example.com",
      selector: "h1",
      frequency: "daily",
    };

    it("creates a monitor successfully", async () => {
      mockAuthStorage.getUser.mockResolvedValue({ id: "user-1", tier: "pro" });
      mockStorage.createMonitor.mockResolvedValue({
        id: 42,
        ...validBody,
        userId: "user-1",
      });

      const token = sign("user-1", "pro");
      const app = await createApp();

      const res = await makeRequest(app, "post", "/api/extension/monitors", {
        headers: { Authorization: `Bearer ${token}` },
        body: validBody,
      });

      expect(res.status).toBe(201);
      expect(res.body.id).toBe(42);
      expect(mockStorage.createMonitor).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Test Monitor",
          url: "https://example.com",
          selector: "h1",
          userId: "user-1",
        })
      );
    });

    it("triggers async monitor check after creation", async () => {
      const monitor = { id: 42, ...validBody, userId: "user-1" };
      mockAuthStorage.getUser.mockResolvedValue({ id: "user-1", tier: "pro" });
      mockStorage.createMonitor.mockResolvedValue(monitor);

      const token = sign("user-1", "pro");
      const app = await createApp();

      await makeRequest(app, "post", "/api/extension/monitors", {
        headers: { Authorization: `Bearer ${token}` },
        body: validBody,
      });

      await vi.waitFor(() => {
        expect(mockScraperCheckMonitor).toHaveBeenCalledWith(monitor);
      });
    });

    it("returns tier limit error with message (not error) key", async () => {
      mockAuthStorage.getUser.mockResolvedValue({ id: "user-1", tier: "free" });
      mockCheckMonitorLimit.mockResolvedValue({
        status: 403,
        error: "You've reached your free plan limit of 3 monitors.",
        code: "TIER_LIMIT_REACHED",
      });

      const token = sign("user-1", "free");
      const app = await createApp();

      const res = await makeRequest(app, "post", "/api/extension/monitors", {
        headers: { Authorization: `Bearer ${token}` },
        body: validBody,
      });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("TIER_LIMIT_REACHED");
      expect(res.body.message).toBeDefined();
      // Consistent response shape: uses 'message', not 'error'
      expect(res.body.error).toBeUndefined();
    });

    it("rejects hourly frequency for free-tier users", async () => {
      mockAuthStorage.getUser.mockResolvedValue({ id: "user-1", tier: "free" });
      mockCheckFrequencyTier.mockReturnValue({
        status: 403,
        error: 'The "hourly" check frequency requires a pro or power plan. Upgrade to use this frequency.',
        code: "FREQUENCY_TIER_RESTRICTED",
      });

      const token = sign("user-1", "free");
      const app = await createApp();

      const res = await makeRequest(app, "post", "/api/extension/monitors", {
        headers: { Authorization: `Bearer ${token}` },
        body: { ...validBody, frequency: "hourly" },
      });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("FREQUENCY_TIER_RESTRICTED");
    });

    it("returns SSRF error for private URLs", async () => {
      mockAuthStorage.getUser.mockResolvedValue({ id: "user-1", tier: "pro" });
      mockValidateMonitorInput.mockResolvedValue({
        status: 422,
        error: "URL blocked: Private address",
        code: "SSRF_BLOCKED",
      });

      const token = sign("user-1", "pro");
      const app = await createApp();

      const res = await makeRequest(app, "post", "/api/extension/monitors", {
        headers: { Authorization: `Bearer ${token}` },
        body: validBody,
      });

      expect(res.status).toBe(422);
      expect(res.body.code).toBe("SSRF_BLOCKED");
    });

    it("returns 400 for missing required fields", async () => {
      mockAuthStorage.getUser.mockResolvedValue({ id: "user-1", tier: "pro" });

      const token = sign("user-1", "pro");
      const app = await createApp();

      const res = await makeRequest(app, "post", "/api/extension/monitors", {
        headers: { Authorization: `Bearer ${token}` },
        body: { name: "Test" }, // missing url, selector
      });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("Invalid input");
      expect(res.body.errors).toBeDefined();
    });

    it("uses fresh DB tier over stale token tier", async () => {
      // Token says "free" but DB says user upgraded to "pro"
      mockAuthStorage.getUser.mockResolvedValue({ id: "user-1", tier: "pro" });
      mockStorage.createMonitor.mockResolvedValue({
        id: 1,
        ...validBody,
        userId: "user-1",
      });

      const token = sign("user-1", "free");
      const app = await createApp();

      await makeRequest(app, "post", "/api/extension/monitors", {
        headers: { Authorization: `Bearer ${token}` },
        body: validBody,
      });

      // Should call checkMonitorLimit with the fresh "pro" tier
      expect(mockCheckMonitorLimit).toHaveBeenCalledWith("user-1", "pro");
    });

    it("falls back to token tier when user not in DB", async () => {
      mockAuthStorage.getUser.mockResolvedValue(null);
      mockStorage.createMonitor.mockResolvedValue({
        id: 1,
        ...validBody,
        userId: "user-1",
      });

      const token = sign("user-1", "pro");
      const app = await createApp();

      await makeRequest(app, "post", "/api/extension/monitors", {
        headers: { Authorization: `Bearer ${token}` },
        body: validBody,
      });

      expect(mockCheckMonitorLimit).toHaveBeenCalledWith("user-1", "pro");
    });

    it("returns 401 without authorization", async () => {
      const app = await createApp();

      const res = await makeRequest(app, "post", "/api/extension/monitors", {
        body: validBody,
      });

      expect(res.status).toBe(401);
    });
  });
});
