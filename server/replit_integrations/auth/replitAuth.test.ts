import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock heavy dependencies that require DATABASE_URL / external services
vi.mock("./storage", () => ({ authStorage: {} }));

const mockRefreshTokenGrant = vi.fn();
const mockDiscovery = vi.fn();
vi.mock("openid-client", () => ({
  discovery: mockDiscovery,
  refreshTokenGrant: mockRefreshTokenGrant,
}));
vi.mock("openid-client/passport", () => ({ Strategy: vi.fn() }));
vi.mock("connect-pg-simple", () => ({ default: vi.fn(() => vi.fn()) }));
vi.mock("express-session", () => ({ default: vi.fn() }));
vi.mock("passport", () => ({
  default: { use: vi.fn(), serializeUser: vi.fn(), deserializeUser: vi.fn() },
}));
vi.mock("memoizee", () => ({
  default: (fn: any) => fn,
}));

const { sanitizeReturnTo, isAuthenticated } = await import("./replitAuth");

describe("sanitizeReturnTo", () => {
  it("accepts a valid relative path", () => {
    expect(sanitizeReturnTo("/extension-auth")).toBe("/extension-auth");
  });

  it("accepts root path", () => {
    expect(sanitizeReturnTo("/")).toBe("/");
  });

  it("accepts paths with query strings", () => {
    expect(sanitizeReturnTo("/extension-auth?foo=bar")).toBe("/extension-auth?foo=bar");
  });

  it("accepts nested paths", () => {
    expect(sanitizeReturnTo("/dashboard/monitors")).toBe("/dashboard/monitors");
  });

  it("rejects protocol-relative URLs (open redirect)", () => {
    expect(sanitizeReturnTo("//evil.com")).toBeUndefined();
  });

  it("rejects protocol-relative with path", () => {
    expect(sanitizeReturnTo("//evil.com/steal")).toBeUndefined();
  });

  it("rejects absolute URLs", () => {
    expect(sanitizeReturnTo("https://evil.com")).toBeUndefined();
  });

  it("rejects javascript: URIs", () => {
    expect(sanitizeReturnTo("javascript:alert(1)")).toBeUndefined();
  });

  it("rejects bare hostnames", () => {
    expect(sanitizeReturnTo("evil.com")).toBeUndefined();
  });

  it("rejects empty string", () => {
    expect(sanitizeReturnTo("")).toBeUndefined();
  });

  it("rejects CRLF injection (literal characters)", () => {
    expect(sanitizeReturnTo("/foo\r\nSet-Cookie: evil=1")).toBeUndefined();
    expect(sanitizeReturnTo("/foo\nX-Injected: bar")).toBeUndefined();
    expect(sanitizeReturnTo("/foo\rX-Injected: bar")).toBeUndefined();
  });

  it("rejects CRLF injection (percent-encoded)", () => {
    expect(sanitizeReturnTo("/foo%0d%0aSet-Cookie:%20evil=1")).toBeUndefined();
    expect(sanitizeReturnTo("/foo%0D%0ASet-Cookie:%20evil=1")).toBeUndefined();
  });

  it("rejects null bytes", () => {
    expect(sanitizeReturnTo("/foo\x00bar")).toBeUndefined();
    expect(sanitizeReturnTo("/foo%00bar")).toBeUndefined();
  });

  it("rejects tab characters", () => {
    expect(sanitizeReturnTo("/foo\tbar")).toBeUndefined();
  });

  it("rejects excessively long paths", () => {
    expect(sanitizeReturnTo("/" + "a".repeat(2048))).toBeUndefined();
  });

  it("accepts paths at the length limit", () => {
    const path = "/" + "a".repeat(2047);
    expect(sanitizeReturnTo(path)).toBe(path);
  });

  it("rejects backslash-prefixed paths", () => {
    expect(sanitizeReturnTo("\\evil.com")).toBeUndefined();
  });

  it("rejects backslash after leading slash (browser normalization bypass)", () => {
    expect(sanitizeReturnTo("/\\evil.com")).toBeUndefined();
    expect(sanitizeReturnTo("/%5Cevil.com")).toBeUndefined();
    expect(sanitizeReturnTo("/%5cevil.com")).toBeUndefined();
  });

  it("rejects non-string values", () => {
    expect(sanitizeReturnTo(undefined)).toBeUndefined();
    expect(sanitizeReturnTo(null)).toBeUndefined();
    expect(sanitizeReturnTo(123)).toBeUndefined();
    expect(sanitizeReturnTo(["/"])).toBeUndefined();
  });
});

describe("isAuthenticated", () => {
  function createMockReqResNext(overrides: {
    isAuthenticated?: boolean;
    user?: any;
    passportUser?: any;
  }) {
    const saveFn = vi.fn((cb: (err?: any) => void) => cb());
    const req = {
      isAuthenticated: () => overrides.isAuthenticated ?? true,
      user: overrides.user ?? {},
      sessionID: "test-session-id",
      session: {
        passport: { user: overrides.passportUser ?? {} },
        save: saveFn,
      },
    } as any;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as any;
    const next = vi.fn();
    return { req, res, next, saveFn };
  }

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    const { req, res, next } = createMockReqResNext({
      isAuthenticated: false,
      user: {},
    });
    await isAuthenticated(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when expires_at is missing", async () => {
    const { req, res, next } = createMockReqResNext({
      user: { access_token: "tok" },
    });
    await isAuthenticated(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() when token is not expired", async () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    const { req, res, next } = createMockReqResNext({
      user: { expires_at: futureExp, access_token: "tok" },
    });
    await isAuthenticated(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 401 when token expired and no refresh_token", async () => {
    const pastExp = Math.floor(Date.now() / 1000) - 100;
    const { req, res, next } = createMockReqResNext({
      user: { expires_at: pastExp, access_token: "tok" },
    });
    await isAuthenticated(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("refreshes token and persists to session store when expired", async () => {
    const pastExp = Math.floor(Date.now() / 1000) - 100;
    const newExp = Math.floor(Date.now() / 1000) + 3600;
    const user = {
      expires_at: pastExp,
      access_token: "old_access",
      refresh_token: "old_refresh",
      claims: { sub: "user1", exp: pastExp },
    };

    mockDiscovery.mockResolvedValue({ serverMetadata: () => ({}) });
    mockRefreshTokenGrant.mockResolvedValue({
      access_token: "new_access",
      refresh_token: "new_refresh",
      claims: () => ({ sub: "user1", exp: newExp }),
    });

    const { req, res, next, saveFn } = createMockReqResNext({
      user,
      passportUser: {
        claims: user.claims,
        access_token: "old_access",
        refresh_token: "old_refresh",
        expires_at: pastExp,
      },
    });

    await isAuthenticated(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(mockRefreshTokenGrant).toHaveBeenCalled();

    // Verify session.passport.user was updated with new tokens
    expect(req.session.passport.user.access_token).toBe("new_access");
    expect(req.session.passport.user.refresh_token).toBe("new_refresh");
    expect(req.session.passport.user.expires_at).toBe(newExp);

    // Verify session.save() was called
    expect(saveFn).toHaveBeenCalled();
  });

  it("returns 401 when refresh token grant fails", async () => {
    const pastExp = Math.floor(Date.now() / 1000) - 100;
    const user = {
      expires_at: pastExp,
      access_token: "old_access",
      refresh_token: "old_refresh",
      claims: { sub: "user1", exp: pastExp },
    };

    mockDiscovery.mockResolvedValue({ serverMetadata: () => ({}) });
    mockRefreshTokenGrant.mockRejectedValue(new Error("invalid_grant"));

    const { req, res, next } = createMockReqResNext({ user });

    await isAuthenticated(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 500 and logs error when session.save fails", async () => {
    const pastExp = Math.floor(Date.now() / 1000) - 100;
    const newExp = Math.floor(Date.now() / 1000) + 3600;
    const user = {
      expires_at: pastExp,
      access_token: "old_access",
      refresh_token: "old_refresh",
      claims: { sub: "user1", exp: pastExp },
    };

    mockDiscovery.mockResolvedValue({ serverMetadata: () => ({}) });
    mockRefreshTokenGrant.mockResolvedValue({
      access_token: "new_access",
      refresh_token: "new_refresh",
      claims: () => ({ sub: "user1", exp: newExp }),
    });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const saveErr = new Error("store write failed");
    const saveFn = vi.fn((cb: (err?: any) => void) => cb(saveErr));
    const req = {
      isAuthenticated: () => true,
      user,
      sessionID: "test-session-id-save-fail",
      session: {
        passport: { user: {} },
        save: saveFn,
      },
    } as any;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as any;
    const next = vi.fn();

    await isAuthenticated(req, res, next);

    // Should NOT call next — should return 500
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ message: "Internal Server Error" });
    expect(consoleSpy).toHaveBeenCalledWith(
      "[auth] Failed to save refreshed session:",
      expect.stringContaining("store write failed")
    );
    consoleSpy.mockRestore();
  });

  it("preserves existing refresh_token when OIDC provider omits it from response", async () => {
    const pastExp = Math.floor(Date.now() / 1000) - 100;
    const newExp = Math.floor(Date.now() / 1000) + 3600;
    const user = {
      expires_at: pastExp,
      access_token: "old_access",
      refresh_token: "original_refresh",
      claims: { sub: "user1", exp: pastExp },
    };

    mockDiscovery.mockResolvedValue({ serverMetadata: () => ({}) });
    mockRefreshTokenGrant.mockResolvedValue({
      access_token: "new_access",
      refresh_token: undefined, // OIDC provider omits refresh token
      claims: () => ({ sub: "user1", exp: newExp }),
    });

    const { req, res, next } = createMockReqResNext({
      user,
      passportUser: { ...user },
    });
    req.sessionID = "test-preserve-refresh";

    await isAuthenticated(req, res, next);

    expect(next).toHaveBeenCalled();
    // The original refresh token must be preserved, not overwritten with undefined
    expect(user.refresh_token).toBe("original_refresh");
    expect(req.session.passport.user.refresh_token).toBe("original_refresh");
  });

  it("deduplicates concurrent refresh calls for the same session", async () => {
    const pastExp = Math.floor(Date.now() / 1000) - 100;
    const newExp = Math.floor(Date.now() / 1000) + 3600;

    // Use a deferred promise so we control when the refresh resolves
    let resolveRefresh!: (value: any) => void;
    const refreshPromise = new Promise((r) => { resolveRefresh = r; });

    mockDiscovery.mockResolvedValue({ serverMetadata: () => ({}) });
    mockRefreshTokenGrant.mockReset();
    mockRefreshTokenGrant.mockReturnValue(refreshPromise);

    const sharedSessionId = "test-dedup-session";

    const makeReq = () => {
      const user = {
        expires_at: pastExp,
        access_token: "old_access",
        refresh_token: "old_refresh",
        claims: { sub: "user1", exp: pastExp },
      };
      const saveFn = vi.fn((cb: (err?: any) => void) => cb());
      return {
        req: {
          isAuthenticated: () => true,
          user,
          sessionID: sharedSessionId,
          session: { passport: { user: {} }, save: saveFn },
        } as any,
        res: { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as any,
        next: vi.fn(),
      };
    };

    const r1 = makeReq();
    const r2 = makeReq();

    // Fire both concurrently — don't await yet
    const p1 = isAuthenticated(r1.req, r1.res, r1.next);
    const p2 = isAuthenticated(r2.req, r2.res, r2.next);

    // Resolve the single refresh
    resolveRefresh({
      access_token: "new_access",
      refresh_token: "new_refresh",
      claims: () => ({ sub: "user1", exp: newExp }),
    });

    await p1;
    await p2;

    // refreshTokenGrant should only have been called ONCE despite two concurrent requests
    expect(mockRefreshTokenGrant).toHaveBeenCalledTimes(1);
    expect(r1.next).toHaveBeenCalled();
    expect(r2.next).toHaveBeenCalled();

    // Both waiters' user objects must have the refreshed tokens
    expect(r1.req.user.access_token).toBe("new_access");
    expect(r2.req.user.access_token).toBe("new_access");
    expect(r2.req.user.refresh_token).toBe("new_refresh");
  });

  it("propagates refresh rejection to all concurrent waiters", async () => {
    const pastExp = Math.floor(Date.now() / 1000) - 100;

    let rejectRefresh!: (reason: any) => void;
    const refreshPromise = new Promise((_resolve, reject) => { rejectRefresh = reject; });

    mockDiscovery.mockResolvedValue({ serverMetadata: () => ({}) });
    mockRefreshTokenGrant.mockReset();
    mockRefreshTokenGrant.mockReturnValue(refreshPromise);

    const sharedSessionId = "test-dedup-reject";
    const makeReq = () => {
      const user = {
        expires_at: pastExp,
        access_token: "old",
        refresh_token: "old_refresh",
        claims: { sub: "user1", exp: pastExp },
      };
      const saveFn = vi.fn((cb: (err?: any) => void) => cb());
      return {
        req: {
          isAuthenticated: () => true,
          user,
          sessionID: sharedSessionId,
          session: { passport: { user: {} }, save: saveFn },
        } as any,
        res: { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as any,
        next: vi.fn(),
      };
    };

    const r1 = makeReq();
    const r2 = makeReq();

    const p1 = isAuthenticated(r1.req, r1.res, r1.next);
    const p2 = isAuthenticated(r2.req, r2.res, r2.next);

    rejectRefresh(new Error("invalid_grant"));

    await p1;
    await p2;

    // Both should get 401, neither should call next
    expect(r1.res.status).toHaveBeenCalledWith(401);
    expect(r2.res.status).toHaveBeenCalledWith(401);
    expect(r1.next).not.toHaveBeenCalled();
    expect(r2.next).not.toHaveBeenCalled();
  });
});
