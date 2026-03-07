import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mock variables
// ---------------------------------------------------------------------------
const {
  mockGetMonitor,
  mockGetMonitorChannels,
  mockUpsertMonitorChannel,
  mockDeleteMonitorChannel,
  mockAddDeliveryLog,
  mockGetDeliveryLog,
  mockGetSlackConnection,
  mockUpsertSlackConnection,
  mockDeleteSlackConnection,
  mockDeleteSlackChannelsForUser,
  mockNotificationTablesExist,
  mockChannelTablesExist,
  mockGetUser,
  mockIsPrivateUrl,
  mockGenerateWebhookSecret,
  mockRedactSecret,
  mockListSlackChannels,
  mockEncryptToken,
  mockDecryptToken,
  mockIsValidEncryptedToken,
} = vi.hoisted(() => ({
  mockGetMonitor: vi.fn(),
  mockGetMonitorChannels: vi.fn(),
  mockUpsertMonitorChannel: vi.fn(),
  mockDeleteMonitorChannel: vi.fn(),
  mockAddDeliveryLog: vi.fn(),
  mockGetDeliveryLog: vi.fn(),
  mockGetSlackConnection: vi.fn(),
  mockUpsertSlackConnection: vi.fn(),
  mockDeleteSlackConnection: vi.fn(),
  mockDeleteSlackChannelsForUser: vi.fn(),
  mockNotificationTablesExist: vi.fn().mockResolvedValue(true),
  mockChannelTablesExist: vi.fn().mockResolvedValue(true),
  mockGetUser: vi.fn(),
  mockIsPrivateUrl: vi.fn().mockResolvedValue(null),
  mockGenerateWebhookSecret: vi.fn().mockReturnValue("whsec_generated123"),
  mockRedactSecret: vi.fn().mockReturnValue("whsec_****...****"),
  mockListSlackChannels: vi.fn(),
  mockEncryptToken: vi.fn().mockReturnValue("encrypted-token"),
  mockDecryptToken: vi.fn().mockReturnValue("xoxb-decrypted"),
  mockIsValidEncryptedToken: vi.fn().mockReturnValue(true),
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
    getMonitorChannels: (...args: any[]) => mockGetMonitorChannels(...args),
    upsertMonitorChannel: (...args: any[]) => mockUpsertMonitorChannel(...args),
    deleteMonitorChannel: (...args: any[]) => mockDeleteMonitorChannel(...args),
    addDeliveryLog: (...args: any[]) => mockAddDeliveryLog(...args),
    getDeliveryLog: (...args: any[]) => mockGetDeliveryLog(...args),
    getSlackConnection: (...args: any[]) => mockGetSlackConnection(...args),
    upsertSlackConnection: (...args: any[]) => mockUpsertSlackConnection(...args),
    deleteSlackConnection: (...args: any[]) => mockDeleteSlackConnection(...args),
    deleteSlackChannelsForUser: (...args: any[]) => mockDeleteSlackChannelsForUser(...args),
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
  notificationTablesExist: (...args: any[]) => mockNotificationTablesExist(...args),
  channelTablesExist: (...args: any[]) => mockChannelTablesExist(...args),
}));

vi.mock("./utils/ssrf", () => ({
  isPrivateUrl: (...args: any[]) => mockIsPrivateUrl(...args),
  ssrfSafeFetch: vi.fn(),
}));

vi.mock("./services/webhookDelivery", () => ({
  generateWebhookSecret: (...args: any[]) => mockGenerateWebhookSecret(...args),
  redactSecret: (...args: any[]) => mockRedactSecret(...args),
}));

vi.mock("./services/slackDelivery", () => ({
  listChannels: (...args: any[]) => mockListSlackChannels(...args),
}));

vi.mock("./utils/encryption", () => ({
  encryptToken: (...args: any[]) => mockEncryptToken(...args),
  decryptToken: (...args: any[]) => mockDecryptToken(...args),
  isValidEncryptedToken: (...args: any[]) => mockIsValidEncryptedToken(...args),
}));

vi.mock("express-rate-limit", () => ({
  default: () => (_req: any, _res: any, next: any) => next(),
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
    _redirectUrl: null,
    status(code: number) { res._status = code; return res; },
    json(body: any) { res._json = body; return res; },
    send(body?: any) { res._body = body; return res; },
    redirect(url: string) { res._redirectUrl = url; return res; },
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

function resetMocks() {
  mockGetMonitor.mockReset();
  mockGetMonitorChannels.mockReset();
  mockUpsertMonitorChannel.mockReset();
  mockDeleteMonitorChannel.mockReset();
  mockAddDeliveryLog.mockReset();
  mockGetDeliveryLog.mockReset();
  mockGetSlackConnection.mockReset();
  mockUpsertSlackConnection.mockReset();
  mockDeleteSlackConnection.mockReset();
  mockDeleteSlackChannelsForUser.mockReset();
  mockNotificationTablesExist.mockReset().mockResolvedValue(true);
  mockChannelTablesExist.mockReset().mockResolvedValue(true);
  mockGetUser.mockReset();
  mockIsPrivateUrl.mockReset().mockResolvedValue(null);
  mockGenerateWebhookSecret.mockReset().mockReturnValue("whsec_generated123");
  mockRedactSecret.mockReset().mockReturnValue("whsec_****...****");
  mockListSlackChannels.mockReset();
  mockEncryptToken.mockReset().mockReturnValue("encrypted-token");
  mockDecryptToken.mockReset().mockReturnValue("xoxb-decrypted");
  mockIsValidEncryptedToken.mockReset().mockReturnValue(true);
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

// ---------------------------------------------------------------------------
// Tests: Notification Channels CRUD
// ---------------------------------------------------------------------------
describe("GET /api/monitors/:id/channels", () => {
  const ENDPOINT = "/api/monitors/:id/channels";

  beforeEach(async () => {
    await ensureRoutes();
    resetMocks();
  });

  it("returns channels for owned monitor", async () => {
    mockGetMonitor.mockResolvedValueOnce({ id: 1, userId: "user1" });
    mockGetMonitorChannels.mockResolvedValueOnce([
      { id: 1, monitorId: 1, channel: "email", enabled: true, config: {} },
    ]);

    const res = await callHandler("get", ENDPOINT, makeReq());
    expect(res._status).toBe(200);
    expect(res._json).toHaveLength(1);
    expect(res._json[0].channel).toBe("email");
  });

  it("redacts webhook secrets in response", async () => {
    mockGetMonitor.mockResolvedValueOnce({ id: 1, userId: "user1" });
    mockGetMonitorChannels.mockResolvedValueOnce([
      { id: 1, monitorId: 1, channel: "webhook", enabled: true, config: { url: "https://example.com", secret: "whsec_real_secret" } },
    ]);

    const res = await callHandler("get", ENDPOINT, makeReq());
    expect(res._status).toBe(200);
    expect(mockRedactSecret).toHaveBeenCalledWith("whsec_real_secret");
    expect(res._json[0].config.secret).toBe("whsec_****...****");
  });

  it("does not redact config for non-webhook channels", async () => {
    mockGetMonitor.mockResolvedValueOnce({ id: 1, userId: "user1" });
    mockGetMonitorChannels.mockResolvedValueOnce([
      { id: 1, monitorId: 1, channel: "slack", enabled: true, config: { channelId: "C0123" } },
    ]);

    const res = await callHandler("get", ENDPOINT, makeReq());
    expect(res._status).toBe(200);
    expect(res._json[0].config.channelId).toBe("C0123");
    expect(mockRedactSecret).not.toHaveBeenCalled();
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

describe("PUT /api/monitors/:id/channels/:channel", () => {
  const ENDPOINT = "/api/monitors/:id/channels/:channel";

  beforeEach(async () => {
    await ensureRoutes();
    resetMocks();
  });

  it("creates email channel for owned monitor", async () => {
    mockGetMonitor.mockResolvedValueOnce({ id: 1, userId: "user1" });
    const saved = { id: 1, monitorId: 1, channel: "email", enabled: true, config: {} };
    mockUpsertMonitorChannel.mockResolvedValueOnce(saved);

    const req = makeReq("user1", {
      params: { id: "1", channel: "email" },
      body: { enabled: true, config: {} },
    });
    const res = await callHandler("put", ENDPOINT, req);
    expect(res._status).toBe(200);
    expect(mockUpsertMonitorChannel).toHaveBeenCalledWith(1, "email", true, {});
  });

  it("rejects invalid channel type", async () => {
    const req = makeReq("user1", {
      params: { id: "1", channel: "telegram" },
      body: { enabled: true, config: {} },
    });
    const res = await callHandler("put", ENDPOINT, req);
    expect(res._status).toBe(400);
    expect(res._json.message).toContain("Invalid channel type");
  });

  it("blocks free tier from webhook channel", async () => {
    mockGetMonitor.mockResolvedValueOnce({ id: 1, userId: "user1" });
    mockGetUser.mockResolvedValueOnce({ tier: "free" });

    const req = makeReq("user1", {
      params: { id: "1", channel: "webhook" },
      body: { enabled: true, config: { url: "https://hooks.example.com" } },
    });
    const res = await callHandler("put", ENDPOINT, req);
    expect(res._status).toBe(403);
    expect(res._json.code).toBe("TIER_LIMIT_REACHED");
  });

  it("blocks free tier from slack channel", async () => {
    mockGetMonitor.mockResolvedValueOnce({ id: 1, userId: "user1" });
    mockGetUser.mockResolvedValueOnce({ tier: "free" });

    const req = makeReq("user1", {
      params: { id: "1", channel: "slack" },
      body: { enabled: true, config: { channelId: "C0123", channelName: "#general" } },
    });
    const res = await callHandler("put", ENDPOINT, req);
    expect(res._status).toBe(403);
    expect(res._json.code).toBe("TIER_LIMIT_REACHED");
  });

  it("allows email channel for free tier (no tier check)", async () => {
    mockGetMonitor.mockResolvedValueOnce({ id: 1, userId: "user1" });
    mockUpsertMonitorChannel.mockResolvedValueOnce({ id: 1, channel: "email", config: {} });

    const req = makeReq("user1", {
      params: { id: "1", channel: "email" },
      body: { enabled: true, config: {} },
    });
    const res = await callHandler("put", ENDPOINT, req);
    expect(res._status).toBe(200);
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it("allows pro tier to create webhook channel with generated secret", async () => {
    mockGetMonitor.mockResolvedValueOnce({ id: 1, userId: "user1" });
    mockGetUser.mockResolvedValueOnce({ tier: "pro" });
    mockGetMonitorChannels.mockResolvedValueOnce([]); // no existing webhook
    const saved = { id: 1, monitorId: 1, channel: "webhook", enabled: true, config: { url: "https://hooks.example.com", secret: "whsec_generated123", headers: {} } };
    mockUpsertMonitorChannel.mockResolvedValueOnce(saved);

    const req = makeReq("user1", {
      params: { id: "1", channel: "webhook" },
      body: { enabled: true, config: { url: "https://hooks.example.com" } },
    });
    const res = await callHandler("put", ENDPOINT, req);
    expect(res._status).toBe(200);
    expect(mockGenerateWebhookSecret).toHaveBeenCalled();
    // New webhook: full secret returned (not redacted)
    expect(res._json.config.secret).toBe("whsec_generated123");
  });

  it("reuses existing webhook secret on update and redacts it", async () => {
    mockGetMonitor.mockResolvedValueOnce({ id: 1, userId: "user1" });
    mockGetUser.mockResolvedValueOnce({ tier: "pro" });
    mockGetMonitorChannels.mockResolvedValueOnce([
      { id: 1, channel: "webhook", config: { url: "https://old.example.com", secret: "whsec_existing" } },
    ]);
    const saved = { id: 1, channel: "webhook", config: { url: "https://new.example.com", secret: "whsec_existing", headers: {} } };
    mockUpsertMonitorChannel.mockResolvedValueOnce(saved);

    const req = makeReq("user1", {
      params: { id: "1", channel: "webhook" },
      body: { enabled: true, config: { url: "https://new.example.com" } },
    });
    const res = await callHandler("put", ENDPOINT, req);
    expect(res._status).toBe(200);
    expect(mockGenerateWebhookSecret).not.toHaveBeenCalled();
    expect(mockRedactSecret).toHaveBeenCalledWith("whsec_existing");
  });

  it("blocks webhook with private URL (SSRF)", async () => {
    mockGetMonitor.mockResolvedValueOnce({ id: 1, userId: "user1" });
    mockGetUser.mockResolvedValueOnce({ tier: "pro" });
    mockIsPrivateUrl.mockResolvedValueOnce("Private IP detected");

    const req = makeReq("user1", {
      params: { id: "1", channel: "webhook" },
      body: { enabled: true, config: { url: "http://169.254.169.254/metadata" } },
    });
    const res = await callHandler("put", ENDPOINT, req);
    expect(res._status).toBe(422);
    expect(res._json.message).toContain("Invalid webhook URL");
  });

  it("returns 404 when monitor does not exist", async () => {
    mockGetMonitor.mockResolvedValueOnce(undefined);
    const req = makeReq("user1", {
      params: { id: "99", channel: "email" },
      body: { enabled: true, config: {} },
    });
    const res = await callHandler("put", ENDPOINT, req);
    expect(res._status).toBe(404);
  });

  it("returns 403 when user does not own the monitor", async () => {
    mockGetMonitor.mockResolvedValueOnce({ id: 1, userId: "other-user" });
    const req = makeReq("user1", {
      params: { id: "1", channel: "email" },
      body: { enabled: true, config: {} },
    });
    const res = await callHandler("put", ENDPOINT, req);
    expect(res._status).toBe(403);
  });

  it("returns 422 for invalid webhook config (missing url)", async () => {
    mockGetMonitor.mockResolvedValueOnce({ id: 1, userId: "user1" });
    mockGetUser.mockResolvedValueOnce({ tier: "pro" });

    const req = makeReq("user1", {
      params: { id: "1", channel: "webhook" },
      body: { enabled: true, config: {} },
    });
    const res = await callHandler("put", ENDPOINT, req);
    expect(res._status).toBe(422);
  });
});

describe("DELETE /api/monitors/:id/channels/:channel", () => {
  const ENDPOINT = "/api/monitors/:id/channels/:channel";

  beforeEach(async () => {
    await ensureRoutes();
    resetMocks();
  });

  it("deletes channel for owned monitor", async () => {
    mockGetMonitor.mockResolvedValueOnce({ id: 1, userId: "user1" });
    mockDeleteMonitorChannel.mockResolvedValueOnce(undefined);

    const req = makeReq("user1", { params: { id: "1", channel: "webhook" } });
    const res = await callHandler("delete", ENDPOINT, req);
    expect(res._status).toBe(204);
    expect(mockDeleteMonitorChannel).toHaveBeenCalledWith(1, "webhook");
  });

  it("returns 404 when monitor does not exist", async () => {
    mockGetMonitor.mockResolvedValueOnce(undefined);
    const req = makeReq("user1", { params: { id: "99", channel: "email" } });
    const res = await callHandler("delete", ENDPOINT, req);
    expect(res._status).toBe(404);
  });

  it("returns 403 when user does not own the monitor", async () => {
    mockGetMonitor.mockResolvedValueOnce({ id: 1, userId: "other-user" });
    const req = makeReq("user1", { params: { id: "1", channel: "email" } });
    const res = await callHandler("delete", ENDPOINT, req);
    expect(res._status).toBe(403);
  });
});

describe("POST /api/monitors/:id/channels/webhook/reveal-secret", () => {
  const ENDPOINT = "/api/monitors/:id/channels/webhook/reveal-secret";

  beforeEach(async () => {
    await ensureRoutes();
    resetMocks();
  });

  it("reveals full webhook secret for owned monitor", async () => {
    mockGetMonitor.mockResolvedValueOnce({ id: 1, userId: "user1" });
    mockGetMonitorChannels.mockResolvedValueOnce([
      { id: 1, channel: "webhook", config: { url: "https://example.com", secret: "whsec_full_secret" } },
    ]);

    const res = await callHandler("post", ENDPOINT, makeReq());
    expect(res._status).toBe(200);
    expect(res._json.secret).toBe("whsec_full_secret");
  });

  it("returns 404 when no webhook channel exists", async () => {
    mockGetMonitor.mockResolvedValueOnce({ id: 1, userId: "user1" });
    mockGetMonitorChannels.mockResolvedValueOnce([
      { id: 1, channel: "email", config: {} },
    ]);

    const res = await callHandler("post", ENDPOINT, makeReq());
    expect(res._status).toBe(404);
    expect(res._json.message).toContain("No webhook channel");
  });

  it("returns 404 when monitor does not exist", async () => {
    mockGetMonitor.mockResolvedValueOnce(undefined);
    const res = await callHandler("post", ENDPOINT, makeReq());
    expect(res._status).toBe(404);
  });

  it("returns 403 when user does not own the monitor", async () => {
    mockGetMonitor.mockResolvedValueOnce({ id: 1, userId: "other-user" });
    const res = await callHandler("post", ENDPOINT, makeReq());
    expect(res._status).toBe(403);
  });
});

describe("GET /api/monitors/:id/deliveries", () => {
  const ENDPOINT = "/api/monitors/:id/deliveries";

  beforeEach(async () => {
    await ensureRoutes();
    resetMocks();
  });

  it("returns delivery log for owned monitor", async () => {
    mockGetMonitor.mockResolvedValueOnce({ id: 1, userId: "user1" });
    const entries = [
      { id: 1, monitorId: 1, channel: "email", status: "success", createdAt: new Date() },
    ];
    mockGetDeliveryLog.mockResolvedValueOnce(entries);

    const res = await callHandler("get", ENDPOINT, makeReq());
    expect(res._status).toBe(200);
    expect(res._json).toHaveLength(1);
  });

  it("passes limit and channel filter from query", async () => {
    mockGetMonitor.mockResolvedValueOnce({ id: 1, userId: "user1" });
    mockGetDeliveryLog.mockResolvedValueOnce([]);

    const req = makeReq("user1", { query: { limit: "10", channel: "webhook" } });
    const res = await callHandler("get", ENDPOINT, req);
    expect(res._status).toBe(200);
    expect(mockGetDeliveryLog).toHaveBeenCalledWith(1, 10, "webhook");
  });

  it("clamps limit to max 200", async () => {
    mockGetMonitor.mockResolvedValueOnce({ id: 1, userId: "user1" });
    mockGetDeliveryLog.mockResolvedValueOnce([]);

    const req = makeReq("user1", { query: { limit: "500" } });
    await callHandler("get", ENDPOINT, req);
    expect(mockGetDeliveryLog).toHaveBeenCalledWith(1, 200, undefined);
  });

  it("defaults limit to 50", async () => {
    mockGetMonitor.mockResolvedValueOnce({ id: 1, userId: "user1" });
    mockGetDeliveryLog.mockResolvedValueOnce([]);

    await callHandler("get", ENDPOINT, makeReq());
    expect(mockGetDeliveryLog).toHaveBeenCalledWith(1, 50, undefined);
  });

  it("returns 404 when monitor does not exist", async () => {
    mockGetMonitor.mockResolvedValueOnce(undefined);
    const res = await callHandler("get", ENDPOINT, makeReq());
    expect(res._status).toBe(404);
  });

  it("returns 403 when user does not own the monitor", async () => {
    mockGetMonitor.mockResolvedValueOnce({ id: 1, userId: "other-user" });
    const res = await callHandler("get", ENDPOINT, makeReq());
    expect(res._status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Tests: Slack OAuth / Integration
// ---------------------------------------------------------------------------
describe("GET /api/integrations/slack/status", () => {
  const ENDPOINT = "/api/integrations/slack/status";
  const savedClientId = process.env.SLACK_CLIENT_ID;
  const savedClientSecret = process.env.SLACK_CLIENT_SECRET;

  beforeEach(async () => {
    await ensureRoutes();
    resetMocks();
    process.env.SLACK_CLIENT_ID = "test-client-id";
    process.env.SLACK_CLIENT_SECRET = "test-client-secret";
  });

  afterEach(() => {
    if (savedClientId !== undefined) {
      process.env.SLACK_CLIENT_ID = savedClientId;
    } else {
      delete process.env.SLACK_CLIENT_ID;
    }
    if (savedClientSecret !== undefined) {
      process.env.SLACK_CLIENT_SECRET = savedClientSecret;
    } else {
      delete process.env.SLACK_CLIENT_SECRET;
    }
  });

  it("returns connected with teamName when connection exists", async () => {
    mockGetSlackConnection.mockResolvedValueOnce({
      id: 1, userId: "user1", teamId: "T001", teamName: "TestTeam",
      botToken: "enc", scope: "chat:write",
    });

    const res = await callHandler("get", ENDPOINT, makeReq());
    expect(res._status).toBe(200);
    expect(res._json).toEqual({ connected: true, available: true, teamName: "TestTeam" });
  });

  it("returns not connected when no connection exists", async () => {
    mockGetSlackConnection.mockResolvedValueOnce(undefined);

    const res = await callHandler("get", ENDPOINT, makeReq());
    expect(res._status).toBe(200);
    expect(res._json).toEqual({ connected: false, available: true });
  });

  it("returns oauth-not-configured when SLACK_CLIENT_ID is not set", async () => {
    delete process.env.SLACK_CLIENT_ID;

    const res = await callHandler("get", ENDPOINT, makeReq());
    expect(res._status).toBe(200);
    expect(res._json).toEqual({ connected: false, available: false, unavailableReason: "oauth-not-configured" });
    expect(mockGetSlackConnection).not.toHaveBeenCalled();
  });

  it("returns tables-not-ready when both tables and SLACK_CLIENT_ID are missing", async () => {
    delete process.env.SLACK_CLIENT_ID;
    mockChannelTablesExist.mockResolvedValueOnce(false);

    const res = await callHandler("get", ENDPOINT, makeReq());
    expect(res._status).toBe(200);
    expect(res._json).toEqual({ connected: false, available: false, unavailableReason: "tables-not-ready" });
    expect(mockGetSlackConnection).not.toHaveBeenCalled();
  });

  it("returns tables-not-ready when tables are missing but OAuth is configured", async () => {
    mockChannelTablesExist.mockResolvedValueOnce(false);

    const res = await callHandler("get", ENDPOINT, makeReq());
    expect(res._status).toBe(200);
    expect(res._json).toEqual({ connected: false, available: false, unavailableReason: "tables-not-ready" });
    expect(mockGetSlackConnection).not.toHaveBeenCalled();
  });

  it("does not include unavailableReason when Slack is available", async () => {
    mockGetSlackConnection.mockResolvedValueOnce(undefined);

    const res = await callHandler("get", ENDPOINT, makeReq());
    expect(res._status).toBe(200);
    expect(res._json).toEqual({ connected: false, available: true });
    expect(res._json.unavailableReason).toBeUndefined();
  });

  it("returns oauth-not-configured when SLACK_CLIENT_ID is empty string", async () => {
    process.env.SLACK_CLIENT_ID = "";

    const res = await callHandler("get", ENDPOINT, makeReq());
    expect(res._status).toBe(200);
    expect(res._json).toEqual({ connected: false, available: false, unavailableReason: "oauth-not-configured" });
    expect(mockGetSlackConnection).not.toHaveBeenCalled();
  });

  it("returns oauth-not-configured when SLACK_CLIENT_SECRET is missing", async () => {
    delete process.env.SLACK_CLIENT_SECRET;

    const res = await callHandler("get", ENDPOINT, makeReq());
    expect(res._status).toBe(200);
    expect(res._json).toEqual({ connected: false, available: false, unavailableReason: "oauth-not-configured" });
    expect(mockGetSlackConnection).not.toHaveBeenCalled();
  });

  it("returns 500 when getSlackConnection throws", async () => {
    mockGetSlackConnection.mockRejectedValueOnce(new Error("db connection failed"));

    const res = await callHandler("get", ENDPOINT, makeReq());
    expect(res._status).toBe(500);
    expect(res._json).toEqual({ message: "Internal server error" });
  });
});

describe("DELETE /api/integrations/slack", () => {
  const ENDPOINT = "/api/integrations/slack";

  beforeEach(async () => {
    await ensureRoutes();
    resetMocks();
  });

  it("deletes slack channels and connection", async () => {
    mockDeleteSlackChannelsForUser.mockResolvedValueOnce(undefined);
    mockDeleteSlackConnection.mockResolvedValueOnce(undefined);

    const res = await callHandler("delete", ENDPOINT, makeReq("user1"));
    expect(res._status).toBe(204);
    expect(mockDeleteSlackChannelsForUser).toHaveBeenCalledWith("user1");
    expect(mockDeleteSlackConnection).toHaveBeenCalledWith("user1");
  });
});

describe("GET /api/integrations/slack/channels", () => {
  const ENDPOINT = "/api/integrations/slack/channels";

  beforeEach(async () => {
    await ensureRoutes();
    resetMocks();
  });

  it("returns channels when connection exists", async () => {
    // Use a unique userId to avoid cache collisions with other tests
    const userId = `user-channels-${Date.now()}`;
    mockGetSlackConnection.mockResolvedValueOnce({
      id: 1, userId, teamId: "T001", teamName: "TestTeam",
      botToken: "enc-token", scope: "chat:write",
    });
    mockListSlackChannels.mockResolvedValueOnce([
      { id: "C001", name: "general" },
      { id: "C002", name: "alerts" },
    ]);

    const res = await callHandler("get", ENDPOINT, makeReq(userId));
    expect(res._status).toBe(200);
    expect(res._json).toHaveLength(2);
    expect(mockDecryptToken).toHaveBeenCalledWith("enc-token");
  });

  it("returns 404 when no connection exists", async () => {
    const userId = `user-no-conn-${Date.now()}`;
    mockGetSlackConnection.mockResolvedValueOnce(undefined);

    const res = await callHandler("get", ENDPOINT, makeReq(userId));
    expect(res._status).toBe(404);
    expect(res._json.message).toContain("No Slack connection");
  });

  it("returns 500 when token decryption fails", async () => {
    const userId = `user-decrypt-fail-${Date.now()}`;
    mockGetSlackConnection.mockResolvedValueOnce({
      id: 1, userId, teamId: "T001", teamName: "TestTeam",
      botToken: "corrupted-token", scope: "chat:write",
    });
    mockDecryptToken.mockImplementationOnce(() => { throw new Error("Decryption failed"); });

    const res = await callHandler("get", ENDPOINT, makeReq(userId));
    expect(res._status).toBe(500);
    expect(res._json.message).toContain("reconnect Slack");
  });
});

describe("GET /api/integrations/slack/install", () => {
  const ENDPOINT = "/api/integrations/slack/install";
  const savedClientId = process.env.SLACK_CLIENT_ID;

  beforeEach(async () => {
    await ensureRoutes();
    resetMocks();
    // Ensure clean env state
    delete process.env.SLACK_CLIENT_ID;
  });

  afterEach(() => {
    // Restore original env
    if (savedClientId !== undefined) {
      process.env.SLACK_CLIENT_ID = savedClientId;
    } else {
      delete process.env.SLACK_CLIENT_ID;
    }
  });

  it("returns 403 for free tier users", async () => {
    mockGetUser.mockResolvedValueOnce({ tier: "free" });

    const req = makeReq("user1", {
      protocol: "https",
      get: () => "example.com",
    });
    const res = await callHandler("get", ENDPOINT, req);
    expect(res._status).toBe(403);
    expect(res._json.code).toBe("TIER_LIMIT_REACHED");
  });

  it("returns 501 when SLACK_CLIENT_ID is not set", async () => {
    mockGetUser.mockResolvedValueOnce({ tier: "pro" });

    const req = makeReq("user1", {
      protocol: "https",
      get: () => "example.com",
    });
    const res = await callHandler("get", ENDPOINT, req);
    expect(res._status).toBe(501);
    expect(res._json.message).toContain("not available");
  });

  it("redirects to Slack OAuth URL for pro tier with client ID set", async () => {
    process.env.SLACK_CLIENT_ID = "test-client-id";
    process.env.SLACK_CLIENT_SECRET = "test-client-secret";
    process.env.REPLIT_DOMAINS = "example.com";

    mockGetUser.mockResolvedValueOnce({ tier: "pro" });

    const req = makeReq("user1", {
      protocol: "https",
      get: () => "example.com",
    });
    const res = await callHandler("get", ENDPOINT, req);
    expect(res._redirectUrl).toContain("slack.com/oauth/v2/authorize");
    expect(res._redirectUrl).toContain("client_id=test-client-id");
    expect(res._redirectUrl).toContain("chat:write");

    delete process.env.REPLIT_DOMAINS;
  });

  it("uses request host for redirect_uri when host is in REPLIT_DOMAINS", async () => {
    process.env.SLACK_CLIENT_ID = "test-client-id";
    process.env.SLACK_CLIENT_SECRET = "test-client-secret";
    process.env.REPLIT_DOMAINS = "replit-domain.repl.co,custom-domain.example.com";
    mockGetUser.mockResolvedValueOnce({ tier: "pro" });

    const req = makeReq("user1", {
      protocol: "https",
      get: () => "custom-domain.example.com",
    });
    const res = await callHandler("get", ENDPOINT, req);
    const redirectUri = decodeURIComponent(res._redirectUrl);
    expect(redirectUri).toContain("redirect_uri=https://custom-domain.example.com/api/integrations/slack/callback");
    expect(redirectUri).not.toContain("replit-domain.repl.co");

    delete process.env.REPLIT_DOMAINS;
  });

  it("returns 400 when Host header is not in REPLIT_DOMAINS", async () => {
    process.env.SLACK_CLIENT_ID = "test-client-id";
    process.env.SLACK_CLIENT_SECRET = "test-client-secret";
    process.env.REPLIT_DOMAINS = "legit-domain.example.com";
    mockGetUser.mockResolvedValueOnce({ tier: "pro" });

    const req = makeReq("user1", {
      protocol: "https",
      get: () => "evil-domain.attacker.com",
    });
    const res = await callHandler("get", ENDPOINT, req);
    expect(res._status).toBe(400);
    expect(res._json.code).toBe("BAD_REQUEST");

    delete process.env.REPLIT_DOMAINS;
  });

  it("works for power tier users", async () => {
    process.env.SLACK_CLIENT_ID = "test-client-id";
    process.env.SLACK_CLIENT_SECRET = "test-client-secret";
    process.env.REPLIT_DOMAINS = "example.com";
    mockGetUser.mockResolvedValueOnce({ tier: "power" });

    const req = makeReq("user1", {
      protocol: "https",
      get: () => "example.com",
    });
    const res = await callHandler("get", ENDPOINT, req);
    expect(res._redirectUrl).toContain("slack.com/oauth/v2/authorize");

    delete process.env.REPLIT_DOMAINS;
  });
});

describe("GET /api/integrations/slack/callback", () => {
  const ENDPOINT = "/api/integrations/slack/callback";

  beforeEach(async () => {
    await ensureRoutes();
    resetMocks();
  });

  it("redirects with error when error param is present", async () => {
    const req = makeReq("user1", {
      query: { error: "access_denied" },
      protocol: "https",
      get: () => "example.com",
    });
    const res = await callHandler("get", ENDPOINT, req);
    expect(res._redirectUrl).toContain("slack=error");
    expect(res._redirectUrl).toContain("access_denied");
  });

  it("redirects with error when state or code is missing", async () => {
    const req = makeReq("user1", {
      query: {},
      protocol: "https",
      get: () => "example.com",
    });
    const res = await callHandler("get", ENDPOINT, req);
    expect(res._redirectUrl).toContain("slack=error");
    expect(res._redirectUrl).toContain("missing_params");
  });

  it("redirects with error when state HMAC is invalid", async () => {
    process.env.SLACK_CLIENT_SECRET = "test-secret";
    const req = makeReq("user1", {
      query: { code: "some-code", state: "user1:invalid-signature" },
      protocol: "https",
      get: () => "example.com",
    });
    const res = await callHandler("get", ENDPOINT, req);
    expect(res._redirectUrl).toContain("slack=error");
    expect(res._redirectUrl).toContain("invalid_state");

    delete process.env.SLACK_CLIENT_SECRET;
  });
});

// ---------------------------------------------------------------------------
// Tests: channelTablesExist guards — early-return when tables are missing
// ---------------------------------------------------------------------------
describe("channelTablesExist guards", () => {
  beforeEach(async () => {
    await ensureRoutes();
    resetMocks();
    mockChannelTablesExist.mockResolvedValue(false);
  });

  it("GET /api/monitors/:id/channels returns [] when channel tables missing", async () => {
    const res = await callHandler("get", "/api/monitors/:id/channels", makeReq());
    expect(res._status).toBe(200);
    expect(res._json).toEqual([]);
    expect(mockGetMonitor).not.toHaveBeenCalled();
  });

  it("PUT /api/monitors/:id/channels/:channel returns 503 when channel tables missing", async () => {
    const req = makeReq("user1", {
      params: { id: "1", channel: "email" },
      body: { enabled: true, config: {} },
    });
    const res = await callHandler("put", "/api/monitors/:id/channels/:channel", req);
    expect(res._status).toBe(503);
    expect(res._json.message).toContain("not available yet");
    expect(res._json.code).toBe("NOT_CONFIGURED");
    expect(mockGetMonitor).not.toHaveBeenCalled();
  });

  it("DELETE /api/monitors/:id/channels/:channel returns 204 when channel tables missing", async () => {
    const req = makeReq("user1", { params: { id: "1", channel: "email" } });
    const res = await callHandler("delete", "/api/monitors/:id/channels/:channel", req);
    expect(res._status).toBe(204);
    expect(mockDeleteMonitorChannel).not.toHaveBeenCalled();
  });

  it("POST reveal-secret returns 404 when channel tables missing", async () => {
    const res = await callHandler("post", "/api/monitors/:id/channels/webhook/reveal-secret", makeReq());
    expect(res._status).toBe(404);
    expect(res._json.code).toBe("NOT_FOUND");
    expect(mockGetMonitor).not.toHaveBeenCalled();
  });

  it("GET /api/monitors/:id/deliveries returns [] when channel tables missing", async () => {
    const res = await callHandler("get", "/api/monitors/:id/deliveries", makeReq());
    expect(res._status).toBe(200);
    expect(res._json).toEqual([]);
    expect(mockGetMonitor).not.toHaveBeenCalled();
  });

  it("GET /api/integrations/slack/status returns tables-not-ready when channel tables missing", async () => {
    const res = await callHandler("get", "/api/integrations/slack/status", makeReq());
    expect(res._status).toBe(200);
    expect(res._json).toEqual({ connected: false, available: false, unavailableReason: "tables-not-ready" });
    expect(mockGetSlackConnection).not.toHaveBeenCalled();
  });

  it("DELETE /api/integrations/slack returns 204 when channel tables missing", async () => {
    const res = await callHandler("delete", "/api/integrations/slack", makeReq());
    expect(res._status).toBe(204);
    expect(mockDeleteSlackConnection).not.toHaveBeenCalled();
    expect(mockDeleteSlackChannelsForUser).not.toHaveBeenCalled();
  });

  it("GET /api/integrations/slack/channels returns 404 when channel tables missing", async () => {
    const userId = `user-guard-${Date.now()}`;
    const res = await callHandler("get", "/api/integrations/slack/channels", makeReq(userId));
    expect(res._status).toBe(404);
    expect(mockGetSlackConnection).not.toHaveBeenCalled();
  });

  it("GET /api/integrations/slack/install returns 503 when channel tables missing", async () => {
    const req = makeReq("user1", {
      protocol: "https",
      get: () => "example.com",
    });
    const res = await callHandler("get", "/api/integrations/slack/install", req);
    expect(res._status).toBe(503);
    expect(res._json.code).toBe("NOT_CONFIGURED");
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it("GET /api/integrations/slack/callback redirects with not_configured when channel tables missing", async () => {
    const req = makeReq("user1", {
      query: { code: "abc", state: "user1:sig" },
      protocol: "https",
      get: () => "example.com",
    });
    const res = await callHandler("get", "/api/integrations/slack/callback", req);
    expect(res._redirectUrl).toContain("not_configured");
  });
});
