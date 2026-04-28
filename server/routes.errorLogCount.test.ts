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
  adminErrorLogsRateLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("./services/scheduler", () => ({
  startScheduler: vi.fn().mockResolvedValue(undefined),
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
    param: vi.fn(),
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

  it("returns count of logs visible to app owner (matched rows from SQL)", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([]);
    // Ownership filter is now pushed into SQL (see #465), so the DB hands
    // back exactly the rows this user is authorized to see — no JS filter.
    // Owner with zero monitors sees only system logs (monitor_id IS NULL).
    mockLimitFn.mockResolvedValue([{ id: 1 }, { id: 2 }]);

    const req = { user: { claims: { sub: "owner-123" } } };
    const res = await callHandler("get", ENDPOINT, req);
    expect(res._status).toBe(200);
    expect(res._json).toEqual({ count: 2 });
  });

  it("returns count filtered to user's monitors for non-owner", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([{ id: 5 }, { id: 10 }]);
    // SQL `WHERE monitor_id IN (5, 10)` returns only the user's matches.
    mockLimitFn.mockResolvedValue([{ id: 1 }, { id: 2 }]);

    const req = { user: { claims: { sub: "non-owner-user" } } };
    const res = await callHandler("get", ENDPOINT, req);
    expect(res._status).toBe(200);
    expect(res._json).toEqual({ count: 2 });
  });

  it("returns count 0 when no unresolved logs exist", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([{ id: 1 }]);
    mockLimitFn.mockResolvedValue([]);

    const req = { user: { claims: { sub: "owner-123" } } };
    const res = await callHandler("get", ENDPOINT, req);
    expect(res._status).toBe(200);
    expect(res._json).toEqual({ count: 0 });
  });

  it("returns count 0 when database throws an error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([{ id: 1 }]);
    mockLimitFn.mockRejectedValue(new Error("DB connection lost"));

    const req = { user: { claims: { sub: "owner-123" } } };
    const res = await callHandler("get", ENDPOINT, req);
    expect(res._status).toBe(200);
    expect(res._json).toEqual({ count: 0 });
    errorSpy.mockRestore();
  });

  it("non-owner with zero monitors short-circuits without hitting error_logs", async () => {
    // The fast-path in the route returns count: 0 without issuing the
    // error_logs SELECT — verifies that polling tabs from a Power-tier user
    // with no monitors don't amplify into N concurrent DB queries. See #465.
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([]);

    const req = { user: { claims: { sub: "non-owner" } } };
    const res = await callHandler("get", ENDPOINT, req);
    expect(res._status).toBe(200);
    expect(res._json).toEqual({ count: 0 });
    // No SELECT on error_logs was performed (LIMIT clause never invoked).
    expect(mockLimitFn).not.toHaveBeenCalled();
  });

  it("owner with zero monitors still queries for system-level logs", async () => {
    // Owner sees system logs (monitor_id IS NULL) even with no monitors,
    // so the SELECT must still run — only the ownership predicate narrows.
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([]);
    mockLimitFn.mockResolvedValue([{ id: 1 }]);

    const req = { user: { claims: { sub: "owner-123" } } };
    const res = await callHandler("get", ENDPOINT, req);
    expect(res._status).toBe(200);
    expect(res._json).toEqual({ count: 1 });
    expect(mockLimitFn).toHaveBeenCalled();
  });
});
