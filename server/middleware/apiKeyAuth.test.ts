import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

const { mockStorage, mockAuthStorage } = vi.hoisted(() => ({
  mockStorage: {
    getApiKeyByHash: vi.fn(),
    touchApiKey: vi.fn().mockResolvedValue(undefined),
  },
  mockAuthStorage: {
    getUser: vi.fn(),
  },
}));

vi.mock("../storage", () => ({ storage: mockStorage }));
vi.mock("../replit_integrations/auth/storage", () => ({ authStorage: mockAuthStorage }));

import apiKeyAuth from "./apiKeyAuth";

function makeReqRes(authHeader?: string) {
  const req = {
    headers: authHeader ? { authorization: authHeader } : {},
    path: "/api/v1/monitors",
    method: "GET",
  } as unknown as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  const next = vi.fn() as NextFunction;
  return { req, res, next };
}

describe("apiKeyAuth middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when Authorization header is missing", async () => {
    const { req, res, next } = makeReqRes();
    await apiKeyAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "INVALID_API_KEY" }));
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 for malformed key without ftc_ prefix", async () => {
    const { req, res, next } = makeReqRes("Bearer bad_key_here");
    await apiKeyAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "INVALID_API_KEY" }));
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 for revoked key", async () => {
    const rawKey = "ftc_" + "a".repeat(64);
    const hash = createHash("sha256").update(rawKey).digest("hex");
    mockStorage.getApiKeyByHash.mockResolvedValue({
      id: 1,
      userId: "user1",
      keyHash: hash,
      keyPrefix: rawKey.substring(0, 12),
      revokedAt: new Date(),
    });

    const { req, res, next } = makeReqRes(`Bearer ${rawKey}`);
    await apiKeyAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "INVALID_API_KEY" }));
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 for Free/Pro tier user", async () => {
    const rawKey = "ftc_" + "b".repeat(64);
    const hash = createHash("sha256").update(rawKey).digest("hex");
    mockStorage.getApiKeyByHash.mockResolvedValue({
      id: 2,
      userId: "user2",
      keyHash: hash,
      keyPrefix: rawKey.substring(0, 12),
      revokedAt: null,
    });
    mockAuthStorage.getUser.mockResolvedValue({ id: "user2", tier: "pro" });

    const { req, res, next } = makeReqRes(`Bearer ${rawKey}`);
    await apiKeyAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "TIER_LIMIT_REACHED" }));
    expect(next).not.toHaveBeenCalled();
  });

  it("attaches apiUser and calls next for valid Power-tier key", async () => {
    const rawKey = "ftc_" + "c".repeat(64);
    const hash = createHash("sha256").update(rawKey).digest("hex");
    mockStorage.getApiKeyByHash.mockResolvedValue({
      id: 3,
      userId: "user3",
      keyHash: hash,
      keyPrefix: rawKey.substring(0, 12),
      revokedAt: null,
    });
    mockAuthStorage.getUser.mockResolvedValue({ id: "user3", tier: "power" });

    const { req, res, next } = makeReqRes(`Bearer ${rawKey}`);
    await apiKeyAuth(req, res, next);
    expect(next).toHaveBeenCalled();
    expect((req as any).apiUser).toEqual({
      id: "user3",
      tier: "power",
      keyId: 3,
      keyPrefix: rawKey.substring(0, 12),
    });
    expect(mockStorage.touchApiKey).toHaveBeenCalledWith(3);
  });
});
