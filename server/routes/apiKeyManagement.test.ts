import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockStorage, mockAuthStorage } = vi.hoisted(() => ({
  mockStorage: {
    createApiKeyIfUnderLimit: vi.fn(),
    listApiKeys: vi.fn(),
    revokeApiKey: vi.fn(),
    countActiveApiKeys: vi.fn(),
  },
  mockAuthStorage: {
    getUser: vi.fn(),
  },
}));

vi.mock("../storage", () => ({ storage: mockStorage }));
vi.mock("../replit_integrations/auth/storage", () => ({ authStorage: mockAuthStorage }));
vi.mock("../replit_integrations/auth", () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: "user1" } };
    next();
  },
}));

import { API_RATE_LIMITS } from "@shared/models/auth";

describe("POST /api/keys — atomic key creation via createApiKeyIfUnderLimit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthStorage.getUser.mockResolvedValue({ id: "user1", tier: "power" });
  });

  it("calls createApiKeyIfUnderLimit with maxKeysPerUser from API_RATE_LIMITS", async () => {
    // Import the router to verify it uses the atomic method
    const { default: router } = await import("./apiKeyManagement");
    const postRoute = router.stack.find(
      (l: any) => l.route?.path === "/" && l.route?.methods?.post
    );
    expect(postRoute).toBeDefined();

    // Simulate the handler
    mockStorage.createApiKeyIfUnderLimit.mockResolvedValue({
      id: 1, name: "test", keyPrefix: "ftc_12345678", createdAt: "2026-03-06T00:00:00Z",
    });

    const req = {
      user: { claims: { sub: "user1" } },
      body: { name: "CI key" },
    };
    let statusCode = 200;
    let responseBody: any;
    const res = {
      status(code: number) { statusCode = code; return this; },
      json(body: any) { responseBody = body; return this; },
    };

    const handler = postRoute.route.stack.find((h: any) => h.name !== "isAuthenticated")?.handle;
    // We need to call through the middleware chain
    // The isAuthenticated mock already sets req.user, so call the actual route handler
    await new Promise<void>((resolve) => {
      const fakeNext = () => resolve();
      // Get all handlers on the route
      const handlers = postRoute.route.stack.map((h: any) => h.handle);
      // Execute them in sequence
      let idx = 0;
      const next = async () => {
        if (idx < handlers.length) {
          const h = handlers[idx++];
          await h(req, res, next);
        }
        resolve();
      };
      next();
    });

    expect(mockStorage.createApiKeyIfUnderLimit).toHaveBeenCalledTimes(1);
    const [userId, name, keyHash, keyPrefix, maxKeys] = mockStorage.createApiKeyIfUnderLimit.mock.calls[0];
    expect(userId).toBe("user1");
    expect(name).toBe("CI key");
    expect(typeof keyHash).toBe("string");
    expect(keyHash).toHaveLength(64); // SHA-256 hex
    expect(typeof keyPrefix).toBe("string");
    expect(keyPrefix).toMatch(/^ftc_/);
    expect(maxKeys).toBe(API_RATE_LIMITS.maxKeysPerUser);
  });

  it("returns 400 KEY_LIMIT_REACHED when createApiKeyIfUnderLimit returns null", async () => {
    mockStorage.createApiKeyIfUnderLimit.mockResolvedValue(null);
    const { default: router } = await import("./apiKeyManagement");
    const postRoute = router.stack.find(
      (l: any) => l.route?.path === "/" && l.route?.methods?.post
    );

    const req = {
      user: { claims: { sub: "user1" } },
      body: { name: "CI key" },
    };
    let statusCode = 200;
    let responseBody: any;
    const res = {
      status(code: number) { statusCode = code; return this; },
      json(body: any) { responseBody = body; return this; },
    };

    await new Promise<void>((resolve) => {
      const handlers = postRoute.route.stack.map((h: any) => h.handle);
      let idx = 0;
      const next = async () => {
        if (idx < handlers.length) {
          const h = handlers[idx++];
          await h(req, res, next);
        }
        resolve();
      };
      next();
    });

    expect(statusCode).toBe(400);
    expect(responseBody.code).toBe("KEY_LIMIT_REACHED");
    expect(responseBody.message).toContain("at most");
  });

  it("returns 201 with key (but not keyHash) when creation succeeds", async () => {
    mockStorage.createApiKeyIfUnderLimit.mockResolvedValue({
      id: 42, name: "CI key", keyPrefix: "ftc_abc12345", createdAt: "2026-03-06T00:00:00Z",
    });
    const { default: router } = await import("./apiKeyManagement");
    const postRoute = router.stack.find(
      (l: any) => l.route?.path === "/" && l.route?.methods?.post
    );

    const req = {
      user: { claims: { sub: "user1" } },
      body: { name: "CI key" },
    };
    let statusCode = 200;
    let responseBody: any;
    const res = {
      status(code: number) { statusCode = code; return this; },
      json(body: any) { responseBody = body; return this; },
    };

    await new Promise<void>((resolve) => {
      const handlers = postRoute.route.stack.map((h: any) => h.handle);
      let idx = 0;
      const next = async () => {
        if (idx < handlers.length) {
          const h = handlers[idx++];
          await h(req, res, next);
        }
        resolve();
      };
      next();
    });

    expect(statusCode).toBe(201);
    expect(responseBody.id).toBe(42);
    expect(responseBody.name).toBe("CI key");
    expect(responseBody.key).toMatch(/^ftc_[a-f0-9]{64}$/);
    expect(responseBody).not.toHaveProperty("keyHash");
  });

  it("does not call createApiKeyIfUnderLimit for non-power tier", async () => {
    mockAuthStorage.getUser.mockResolvedValue({ id: "user1", tier: "pro" });
    const { default: router } = await import("./apiKeyManagement");
    const postRoute = router.stack.find(
      (l: any) => l.route?.path === "/" && l.route?.methods?.post
    );

    const req = {
      user: { claims: { sub: "user1" } },
      body: { name: "CI key" },
    };
    let statusCode = 200;
    let responseBody: any;
    const res = {
      status(code: number) { statusCode = code; return this; },
      json(body: any) { responseBody = body; return this; },
    };

    await new Promise<void>((resolve) => {
      const handlers = postRoute.route.stack.map((h: any) => h.handle);
      let idx = 0;
      const next = async () => {
        if (idx < handlers.length) {
          const h = handlers[idx++];
          await h(req, res, next);
        }
        resolve();
      };
      next();
    });

    expect(statusCode).toBe(403);
    expect(responseBody.code).toBe("TIER_LIMIT_REACHED");
    expect(mockStorage.createApiKeyIfUnderLimit).not.toHaveBeenCalled();
  });

  it("does not call old countActiveApiKeys + createApiKey pattern", async () => {
    // Verify the route no longer uses the non-atomic methods
    mockStorage.createApiKeyIfUnderLimit.mockResolvedValue({
      id: 1, name: "test", keyPrefix: "ftc_12345678", createdAt: "2026-03-06T00:00:00Z",
    });
    const { default: router } = await import("./apiKeyManagement");
    const postRoute = router.stack.find(
      (l: any) => l.route?.path === "/" && l.route?.methods?.post
    );

    const req = {
      user: { claims: { sub: "user1" } },
      body: { name: "test" },
    };
    const res = {
      status(_code: number) { return this; },
      json(_body: any) { return this; },
    };

    await new Promise<void>((resolve) => {
      const handlers = postRoute.route.stack.map((h: any) => h.handle);
      let idx = 0;
      const next = async () => {
        if (idx < handlers.length) {
          const h = handlers[idx++];
          await h(req, res, next);
        }
        resolve();
      };
      next();
    });

    // The old non-atomic countActiveApiKeys should never be called
    expect(mockStorage.countActiveApiKeys).not.toHaveBeenCalled();
  });
});
