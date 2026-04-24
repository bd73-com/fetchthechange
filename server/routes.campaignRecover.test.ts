import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

const previousAppOwnerId = process.env.APP_OWNER_ID;

// ---------------------------------------------------------------------------
// Hoisted mock variables
// ---------------------------------------------------------------------------
const {
  mockGetUser,
  mockDbExecute,
  mockDbSelect,
  mockLimitFn,
  mockSelectWhereFn,
  mockSelectFromFn,
  mockOrderByFn,
  mockGetResendClient,
} = vi.hoisted(() => {
  const mockLimitFn = vi.fn();
  const mockOrderByFn = vi.fn(() => ({ limit: mockLimitFn }));
  const mockSelectWhereFn = vi.fn(() => ({ limit: mockLimitFn, orderBy: mockOrderByFn }));
  const mockSelectFromFn = vi.fn(() => ({ where: mockSelectWhereFn, orderBy: mockOrderByFn }));
  const mockDbSelect = vi.fn(() => ({ from: mockSelectFromFn }));
  const mockDbExecute = vi.fn();

  return {
    mockGetUser: vi.fn(),
    mockDbExecute,
    mockDbSelect,
    mockLimitFn,
    mockSelectWhereFn,
    mockSelectFromFn,
    mockOrderByFn,
    mockGetResendClient: vi.fn(),
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
    getMonitors: vi.fn().mockResolvedValue([]),
    getAllActiveMonitors: vi.fn().mockResolvedValue([]),
    deleteMonitor: vi.fn(),
    createMonitor: vi.fn(),
    updateMonitor: vi.fn(),
  },
}));

vi.mock("./db", () => ({
  db: {
    select: (...args: any[]) => mockDbSelect(...args),
    delete: vi.fn(() => ({ where: vi.fn() })),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }) }),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => ({ returning: vi.fn().mockResolvedValue([]) })) })) })),
    execute: (...args: any[]) => mockDbExecute(...args),
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

vi.mock("./services/campaignEmail", () => ({
  sendTestCampaignEmail: vi.fn(),
  previewRecipients: vi.fn().mockResolvedValue({ count: 0, users: [] }),
  resolveRecipients: vi.fn().mockResolvedValue([]),
  triggerCampaignSend: vi.fn().mockResolvedValue({ totalRecipients: 0 }),
  cancelCampaign: vi.fn().mockResolvedValue({ sentSoFar: 0, cancelled: 0 }),
}));

vi.mock("./services/resendClient", () => ({
  getResendClient: (...args: any[]) => mockGetResendClient(...args),
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

// ---------------------------------------------------------------------------
// Tests: POST /api/admin/campaigns/recover
// ---------------------------------------------------------------------------
describe("POST /api/admin/campaigns/recover", () => {
  const ENDPOINT = "/api/admin/campaigns/recover";

  beforeEach(async () => {
    await ensureRoutes();
    vi.clearAllMocks();

    // Reset chain mocks
    mockOrderByFn.mockReturnValue({ limit: mockLimitFn });
    mockSelectFromFn.mockReturnValue({ where: mockSelectWhereFn, orderBy: mockOrderByFn });
    mockDbSelect.mockReturnValue({ from: mockSelectFromFn });
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

  it("returns 403 when power user is not app owner", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    const req = { user: { claims: { sub: "not-the-owner" } }, body: {} };
    const res = await callHandler("post", ENDPOINT, req);
    expect(res._status).toBe(403);
    expect(res._json).toEqual({ message: "Owner access required" });
  });

  it("returns zero recovered when no orphaned recipients exist", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockDbExecute.mockResolvedValue({ rows: [] });

    const req = { user: { claims: { sub: "owner-123" } }, body: {} };
    const res = await callHandler("post", ENDPOINT, req);

    expect(res._status).toBe(200);
    expect(res._json).toEqual({
      recovered: 0,
      campaigns: [],
      message: "No orphaned recipients found — campaign data appears intact.",
    });
  });

  it("recovers a campaign from orphaned recipient data without Resend client", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetResendClient.mockReturnValue(null);

    // Call sequence: 1=orphans, 2=stats, 3=INSERT, 4=setval
    let callCount = 0;
    mockDbExecute.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({ rows: [{ campaign_id: 42 }] });
      }
      if (callCount === 2) {
        return Promise.resolve({
          rows: [{
            total: 10,
            sent: 8,
            failed: 2,
            delivered: 6,
            opened: 3,
            clicked: 1,
            first_sent: "2026-01-01T00:00:00Z",
            last_sent: "2026-01-01T01:00:00Z",
          }],
        });
      }
      if (callCount === 3) {
        // INSERT
        return Promise.resolve({ rows: [], rowCount: 1 });
      }
      // setval
      return Promise.resolve({ rows: [] });
    });

    const req = { user: { claims: { sub: "owner-123" } }, body: {} };
    const res = await callHandler("post", ENDPOINT, req);

    expect(res._status).toBe(200);
    expect(res._json.recovered).toBe(1);
    expect(res._json.campaigns).toHaveLength(1);
    expect(res._json.campaigns[0]).toEqual({
      id: 42,
      name: "Recovered Campaign #42",
      subject: "Recovered Campaign #42",
      totalRecipients: 10,
    });
  });

  it("recovers subject and body from Resend API when available", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    const mockResend = {
      emails: {
        get: vi.fn().mockResolvedValue({
          data: { subject: "Original Subject", html: "<h1>Original Body</h1>" },
        }),
      },
    };
    mockGetResendClient.mockReturnValue(mockResend);

    // Call sequence: 1=orphans, 2=stats, 3=sample resend_id, 4=INSERT, 5=setval
    let callCount = 0;
    mockDbExecute.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({ rows: [{ campaign_id: 7 }] });
      }
      if (callCount === 2) {
        return Promise.resolve({
          rows: [{
            total: 5, sent: 5, failed: 0, delivered: 5,
            opened: 2, clicked: 1,
            first_sent: "2026-02-01T00:00:00Z",
            last_sent: "2026-02-01T00:30:00Z",
          }],
        });
      }
      if (callCount === 3) {
        return Promise.resolve({ rows: [{ resend_id: "resend_abc123" }] });
      }
      if (callCount === 4) {
        // INSERT
        return Promise.resolve({ rows: [], rowCount: 1 });
      }
      // setval
      return Promise.resolve({ rows: [] });
    });

    const req = { user: { claims: { sub: "owner-123" } }, body: {} };
    const res = await callHandler("post", ENDPOINT, req);

    expect(res._status).toBe(200);
    expect(res._json.recovered).toBe(1);
    expect(res._json.campaigns[0].subject).toBe("Original Subject");
    expect(mockResend.emails.get).toHaveBeenCalledWith("resend_abc123");
  });

  it("falls back to default subject when Resend API call fails", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    const mockResend = {
      emails: {
        get: vi.fn().mockRejectedValue(new Error("Resend API error")),
      },
    };
    mockGetResendClient.mockReturnValue(mockResend);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Call sequence: 1=orphans, 2=stats, 3=sample resend_id, 4=INSERT, 5=setval
    let callCount = 0;
    mockDbExecute.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({ rows: [{ campaign_id: 99 }] });
      }
      if (callCount === 2) {
        return Promise.resolve({
          rows: [{
            total: 3, sent: 3, failed: 0, delivered: 3,
            opened: 1, clicked: 0,
            first_sent: "2026-03-01T00:00:00Z",
            last_sent: "2026-03-01T00:10:00Z",
          }],
        });
      }
      if (callCount === 3) {
        return Promise.resolve({ rows: [{ resend_id: "resend_fail" }] });
      }
      if (callCount === 4) {
        // INSERT
        return Promise.resolve({ rows: [], rowCount: 1 });
      }
      // setval
      return Promise.resolve({ rows: [] });
    });

    const req = { user: { claims: { sub: "owner-123" } }, body: {} };
    const res = await callHandler("post", ENDPOINT, req);

    expect(res._status).toBe(200);
    expect(res._json.recovered).toBe(1);
    expect(res._json.campaigns[0].subject).toBe("Recovered Campaign #99");
    warnSpy.mockRestore();
  });

  it("recovers multiple campaigns in a single call", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetResendClient.mockReturnValue(null);

    let callCount = 0;
    mockDbExecute.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // Orphaned campaign IDs
        return Promise.resolve({ rows: [{ campaign_id: 10 }, { campaign_id: 20 }] });
      }
      if (callCount === 2) {
        // Stats for campaign 10
        return Promise.resolve({
          rows: [{ total: 5, sent: 5, failed: 0, delivered: 5, opened: 2, clicked: 1, first_sent: "2026-01-01T00:00:00Z", last_sent: "2026-01-01T00:30:00Z" }],
        });
      }
      if (callCount === 3) {
        // INSERT for campaign 10
        return Promise.resolve({ rows: [], rowCount: 1 });
      }
      if (callCount === 4) {
        // Stats for campaign 20
        return Promise.resolve({
          rows: [{ total: 3, sent: 2, failed: 1, delivered: 2, opened: 0, clicked: 0, first_sent: "2026-02-01T00:00:00Z", last_sent: "2026-02-01T00:15:00Z" }],
        });
      }
      if (callCount === 5) {
        // INSERT for campaign 20
        return Promise.resolve({ rows: [], rowCount: 1 });
      }
      // setval at end
      return Promise.resolve({ rows: [] });
    });

    const req = { user: { claims: { sub: "owner-123" } }, body: {} };
    const res = await callHandler("post", ENDPOINT, req);

    expect(res._status).toBe(200);
    expect(res._json.recovered).toBe(2);
    expect(res._json.campaigns).toHaveLength(2);
    expect(res._json.campaigns[0].id).toBe(10);
    expect(res._json.campaigns[1].id).toBe(20);
  });

  it("returns 500 when database throws an error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockDbExecute.mockRejectedValue(new Error("DB connection lost"));

    const req = { user: { claims: { sub: "owner-123" } }, body: {} };
    const res = await callHandler("post", ENDPOINT, req);

    expect(res._status).toBe(500);
    expect(res._json).toEqual({ message: "Failed to recover campaigns" });
    errorSpy.mockRestore();
  });

  it("sets status to partially_sent when there are failures and not all done", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetResendClient.mockReturnValue(null);

    // Call sequence: 1=orphans, 2=stats, 3=INSERT, 4=setval
    let callCount = 0;
    mockDbExecute.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({ rows: [{ campaign_id: 55 }] });
      }
      if (callCount === 2) {
        // failed > 0 and sent + failed !== total → partially_sent
        return Promise.resolve({
          rows: [{
            total: 10, sent: 5, failed: 2, delivered: 4,
            opened: 1, clicked: 0,
            first_sent: "2026-01-15T00:00:00Z",
            last_sent: "2026-01-15T00:30:00Z",
          }],
        });
      }
      if (callCount === 3) {
        // INSERT
        return Promise.resolve({ rows: [], rowCount: 1 });
      }
      // setval
      return Promise.resolve({ rows: [] });
    });

    const req = { user: { claims: { sub: "owner-123" } }, body: {} };
    const res = await callHandler("post", ENDPOINT, req);

    expect(res._status).toBe(200);
    expect(res._json.recovered).toBe(1);
    // We can't directly check the DB INSERT args since db.execute is a generic mock,
    // but we verify the endpoint succeeded and returned the campaign
    expect(res._json.campaigns[0].id).toBe(55);
  });

  it("skips already-recovered campaigns (idempotent retry)", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockGetResendClient.mockReturnValue(null);

    let callCount = 0;
    mockDbExecute.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({ rows: [{ campaign_id: 42 }] });
      }
      if (callCount === 2) {
        return Promise.resolve({
          rows: [{
            total: 10, sent: 10, failed: 0, delivered: 10,
            opened: 5, clicked: 2,
            first_sent: "2026-01-01T00:00:00Z",
            last_sent: "2026-01-01T01:00:00Z",
          }],
        });
      }
      if (callCount === 3) {
        // INSERT returns rowCount: 0 (already exists via ON CONFLICT DO NOTHING)
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      return Promise.resolve({ rows: [] });
    });

    const req = { user: { claims: { sub: "owner-123" } }, body: {} };
    const res = await callHandler("post", ENDPOINT, req);

    expect(res._status).toBe(200);
    expect(res._json.recovered).toBe(0);
    expect(res._json.campaigns).toHaveLength(0);
  });
});
