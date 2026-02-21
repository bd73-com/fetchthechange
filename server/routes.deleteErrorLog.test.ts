import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mock variables
// ---------------------------------------------------------------------------
const {
  mockGetUser,
  mockGetMonitors,
  mockDbSelect,
  mockDbDelete,
  mockDbUpdate,
  mockLimitFn,
  mockSelectWhereFn,
  mockSelectFromFn,
  mockDeleteWhereFn,
  mockUpdateSetFn,
  mockUpdateWhereFn,
  mockOrderByFn,
} = vi.hoisted(() => {
  const mockLimitFn = vi.fn();
  const mockOrderByFn = vi.fn(() => ({ limit: mockLimitFn }));
  const mockSelectWhereFn = vi.fn(() => ({ limit: mockLimitFn, orderBy: mockOrderByFn }));
  const mockSelectFromFn = vi.fn(() => ({ where: mockSelectWhereFn, orderBy: mockOrderByFn }));
  const mockDbSelect = vi.fn(() => ({ from: mockSelectFromFn }));

  const mockDeleteWhereFn = vi.fn().mockResolvedValue(undefined);
  const mockDbDelete = vi.fn(() => ({ where: mockDeleteWhereFn }));

  const mockUpdateWhereFn = vi.fn().mockResolvedValue(undefined);
  const mockUpdateSetFn = vi.fn(() => ({ where: mockUpdateWhereFn }));
  const mockDbUpdate = vi.fn(() => ({ set: mockUpdateSetFn }));

  return {
    mockGetUser: vi.fn(),
    mockGetMonitors: vi.fn(),
    mockDbSelect,
    mockDbDelete,
    mockDbUpdate,
    mockLimitFn,
    mockSelectWhereFn,
    mockSelectFromFn,
    mockDeleteWhereFn,
    mockUpdateSetFn,
    mockUpdateWhereFn,
    mockOrderByFn,
  };
});

// ---------------------------------------------------------------------------
// Module mocks
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
  },
}));

vi.mock("./db", () => ({
  db: {
    select: (...args: any[]) => mockDbSelect(...args),
    delete: (...args: any[]) => mockDbDelete(...args),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }) }),
    update: (...args: any[]) => mockDbUpdate(...args),
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
// Helpers: capture route handlers from Express mock
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
  // Skip middleware (isAuthenticated), call the last handler directly
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
  // registerRoutes expects (httpServer, app) but we only need route registration
  await registerRoutes(app as any, app as any);
  routesRegistered = true;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("DELETE /api/admin/error-logs/:id", () => {
  const ENDPOINT = "/api/admin/error-logs/:id";

  beforeEach(async () => {
    await ensureRoutes();
    vi.clearAllMocks();

    // Reset db chain mocks after clearAllMocks
    mockOrderByFn.mockReturnValue({ limit: mockLimitFn });
    mockSelectWhereFn.mockReturnValue({ limit: mockLimitFn, orderBy: mockOrderByFn });
    mockSelectFromFn.mockReturnValue({ where: mockSelectWhereFn, orderBy: mockOrderByFn });
    mockDbSelect.mockReturnValue({ from: mockSelectFromFn });
    mockDeleteWhereFn.mockResolvedValue(undefined);
    mockDbDelete.mockReturnValue({ where: mockDeleteWhereFn });
    mockUpdateWhereFn.mockResolvedValue(undefined);
    mockUpdateSetFn.mockReturnValue({ where: mockUpdateWhereFn });
    mockDbUpdate.mockReturnValue({ set: mockUpdateSetFn });
  });

  it("returns 401 when user is not authenticated", async () => {
    const req = { user: null, params: { id: "1" } };
    const res = await callHandler("delete", ENDPOINT, req);
    expect(res._status).toBe(401);
    expect(res._json).toEqual({ message: "Unauthorized" });
  });

  it("returns 403 when user is not power tier", async () => {
    mockGetUser.mockResolvedValue({ tier: "pro" });
    const req = { user: { claims: { sub: "user-1" } }, params: { id: "1" } };
    const res = await callHandler("delete", ENDPOINT, req);
    expect(res._status).toBe(403);
    expect(res._json).toEqual({ message: "Admin access required" });
  });

  it("returns 403 when user is null in database", async () => {
    mockGetUser.mockResolvedValue(null);
    const req = { user: { claims: { sub: "user-1" } }, params: { id: "1" } };
    const res = await callHandler("delete", ENDPOINT, req);
    expect(res._status).toBe(403);
    expect(res._json).toEqual({ message: "Admin access required" });
  });

  it("returns 400 for non-numeric log ID", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    const req = { user: { claims: { sub: "owner-123" } }, params: { id: "abc" } };
    const res = await callHandler("delete", ENDPOINT, req);
    expect(res._status).toBe(400);
    expect(res._json).toEqual({ message: "Invalid log ID" });
  });

  it("returns 404 when log entry does not exist", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockLimitFn.mockResolvedValue([]);

    const req = { user: { claims: { sub: "owner-123" } }, params: { id: "99" } };
    const res = await callHandler("delete", ENDPOINT, req);
    expect(res._status).toBe(404);
    expect(res._json).toEqual({ message: "Log entry not found" });
  });

  it("soft-deletes log entry when user is app owner (no monitorId in context)", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([]);
    mockLimitFn.mockResolvedValue([{ id: 5, context: null }]);

    const req = { user: { claims: { sub: "owner-123" } }, params: { id: "5" } };
    const res = await callHandler("delete", ENDPOINT, req);
    expect(res._status).toBe(200);
    expect(res._json).toEqual({ message: "Deleted" });
    expect(mockDbUpdate).toHaveBeenCalled();
    expect(mockUpdateSetFn).toHaveBeenCalled();
    expect(mockUpdateWhereFn).toHaveBeenCalled();
  });

  it("deletes log entry when user owns the monitor referenced in context", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([{ id: 42 }]);
    mockLimitFn.mockResolvedValue([{ id: 10, context: { monitorId: 42 } }]);

    const req = { user: { claims: { sub: "user-power" } }, params: { id: "10" } };
    const res = await callHandler("delete", ENDPOINT, req);
    expect(res._status).toBe(200);
    expect(res._json).toEqual({ message: "Deleted" });
  });

  it("returns 403 when non-owner user's monitors don't match the log's monitorId", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([{ id: 99 }]);
    mockLimitFn.mockResolvedValue([{ id: 10, context: { monitorId: 42 } }]);

    const req = { user: { claims: { sub: "user-power" } }, params: { id: "10" } };
    const res = await callHandler("delete", ENDPOINT, req);
    expect(res._status).toBe(403);
    expect(res._json).toEqual({ message: "Not authorized to delete this log entry" });
  });

  it("returns 403 when non-owner tries to delete log with no monitorId in context", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([{ id: 1 }]);
    mockLimitFn.mockResolvedValue([{ id: 10, context: null }]);

    const req = { user: { claims: { sub: "not-the-owner" } }, params: { id: "10" } };
    const res = await callHandler("delete", ENDPOINT, req);
    expect(res._status).toBe(403);
    expect(res._json).toEqual({ message: "Not authorized to delete this log entry" });
  });

  it("returns 500 when database throws an error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockLimitFn.mockRejectedValue(new Error("DB connection lost"));

    const req = { user: { claims: { sub: "owner-123" } }, params: { id: "5" } };
    const res = await callHandler("delete", ENDPOINT, req);
    expect(res._status).toBe(500);
    expect(res._json).toEqual({ message: "Failed to delete error log" });
    errorSpy.mockRestore();
  });

  // --- ID validation edge cases (Number.isInteger + id > 0) ---

  it("returns 400 for id '0' (zero is not a valid serial ID)", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    const req = { user: { claims: { sub: "owner-123" } }, params: { id: "0" } };
    const res = await callHandler("delete", ENDPOINT, req);
    expect(res._status).toBe(400);
    expect(res._json).toEqual({ message: "Invalid log ID" });
  });

  it("returns 400 for negative id", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    const req = { user: { claims: { sub: "owner-123" } }, params: { id: "-1" } };
    const res = await callHandler("delete", ENDPOINT, req);
    expect(res._status).toBe(400);
    expect(res._json).toEqual({ message: "Invalid log ID" });
  });

  it("returns 400 for float id", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    const req = { user: { claims: { sub: "owner-123" } }, params: { id: "1.5" } };
    const res = await callHandler("delete", ENDPOINT, req);
    expect(res._status).toBe(400);
    expect(res._json).toEqual({ message: "Invalid log ID" });
  });

  it("returns 400 for empty string id", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    const req = { user: { claims: { sub: "owner-123" } }, params: { id: "" } };
    const res = await callHandler("delete", ENDPOINT, req);
    expect(res._status).toBe(400);
    expect(res._json).toEqual({ message: "Invalid log ID" });
  });

  // --- Type guard on context.monitorId ---

  it("treats string monitorId in context as missing (falls back to owner check)", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([{ id: 42 }]);
    // monitorId is a string, not a number — the type guard should ignore it
    mockLimitFn.mockResolvedValue([{ id: 10, context: { monitorId: "42" } }]);

    // Non-owner: should be denied because string monitorId is treated as absent
    const req = { user: { claims: { sub: "not-the-owner" } }, params: { id: "10" } };
    const res = await callHandler("delete", ENDPOINT, req);
    expect(res._status).toBe(403);
    expect(res._json).toEqual({ message: "Not authorized to delete this log entry" });
  });

  it("treats boolean monitorId in context as missing (falls back to owner check)", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([]);
    mockLimitFn.mockResolvedValue([{ id: 10, context: { monitorId: true } }]);

    // Owner should still be able to delete
    const req = { user: { claims: { sub: "owner-123" } }, params: { id: "10" } };
    const res = await callHandler("delete", ENDPOINT, req);
    expect(res._status).toBe(200);
    expect(res._json).toEqual({ message: "Deleted" });
  });

  it("treats context with empty object (no monitorId key) same as null context", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([]);
    mockLimitFn.mockResolvedValue([{ id: 10, context: {} }]);

    // Non-owner with no monitorId in context: denied
    const req = { user: { claims: { sub: "not-the-owner" } }, params: { id: "10" } };
    const res = await callHandler("delete", ENDPOINT, req);
    expect(res._status).toBe(403);
    expect(res._json).toEqual({ message: "Not authorized to delete this log entry" });
  });
});

// ---------------------------------------------------------------------------
// GET /api/admin/error-logs — context.monitorId type guard filtering
// ---------------------------------------------------------------------------
describe("GET /api/admin/error-logs — context type guard filtering", () => {
  const ENDPOINT = "/api/admin/error-logs";

  beforeEach(async () => {
    await ensureRoutes();
    vi.clearAllMocks();

    mockOrderByFn.mockReturnValue({ limit: mockLimitFn });
    mockSelectWhereFn.mockReturnValue({ limit: mockLimitFn, orderBy: mockOrderByFn });
    mockSelectFromFn.mockReturnValue({ where: mockSelectWhereFn, orderBy: mockOrderByFn });
    mockDbSelect.mockReturnValue({ from: mockSelectFromFn });
  });

  it("includes logs with numeric monitorId matching user's monitors", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([{ id: 10 }]);
    mockLimitFn.mockResolvedValue([
      { id: 1, context: { monitorId: 10 } },
      { id: 2, context: { monitorId: 99 } },
    ]);

    const req = { user: { claims: { sub: "user-power" } }, query: {} };
    const res = await callHandler("get", ENDPOINT, req);
    expect(res._status).toBe(200);
    // Only log with monitorId 10 should be included
    expect(res._json).toHaveLength(1);
    expect(res._json[0].id).toBe(1);
  });

  it("excludes logs with string monitorId (non-owner user)", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([{ id: 42 }]);
    // monitorId is a string "42" — type guard should treat it as undefined
    mockLimitFn.mockResolvedValue([
      { id: 1, context: { monitorId: "42" } },
    ]);

    const req = { user: { claims: { sub: "not-the-owner" } }, query: {} };
    const res = await callHandler("get", ENDPOINT, req);
    expect(res._status).toBe(200);
    // String monitorId treated as missing → non-owner can't see it
    expect(res._json).toHaveLength(0);
  });

  it("owner sees logs with string monitorId (treated as no-monitor system log)", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([]);
    // monitorId is a string — type guard treats it as absent → falls through to isAppOwner
    mockLimitFn.mockResolvedValue([
      { id: 1, context: { monitorId: "injected" } },
    ]);

    const req = { user: { claims: { sub: "owner-123" } }, query: {} };
    const res = await callHandler("get", ENDPOINT, req);
    expect(res._status).toBe(200);
    expect(res._json).toHaveLength(1);
  });

  it("excludes logs with boolean monitorId for non-owner", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([{ id: 1 }]);
    mockLimitFn.mockResolvedValue([
      { id: 1, context: { monitorId: true } },
    ]);

    const req = { user: { claims: { sub: "not-the-owner" } }, query: {} };
    const res = await callHandler("get", ENDPOINT, req);
    expect(res._status).toBe(200);
    expect(res._json).toHaveLength(0);
  });

  it("correctly filters mixed context types", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([{ id: 5 }]);
    mockLimitFn.mockResolvedValue([
      { id: 1, context: { monitorId: 5 } },          // numeric, matches → included
      { id: 2, context: { monitorId: "5" } },         // string → excluded (non-owner)
      { id: 3, context: null },                        // null context → excluded (non-owner)
      { id: 4, context: { monitorId: 99 } },          // numeric, doesn't match → excluded
      { id: 5, context: { other: "data" } },           // no monitorId key → excluded (non-owner)
    ]);

    const req = { user: { claims: { sub: "not-the-owner" } }, query: {} };
    const res = await callHandler("get", ENDPOINT, req);
    expect(res._status).toBe(200);
    expect(res._json).toHaveLength(1);
    expect(res._json[0].id).toBe(1);
  });
});
