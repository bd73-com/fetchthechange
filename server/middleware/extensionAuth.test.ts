import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { extensionAuth } from "./extensionAuth";
import { sign } from "../utils/extensionToken";
import type { Request, Response, NextFunction } from "express";

const TEST_SECRET = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2";

function mockReq(authHeader?: string): Request {
  return {
    headers: authHeader ? { authorization: authHeader } : {},
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

describe("extensionAuth middleware", () => {
  beforeEach(() => {
    vi.stubEnv("EXTENSION_JWT_SECRET", TEST_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("attaches extensionUser on valid token", () => {
    const token = sign("user-42", "pro");
    const req = mockReq(`Bearer ${token}`);
    const res = mockRes();
    const next = vi.fn();

    extensionAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.extensionUser).toEqual({ id: "user-42", tier: "pro" });
  });

  it("returns 401 when no Authorization header", () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    extensionAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(401);
    expect(res._body.code).toBe("INVALID_EXTENSION_TOKEN");
  });

  it("returns 401 when header is not Bearer", () => {
    const req = mockReq("Basic abc123");
    const res = mockRes();
    const next = vi.fn();

    extensionAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(401);
  });

  it("returns 401 on invalid token", () => {
    const req = mockReq("Bearer invalid.token.here");
    const res = mockRes();
    const next = vi.fn();

    extensionAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(401);
    expect(res._body.code).toBe("INVALID_EXTENSION_TOKEN");
  });

  it("returns 401 on expired token", () => {
    const token = sign("user-42", "free");
    // Fast-forward 8 days (past 7-day expiry)
    vi.spyOn(Date, "now").mockReturnValue(
      Date.now() + 8 * 24 * 60 * 60 * 1000
    );

    const req = mockReq(`Bearer ${token}`);
    const res = mockRes();
    const next = vi.fn();

    extensionAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(401);

    vi.restoreAllMocks();
  });
});
