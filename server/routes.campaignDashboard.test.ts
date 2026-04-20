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
// Tests: GET /api/admin/campaigns/dashboard
// ---------------------------------------------------------------------------
describe("GET /api/admin/campaigns/dashboard", () => {
  const ENDPOINT = "/api/admin/campaigns/dashboard";

  beforeEach(async () => {
    await ensureRoutes();
    vi.clearAllMocks();

    // Reset chain mocks
    mockOrderByFn.mockReturnValue({ limit: mockLimitFn });
    mockSelectFromFn.mockReturnValue({ where: mockSelectWhereFn, orderBy: mockOrderByFn });
    mockDbSelect.mockReturnValue({ from: mockSelectFromFn });
  });

  it("returns 401 when user is not authenticated", async () => {
    const req = { user: null };
    const res = await callHandler("get", ENDPOINT, req);
    expect(res._status).toBe(401);
    expect(res._json).toEqual({ message: "Unauthorized" });
  });

  it("returns 403 when user is not power tier", async () => {
    mockGetUser.mockResolvedValue({ tier: "pro" });
    const req = { user: { claims: { sub: "user-1" } } };
    const res = await callHandler("get", ENDPOINT, req);
    expect(res._status).toBe(403);
    expect(res._json).toEqual({ message: "Admin access required" });
  });

  it("returns 403 when power user is not app owner", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    const req = { user: { claims: { sub: "not-the-owner" } } };
    const res = await callHandler("get", ENDPOINT, req);
    expect(res._status).toBe(403);
    expect(res._json).toEqual({ message: "Owner access required" });
  });

  it("returns dashboard stats with correct numeric conversion", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    // Simulate PostgreSQL returning numeric types as strings (common with raw SQL)
    mockDbExecute.mockResolvedValue({
      rows: [{
        totalCampaigns: "3",
        totalSent: "150",
        totalOpened: "45",
        totalClicked: "12",
        avgOpenRate: "32.5",
        avgClickRate: "8.3",
      }],
    });
    mockLimitFn.mockResolvedValue([]);

    const req = { user: { claims: { sub: "owner-123" } } };
    const res = await callHandler("get", ENDPOINT, req);

    expect(res._status).toBe(200);
    expect(res._json).toEqual({
      totalCampaigns: 3,
      totalSent: 150,
      totalOpened: 45,
      totalClicked: 12,
      avgOpenRate: 32.5,
      avgClickRate: 8.3,
      recentCampaigns: [],
    });
  });

  it("returns zero rates when no campaigns exist", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockDbExecute.mockResolvedValue({
      rows: [{
        totalCampaigns: 0,
        totalSent: 0,
        totalOpened: 0,
        totalClicked: 0,
        avgOpenRate: "0.0",
        avgClickRate: "0.0",
      }],
    });
    mockLimitFn.mockResolvedValue([]);

    const req = { user: { claims: { sub: "owner-123" } } };
    const res = await callHandler("get", ENDPOINT, req);

    expect(res._status).toBe(200);
    expect(res._json.avgOpenRate).toBe(0);
    expect(res._json.avgClickRate).toBe(0);
  });

  it("defaults to zero when stats row has null values", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockDbExecute.mockResolvedValue({
      rows: [{ totalCampaigns: null, totalSent: null, totalOpened: null, totalClicked: null, avgOpenRate: null, avgClickRate: null }],
    });
    mockLimitFn.mockResolvedValue([]);

    const req = { user: { claims: { sub: "owner-123" } } };
    const res = await callHandler("get", ENDPOINT, req);

    expect(res._status).toBe(200);
    expect(res._json.totalCampaigns).toBe(0);
    expect(res._json.totalSent).toBe(0);
    expect(res._json.avgOpenRate).toBe(0);
    expect(res._json.avgClickRate).toBe(0);
  });

  it("defaults to zero when stats row is undefined", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockDbExecute.mockResolvedValue({ rows: [undefined] });
    mockLimitFn.mockResolvedValue([]);

    const req = { user: { claims: { sub: "owner-123" } } };
    const res = await callHandler("get", ENDPOINT, req);

    expect(res._status).toBe(200);
    expect(res._json.totalCampaigns).toBe(0);
    expect(res._json.avgOpenRate).toBe(0);
    expect(res._json.avgClickRate).toBe(0);
  });

  it("defaults to zero when rows array is empty", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockDbExecute.mockResolvedValue({ rows: [] });
    mockLimitFn.mockResolvedValue([]);

    const req = { user: { claims: { sub: "owner-123" } } };
    const res = await callHandler("get", ENDPOINT, req);

    expect(res._status).toBe(200);
    expect(res._json.totalCampaigns).toBe(0);
    expect(res._json.avgOpenRate).toBe(0);
    expect(res._json.avgClickRate).toBe(0);
  });

  it("includes recent campaigns in response", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockDbExecute.mockResolvedValue({
      rows: [{ totalCampaigns: 2, totalSent: 10, totalOpened: 5, totalClicked: 2, avgOpenRate: "50.0", avgClickRate: "20.0" }],
    });
    const mockCampaigns = [
      { id: 1, name: "Campaign A", status: "sent", sentCount: 5, openedCount: 3, clickedCount: 1 },
      { id: 2, name: "Campaign B", status: "sent", sentCount: 5, openedCount: 2, clickedCount: 1 },
    ];
    mockLimitFn.mockResolvedValue(mockCampaigns);

    const req = { user: { claims: { sub: "owner-123" } } };
    const res = await callHandler("get", ENDPOINT, req);

    expect(res._status).toBe(200);
    expect(res._json.recentCampaigns).toEqual(mockCampaigns);
    expect(res._json.recentCampaigns).toHaveLength(2);
  });

  it("returns 500 when database throws an error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockDbExecute.mockRejectedValue(new Error("DB connection lost"));

    const req = { user: { claims: { sub: "owner-123" } } };
    const res = await callHandler("get", ENDPOINT, req);

    expect(res._status).toBe(500);
    expect(res._json).toEqual({ message: "Failed to fetch campaign dashboard" });
    errorSpy.mockRestore();
  });
});
