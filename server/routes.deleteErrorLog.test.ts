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
    mockGetMonitors.mockResolvedValue([{ id: 1 }]);
    mockLimitFn.mockResolvedValue([]);

    const req = { user: { claims: { sub: "owner-123" } }, params: { id: "99" } };
    const res = await callHandler("delete", ENDPOINT, req);
    expect(res._status).toBe(404);
    expect(res._json).toEqual({ message: "Log entry not found" });
  });

  it("soft-deletes log entry when user is app owner (no monitorId in context)", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([]);
    // SQL ownership filter (#465) returned this row → user is authorized.
    mockLimitFn.mockResolvedValue([{ id: 5 }]);

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
    mockLimitFn.mockResolvedValue([{ id: 10 }]);

    const req = { user: { claims: { sub: "user-power" } }, params: { id: "10" } };
    const res = await callHandler("delete", ENDPOINT, req);
    expect(res._status).toBe(200);
    expect(res._json).toEqual({ message: "Deleted" });
  });

  it("returns 404 when non-owner user's monitors don't match the log's monitorId", async () => {
    // Ownership is enforced in SQL via #465 — the filter excludes rows the
    // user can't see, so the SELECT returns no row and the route reports
    // 404 ("Log entry not found"). The pre-#465 behavior of returning 403
    // ("Not authorized") was changed to 404 because distinguishing the two
    // states leaks the existence of logs scoped to other users' monitors.
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([{ id: 99 }]);
    mockLimitFn.mockResolvedValue([]);

    const req = { user: { claims: { sub: "user-power" } }, params: { id: "10" } };
    const res = await callHandler("delete", ENDPOINT, req);
    expect(res._status).toBe(404);
    expect(res._json).toEqual({ message: "Log entry not found" });
  });

  it("returns 404 when non-owner has zero monitors (short-circuits before SQL)", async () => {
    // Helper short-circuits when the user has no monitors and isn't owner —
    // no SELECT is issued, the response is 404. See #465.
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([]);

    const req = { user: { claims: { sub: "not-the-owner" } }, params: { id: "10" } };
    const res = await callHandler("delete", ENDPOINT, req);
    expect(res._status).toBe(404);
    expect(res._json).toEqual({ message: "Log entry not found" });
    // The SELECT was never reached because ownership === null short-circuits.
    expect(mockLimitFn).not.toHaveBeenCalled();
  });

  it("returns 500 when database throws an error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([{ id: 1 }]);
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

  // monitorId type-guard semantics moved to ErrorLogger.log (see
  // server/services/logger.test.ts). At write time, ErrorLogger denormalizes
  // numeric `context.monitorId` into the dedicated `monitor_id` column and
  // ignores non-numeric values. The route layer no longer inspects context —
  // ownership is decided by the SQL filter against `monitor_id`.
});

// ---------------------------------------------------------------------------
// GET /api/admin/error-logs — ownership filter pushed into SQL (#465)
// ---------------------------------------------------------------------------
describe("GET /api/admin/error-logs — SQL ownership filter", () => {
  const ENDPOINT = "/api/admin/error-logs";

  beforeEach(async () => {
    await ensureRoutes();
    vi.clearAllMocks();

    mockOrderByFn.mockReturnValue({ limit: mockLimitFn });
    mockSelectWhereFn.mockReturnValue({ limit: mockLimitFn, orderBy: mockOrderByFn });
    mockSelectFromFn.mockReturnValue({ where: mockSelectWhereFn, orderBy: mockOrderByFn });
    mockDbSelect.mockReturnValue({ from: mockSelectFromFn });
  });

  it("returns rows the SQL ownership filter handed back (no JS post-filter)", async () => {
    // After #465, the route trusts the SQL filter — whatever the SELECT
    // returns IS what the user is authorized to see. The route no longer
    // re-inspects context.monitorId in JS.
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([{ id: 10 }]);
    mockLimitFn.mockResolvedValue([{ id: 1 }]);

    const req = { user: { claims: { sub: "user-power" } }, query: {} };
    const res = await callHandler("get", ENDPOINT, req);
    expect(res._status).toBe(200);
    expect(res._json).toHaveLength(1);
    expect(res._json[0].id).toBe(1);
  });

  it("non-owner with zero monitors short-circuits to empty array (no SELECT issued)", async () => {
    // A Power-tier user with no monitors can't own any logs — the helper
    // returns null and the route bypasses the SELECT entirely. See #465.
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([]);

    const req = { user: { claims: { sub: "not-the-owner" } }, query: {} };
    const res = await callHandler("get", ENDPOINT, req);
    expect(res._status).toBe(200);
    expect(res._json).toEqual([]);
    expect(mockLimitFn).not.toHaveBeenCalled();
  });

  it("owner with zero monitors still queries (system-level logs visible)", async () => {
    // Owner sees system logs (monitor_id IS NULL) even when they own no
    // monitors, so the SELECT must run.
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([]);
    mockLimitFn.mockResolvedValue([{ id: 99 }]);

    const req = { user: { claims: { sub: "owner-123" } }, query: {} };
    const res = await callHandler("get", ENDPOINT, req);
    expect(res._status).toBe(200);
    expect(res._json).toHaveLength(1);
    expect(mockLimitFn).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/error-logs/batch-delete
// ---------------------------------------------------------------------------
describe("POST /api/admin/error-logs/batch-delete", () => {
  const ENDPOINT = "/api/admin/error-logs/batch-delete";

  beforeEach(async () => {
    await ensureRoutes();
    vi.clearAllMocks();

    // For batch endpoints:
    // - ID path: .where() resolves directly (no .limit/.orderBy)
    // - Filter path: .where().orderBy().limit(500)
    // Default to filter chain; ID-based tests override with mockResolvedValue.
    mockLimitFn.mockResolvedValue([]);
    mockOrderByFn.mockReturnValue({ limit: mockLimitFn });
    mockSelectWhereFn.mockReturnValue({ orderBy: mockOrderByFn, limit: mockLimitFn });
    mockSelectFromFn.mockReturnValue({ where: mockSelectWhereFn });
    mockDbSelect.mockReturnValue({ from: mockSelectFromFn });

    mockUpdateWhereFn.mockResolvedValue(undefined);
    mockUpdateSetFn.mockReturnValue({ where: mockUpdateWhereFn });
    mockDbUpdate.mockReturnValue({ set: mockUpdateSetFn });
  });

  it("returns 401 when user is not authenticated", async () => {
    const req = { user: null, body: { ids: [1] } };
    const res = await callHandler("post", ENDPOINT, req);
    expect(res._status).toBe(401);
    expect(res._json).toEqual({ message: "Unauthorized" });
  });

  it("returns 403 when user is not power tier", async () => {
    mockGetUser.mockResolvedValue({ tier: "pro" });
    const req = { user: { claims: { sub: "user-1" } }, body: { ids: [1] } };
    const res = await callHandler("post", ENDPOINT, req);
    expect(res._status).toBe(403);
    expect(res._json).toEqual({ message: "Admin access required" });
  });

  it("returns 400 when neither ids nor filters provided", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    const req = { user: { claims: { sub: "owner-123" } }, body: {} };
    const res = await callHandler("post", ENDPOINT, req);
    expect(res._status).toBe(400);
    expect(res._json.message).toBe("Invalid request body");
  });

  it("returns 400 when both ids and filters provided", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    const req = { user: { claims: { sub: "owner-123" } }, body: { ids: [1], filters: { level: "error" } } };
    const res = await callHandler("post", ENDPOINT, req);
    expect(res._status).toBe(400);
    expect(res._json.message).toBe("Invalid request body");
  });

  it("returns 400 for empty ids array", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([]);
    const req = { user: { claims: { sub: "owner-123" } }, body: { ids: [] } };
    const res = await callHandler("post", ENDPOINT, req);
    expect(res._status).toBe(400);
    expect(res._json.message).toBe("Invalid request body");
  });

  it("returns 400 for ids containing non-integers", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([]);
    const req = { user: { claims: { sub: "owner-123" } }, body: { ids: [1, "abc", 3] } };
    const res = await callHandler("post", ENDPOINT, req);
    expect(res._status).toBe(400);
    expect(res._json.message).toBe("Invalid request body");
  });

  it("returns 400 for ids containing zero or negative values", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([]);
    const req = { user: { claims: { sub: "owner-123" } }, body: { ids: [0, -1] } };
    const res = await callHandler("post", ENDPOINT, req);
    expect(res._status).toBe(400);
    expect(res._json.message).toBe("Invalid request body");
  });

  it("soft-deletes authorized entries by IDs for app owner", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([]);
    // Ownership is in SQL — the SELECT only returns rows the user can act on.
    mockSelectWhereFn.mockResolvedValue([{ id: 1 }, { id: 2 }]);

    const req = { user: { claims: { sub: "owner-123" } }, body: { ids: [1, 2] } };
    const res = await callHandler("post", ENDPOINT, req);
    expect(res._status).toBe(200);
    expect(res._json).toEqual({ message: "2 entries deleted", count: 2 });
    expect(mockDbUpdate).toHaveBeenCalled();
    expect(mockUpdateSetFn).toHaveBeenCalled();
  });

  it("counts only what the SQL ownership filter returned (non-owner)", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([{ id: 10 }]);
    // Of the requested ids [1,2,3], only id=1 belongs to a monitor this user
    // owns; the SQL filter handed back exactly that row.
    mockSelectWhereFn.mockResolvedValue([{ id: 1 }]);

    const req = { user: { claims: { sub: "not-the-owner" } }, body: { ids: [1, 2, 3] } };
    const res = await callHandler("post", ENDPOINT, req);
    expect(res._status).toBe(200);
    expect(res._json).toEqual({ message: "1 entries deleted", count: 1 });
  });

  it("returns count 0 when no entries are authorized", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([{ id: 10 }]);
    mockSelectWhereFn.mockResolvedValue([]);

    const req = { user: { claims: { sub: "not-the-owner" } }, body: { ids: [1] } };
    const res = await callHandler("post", ENDPOINT, req);
    expect(res._status).toBe(200);
    expect(res._json).toEqual({ message: "0 entries deleted", count: 0 });
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it("non-owner with zero monitors short-circuits without SELECT (ids path)", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([]);

    const req = { user: { claims: { sub: "not-the-owner" } }, body: { ids: [1, 2, 3] } };
    const res = await callHandler("post", ENDPOINT, req);
    expect(res._status).toBe(200);
    expect(res._json).toEqual({ message: "0 entries deleted", count: 0 });
    expect(mockSelectWhereFn).not.toHaveBeenCalled();
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it("soft-deletes entries matching filters for app owner", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([]);
    mockLimitFn.mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }]);

    const req = { user: { claims: { sub: "owner-123" } }, body: { filters: { level: "error" } } };
    const res = await callHandler("post", ENDPOINT, req);
    expect(res._status).toBe(200);
    expect(res._json).toEqual({ message: "3 entries deleted", count: 3, hasMore: false });
    expect(mockDbUpdate).toHaveBeenCalled();
  });

  it("soft-deletes with filter and excludeIds", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([]);
    mockLimitFn.mockResolvedValue([{ id: 1 }, { id: 3 }]);

    const req = {
      user: { claims: { sub: "owner-123" } },
      body: { filters: { source: "scraper" }, excludeIds: [2] },
    };
    const res = await callHandler("post", ENDPOINT, req);
    expect(res._status).toBe(200);
    expect(res._json).toEqual({ message: "2 entries deleted", count: 2, hasMore: false });
  });

  it("rejects empty filters object", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([{ id: 10 }]);

    const req = { user: { claims: { sub: "not-the-owner" } }, body: { filters: {} } };
    const res = await callHandler("post", ENDPOINT, req);
    expect(res._status).toBe(400);
    expect(res._json.message).toBe("Invalid request body");
  });

  it("rejects excludeIds when combined with ids", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });

    const req = { user: { claims: { sub: "owner-123" } }, body: { ids: [1, 2, 3], excludeIds: [2] } };
    const res = await callHandler("post", ENDPOINT, req);
    expect(res._status).toBe(400);
    expect(res._json.message).toBe("Invalid request body");
  });

  it("applies ownership filtering with filters mode", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([{ id: 10 }]);
    // SQL filter narrows to authorized rows.
    mockLimitFn.mockResolvedValue([{ id: 1 }]);

    const req = { user: { claims: { sub: "not-the-owner" } }, body: { filters: { level: "error" } } };
    const res = await callHandler("post", ENDPOINT, req);
    expect(res._status).toBe(200);
    expect(res._json).toEqual({ message: "1 entries deleted", count: 1, hasMore: false });
  });

  it("returns hasMore true when filter query hits the 500-row limit", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([]);
    // Simulate exactly 500 rows returned (the limit)
    const entries = Array.from({ length: 500 }, (_, i) => ({ id: i + 1 }));
    mockLimitFn.mockResolvedValue(entries);

    const req = { user: { claims: { sub: "owner-123" } }, body: { filters: { level: "error" } } };
    const res = await callHandler("post", ENDPOINT, req);
    expect(res._status).toBe(200);
    expect(res._json.count).toBe(500);
    expect(res._json.hasMore).toBe(true);
  });

  it("rejects filters with only invalid values", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([]);

    const req = {
      user: { claims: { sub: "owner-123" } },
      body: { filters: { level: "critical", source: "unknown" } },
    };
    const res = await callHandler("post", ENDPOINT, req);
    expect(res._status).toBe(400);
    expect(res._json.message).toBe("Invalid request body");
  });

  it("rejects empty filters even with excludeIds", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([]);

    const req = {
      user: { claims: { sub: "owner-123" } },
      body: { filters: {}, excludeIds: ["abc", -1, 0] },
    };
    const res = await callHandler("post", ENDPOINT, req);
    expect(res._status).toBe(400);
    expect(res._json.message).toBe("Invalid request body");
  });

  it("rejects non-integer excludeIds with valid filters", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([]);

    const req = {
      user: { claims: { sub: "owner-123" } },
      body: { filters: { level: "error" }, excludeIds: ["abc", -1, 0] },
    };
    const res = await callHandler("post", ENDPOINT, req);
    expect(res._status).toBe(400);
    expect(res._json.message).toBe("Invalid request body");
  });

  it("rejects unexpected properties via strict schema", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });

    const req = {
      user: { claims: { sub: "owner-123" } },
      body: { ids: [1], extraProp: "should not be here" },
    };
    const res = await callHandler("post", ENDPOINT, req);
    expect(res._status).toBe(400);
    expect(res._json.message).toBe("Invalid request body");
    expect(res._json.errors).toBeDefined();
  });

  it("rejects filters with unexpected nested properties via strict schema", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });

    const req = {
      user: { claims: { sub: "owner-123" } },
      body: { filters: { level: "error", unknownField: true } },
    };
    const res = await callHandler("post", ENDPOINT, req);
    expect(res._status).toBe(400);
    expect(res._json.message).toBe("Invalid request body");
  });

  it("returns 500 when database throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([]);
    mockSelectWhereFn.mockRejectedValue(new Error("DB error"));

    const req = { user: { claims: { sub: "owner-123" } }, body: { ids: [1] } };
    const res = await callHandler("post", ENDPOINT, req);
    expect(res._status).toBe(500);
    expect(res._json).toEqual({ message: "Failed to batch delete error logs" });
    errorSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/error-logs/restore
// ---------------------------------------------------------------------------
describe("POST /api/admin/error-logs/restore", () => {
  const ENDPOINT = "/api/admin/error-logs/restore";

  beforeEach(async () => {
    await ensureRoutes();
    vi.clearAllMocks();

    // restore uses .where(...).orderBy(...).limit(500), so chain through mockOrderByFn/mockLimitFn
    mockLimitFn.mockResolvedValue([]);
    mockOrderByFn.mockReturnValue({ limit: mockLimitFn });
    mockSelectWhereFn.mockReturnValue({ orderBy: mockOrderByFn, limit: mockLimitFn });
    mockSelectFromFn.mockReturnValue({ where: mockSelectWhereFn });
    mockDbSelect.mockReturnValue({ from: mockSelectFromFn });

    mockUpdateWhereFn.mockResolvedValue(undefined);
    mockUpdateSetFn.mockReturnValue({ where: mockUpdateWhereFn });
    mockDbUpdate.mockReturnValue({ set: mockUpdateSetFn });
  });

  it("returns 401 when user is not authenticated", async () => {
    const req = { user: null, body: {} };
    const res = await callHandler("post", ENDPOINT, req);
    expect(res._status).toBe(401);
    expect(res._json).toEqual({ message: "Unauthorized" });
  });

  it("returns 403 when user is not power tier", async () => {
    mockGetUser.mockResolvedValue({ tier: "free" });
    const req = { user: { claims: { sub: "user-1" } }, body: {} };
    const res = await callHandler("post", ENDPOINT, req);
    expect(res._status).toBe(403);
    expect(res._json).toEqual({ message: "Admin access required" });
  });

  it("restores authorized soft-deleted entries for app owner", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([]);
    // SQL ownership filter (#465) returns only the rows the user owns.
    mockLimitFn.mockResolvedValue([{ id: 1 }, { id: 2 }]);

    const req = { user: { claims: { sub: "owner-123" } }, body: {} };
    const res = await callHandler("post", ENDPOINT, req);
    expect(res._status).toBe(200);
    expect(res._json).toEqual({ message: "2 entries restored", count: 2, hasMore: false });
    expect(mockDbUpdate).toHaveBeenCalled();
    expect(mockUpdateSetFn).toHaveBeenCalled();
  });

  it("counts only what the SQL ownership filter returned (non-owner)", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([{ id: 10 }]);
    // SQL filter returned only the row scoped to monitor 10.
    mockLimitFn.mockResolvedValue([{ id: 1 }]);

    const req = { user: { claims: { sub: "not-the-owner" } }, body: {} };
    const res = await callHandler("post", ENDPOINT, req);
    expect(res._status).toBe(200);
    expect(res._json).toEqual({ message: "1 entries restored", count: 1, hasMore: false });
  });

  it("non-owner with zero monitors short-circuits without SELECT", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([]);

    const req = { user: { claims: { sub: "not-the-owner" } }, body: {} };
    const res = await callHandler("post", ENDPOINT, req);
    expect(res._status).toBe(200);
    expect(res._json).toEqual({ message: "0 entries restored", count: 0, hasMore: false });
    expect(mockLimitFn).not.toHaveBeenCalled();
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it("returns count 0 when no soft-deleted entries exist", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([]);
    mockLimitFn.mockResolvedValue([]);

    const req = { user: { claims: { sub: "owner-123" } }, body: {} };
    const res = await callHandler("post", ENDPOINT, req);
    expect(res._status).toBe(200);
    expect(res._json).toEqual({ message: "0 entries restored", count: 0, hasMore: false });
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it("returns 500 when database throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([]);
    mockLimitFn.mockRejectedValue(new Error("DB error"));

    const req = { user: { claims: { sub: "owner-123" } }, body: {} };
    const res = await callHandler("post", ENDPOINT, req);
    expect(res._status).toBe(500);
    expect(res._json).toEqual({ message: "Failed to restore error logs" });
    errorSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/error-logs/finalize
// ---------------------------------------------------------------------------
describe("POST /api/admin/error-logs/finalize", () => {
  const ENDPOINT = "/api/admin/error-logs/finalize";

  beforeEach(async () => {
    await ensureRoutes();
    vi.clearAllMocks();

    // finalize uses .where(...).orderBy(...).limit(500), so chain through mockOrderByFn/mockLimitFn
    mockLimitFn.mockResolvedValue([]);
    mockOrderByFn.mockReturnValue({ limit: mockLimitFn });
    mockSelectWhereFn.mockReturnValue({ orderBy: mockOrderByFn, limit: mockLimitFn });
    mockSelectFromFn.mockReturnValue({ where: mockSelectWhereFn });
    mockDbSelect.mockReturnValue({ from: mockSelectFromFn });

    mockDeleteWhereFn.mockResolvedValue(undefined);
    mockDbDelete.mockReturnValue({ where: mockDeleteWhereFn });
  });

  it("returns 401 when user is not authenticated", async () => {
    const req = { user: null, body: {} };
    const res = await callHandler("post", ENDPOINT, req);
    expect(res._status).toBe(401);
    expect(res._json).toEqual({ message: "Unauthorized" });
  });

  it("returns 403 when user is not power tier", async () => {
    mockGetUser.mockResolvedValue({ tier: "pro" });
    const req = { user: { claims: { sub: "user-1" } }, body: {} };
    const res = await callHandler("post", ENDPOINT, req);
    expect(res._status).toBe(403);
    expect(res._json).toEqual({ message: "Admin access required" });
  });

  it("hard-deletes authorized soft-deleted entries for app owner", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([]);
    mockLimitFn.mockResolvedValue([{ id: 1 }, { id: 2 }]);

    const req = { user: { claims: { sub: "owner-123" } }, body: {} };
    const res = await callHandler("post", ENDPOINT, req);
    expect(res._status).toBe(200);
    expect(res._json).toEqual({ message: "2 entries finalized", count: 2, hasMore: false });
    expect(mockDbDelete).toHaveBeenCalled();
    expect(mockDeleteWhereFn).toHaveBeenCalled();
  });

  it("counts only what the SQL ownership filter returned (non-owner)", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([{ id: 5 }]);
    // SQL filter returned only the row scoped to monitor 5.
    mockLimitFn.mockResolvedValue([{ id: 1 }]);

    const req = { user: { claims: { sub: "not-the-owner" } }, body: {} };
    const res = await callHandler("post", ENDPOINT, req);
    expect(res._status).toBe(200);
    expect(res._json).toEqual({ message: "1 entries finalized", count: 1, hasMore: false });
  });

  it("non-owner with zero monitors short-circuits without SELECT", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([]);

    const req = { user: { claims: { sub: "not-the-owner" } }, body: {} };
    const res = await callHandler("post", ENDPOINT, req);
    expect(res._status).toBe(200);
    expect(res._json).toEqual({ message: "0 entries finalized", count: 0, hasMore: false });
    expect(mockLimitFn).not.toHaveBeenCalled();
    expect(mockDbDelete).not.toHaveBeenCalled();
  });

  it("returns count 0 when no soft-deleted entries exist", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([]);
    mockLimitFn.mockResolvedValue([]);

    const req = { user: { claims: { sub: "owner-123" } }, body: {} };
    const res = await callHandler("post", ENDPOINT, req);
    expect(res._status).toBe(200);
    expect(res._json).toEqual({ message: "0 entries finalized", count: 0, hasMore: false });
    expect(mockDbDelete).not.toHaveBeenCalled();
  });

  it("returns 500 when database throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([]);
    mockLimitFn.mockRejectedValue(new Error("DB error"));

    const req = { user: { claims: { sub: "owner-123" } }, body: {} };
    const res = await callHandler("post", ENDPOINT, req);
    expect(res._status).toBe(500);
    expect(res._json).toEqual({ message: "Failed to finalize error logs" });
    errorSpy.mockRestore();
  });
});

describe("POST /api/test-email", () => {
  it("is registered as POST, not GET", async () => {
    await ensureRoutes();
    expect(registeredRoutes["post"]?.["/api/test-email"]).toBeDefined();
    expect(registeredRoutes["get"]?.["/api/test-email"]).toBeUndefined();
  });
});
