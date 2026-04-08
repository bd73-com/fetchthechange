import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

const previousAppOwnerId = process.env.APP_OWNER_ID;

// ---------------------------------------------------------------------------
// Hoisted mock variables
// ---------------------------------------------------------------------------
const {
  mockGetUser,
  mockGetMonitors,
  mockDbSelect,
  mockDbUpdate,
  mockDbDelete,
  mockLimitFn,
  mockSelectWhereFn,
  mockSelectFromFn,
  mockOrderByFn,
  mockUpdateSetFn,
  mockUpdateWhereFn,
  mockUpdateReturningFn,
  mockDeleteWhereFn,
  mockSendNotificationEmail,
  mockGetDeliveryLog,
  mockGetMonitor,
  mockChannelTablesExist,
} = vi.hoisted(() => {
  const mockLimitFn = vi.fn();
  const mockOrderByFn = vi.fn(() => ({ limit: mockLimitFn }));
  const mockSelectWhereFn = vi.fn(() => ({ limit: mockLimitFn, orderBy: mockOrderByFn }));
  const mockSelectFromFn = vi.fn(() => ({ where: mockSelectWhereFn, orderBy: mockOrderByFn }));
  const mockDbSelect = vi.fn(() => ({ from: mockSelectFromFn }));

  const mockUpdateReturningFn = vi.fn().mockResolvedValue([]);
  const mockUpdateWhereFn = vi.fn(() => ({ returning: mockUpdateReturningFn }));
  const mockUpdateSetFn = vi.fn(() => ({ where: mockUpdateWhereFn }));
  const mockDbUpdate = vi.fn(() => ({ set: mockUpdateSetFn }));

  const mockDeleteWhereFn = vi.fn().mockResolvedValue(undefined);
  const mockDbDelete = vi.fn(() => ({ where: mockDeleteWhereFn }));

  return {
    mockGetUser: vi.fn(),
    mockGetMonitors: vi.fn(),
    mockGetDeliveryLog: vi.fn().mockResolvedValue([]),
    mockGetMonitor: vi.fn(),
    mockChannelTablesExist: vi.fn().mockResolvedValue(true),
    mockDbSelect,
    mockDbUpdate,
    mockDbDelete,
    mockLimitFn,
    mockSelectWhereFn,
    mockSelectFromFn,
    mockOrderByFn,
    mockUpdateSetFn,
    mockUpdateWhereFn,
    mockUpdateReturningFn,
    mockDeleteWhereFn,
    mockSendNotificationEmail: vi.fn(),
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
    getMonitor: (...args: any[]) => mockGetMonitor(...args),
    getMonitors: (...args: any[]) => mockGetMonitors(...args),
    getAllActiveMonitors: vi.fn().mockResolvedValue([]),
    deleteMonitor: vi.fn(),
    createMonitor: vi.fn(),
    updateMonitor: vi.fn(),
    getMonitorCount: vi.fn().mockResolvedValue(0),
    getDeliveryLog: (...args: any[]) => mockGetDeliveryLog(...args),
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
  sendNotificationEmail: (...args: any[]) => mockSendNotificationEmail(...args),
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

vi.mock("./services/notificationReady", () => ({
  notificationTablesExist: vi.fn().mockResolvedValue(true),
  channelTablesExist: (...args: any[]) => mockChannelTablesExist(...args),
}));

vi.mock("./services/scheduler", () => ({
  startScheduler: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./services/campaignEmail", () => ({
  sendTestCampaignEmail: vi.fn(),
  previewRecipients: vi.fn().mockResolvedValue({ count: 0, users: [] }),
  resolveRecipients: vi.fn().mockResolvedValue([]),
  triggerCampaignSend: vi.fn().mockResolvedValue({ totalRecipients: 0 }),
  cancelCampaign: vi.fn().mockResolvedValue({ sentSoFar: 0, cancelled: 0 }),
  reconcileCampaignCounters: vi.fn().mockResolvedValue({}),
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
  const mockHttpServer = {} as any;
  await registerRoutes(mockHttpServer, app as any);
  routesRegistered = true;
}

afterAll(() => {
  if (previousAppOwnerId === undefined) {
    delete process.env.APP_OWNER_ID;
  } else {
    process.env.APP_OWNER_ID = previousAppOwnerId;
  }
});

function ownerReq(overrides: any = {}) {
  return { user: { claims: { sub: "owner-123" } }, params: {}, body: {}, query: {}, ...overrides };
}

// ---------------------------------------------------------------------------
// #294 — Campaign routes NaN validation
// ---------------------------------------------------------------------------
describe("#294: Campaign routes reject invalid IDs", () => {
  const campaignRoutes = [
    { method: "get", path: "/api/admin/campaigns/:id", label: "GET campaign" },
    { method: "patch", path: "/api/admin/campaigns/:id", label: "PATCH campaign" },
    { method: "delete", path: "/api/admin/campaigns/:id", label: "DELETE campaign" },
    { method: "post", path: "/api/admin/campaigns/:id/send-test", label: "POST send-test" },
    { method: "post", path: "/api/admin/campaigns/:id/send", label: "POST send" },
    { method: "post", path: "/api/admin/campaigns/:id/cancel", label: "POST cancel" },
    { method: "get", path: "/api/admin/campaigns/:id/analytics", label: "GET analytics" },
  ];

  beforeEach(async () => {
    await ensureRoutes();
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockOrderByFn.mockReturnValue({ limit: mockLimitFn });
    mockSelectWhereFn.mockReturnValue({ limit: mockLimitFn, orderBy: mockOrderByFn });
    mockSelectFromFn.mockReturnValue({ where: mockSelectWhereFn, orderBy: mockOrderByFn });
    mockDbSelect.mockReturnValue({ from: mockSelectFromFn });
  });

  for (const route of campaignRoutes) {
    it(`${route.label} returns 400 for non-numeric ID "abc"`, async () => {
      const req = ownerReq({ params: { id: "abc" }, body: { name: "x", subject: "x", htmlBody: "x" } });
      const res = await callHandler(route.method, route.path, req);
      expect(res._status).toBe(400);
      expect(res._json).toEqual({ message: "Invalid campaign ID" });
    });

    it(`${route.label} returns 400 for negative ID "-1"`, async () => {
      const req = ownerReq({ params: { id: "-1" }, body: { name: "x", subject: "x", htmlBody: "x" } });
      const res = await callHandler(route.method, route.path, req);
      expect(res._status).toBe(400);
      expect(res._json).toEqual({ message: "Invalid campaign ID" });
    });

    it(`${route.label} returns 400 for zero ID "0"`, async () => {
      const req = ownerReq({ params: { id: "0" }, body: { name: "x", subject: "x", htmlBody: "x" } });
      const res = await callHandler(route.method, route.path, req);
      expect(res._status).toBe(400);
      expect(res._json).toEqual({ message: "Invalid campaign ID" });
    });

    it(`${route.label} returns 400 for float ID "1.5"`, async () => {
      const req = ownerReq({ params: { id: "1.5" }, body: { name: "x", subject: "x", htmlBody: "x" } });
      const res = await callHandler(route.method, route.path, req);
      expect(res._status).toBe(400);
      expect(res._json).toEqual({ message: "Invalid campaign ID" });
    });
  }
});

// ---------------------------------------------------------------------------
// #293 — Campaign PATCH empty body
// ---------------------------------------------------------------------------
describe("#293: PATCH /api/admin/campaigns/:id rejects empty body", () => {
  const ENDPOINT = "/api/admin/campaigns/:id";

  beforeEach(async () => {
    await ensureRoutes();
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockOrderByFn.mockReturnValue({ limit: mockLimitFn });
    mockSelectWhereFn.mockReturnValue({ limit: mockLimitFn, orderBy: mockOrderByFn });
    mockSelectFromFn.mockReturnValue({ where: mockSelectWhereFn, orderBy: mockOrderByFn });
    mockDbSelect.mockReturnValue({ from: mockSelectFromFn });
  });

  it("returns 400 when body is empty {}", async () => {
    mockLimitFn.mockResolvedValue([{ id: 1, status: "draft" }]);
    const req = ownerReq({ params: { id: "1" }, body: {} });
    const res = await callHandler("patch", ENDPOINT, req);
    expect(res._status).toBe(400);
    expect(res._json).toEqual({ message: "No valid fields to update" });
  });

  it("returns 400 when body has only unknown fields", async () => {
    mockLimitFn.mockResolvedValue([{ id: 1, status: "draft" }]);
    const req = ownerReq({ params: { id: "1" }, body: { unknownField: "value" } });
    const res = await callHandler("patch", ENDPOINT, req);
    expect(res._status).toBe(400);
    expect(res._json).toEqual({ message: "No valid fields to update" });
  });

  it("succeeds when body has a valid field", async () => {
    mockLimitFn.mockResolvedValue([{ id: 1, status: "draft" }]);
    mockUpdateReturningFn.mockResolvedValue([{ id: 1, name: "Updated", status: "draft" }]);
    const req = ownerReq({ params: { id: "1" }, body: { name: "Updated" } });
    const res = await callHandler("patch", ENDPOINT, req);
    expect(res._status).toBe(200);
    expect(res._json.name).toBe("Updated");
  });
});

// ---------------------------------------------------------------------------
// #292 — Error log list filters by resolved=false
// ---------------------------------------------------------------------------
describe("#292: GET /api/admin/error-logs filters by resolved=false", () => {
  const ENDPOINT = "/api/admin/error-logs";

  beforeEach(async () => {
    await ensureRoutes();
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([]);
    mockOrderByFn.mockReturnValue({ limit: mockLimitFn });
    mockSelectWhereFn.mockReturnValue({ limit: mockLimitFn, orderBy: mockOrderByFn });
    mockSelectFromFn.mockReturnValue({ where: mockSelectWhereFn, orderBy: mockOrderByFn });
    mockDbSelect.mockReturnValue({ from: mockSelectFromFn });
  });

  it("returns only unresolved entries (resolved entries excluded from list)", async () => {
    mockLimitFn.mockResolvedValue([
      { id: 1, context: null, resolved: false },
    ]);

    const req = ownerReq({ query: {} });
    const res = await callHandler("get", ENDPOINT, req);
    expect(res._status).toBe(200);
    // The WHERE clause now includes eq(errorLogs.resolved, false),
    // so the DB mock only returns unresolved entries. Verify the query was built.
    expect(mockSelectWhereFn).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// #288 — Single-delete filters already-deleted entries
// ---------------------------------------------------------------------------
describe("#288: DELETE /api/admin/error-logs/:id rejects already-deleted entries", () => {
  const ENDPOINT = "/api/admin/error-logs/:id";

  beforeEach(async () => {
    await ensureRoutes();
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitors.mockResolvedValue([]);
    mockOrderByFn.mockReturnValue({ limit: mockLimitFn });
    mockSelectWhereFn.mockReturnValue({ limit: mockLimitFn, orderBy: mockOrderByFn });
    mockSelectFromFn.mockReturnValue({ where: mockSelectWhereFn, orderBy: mockOrderByFn });
    mockDbSelect.mockReturnValue({ from: mockSelectFromFn });
    mockUpdateWhereFn.mockResolvedValue(undefined);
    mockUpdateSetFn.mockReturnValue({ where: mockUpdateWhereFn });
    mockDbUpdate.mockReturnValue({ set: mockUpdateSetFn });
  });

  it("returns 404 when entry is already soft-deleted (not found by query)", async () => {
    // The query now includes isNull(errorLogs.deletedAt), so a soft-deleted
    // entry won't be returned — mockLimitFn returns empty array
    mockLimitFn.mockResolvedValue([]);

    const req = ownerReq({ params: { id: "5" } });
    const res = await callHandler("delete", ENDPOINT, req);
    expect(res._status).toBe(404);
    expect(res._json).toEqual({ message: "Log entry not found" });
  });

  it("successfully soft-deletes a non-deleted entry", async () => {
    mockLimitFn.mockResolvedValue([{ id: 5, context: null, deletedAt: null }]);

    const req = ownerReq({ params: { id: "5" } });
    const res = await callHandler("delete", ENDPOINT, req);
    expect(res._status).toBe(200);
    expect(res._json).toEqual({ message: "Deleted" });
  });
});

// ---------------------------------------------------------------------------
// #287 — Email masked in test-email log
// ---------------------------------------------------------------------------
describe("#287: POST /api/test-email masks email in log output", () => {
  const ENDPOINT = "/api/test-email";

  beforeEach(async () => {
    await ensureRoutes();
    vi.clearAllMocks();
  });

  it("logs masked email instead of full email", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockGetUser.mockResolvedValue({
      id: "user-1",
      email: "alice@example.com",
      notificationEmail: "alice@example.com",
      tier: "pro",
    });
    mockSendNotificationEmail.mockResolvedValue({ success: true, id: "re_123", to: "alice@example.com", from: "noreply@example.com" });

    const req = ownerReq({ user: { claims: { sub: "user-1" } } });
    const res = await callHandler("post", ENDPOINT, req);

    // Find the log call that contains "[Test Email]"
    const testEmailLog = consoleSpy.mock.calls.find(
      (call) => typeof call[0] === "string" && call[0].includes("[Test Email]")
    );
    expect(testEmailLog).toBeDefined();
    // Should NOT contain the full email
    expect(testEmailLog![0]).not.toContain("alice@example.com");
    // Should contain masked version
    expect(testEmailLog![0]).toContain("a****@example.com");

    consoleSpy.mockRestore();
  });

  it("masks single-character local part emails correctly", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockGetUser.mockResolvedValue({
      id: "user-1",
      email: "a@example.com",
      notificationEmail: "a@example.com",
      tier: "pro",
    });
    mockSendNotificationEmail.mockResolvedValue({ success: true, id: "re_123", to: "a@example.com", from: "noreply@example.com" });

    const req = ownerReq({ user: { claims: { sub: "user-1" } } });
    await callHandler("post", ENDPOINT, req);

    const testEmailLog = consoleSpy.mock.calls.find(
      (call) => typeof call[0] === "string" && call[0].includes("[Test Email]")
    );
    expect(testEmailLog).toBeDefined();
    // Should NOT contain the full email — even single-char local parts are masked
    expect(testEmailLog![0]).not.toContain("a@example.com");
    expect(testEmailLog![0]).toContain("a*@example.com");

    consoleSpy.mockRestore();
  });

  it("logs [redacted] for malformed emails without @ sign", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockGetUser.mockResolvedValue({
      id: "user-1",
      email: "malformed-no-at",
      notificationEmail: "malformed-no-at",
      tier: "pro",
    });
    mockSendNotificationEmail.mockResolvedValue({ success: true, id: "re_123", to: "malformed-no-at", from: "noreply@example.com" });

    const req = ownerReq({ user: { claims: { sub: "user-1" } } });
    await callHandler("post", ENDPOINT, req);

    const testEmailLog = consoleSpy.mock.calls.find(
      (call) => typeof call[0] === "string" && call[0].includes("[Test Email]")
    );
    expect(testEmailLog).toBeDefined();
    expect(testEmailLog![0]).not.toContain("malformed-no-at");
    expect(testEmailLog![0]).toContain("[redacted]");

    consoleSpy.mockRestore();
  });

  it("returns 400 early when user has no email (never reaches log line)", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockGetUser.mockResolvedValue({
      id: "user-1",
      email: null,
      notificationEmail: null,
      tier: "pro",
    });

    const req = ownerReq({ user: { claims: { sub: "user-1" } } });
    const res = await callHandler("post", ENDPOINT, req);

    expect(res._status).toBe(400);
    expect(res._json).toEqual({
      success: false,
      message: "No email address found for your account",
    });

    // The log line should NOT be reached when there's no email
    const testEmailLog = consoleSpy.mock.calls.find(
      (call) => typeof call[0] === "string" && call[0].includes("[Test Email]")
    );
    expect(testEmailLog).toBeUndefined();

    consoleSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// #346 — app.param("id") validation rejects non-numeric IDs
// ---------------------------------------------------------------------------
describe("app.param id validation (#346)", () => {
  it("registers a param handler for 'id' during route setup", async () => {
    await ensureRoutes();
    const app = makeMockApp();
    const { registerRoutes } = await import("./routes");
    const mockHttpServer = {} as any;
    await registerRoutes(mockHttpServer, app as any);
    expect(app.param).toHaveBeenCalledWith("id", expect.any(Function));
  });

  it("rejects non-numeric id with 400", async () => {
    await ensureRoutes();
    const app = makeMockApp();
    const { registerRoutes } = await import("./routes");
    const mockHttpServer = {} as any;
    await registerRoutes(mockHttpServer, app as any);

    // Extract the param callback
    const paramCall = (app.param as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: any[]) => c[0] === "id"
    );
    expect(paramCall).toBeDefined();
    const paramHandler = paramCall![1];

    const res = makeRes();
    const next = vi.fn();
    paramHandler({}, res, next, "abc");
    expect(res._status).toBe(400);
    expect(res._json).toEqual({ message: "Invalid ID parameter" });
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects negative id with 400", async () => {
    await ensureRoutes();
    const app = makeMockApp();
    const { registerRoutes } = await import("./routes");
    const mockHttpServer = {} as any;
    await registerRoutes(mockHttpServer, app as any);

    const paramCall = (app.param as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: any[]) => c[0] === "id"
    );
    const paramHandler = paramCall![1];

    const res = makeRes();
    const next = vi.fn();
    paramHandler({}, res, next, "-5");
    expect(res._status).toBe(400);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects zero id with 400", async () => {
    await ensureRoutes();
    const app = makeMockApp();
    const { registerRoutes } = await import("./routes");
    const mockHttpServer = {} as any;
    await registerRoutes(mockHttpServer, app as any);

    const paramCall = (app.param as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: any[]) => c[0] === "id"
    );
    const paramHandler = paramCall![1];

    const res = makeRes();
    const next = vi.fn();
    paramHandler({}, res, next, "0");
    expect(res._status).toBe(400);
    expect(next).not.toHaveBeenCalled();
  });

  it("allows valid positive integer id", async () => {
    await ensureRoutes();
    const app = makeMockApp();
    const { registerRoutes } = await import("./routes");
    const mockHttpServer = {} as any;
    await registerRoutes(mockHttpServer, app as any);

    const paramCall = (app.param as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: any[]) => c[0] === "id"
    );
    const paramHandler = paramCall![1];

    const res = makeRes();
    const next = vi.fn();
    paramHandler({}, res, next, "42");
    expect(next).toHaveBeenCalled();
    expect(res._status).toBe(200); // unchanged from default
  });

  it("rejects float id with 400", async () => {
    await ensureRoutes();
    const app = makeMockApp();
    const { registerRoutes } = await import("./routes");
    const mockHttpServer = {} as any;
    await registerRoutes(mockHttpServer, app as any);

    const paramCall = (app.param as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: any[]) => c[0] === "id"
    );
    const paramHandler = paramCall![1];

    const res = makeRes();
    const next = vi.fn();
    paramHandler({}, res, next, "3.14");
    expect(res._status).toBe(400);
    expect(next).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// #373 — Negative limit query parameter causes 500 error
// ---------------------------------------------------------------------------
describe("#373: Negative limit query parameter is clamped to 1", () => {
  const DELIVERIES_ENDPOINT = "/api/monitors/:id/deliveries";
  const ERROR_LOGS_ENDPOINT = "/api/admin/error-logs";

  beforeEach(async () => {
    await ensureRoutes();
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetMonitor.mockResolvedValue({ id: 1, userId: "owner-123" });
    mockGetDeliveryLog.mockResolvedValue([]);
    mockChannelTablesExist.mockResolvedValue(true);
    mockGetMonitors.mockResolvedValue([]);
    mockOrderByFn.mockReturnValue({ limit: mockLimitFn });
    mockSelectWhereFn.mockReturnValue({ limit: mockLimitFn, orderBy: mockOrderByFn });
    mockSelectFromFn.mockReturnValue({ where: mockSelectWhereFn, orderBy: mockOrderByFn });
    mockDbSelect.mockReturnValue({ from: mockSelectFromFn });
    mockLimitFn.mockResolvedValue([]);
  });

  it("deliveries endpoint clamps limit=-1 to 1", async () => {
    const req = ownerReq({ params: { id: "1" }, query: { limit: "-1" } });
    const res = await callHandler("get", DELIVERIES_ENDPOINT, req);
    expect(res._status).toBe(200);
    // getDeliveryLog should be called with clamped limit of 1, not -1
    expect(mockGetDeliveryLog).toHaveBeenCalledWith(1, 1, undefined);
  });

  it("deliveries endpoint defaults limit to 50 for non-numeric input", async () => {
    const req = ownerReq({ params: { id: "1" }, query: { limit: "abc" } });
    const res = await callHandler("get", DELIVERIES_ENDPOINT, req);
    expect(res._status).toBe(200);
    expect(mockGetDeliveryLog).toHaveBeenCalledWith(1, 50, undefined);
  });

  it("deliveries endpoint caps limit at 200", async () => {
    const req = ownerReq({ params: { id: "1" }, query: { limit: "999" } });
    const res = await callHandler("get", DELIVERIES_ENDPOINT, req);
    expect(res._status).toBe(200);
    expect(mockGetDeliveryLog).toHaveBeenCalledWith(1, 200, undefined);
  });

  it("deliveries endpoint treats limit=0 as default (50)", async () => {
    const req = ownerReq({ params: { id: "1" }, query: { limit: "0" } });
    const res = await callHandler("get", DELIVERIES_ENDPOINT, req);
    expect(res._status).toBe(200);
    // Number("0") is falsy, so || 50 kicks in, then Math.max(1, 50) = 50
    expect(mockGetDeliveryLog).toHaveBeenCalledWith(1, 50, undefined);
  });

  it("error-logs endpoint clamps limit=-1 to 1", async () => {
    const req = ownerReq({ query: { limit: "-1" } });
    const res = await callHandler("get", ERROR_LOGS_ENDPOINT, req);
    expect(res._status).toBe(200);
    // The DB select chain should have .limit(1) called, not .limit(-1)
    expect(mockLimitFn).toHaveBeenCalledWith(1);
  });

  it("error-logs endpoint defaults limit to 100 for non-numeric input", async () => {
    const req = ownerReq({ query: { limit: "abc" } });
    const res = await callHandler("get", ERROR_LOGS_ENDPOINT, req);
    expect(res._status).toBe(200);
    expect(mockLimitFn).toHaveBeenCalledWith(100);
  });

  it("error-logs endpoint caps limit at 500", async () => {
    const req = ownerReq({ query: { limit: "9999" } });
    const res = await callHandler("get", ERROR_LOGS_ENDPOINT, req);
    expect(res._status).toBe(200);
    expect(mockLimitFn).toHaveBeenCalledWith(500);
  });

  it("error-logs endpoint treats limit=0 as default (100)", async () => {
    const req = ownerReq({ query: { limit: "0" } });
    const res = await callHandler("get", ERROR_LOGS_ENDPOINT, req);
    expect(res._status).toBe(200);
    // Number("0") is falsy, so || 100 kicks in, then Math.max(1, 100) = 100
    expect(mockLimitFn).toHaveBeenCalledWith(100);
  });

  it("campaign analytics endpoint clamps limit=-1 to 1", async () => {
    const ANALYTICS_ENDPOINT = "/api/admin/campaigns/:id/analytics";
    // Campaign lookup returns a campaign
    const mockOffset = vi.fn().mockResolvedValue([]);
    mockLimitFn.mockReturnValue({ offset: mockOffset });
    mockOrderByFn.mockReturnValue({ limit: mockLimitFn });
    mockSelectWhereFn.mockReturnValue({ limit: mockLimitFn, orderBy: mockOrderByFn });
    mockSelectFromFn.mockReturnValue({ where: mockSelectWhereFn, orderBy: mockOrderByFn });
    mockDbSelect.mockReturnValue({ from: mockSelectFromFn });

    // First .limit(1) call returns the campaign, second .limit(n) returns recipients
    let callCount = 0;
    mockLimitFn.mockImplementation((n: number) => {
      callCount++;
      if (callCount === 1) return Promise.resolve([{ id: 1, name: "Test" }]); // campaign lookup
      return { offset: mockOffset }; // recipients query
    });

    // db.execute returns breakdown + total
    const { db } = await import("./db");
    (db.execute as any).mockResolvedValue({ rows: [{ total: 0 }] });

    const req = ownerReq({ params: { id: "1" }, query: { limit: "-1" } });
    const res = await callHandler("get", ANALYTICS_ENDPOINT, req);
    expect(res._status).toBe(200);
    // Second .limit() call (paginated query) should receive 1, not -1.
    // First call is the campaign lookup with limit(1).
    expect(mockLimitFn).toHaveBeenNthCalledWith(2, 1);
  });

  it("campaign analytics endpoint defaults limit to 50 for non-numeric input", async () => {
    const ANALYTICS_ENDPOINT = "/api/admin/campaigns/:id/analytics";
    const mockOffset = vi.fn().mockResolvedValue([]);
    let callCount = 0;
    mockLimitFn.mockImplementation((_n: number) => {
      callCount++;
      if (callCount === 1) return Promise.resolve([{ id: 1, name: "Test" }]);
      return { offset: mockOffset };
    });
    mockOrderByFn.mockReturnValue({ limit: mockLimitFn });
    mockSelectWhereFn.mockReturnValue({ limit: mockLimitFn, orderBy: mockOrderByFn });
    mockSelectFromFn.mockReturnValue({ where: mockSelectWhereFn, orderBy: mockOrderByFn });
    mockDbSelect.mockReturnValue({ from: mockSelectFromFn });
    const { db } = await import("./db");
    (db.execute as any).mockResolvedValue({ rows: [{ total: 0 }] });

    const req = ownerReq({ params: { id: "1" }, query: { limit: "abc" } });
    const res = await callHandler("get", ANALYTICS_ENDPOINT, req);
    expect(res._status).toBe(200);
    expect(mockLimitFn).toHaveBeenNthCalledWith(2, 50);
  });

  it("campaign analytics endpoint caps limit at 100", async () => {
    const ANALYTICS_ENDPOINT = "/api/admin/campaigns/:id/analytics";
    const mockOffset = vi.fn().mockResolvedValue([]);
    let callCount = 0;
    mockLimitFn.mockImplementation((_n: number) => {
      callCount++;
      if (callCount === 1) return Promise.resolve([{ id: 1, name: "Test" }]);
      return { offset: mockOffset };
    });
    mockOrderByFn.mockReturnValue({ limit: mockLimitFn });
    mockSelectWhereFn.mockReturnValue({ limit: mockLimitFn, orderBy: mockOrderByFn });
    mockSelectFromFn.mockReturnValue({ where: mockSelectWhereFn, orderBy: mockOrderByFn });
    mockDbSelect.mockReturnValue({ from: mockSelectFromFn });
    const { db } = await import("./db");
    (db.execute as any).mockResolvedValue({ rows: [{ total: 0 }] });

    const req = ownerReq({ params: { id: "1" }, query: { limit: "999" } });
    const res = await callHandler("get", ANALYTICS_ENDPOINT, req);
    expect(res._status).toBe(200);
    expect(mockLimitFn).toHaveBeenNthCalledWith(2, 100);
  });

  it("campaign analytics endpoint treats limit=0 as default (50)", async () => {
    const ANALYTICS_ENDPOINT = "/api/admin/campaigns/:id/analytics";
    const mockOffset = vi.fn().mockResolvedValue([]);
    let callCount = 0;
    mockLimitFn.mockImplementation((_n: number) => {
      callCount++;
      if (callCount === 1) return Promise.resolve([{ id: 1, name: "Test" }]);
      return { offset: mockOffset };
    });
    mockOrderByFn.mockReturnValue({ limit: mockLimitFn });
    mockSelectWhereFn.mockReturnValue({ limit: mockLimitFn, orderBy: mockOrderByFn });
    mockSelectFromFn.mockReturnValue({ where: mockSelectWhereFn, orderBy: mockOrderByFn });
    mockDbSelect.mockReturnValue({ from: mockSelectFromFn });
    const { db } = await import("./db");
    (db.execute as any).mockResolvedValue({ rows: [{ total: 0 }] });

    const req = ownerReq({ params: { id: "1" }, query: { limit: "0" } });
    const res = await callHandler("get", ANALYTICS_ENDPOINT, req);
    expect(res._status).toBe(200);
    expect(mockLimitFn).toHaveBeenNthCalledWith(2, 50);
  });
});

// ---------------------------------------------------------------------------
// #378 — PATCH /api/monitors/:id returns 400 on invalid body (not 500)
// ---------------------------------------------------------------------------
describe("#378: PATCH /api/monitors/:id returns 400 on invalid request body", () => {
  const ENDPOINT = "/api/monitors/:id";

  beforeEach(async () => {
    await ensureRoutes();
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ tier: "free" });
    mockGetMonitor.mockResolvedValue({ id: 1, userId: "owner-123", active: true });
  });

  it("returns 400 with Zod message and code for wrong type on name field", async () => {
    const req = ownerReq({ params: { id: "1" }, body: { name: 12345 } });
    const res = await callHandler("patch", ENDPOINT, req);
    expect(res._status).toBe(400);
    expect(res._json).toHaveProperty("message");
    expect(typeof res._json.message).toBe("string");
    expect(res._json.message.length).toBeGreaterThan(0);
    expect(res._json.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 with Zod message and code for wrong type on url field", async () => {
    const req = ownerReq({ params: { id: "1" }, body: { url: 12345 } });
    const res = await callHandler("patch", ENDPOINT, req);
    expect(res._status).toBe(400);
    expect(res._json).toHaveProperty("message");
    expect(res._json.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 with Zod message and code for invalid active field type", async () => {
    const req = ownerReq({ params: { id: "1" }, body: { active: "not-a-boolean" } });
    const res = await callHandler("patch", ENDPOINT, req);
    expect(res._status).toBe(400);
    expect(res._json).toHaveProperty("message");
    expect(res._json.code).toBe("VALIDATION_ERROR");
  });
});
