import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mock variables
// ---------------------------------------------------------------------------
const {
  mockGetMonitor,
  mockGetMonitorConditions,
  mockAddMonitorCondition,
  mockDeleteMonitorCondition,
  mockCountMonitorConditions,
  mockGetUser,
} = vi.hoisted(() => ({
  mockGetMonitor: vi.fn(),
  mockGetMonitorConditions: vi.fn(),
  mockAddMonitorCondition: vi.fn(),
  mockDeleteMonitorCondition: vi.fn(),
  mockCountMonitorConditions: vi.fn(),
  mockGetUser: vi.fn(),
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
  authStorage: { getUser: (...args: any[]) => mockGetUser(...args) },
}));

vi.mock("./storage", () => ({
  storage: {
    getMonitor: (...args: any[]) => mockGetMonitor(...args),
    getMonitors: vi.fn().mockResolvedValue([]),
    getAllActiveMonitors: vi.fn().mockResolvedValue([]),
    deleteMonitor: vi.fn(),
    createMonitor: vi.fn(),
    updateMonitor: vi.fn(),
    getNotificationPreferences: vi.fn().mockResolvedValue(undefined),
    upsertNotificationPreferences: vi.fn(),
    deleteNotificationPreferences: vi.fn(),
    getMonitorChannels: vi.fn().mockResolvedValue([]),
    upsertMonitorChannel: vi.fn(),
    deleteMonitorChannel: vi.fn(),
    addDeliveryLog: vi.fn(),
    getDeliveryLog: vi.fn(),
    getSlackConnection: vi.fn(),
    upsertSlackConnection: vi.fn(),
    deleteSlackConnection: vi.fn(),
    deleteSlackChannelsForUser: vi.fn(),
    getMonitorConditions: (...args: any[]) => mockGetMonitorConditions(...args),
    addMonitorCondition: (...args: any[]) => mockAddMonitorCondition(...args),
    deleteMonitorCondition: (...args: any[]) => mockDeleteMonitorCondition(...args),
    countMonitorConditions: (...args: any[]) => mockCountMonitorConditions(...args),
    getMonitorChanges: vi.fn().mockResolvedValue([]),
    getMonitorCount: vi.fn().mockResolvedValue(0),
    listUserTags: vi.fn().mockResolvedValue([]),
    countUserTags: vi.fn().mockResolvedValue(0),
    createTag: vi.fn(),
    getTag: vi.fn(),
    updateTag: vi.fn(),
    deleteTag: vi.fn(),
    getMonitorTags: vi.fn().mockResolvedValue([]),
    setMonitorTags: vi.fn(),
    getMonitorsWithTags: vi.fn().mockResolvedValue([]),
    getMonitorWithTags: vi.fn(),
    createApiKey: vi.fn(),
    createApiKeyIfUnderLimit: vi.fn(),
    getApiKeyByHash: vi.fn(),
    listApiKeys: vi.fn().mockResolvedValue([]),
    countActiveApiKeys: vi.fn().mockResolvedValue(0),
    revokeApiKey: vi.fn(),
    touchApiKey: vi.fn(),
    getMonitorsPaginated: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    getMonitorChangesPaginated: vi.fn().mockResolvedValue({ data: [], total: 0 }),
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
  startScheduler: vi.fn(),
}));

vi.mock("./services/notificationReady", () => ({
  notificationTablesExist: vi.fn().mockResolvedValue(true),
  channelTablesExist: vi.fn().mockResolvedValue(true),
}));

vi.mock("./utils/ssrf", () => ({
  isPrivateUrl: vi.fn().mockResolvedValue(null),
  ssrfSafeFetch: vi.fn(),
}));

vi.mock("./services/webhookDelivery", () => ({
  generateWebhookSecret: vi.fn().mockReturnValue("whsec_generated123"),
  redactSecret: vi.fn().mockReturnValue("whsec_****...****"),
}));

vi.mock("./services/slackDelivery", () => ({
  listChannels: vi.fn(),
}));

vi.mock("./utils/encryption", () => ({
  encryptToken: vi.fn().mockReturnValue("encrypted-token"),
  decryptToken: vi.fn().mockReturnValue("xoxb-decrypted"),
  isValidEncryptedToken: vi.fn().mockReturnValue(true),
}));

vi.mock("express-rate-limit", () => ({
  default: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock("./services/ensureTables", () => ({
  ensureErrorLogColumns: vi.fn().mockResolvedValue(undefined),
  ensureApiKeysTable: vi.fn().mockResolvedValue(undefined),
  ensureChannelTables: vi.fn().mockResolvedValue(undefined),
  ensureTagTables: vi.fn().mockResolvedValue(undefined),
  ensureMonitorHealthColumns: vi.fn().mockResolvedValue(undefined),
  ensureMonitorConditionsTable: vi.fn().mockResolvedValue(true),
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

function makeReq(userId = "user1", overrides: Record<string, any> = {}) {
  return {
    params: { id: "1" },
    user: { claims: { sub: userId } },
    body: {},
    query: {},
    ...overrides,
  };
}

const ownedMonitor = { id: 1, userId: "user1", name: "Test", url: "https://example.com", selector: ".price", frequency: "daily", active: true, emailEnabled: true };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("conditions routes", () => {
  beforeAll(async () => {
    await ensureRoutes();
  });

  beforeEach(() => {
    mockGetMonitor.mockReset();
    mockGetMonitorConditions.mockReset();
    mockAddMonitorCondition.mockReset();
    mockDeleteMonitorCondition.mockReset();
    mockCountMonitorConditions.mockReset();
    mockGetUser.mockReset();
  });

  describe("GET /api/monitors/:id/conditions", () => {
    it("returns empty array for monitor with no conditions", async () => {
      mockGetMonitor.mockResolvedValue(ownedMonitor);
      mockGetMonitorConditions.mockResolvedValue([]);

      const res = await callHandler("get", "/api/monitors/:id/conditions", makeReq());
      expect(res._status).toBe(200);
      expect(res._json).toEqual([]);
    });

    it("returns conditions ordered by groupIndex, id", async () => {
      const conditions = [
        { id: 1, monitorId: 1, type: "numeric_lt", value: "100", groupIndex: 0, createdAt: new Date() },
        { id: 2, monitorId: 1, type: "text_contains", value: "sale", groupIndex: 1, createdAt: new Date() },
      ];
      mockGetMonitor.mockResolvedValue(ownedMonitor);
      mockGetMonitorConditions.mockResolvedValue(conditions);

      const res = await callHandler("get", "/api/monitors/:id/conditions", makeReq());
      expect(res._status).toBe(200);
      expect(res._json).toHaveLength(2);
      expect(res._json[0].type).toBe("numeric_lt");
      expect(res._json[1].type).toBe("text_contains");
    });

    it("returns 404 for monitor not owned by user", async () => {
      mockGetMonitor.mockResolvedValue({ ...ownedMonitor, userId: "other-user" });

      const res = await callHandler("get", "/api/monitors/:id/conditions", makeReq());
      expect(res._status).toBe(404);
    });

    it("returns 404 when monitor does not exist", async () => {
      mockGetMonitor.mockResolvedValue(undefined);

      const res = await callHandler("get", "/api/monitors/:id/conditions", makeReq());
      expect(res._status).toBe(404);
    });
  });

  describe("POST /api/monitors/:id/conditions", () => {
    it("creates condition, returns 201", async () => {
      mockGetMonitor.mockResolvedValue(ownedMonitor);
      mockGetUser.mockResolvedValue({ id: "user1", tier: "pro" });
      mockCountMonitorConditions.mockResolvedValue(0);
      const created = { id: 1, monitorId: 1, type: "numeric_lt", value: "150", groupIndex: 0, createdAt: new Date() };
      mockAddMonitorCondition.mockResolvedValue(created);

      const req = makeReq("user1", {
        body: { type: "numeric_lt", value: "150", groupIndex: 0 },
      });
      const res = await callHandler("post", "/api/monitors/:id/conditions", req);
      expect(res._status).toBe(201);
      expect(res._json.type).toBe("numeric_lt");
    });

    it("Free user with 1 existing condition → 403 TIER_LIMIT_REACHED", async () => {
      mockGetMonitor.mockResolvedValue(ownedMonitor);
      mockGetUser.mockResolvedValue({ id: "user1", tier: "free" });
      mockCountMonitorConditions.mockResolvedValue(1);

      const req = makeReq("user1", {
        body: { type: "numeric_lt", value: "100", groupIndex: 0 },
      });
      const res = await callHandler("post", "/api/monitors/:id/conditions", req);
      expect(res._status).toBe(403);
      expect(res._json.code).toBe("TIER_LIMIT_REACHED");
    });

    it("Pro user with 5 existing conditions → 201 (no cap)", async () => {
      mockGetMonitor.mockResolvedValue(ownedMonitor);
      mockGetUser.mockResolvedValue({ id: "user1", tier: "pro" });
      mockCountMonitorConditions.mockResolvedValue(5);
      const created = { id: 6, monitorId: 1, type: "numeric_gt", value: "50", groupIndex: 0, createdAt: new Date() };
      mockAddMonitorCondition.mockResolvedValue(created);

      const req = makeReq("user1", {
        body: { type: "numeric_gt", value: "50", groupIndex: 0 },
      });
      const res = await callHandler("post", "/api/monitors/:id/conditions", req);
      expect(res._status).toBe(201);
    });

    it("invalid type → 422", async () => {
      mockGetMonitor.mockResolvedValue(ownedMonitor);
      mockGetUser.mockResolvedValue({ id: "user1", tier: "pro" });
      mockCountMonitorConditions.mockResolvedValue(0);

      const req = makeReq("user1", {
        body: { type: "invalid_type", value: "100", groupIndex: 0 },
      });
      const res = await callHandler("post", "/api/monitors/:id/conditions", req);
      expect(res._status).toBe(422);
    });

    it("regex type with invalid regex → 422 INVALID_REGEX", async () => {
      mockGetMonitor.mockResolvedValue(ownedMonitor);
      mockGetUser.mockResolvedValue({ id: "user1", tier: "pro" });
      mockCountMonitorConditions.mockResolvedValue(0);

      const req = makeReq("user1", {
        body: { type: "regex", value: "[invalid", groupIndex: 0 },
      });
      const res = await callHandler("post", "/api/monitors/:id/conditions", req);
      expect(res._status).toBe(422);
      expect(res._json.code).toBe("INVALID_REGEX");
    });

    it("regex with catastrophic pattern → 422 INVALID_REGEX", async () => {
      mockGetMonitor.mockResolvedValue(ownedMonitor);
      mockGetUser.mockResolvedValue({ id: "user1", tier: "pro" });
      mockCountMonitorConditions.mockResolvedValue(0);

      const req = makeReq("user1", {
        body: { type: "regex", value: "(a+)+", groupIndex: 0 },
      });
      const res = await callHandler("post", "/api/monitors/:id/conditions", req);
      expect(res._status).toBe(422);
      expect(res._json.code).toBe("INVALID_REGEX");
    });

    it("regex type with valid regex → 201", async () => {
      mockGetMonitor.mockResolvedValue(ownedMonitor);
      mockGetUser.mockResolvedValue({ id: "user1", tier: "pro" });
      mockCountMonitorConditions.mockResolvedValue(0);
      const created = { id: 1, monitorId: 1, type: "regex", value: "\\bIn Stock\\b", groupIndex: 0, createdAt: new Date() };
      mockAddMonitorCondition.mockResolvedValue(created);

      const req = makeReq("user1", {
        body: { type: "regex", value: "\\bIn Stock\\b", groupIndex: 0 },
      });
      const res = await callHandler("post", "/api/monitors/:id/conditions", req);
      expect(res._status).toBe(201);
    });

    it("numeric type with non-numeric value → 422 VALIDATION_ERROR", async () => {
      mockGetMonitor.mockResolvedValue(ownedMonitor);
      mockGetUser.mockResolvedValue({ id: "user1", tier: "pro" });
      mockCountMonitorConditions.mockResolvedValue(0);

      const req = makeReq("user1", {
        body: { type: "numeric_gt", value: "abc", groupIndex: 0 },
      });
      const res = await callHandler("post", "/api/monitors/:id/conditions", req);
      expect(res._status).toBe(422);
      expect(res._json.code).toBe("VALIDATION_ERROR");
      expect(res._json.message).toMatch(/valid number/i);
    });

    it("numeric_change_pct with zero value → 422", async () => {
      mockGetMonitor.mockResolvedValue(ownedMonitor);
      mockGetUser.mockResolvedValue({ id: "user1", tier: "pro" });
      mockCountMonitorConditions.mockResolvedValue(0);

      const req = makeReq("user1", {
        body: { type: "numeric_change_pct", value: "0", groupIndex: 0 },
      });
      const res = await callHandler("post", "/api/monitors/:id/conditions", req);
      expect(res._status).toBe(422);
      expect(res._json.message).toMatch(/positive/i);
    });

    it("numeric_change_pct with negative value → 422", async () => {
      mockGetMonitor.mockResolvedValue(ownedMonitor);
      mockGetUser.mockResolvedValue({ id: "user1", tier: "pro" });
      mockCountMonitorConditions.mockResolvedValue(0);

      const req = makeReq("user1", {
        body: { type: "numeric_change_pct", value: "-5", groupIndex: 0 },
      });
      const res = await callHandler("post", "/api/monitors/:id/conditions", req);
      expect(res._status).toBe(422);
    });

    it("TOCTOU: free-tier concurrent insert → later insert is rolled back", async () => {
      mockGetMonitor.mockResolvedValue(ownedMonitor);
      mockGetUser.mockResolvedValue({ id: "user1", tier: "free" });
      mockCountMonitorConditions
        .mockResolvedValueOnce(0)  // pre-insert check passes
        .mockResolvedValueOnce(2); // post-insert check detects race
      // Our insert got id=99, but there's an earlier condition id=50
      const created = { id: 99, monitorId: 1, type: "numeric_lt", value: "100", groupIndex: 0, createdAt: new Date() };
      mockAddMonitorCondition.mockResolvedValue(created);
      mockGetMonitorConditions.mockResolvedValue([
        { id: 50, monitorId: 1, type: "numeric_gt", value: "10", groupIndex: 0, createdAt: new Date() },
        created,
      ]);
      mockDeleteMonitorCondition.mockResolvedValue(undefined);

      const req = makeReq("user1", {
        body: { type: "numeric_lt", value: "100", groupIndex: 0 },
      });
      const res = await callHandler("post", "/api/monitors/:id/conditions", req);
      expect(res._status).toBe(403);
      expect(res._json.code).toBe("TIER_LIMIT_REACHED");
      // Deletes its own (later) condition, not the earlier one
      expect(mockDeleteMonitorCondition).toHaveBeenCalledWith(99, 1);
    });

    it("TOCTOU: free-tier concurrent insert → our insert wins if it has the lowest ID", async () => {
      mockGetMonitor.mockResolvedValue(ownedMonitor);
      mockGetUser.mockResolvedValue({ id: "user1", tier: "free" });
      mockCountMonitorConditions
        .mockResolvedValueOnce(0)  // pre-insert check passes
        .mockResolvedValueOnce(2); // post-insert check detects race
      // Our insert got id=10 (earliest), the concurrent one got id=20
      const created = { id: 10, monitorId: 1, type: "numeric_lt", value: "100", groupIndex: 0, createdAt: new Date() };
      mockAddMonitorCondition.mockResolvedValue(created);
      mockGetMonitorConditions.mockResolvedValue([
        created,
        { id: 20, monitorId: 1, type: "numeric_gt", value: "50", groupIndex: 0, createdAt: new Date() },
      ]);

      const req = makeReq("user1", {
        body: { type: "numeric_lt", value: "100", groupIndex: 0 },
      });
      const res = await callHandler("post", "/api/monitors/:id/conditions", req);
      // Our insert has the lowest ID, so it survives — returns 201
      expect(res._status).toBe(201);
      expect(res._json.id).toBe(10);
      expect(mockDeleteMonitorCondition).not.toHaveBeenCalled();
    });

    it("alternation regex (a|b)+ → 422 INVALID_REGEX", async () => {
      mockGetMonitor.mockResolvedValue(ownedMonitor);
      mockGetUser.mockResolvedValue({ id: "user1", tier: "pro" });
      mockCountMonitorConditions.mockResolvedValue(0);

      const req = makeReq("user1", {
        body: { type: "regex", value: "(a|b)+", groupIndex: 0 },
      });
      const res = await callHandler("post", "/api/monitors/:id/conditions", req);
      expect(res._status).toBe(422);
      expect(res._json.code).toBe("INVALID_REGEX");
    });

    it("value empty string → 422", async () => {
      mockGetMonitor.mockResolvedValue(ownedMonitor);
      mockGetUser.mockResolvedValue({ id: "user1", tier: "pro" });
      mockCountMonitorConditions.mockResolvedValue(0);

      const req = makeReq("user1", {
        body: { type: "numeric_lt", value: "", groupIndex: 0 },
      });
      const res = await callHandler("post", "/api/monitors/:id/conditions", req);
      expect(res._status).toBe(422);
    });

    it("monitor not owned → 404", async () => {
      mockGetMonitor.mockResolvedValue({ ...ownedMonitor, userId: "other-user" });

      const req = makeReq("user1", {
        body: { type: "numeric_lt", value: "100", groupIndex: 0 },
      });
      const res = await callHandler("post", "/api/monitors/:id/conditions", req);
      expect(res._status).toBe(404);
    });
  });

  describe("DELETE /api/monitors/:id/conditions/:conditionId", () => {
    it("deletes condition, returns 204", async () => {
      mockGetMonitor.mockResolvedValue(ownedMonitor);
      mockDeleteMonitorCondition.mockResolvedValue(undefined);

      const req = makeReq("user1", { params: { id: "1", conditionId: "5" } });
      const res = await callHandler("delete", "/api/monitors/:id/conditions/:conditionId", req);
      expect(res._status).toBe(204);
      expect(mockDeleteMonitorCondition).toHaveBeenCalledWith(5, 1);
    });

    it("monitor not owned → 404", async () => {
      mockGetMonitor.mockResolvedValue({ ...ownedMonitor, userId: "other-user" });

      const req = makeReq("user1", { params: { id: "1", conditionId: "5" } });
      const res = await callHandler("delete", "/api/monitors/:id/conditions/:conditionId", req);
      expect(res._status).toBe(404);
    });

    it("monitor not found → 404", async () => {
      mockGetMonitor.mockResolvedValue(undefined);

      const req = makeReq("user1", { params: { id: "999", conditionId: "5" } });
      const res = await callHandler("delete", "/api/monitors/:id/conditions/:conditionId", req);
      expect(res._status).toBe(404);
    });
  });
});
