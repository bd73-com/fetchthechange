import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mock variables
// ---------------------------------------------------------------------------
const {
  mockGetMonitor,
  mockGetNotificationPreferences,
  mockUpsertNotificationPreferences,
  mockDeleteNotificationPreferences,
  mockNotificationTablesExist,
} = vi.hoisted(() => ({
  mockGetMonitor: vi.fn(),
  mockGetNotificationPreferences: vi.fn(),
  mockUpsertNotificationPreferences: vi.fn(),
  mockDeleteNotificationPreferences: vi.fn(),
  mockNotificationTablesExist: vi.fn().mockResolvedValue(true),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
vi.mock("./replit_integrations/auth", () => ({
  setupAuth: vi.fn().mockResolvedValue(undefined),
  registerAuthRoutes: vi.fn(),
  isAuthenticated: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("./replit_integrations/auth/storage", () => ({
  authStorage: { getUser: vi.fn() },
}));

vi.mock("./storage", () => ({
  storage: {
    getMonitor: (...args: any[]) => mockGetMonitor(...args),
    getMonitors: vi.fn().mockResolvedValue([]),
    getAllActiveMonitors: vi.fn().mockResolvedValue([]),
    deleteMonitor: vi.fn(),
    createMonitor: vi.fn(),
    updateMonitor: vi.fn(),
    getNotificationPreferences: (...args: any[]) => mockGetNotificationPreferences(...args),
    upsertNotificationPreferences: (...args: any[]) => mockUpsertNotificationPreferences(...args),
    deleteNotificationPreferences: (...args: any[]) => mockDeleteNotificationPreferences(...args),
  },
}));

vi.mock("./db", () => ({
  db: {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(), orderBy: vi.fn() })), orderBy: vi.fn() })) })),
    delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }) }),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })) })),
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
  startScheduler: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./services/notificationReady", () => ({
  notificationTablesExist: (...args: any[]) => mockNotificationTablesExist(...args),
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
    _body: null,
    status(code: number) { res._status = code; return res; },
    json(body: any) { res._json = body; return res; },
    send(body?: any) { res._body = body; return res; },
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

let routesRegistered = false;

async function ensureRoutes() {
  if (routesRegistered) return;
  process.env.APP_OWNER_ID = "owner-123";
  const { registerRoutes } = await import("./routes");
  const app = makeMockApp();
  await registerRoutes(app as any, app as any);
  routesRegistered = true;
}

const ENDPOINT = "/api/monitors/:id/notification-preferences";

function makeReq(userId = "user1") {
  return {
    params: { id: "1" },
    user: { claims: { sub: userId } },
    body: {},
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("GET /api/monitors/:id/notification-preferences", () => {
  beforeEach(async () => {
    await ensureRoutes();
    vi.clearAllMocks();
    mockNotificationTablesExist.mockResolvedValue(true);
  });

  it("returns defaults when notification tables do not exist", async () => {
    mockGetMonitor.mockResolvedValueOnce({ id: 1, userId: "user1" });
    mockNotificationTablesExist.mockResolvedValueOnce(false);

    const res = await callHandler("get", ENDPOINT, makeReq());

    expect(res._status).toBe(200);
    expect(res._json).toMatchObject({
      id: 0,
      monitorId: 1,
      digestMode: false,
      sensitivityThreshold: 0,
    });
    expect(mockGetNotificationPreferences).not.toHaveBeenCalled();
  });

  it("returns defaults when tables exist but no preferences saved", async () => {
    mockGetMonitor.mockResolvedValueOnce({ id: 1, userId: "user1" });
    mockNotificationTablesExist.mockResolvedValueOnce(true);
    mockGetNotificationPreferences.mockResolvedValueOnce(undefined);

    const res = await callHandler("get", ENDPOINT, makeReq());

    expect(res._status).toBe(200);
    expect(res._json).toMatchObject({ id: 0, monitorId: 1 });
  });

  it("returns saved preferences when they exist", async () => {
    const prefs = { id: 5, monitorId: 1, digestMode: true, sensitivityThreshold: 100 };
    mockGetMonitor.mockResolvedValueOnce({ id: 1, userId: "user1" });
    mockNotificationTablesExist.mockResolvedValueOnce(true);
    mockGetNotificationPreferences.mockResolvedValueOnce(prefs);

    const res = await callHandler("get", ENDPOINT, makeReq());

    expect(res._status).toBe(200);
    expect(res._json).toEqual(prefs);
  });

  it("returns 404 when monitor does not exist", async () => {
    mockGetMonitor.mockResolvedValueOnce(undefined);

    const res = await callHandler("get", ENDPOINT, makeReq());

    expect(res._status).toBe(404);
  });

  it("returns 403 when user does not own the monitor", async () => {
    mockGetMonitor.mockResolvedValueOnce({ id: 1, userId: "other-user" });

    const res = await callHandler("get", ENDPOINT, makeReq("user1"));

    expect(res._status).toBe(403);
  });
});

describe("PUT /api/monitors/:id/notification-preferences", () => {
  beforeEach(async () => {
    await ensureRoutes();
    vi.clearAllMocks();
    mockNotificationTablesExist.mockResolvedValue(true);
  });

  it("returns 503 when notification tables do not exist", async () => {
    mockGetMonitor.mockResolvedValueOnce({ id: 1, userId: "user1" });
    mockNotificationTablesExist.mockResolvedValueOnce(false);

    const req = makeReq();
    req.body = { digestMode: true };

    const res = await callHandler("put", ENDPOINT, req);

    expect(res._status).toBe(503);
    expect(res._json.message).toContain("not available yet");
    expect(mockUpsertNotificationPreferences).not.toHaveBeenCalled();
  });

  it("upserts preferences when tables exist", async () => {
    const savedPrefs = { id: 1, monitorId: 1, digestMode: true };
    mockGetMonitor.mockResolvedValueOnce({ id: 1, userId: "user1" });
    mockNotificationTablesExist.mockResolvedValueOnce(true);
    mockUpsertNotificationPreferences.mockResolvedValueOnce(savedPrefs);

    const req = makeReq();
    req.body = { digestMode: true };

    const res = await callHandler("put", ENDPOINT, req);

    expect(res._status).toBe(200);
    expect(res._json).toEqual(savedPrefs);
    expect(mockUpsertNotificationPreferences).toHaveBeenCalledWith(1, expect.objectContaining({
      digestMode: true,
    }));
  });

  it("returns 422 for invalid input", async () => {
    mockGetMonitor.mockResolvedValueOnce({ id: 1, userId: "user1" });
    mockNotificationTablesExist.mockResolvedValueOnce(true);

    const req = makeReq();
    req.body = { quietHoursStart: "invalid-format" };

    const res = await callHandler("put", ENDPOINT, req);

    expect(res._status).toBe(422);
  });
});

describe("DELETE /api/monitors/:id/notification-preferences", () => {
  beforeEach(async () => {
    await ensureRoutes();
    vi.clearAllMocks();
    mockNotificationTablesExist.mockResolvedValue(true);
  });

  it("returns 204 without calling storage when tables do not exist", async () => {
    mockGetMonitor.mockResolvedValueOnce({ id: 1, userId: "user1" });
    mockNotificationTablesExist.mockResolvedValueOnce(false);

    const res = await callHandler("delete", ENDPOINT, makeReq());

    expect(res._status).toBe(204);
    expect(mockDeleteNotificationPreferences).not.toHaveBeenCalled();
  });

  it("deletes preferences when tables exist", async () => {
    mockGetMonitor.mockResolvedValueOnce({ id: 1, userId: "user1" });
    mockNotificationTablesExist.mockResolvedValueOnce(true);
    mockDeleteNotificationPreferences.mockResolvedValueOnce(undefined);

    const res = await callHandler("delete", ENDPOINT, makeReq());

    expect(res._status).toBe(204);
    expect(mockDeleteNotificationPreferences).toHaveBeenCalledWith(1);
  });
});
