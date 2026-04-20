import { describe, it, expect, vi, beforeEach } from "vitest";

const middlewareOrder: string[] = [];

const { mockStorage } = vi.hoisted(() => ({
  mockStorage: {
    getApiKeyByHash: vi.fn(),
    touchApiKey: vi.fn().mockResolvedValue(undefined),
    getMonitor: vi.fn(),
    getMonitorsPaginated: vi.fn(),
    getMonitorCount: vi.fn(),
    createMonitor: vi.fn(),
    updateMonitor: vi.fn(),
    deleteMonitor: vi.fn(),
    getMonitorChangesPaginated: vi.fn(),
  },
}));

vi.mock("../storage", () => ({ storage: mockStorage }));
vi.mock("../replit_integrations/auth/storage", () => ({
  authStorage: { getUser: vi.fn() },
}));
vi.mock("../utils/ssrf", () => ({ isPrivateUrl: vi.fn().mockResolvedValue(null) }));

// Mock db to break the transitive dependency chain
// (v1 → monitorValidation → scraper → db)
vi.mock("../db", () => ({ db: {}, pool: {} }));

// Mock apiKeyAuth to record execution order
vi.mock("../middleware/apiKeyAuth", () => ({
  default: (req: any, _res: any, next: any) => {
    middlewareOrder.push("apiKeyAuth");
    req.apiUser = { id: "user1", tier: "power", keyId: 1, keyPrefix: "ftc_abc12345" };
    next();
  },
}));

// Mock apiRateLimit to record execution order
vi.mock("../middleware/apiRateLimit", () => ({
  apiRateLimit: (_req: any, _res: any, next: any) => {
    middlewareOrder.push("apiRateLimit");
    next();
  },
}));

describe("v1 router middleware ordering", { timeout: 15_000 }, () => {
  beforeEach(() => {
    middlewareOrder.length = 0;
    vi.clearAllMocks();
  });

  it("rate limiter is registered before /ping in the router stack", async () => {
    const { default: router } = await import("./v1");
    const stack = router.stack;

    const layers = stack.map((layer: any) => ({
      name: layer.name,
      route: layer.route?.path,
    }));

    const pingIdx = layers.findIndex((l: any) => l.route === "/ping");

    // Count non-route middleware layers (use() calls) before ping
    const middlewareLayers = layers.slice(0, pingIdx).filter((l: any) => !l.route);

    // Should have at least 2 middleware layers before /ping: apiKeyAuth and apiRateLimit
    expect(middlewareLayers.length).toBeGreaterThanOrEqual(2);
    expect(pingIdx).toBeGreaterThan(0);
  });

  it("openapi.json route is the first item in the router stack", async () => {
    const { default: router } = await import("./v1");
    const firstLayer = router.stack[0];
    expect(firstLayer.route?.path).toBe("/openapi.json");
  });

  it("/ping route comes after both auth and rate limit middleware", async () => {
    const { default: router } = await import("./v1");
    const stack = router.stack;

    let authIdx = -1;
    let rateLimitIdx = -1;
    let pingIdx = -1;

    stack.forEach((layer: any, idx: number) => {
      if (layer.route?.path === "/ping") pingIdx = idx;
      // Middleware layers (use()) don't have a route
      if (!layer.route && authIdx === -1) authIdx = idx;
      if (!layer.route && authIdx !== -1 && idx > authIdx && rateLimitIdx === -1) rateLimitIdx = idx;
    });

    expect(authIdx).toBeGreaterThan(0); // after openapi.json
    expect(rateLimitIdx).toBeGreaterThan(authIdx);
    expect(pingIdx).toBeGreaterThan(rateLimitIdx);
  });
});

describe("v1 /ping response shape", { timeout: 15_000 }, () => {
  it("ping handler returns ok and keyPrefix without userId", async () => {
    const { default: router } = await import("./v1");
    const pingLayer = router.stack.find((l: any) => l.route?.path === "/ping");
    expect(pingLayer).toBeDefined();

    const handler = pingLayer.route.stack[0].handle;
    const req = { apiUser: { id: "user1", keyPrefix: "ftc_abc12345" } };
    let responseBody: any;
    const res = {
      json(body: any) { responseBody = body; return this; },
    };

    handler(req, res);
    expect(responseBody).toEqual({ ok: true, keyPrefix: "ftc_abc12345" });
    expect(responseBody).not.toHaveProperty("userId");
  });
});

describe("v1 PATCH /monitors/:id TOCTOU guard", { timeout: 15_000 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when updateMonitor returns undefined (concurrent delete)", async () => {
    const { default: router } = await import("./v1");
    const patchLayer = router.stack.find(
      (l: any) => l.route?.path === "/monitors/:id" && l.route?.methods?.patch,
    );
    expect(patchLayer).toBeDefined();

    const handler = patchLayer.route.stack[0].handle;

    mockStorage.getMonitor.mockResolvedValueOnce({ id: 1, userId: "user1", active: true });
    mockStorage.updateMonitor.mockResolvedValueOnce(undefined);

    const req = {
      apiUser: { id: "user1", tier: "power", keyPrefix: "ftc_abc12345" },
      params: { id: "1" },
      body: { name: "NewName" },
    };
    let statusCode = 200;
    let responseBody: any;
    const res = {
      status(code: number) { statusCode = code; return this; },
      json(body: any) { responseBody = body; return this; },
    };

    await handler(req, res);
    expect(statusCode).toBe(404);
    expect(responseBody).toEqual({ error: "Monitor not found", code: "NOT_FOUND" });
  });
});
