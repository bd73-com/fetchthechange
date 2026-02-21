import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mock variables
// ---------------------------------------------------------------------------
const {
  mockGetUser,
  mockGetMonitors,
  mockDbSelect,
  mockLimitFn,
  mockSelectWhereFn,
  mockSelectFromFn,
  mockOrderByFn,
} = vi.hoisted(() => {
  const mockLimitFn = vi.fn();
  const mockOrderByFn = vi.fn(() => ({ limit: mockLimitFn }));
  const mockSelectWhereFn = vi.fn(() => ({ limit: mockLimitFn, orderBy: mockOrderByFn }));
  const mockSelectFromFn = vi.fn(() => ({ where: mockSelectWhereFn, orderBy: mockOrderByFn }));
  const mockDbSelect = vi.fn(() => ({ from: mockSelectFromFn }));

  return {
    mockGetUser: vi.fn(),
    mockGetMonitors: vi.fn(),
    mockDbSelect,
    mockLimitFn,
    mockSelectWhereFn,
    mockSelectFromFn,
    mockOrderByFn,
  };
});

// ---------------------------------------------------------------------------
// Module mocks (same pattern as deleteErrorLog test)
// ---------------------------------------------------------------------------
vi.mock("./replit_integrations/auth", () => ({
  setupAuth: vi.fn().mockResolvedValue(undefined),
  registerAuthRoutes: vi.fn(),
  isAuthenticated: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("./replit_integrations/auth/storage", () => ({
  authStorage: {
    getUser: (...args: any[]) => mockGetUser(...args),
  },
}));

vi.mock("./storage", () => ({
  storage: {
    getMonitor: vi.fn(),
    getMonitors: (...args: any[]) => mockGetMonitors(...args),
    getAllActiveMonitors: vi.fn().mockResolvedValue([]),
    deleteMonitor: vi.fn(),
    createMonitor: vi.fn(),
    updateMonitor: vi.fn(),
    getMonitorCount: vi.fn().mockResolvedValue(0),
  },
}));

vi.mock("./db", () => ({
  db: {
    select: (...args: any[]) => mockDbSelect(...args),
    delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }) }),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }) }) }),
    execute: vi.fn().mockResolvedValue({ rows: [] }),
  },
}));

vi.mock("./services/logger", () => ({
  ErrorLogger: {
    error: vi.fn().mockResolvedValue(undefined),
    warning: vi.fn().mockResolvedValue(undefined),
    info: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("./services/scraper", () => ({
  checkMonitor: vi.fn(),
  extractWithBrowserless: vi.fn(),
  detectPageBlockReason: vi.fn().mockReturnValue({ blocked: false }),
  discoverSelectors: vi.fn(),
  validateCssSelector: vi.fn(),
  extractValueFromHtml: vi.fn(),
}));

vi.mock("./stripeClient", () => ({
  getUncachableStripeClient: vi.fn(),
  getStripePublishableKey: vi.fn().mockReturnValue("pk_test_123"),
}));

vi.mock("./services/email", () => ({
  sendNotificationEmail: vi.fn(),
}));

vi.mock("./services/browserlessTracker", () => ({
  BrowserlessUsageTracker: { getMonthlyUsage: vi.fn(), recordUsage: vi.fn() },
  getMonthResetDate: vi.fn().mockReturnValue("2026-03-01"),
}));

vi.mock("./services/resendTracker", () => ({
  ResendUsageTracker: { recordSend: vi.fn() },
  getResendResetDate: vi.fn().mockReturnValue("2026-03-01"),
}));

vi.mock("./middleware/rateLimiter", () => ({
  generalRateLimiter: (_req: any, _res: any, next: any) => next(),
  createMonitorRateLimiter: (_req: any, _res: any, next: any) => next(),
  checkMonitorRateLimiter: (_req: any, _res: any, next: any) => next(),
  suggestSelectorsRateLimiter: (_req: any, _res: any, next: any) => next(),
  emailUpdateRateLimiter: (_req: any, _res: any, next: any) => next(),
  contactFormRateLimiter: (_req: any, _res: any, next: any) => next(),
  unauthenticatedRateLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("./services/scheduler", () => ({
  startScheduler: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
type RouteHandler = (req: any, res: any, next?: any) => Promise<any>;
const registeredRoutes: Record<string, Record<string, RouteHandler[]>> = {};

function makeMockApp() {
  const makeRegistrar = (method: string) => (path: string, ...handlers: any[]) => {
    if (!registeredRoutes[method]) registeredRoutes[method] = {};
    registeredRoutes[method][path] = handlers;
  };
  return {
    get: makeRegistrar("get"),
    post: makeRegistrar("post"),
    put: makeRegistrar("put"),
    patch: makeRegistrar("patch"),
    delete: makeRegistrar("delete"),
    use: vi.fn(),
    set: vi.fn(),
  };
}

function makeRes() {
  const res: any = {
    _status: 200,
    _json: null,
    status(code: number) { res._status = code; return res; },
    json(body: any) { res._json = body; return res; },
    send(body: any) { res._body = body; return res; },
  };
  return res;
}

async function callHandler(method: string, path: string, req: any) {
  const handlers = registeredRoutes[method]?.[path];
  if (!handlers) throw new Error(`No handler for ${method.toUpperCase()} ${path}`);
  const res = makeRes();
  const handler = handlers[handlers.length - 1];
  await handler(req, res);
  return res;
}

// ---------------------------------------------------------------------------
// Register routes once
// ---------------------------------------------------------------------------
let routesRegistered = false;

async function ensureRoutes() {
  if (routesRegistered) return;
  process.env.APP_OWNER_ID = "owner-123";

  const { registerRoutes } = await import("./routes");
  const app = makeMockApp();
  await registerRoutes(app as any, app as any);
  routesRegistered = true;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("GET /api/admin/error-logs/count", () => {
  const ENDPOINT = "/api/admin/error-logs/count";

  beforeEach(async () => {
    await ensureRoutes();
    vi.clearAllMocks();

    // Reset chain mocks
    mockOrderByFn.mockReturnValue({ limit: mockLimitFn });
    mockSelectWhereFn.mockReturnValue({ limit: mockLimitFn, orderBy: mockOrderByFn });
    mockSelectFromFn.mockReturnValue({ where: mockSelectWhereFn, orderBy: mockOrderByFn });
    mockDbSelect.mockReturnValue({ from: mockSelectFromFn });
  });

  it("returns 401 with count 0 when user is not authenticated", async () => {
    const req = { user: null };
    const res = await callHandler("get", ENDPOINT, req);
    expect(res._status).toBe(401);
    expect(res._json).toEqual({ count: 0 });
  });

  it("returns 403 with count 0 when user is not power tier", async () => {
    mockGetUser.mockResolvedValue({ tier: "pro" });
    const req = { user: { claims: { sub: "user-1" } } };
    const res = await callHandler("get", ENDPOINT, req);
    expect(res._status).toBe(403);
    expect(res._json).toEqual({ count: 0 });
  });

  it("returns 403 with count 0 when user is null in database", async () => {
    mockGetUser.mockResolvedValue(null);
    const req = { user: { claims: { sub: "user-1" } } };
    const res = await callHandler("get", ENDPOINT, req);
    expect(res._status).toBe(403);
    expect(res._json).toEqual({ count: 0 });
  });

  it("returns count of logs visible to app owner", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([]);
    mockLimitFn.mockResolvedValue([
      { id: 1, context: null },
      { id: 2, context: { monitorId: 10 } },
      { id: 3, context: null },
    ]);

    const req = { user: { claims: { sub: "owner-123" } } };
    const res = await callHandler("get", ENDPOINT, req);
    expect(res._status).toBe(200);
    // Owner sees all 3: null context → owner-only, monitorId 10 → not in user monitors but fallback is owner
    // Actually monitorId 10 is numeric and not in userMonitorIds (empty set), so it's excluded
    // null context entries fall through to isAppOwner = true
    expect(res._json).toEqual({ count: 2 });
  });

  it("returns count filtered to user's monitors for non-owner", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([{ id: 5 }, { id: 10 }]);
    mockLimitFn.mockResolvedValue([
      { id: 1, context: { monitorId: 5 } },
      { id: 2, context: { monitorId: 10 } },
      { id: 3, context: { monitorId: 99 } },
      { id: 4, context: null },
    ]);

    const req = { user: { claims: { sub: "non-owner-user" } } };
    const res = await callHandler("get", ENDPOINT, req);
    expect(res._status).toBe(200);
    // Only monitors 5 and 10 match; monitorId 99 excluded, null context excluded (not owner)
    expect(res._json).toEqual({ count: 2 });
  });

  it("returns count 0 when no unresolved logs exist", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([]);
    mockLimitFn.mockResolvedValue([]);

    const req = { user: { claims: { sub: "owner-123" } } };
    const res = await callHandler("get", ENDPOINT, req);
    expect(res._status).toBe(200);
    expect(res._json).toEqual({ count: 0 });
  });

  it("returns count 0 when database throws an error", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockLimitFn.mockRejectedValue(new Error("DB connection lost"));

    const req = { user: { claims: { sub: "owner-123" } } };
    const res = await callHandler("get", ENDPOINT, req);
    expect(res._status).toBe(200);
    expect(res._json).toEqual({ count: 0 });
  });

  it("treats string monitorId as missing (non-owner gets 0)", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([{ id: 42 }]);
    mockLimitFn.mockResolvedValue([
      { id: 1, context: { monitorId: "42" } },
    ]);

    const req = { user: { claims: { sub: "non-owner" } } };
    const res = await callHandler("get", ENDPOINT, req);
    expect(res._status).toBe(200);
    // String "42" is not numeric, treated as absent, non-owner can't see
    expect(res._json).toEqual({ count: 0 });
  });

  it("owner sees logs with string monitorId (treated as system log)", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([]);
    mockLimitFn.mockResolvedValue([
      { id: 1, context: { monitorId: "injected" } },
    ]);

    const req = { user: { claims: { sub: "owner-123" } } };
    const res = await callHandler("get", ENDPOINT, req);
    expect(res._status).toBe(200);
    expect(res._json).toEqual({ count: 1 });
  });

  it("correctly counts mixed context types", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([{ id: 5 }]);
    mockLimitFn.mockResolvedValue([
      { id: 1, context: { monitorId: 5 } },          // numeric, matches
      { id: 2, context: { monitorId: "5" } },         // string → excluded
      { id: 3, context: null },                        // null → excluded (non-owner)
      { id: 4, context: { monitorId: 99 } },          // numeric, no match
      { id: 5, context: { other: "data" } },           // no monitorId → excluded
    ]);

    const req = { user: { claims: { sub: "non-owner" } } };
    const res = await callHandler("get", ENDPOINT, req);
    expect(res._status).toBe(200);
    expect(res._json).toEqual({ count: 1 });
  });
});
