import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

/**
 * Issue #429: DELETE /api/admin/campaigns/:id must refuse to delete a `failed`
 * campaign when any recipient already has a terminal delivery status
 * (sent / delivered / opened / clicked). Without this guard the cascade delete
 * would erase the audit trail of who actually received the partial send.
 */

const previousAppOwnerId = process.env.APP_OWNER_ID;

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const {
  mockGetUser,
  mockCampaignLookup,
  mockTerminalRecipientCount,
  mockDbDeleteWhere,
} = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockCampaignLookup: vi.fn(),
  mockTerminalRecipientCount: vi.fn(),
  mockDbDeleteWhere: vi.fn().mockResolvedValue(undefined),
}));

// db.select() is called twice in the DELETE handler:
//   1. select from campaignsTable (chain: .from().where().limit(1))
//   2. select { count } from campaignRecipientsTable (chain: .from().where())
// We track call order to return the right resolver for each.
let selectCallIndex = 0;

vi.mock("./db", () => ({
  db: {
    select: vi.fn(() => {
      const currentCall = selectCallIndex++;
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => {
            if (currentCall === 0) {
              // campaigns lookup — chains .limit(1)
              return { limit: vi.fn(() => mockCampaignLookup()) };
            }
            // campaign_recipients count — awaited directly
            return mockTerminalRecipientCount();
          }),
        })),
      };
    }),
    delete: vi.fn(() => ({ where: (...args: any[]) => mockDbDeleteWhere(...args) })),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }) }),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }) }) }),
    execute: vi.fn().mockResolvedValue({ rows: [] }),
  },
}));

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
    getMonitors: vi.fn(),
    getAllActiveMonitors: vi.fn().mockResolvedValue([]),
    deleteMonitor: vi.fn(),
    createMonitor: vi.fn(),
    updateMonitor: vi.fn(),
    getMonitorCount: vi.fn().mockResolvedValue(0),
    getDeliveryLog: vi.fn().mockResolvedValue([]),
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

vi.mock("./services/notificationReady", () => ({
  notificationTablesExist: vi.fn().mockResolvedValue(true),
  channelTablesExist: vi.fn().mockResolvedValue(true),
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
  TERMINAL_RECIPIENT_STATUSES: ["sent", "delivered", "opened", "clicked"] as const,
}));

// ---------------------------------------------------------------------------
// Mock express app
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
    _body: null,
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

let routesRegistered = false;
async function ensureRoutes() {
  if (routesRegistered) return;
  process.env.APP_OWNER_ID = "owner-123";
  const { registerRoutes } = await import("./routes");
  const app = makeMockApp();
  await registerRoutes({} as any, app as any);
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
// Tests
// ---------------------------------------------------------------------------
describe("#429: DELETE /api/admin/campaigns/:id preserves audit trail for failed campaigns", () => {
  beforeEach(async () => {
    await ensureRoutes();
    vi.clearAllMocks();
    selectCallIndex = 0;
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockDbDeleteWhere.mockResolvedValue(undefined);
  });

  it("returns 400 when a failed campaign has recipients in terminal status", async () => {
    mockCampaignLookup.mockResolvedValueOnce([{ id: 42, status: "failed" }]);
    mockTerminalRecipientCount.mockResolvedValueOnce([{ count: 5 }]);

    const req = ownerReq({ params: { id: "42" } });
    const res = await callHandler("delete", "/api/admin/campaigns/:id", req);

    expect(res._status).toBe(400);
    expect(res._json.message).toMatch(/5 recipient/i);
    expect(res._json.message).toMatch(/already received/i);
    // No cascade delete must fire when the guard trips.
    expect(mockDbDeleteWhere).not.toHaveBeenCalled();
  });

  it("allows deletion of a failed campaign with zero terminal recipients", async () => {
    mockCampaignLookup.mockResolvedValueOnce([{ id: 43, status: "failed" }]);
    mockTerminalRecipientCount.mockResolvedValueOnce([{ count: 0 }]);

    const req = ownerReq({ params: { id: "43" } });
    const res = await callHandler("delete", "/api/admin/campaigns/:id", req);

    expect(res._status).toBe(204);
    // Cascade delete: once for recipients, once for the campaign row.
    expect(mockDbDeleteWhere).toHaveBeenCalledTimes(2);
  });

  it("skips the terminal-recipient check for draft campaigns", async () => {
    mockCampaignLookup.mockResolvedValueOnce([{ id: 44, status: "draft" }]);

    const req = ownerReq({ params: { id: "44" } });
    const res = await callHandler("delete", "/api/admin/campaigns/:id", req);

    expect(res._status).toBe(204);
    // The count query must not be invoked for draft campaigns — they have no
    // audit trail concern since no sends have occurred.
    expect(mockTerminalRecipientCount).not.toHaveBeenCalled();
    expect(mockDbDeleteWhere).toHaveBeenCalledTimes(2);
  });

  it("treats null count row defensively as zero", async () => {
    mockCampaignLookup.mockResolvedValueOnce([{ id: 45, status: "failed" }]);
    mockTerminalRecipientCount.mockResolvedValueOnce([]);

    const req = ownerReq({ params: { id: "45" } });
    const res = await callHandler("delete", "/api/admin/campaigns/:id", req);

    expect(res._status).toBe(204);
    expect(mockDbDeleteWhere).toHaveBeenCalledTimes(2);
  });

  it("rejects statuses other than draft or failed", async () => {
    mockCampaignLookup.mockResolvedValueOnce([{ id: 46, status: "sent" }]);

    const req = ownerReq({ params: { id: "46" } });
    const res = await callHandler("delete", "/api/admin/campaigns/:id", req);

    expect(res._status).toBe(400);
    expect(res._json).toEqual({ message: "Only draft or failed campaigns can be deleted" });
    expect(mockDbDeleteWhere).not.toHaveBeenCalled();
  });
});
