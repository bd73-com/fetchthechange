import { describe, it, expect, vi, beforeEach } from "vitest";
import { csrfProtection } from "./csrf";
import type { Request, Response, NextFunction } from "express";

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    method: "GET",
    path: "/api/monitors",
    headers: {},
    ...overrides,
  } as unknown as Request;
}

function mockRes(): Response & { _status: number; _body: any } {
  const res: any = {
    _status: 200,
    _body: null,
    status(code: number) {
      res._status = code;
      return res;
    },
    json(body: any) {
      res._body = body;
      return res;
    },
  };
  return res;
}

describe("csrfProtection", () => {
  const allowedOrigins = ["https://myapp.example.com", "https://alt.example.com"];
  let next: NextFunction;

  beforeEach(() => {
    next = vi.fn();
  });

  describe("GET requests (non-state-changing)", () => {
    it("passes through without checking origin", () => {
      const middleware = csrfProtection(allowedOrigins, false);
      const req = mockReq({ method: "GET" });
      const res = mockRes();

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it("passes through HEAD requests", () => {
      const middleware = csrfProtection(allowedOrigins, false);
      const req = mockReq({ method: "HEAD" });
      const res = mockRes();

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it("passes through OPTIONS requests", () => {
      const middleware = csrfProtection(allowedOrigins, false);
      const req = mockReq({ method: "OPTIONS" });
      const res = mockRes();

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe("state-changing methods with allowed origin", () => {
    for (const method of ["POST", "PATCH", "DELETE", "PUT"]) {
      it(`allows ${method} with matching origin`, () => {
        const middleware = csrfProtection(allowedOrigins, false);
        const req = mockReq({
          method,
          headers: { origin: "https://myapp.example.com" },
        });
        const res = mockRes();

        middleware(req, res, next);

        expect(next).toHaveBeenCalled();
      });
    }

    it("allows alternate allowed origin", () => {
      const middleware = csrfProtection(allowedOrigins, false);
      const req = mockReq({
        method: "POST",
        headers: { origin: "https://alt.example.com" },
      });
      const res = mockRes();

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe("state-changing methods with missing origin", () => {
    it("rejects POST without origin header", () => {
      const middleware = csrfProtection(allowedOrigins, false);
      const req = mockReq({ method: "POST", headers: {} });
      const res = mockRes();

      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res._status).toBe(403);
      expect(res._body.message).toBe("Forbidden: missing Origin header");
    });
  });

  describe("state-changing methods with disallowed origin", () => {
    it("rejects POST from unknown origin in production", () => {
      const middleware = csrfProtection(allowedOrigins, false);
      const req = mockReq({
        method: "POST",
        headers: { origin: "https://evil.com" },
      });
      const res = mockRes();

      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res._status).toBe(403);
      expect(res._body.message).toBe("Forbidden: origin not allowed");
    });

    it("rejects DELETE from unknown origin", () => {
      const middleware = csrfProtection(allowedOrigins, false);
      const req = mockReq({
        method: "DELETE",
        headers: { origin: "https://attacker.site" },
      });
      const res = mockRes();

      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res._status).toBe(403);
    });
  });

  describe("exempt paths", () => {
    it("bypasses CSRF check for /api/stripe/webhook", () => {
      const middleware = csrfProtection(allowedOrigins, false);
      const req = mockReq({
        method: "POST",
        path: "/api/stripe/webhook",
        headers: {},  // no origin
      });
      const res = mockRes();

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it("bypasses CSRF check for webhook even with bad origin", () => {
      const middleware = csrfProtection(allowedOrigins, false);
      const req = mockReq({
        method: "POST",
        path: "/api/stripe/webhook",
        headers: { origin: "https://evil.com" },
      });
      const res = mockRes();

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe("development mode", () => {
    it("allows localhost origin in dev mode", () => {
      const middleware = csrfProtection(allowedOrigins, true);
      const req = mockReq({
        method: "POST",
        headers: { origin: "http://localhost:3000" },
      });
      const res = mockRes();

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it("rejects *.localhost subdomain origin in dev mode", () => {
      const middleware = csrfProtection(allowedOrigins, true);
      const req = mockReq({
        method: "POST",
        headers: { origin: "http://app.localhost:5173" },
      });
      const res = mockRes();

      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res._status).toBe(403);
    });

    it("rejects *.replit.dev origin in dev mode", () => {
      const middleware = csrfProtection(allowedOrigins, true);
      const req = mockReq({
        method: "POST",
        headers: { origin: "https://my-project.replit.dev" },
      });
      const res = mockRes();

      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res._status).toBe(403);
    });

    it("still rejects unknown origin in dev mode", () => {
      const middleware = csrfProtection(allowedOrigins, true);
      const req = mockReq({
        method: "POST",
        headers: { origin: "https://evil.com" },
      });
      const res = mockRes();

      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res._status).toBe(403);
    });

    it("does NOT allow localhost in production mode", () => {
      const middleware = csrfProtection(allowedOrigins, false);
      const req = mockReq({
        method: "POST",
        headers: { origin: "http://localhost:3000" },
      });
      const res = mockRes();

      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res._status).toBe(403);
    });

    it("does NOT allow replit.dev in production mode", () => {
      const middleware = csrfProtection(allowedOrigins, false);
      const req = mockReq({
        method: "POST",
        headers: { origin: "https://my-project.replit.dev" },
      });
      const res = mockRes();

      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res._status).toBe(403);
    });
  });

  describe("edge cases", () => {
    it("handles invalid URL in origin gracefully in dev mode", () => {
      const middleware = csrfProtection(allowedOrigins, true);
      const req = mockReq({
        method: "POST",
        headers: { origin: "not-a-valid-url" },
      });
      const res = mockRes();

      middleware(req, res, next);

      // Should fall through to rejection since URL parsing fails
      expect(next).not.toHaveBeenCalled();
      expect(res._status).toBe(403);
    });
  });
});
