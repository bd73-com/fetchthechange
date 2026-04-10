import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Response, NextFunction } from "express";

// Mock authStorage before importing the module under test
const mockGetUser = vi.fn();
vi.mock("../replit_integrations/auth/storage", () => ({
  authStorage: { getUser: (...args: any[]) => mockGetUser(...args) },
}));

// Import after mocks are set up
import {
  generalRateLimiter,
  createMonitorRateLimiter,
  checkMonitorRateLimiter,
} from "./rateLimiter";

function mockReq(overrides: Record<string, any> = {}): any {
  return {
    ip: "127.0.0.1",
    headers: {},
    params: {},
    ...overrides,
  };
}

function mockRes(): any {
  const res: any = {
    _status: 0,
    _json: null,
    headersSent: false,
    status(code: number) {
      res._status = code;
      return res;
    },
    json(data: any) {
      res._json = data;
      return res;
    },
    setHeader() { return res; },
    getHeader() { return undefined; },
    set() { return res; },
    get() { return undefined; },
  };
  return res;
}

describe("rate limiter middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ id: "user-1", tier: "free" });
  });

  describe("resolveUserId (tested via middleware)", () => {
    it("returns 401 when neither req.user nor req.extensionUser is set", async () => {
      const req = mockReq();
      const res = mockRes();
      const next = vi.fn();

      await generalRateLimiter(req, res, next);

      expect(res._status).toBe(401);
      expect(res._json).toEqual({ message: "Unauthorized" });
      expect(next).not.toHaveBeenCalled();
    });

    it("authenticates via req.extensionUser (extension JWT)", async () => {
      const req = mockReq({ extensionUser: { id: "ext-user-1", tier: "pro" } });
      const res = mockRes();
      const next = vi.fn();

      await generalRateLimiter(req, res, next);

      expect(mockGetUser).toHaveBeenCalledWith("ext-user-1");
      expect(next).toHaveBeenCalled();
    });

    it("authenticates via req.user.claims.sub (session auth)", async () => {
      const req = mockReq({ user: { claims: { sub: "session-user-1" } } });
      const res = mockRes();
      const next = vi.fn();

      await createMonitorRateLimiter(req, res, next);

      expect(mockGetUser).toHaveBeenCalledWith("session-user-1");
      expect(next).toHaveBeenCalled();
    });

    it("prefers extensionUser over session user when both are present", async () => {
      const req = mockReq({
        extensionUser: { id: "ext-user", tier: "pro" },
        user: { claims: { sub: "session-user" } },
      });
      const res = mockRes();
      const next = vi.fn();

      await generalRateLimiter(req, res, next);

      expect(mockGetUser).toHaveBeenCalledWith("ext-user");
    });

    it("does not throw when req.user exists but claims is undefined", async () => {
      // This was the original crash scenario — req.user set by a stale session
      // without the claims property.
      const req = mockReq({ user: {} });
      const res = mockRes();
      const next = vi.fn();

      await generalRateLimiter(req, res, next);

      expect(res._status).toBe(401);
      expect(next).not.toHaveBeenCalled();
    });

    it("does not throw when req.user.claims exists but sub is undefined", async () => {
      const req = mockReq({ user: { claims: {} } });
      const res = mockRes();
      const next = vi.fn();

      await generalRateLimiter(req, res, next);

      expect(res._status).toBe(401);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("getUserTier DB error handling", () => {
    it("defaults to free tier when DB lookup fails", async () => {
      mockGetUser.mockRejectedValue(new Error("connection timeout"));

      const req = mockReq({ extensionUser: { id: "user-1", tier: "pro" } });
      const res = mockRes();
      const next = vi.fn();

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      await generalRateLimiter(req, res, next);

      // Should still call next (using free tier limits, not crash)
      expect(next).toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("[RateLimiter] DB lookup failed"),
        expect.stringContaining("connection timeout"),
      );

      warnSpy.mockRestore();
    });
  });

  describe("checkMonitorRateLimiter keyGenerator", () => {
    it("uses extensionUser ID in rate limit key", async () => {
      const req = mockReq({
        extensionUser: { id: "ext-user-1", tier: "free" },
        params: { id: "42" },
      });
      const res = mockRes();
      const next = vi.fn();

      await checkMonitorRateLimiter(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });
});
