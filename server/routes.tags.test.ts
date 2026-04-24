import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mock variables
// ---------------------------------------------------------------------------
const {
  mockListUserTags,
  mockCountUserTags,
  mockCreateTag,
  mockGetTag,
  mockUpdateTag,
  mockDeleteTag,
  mockGetMonitor,
  mockSetMonitorTags,
  mockGetMonitorWithTags,
  mockGetMonitorsWithTags,
  mockGetUser,
  mockChannelTablesExist,
} = vi.hoisted(() => ({
  mockListUserTags: vi.fn(),
  mockCountUserTags: vi.fn(),
  mockCreateTag: vi.fn(),
  mockGetTag: vi.fn(),
  mockUpdateTag: vi.fn(),
  mockDeleteTag: vi.fn(),
  mockGetMonitor: vi.fn(),
  mockSetMonitorTags: vi.fn(),
  mockGetMonitorWithTags: vi.fn(),
  mockGetMonitorsWithTags: vi.fn(),
  mockGetUser: vi.fn(),
  mockChannelTablesExist: vi.fn().mockResolvedValue(true),
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
    getMonitorsWithTags: (...args: any[]) => mockGetMonitorsWithTags(...args),
    getMonitorWithTags: (...args: any[]) => mockGetMonitorWithTags(...args),
    getAllActiveMonitors: vi.fn().mockResolvedValue([]),
    deleteMonitor: vi.fn(),
    createMonitor: vi.fn(),
    updateMonitor: vi.fn(),
    getMonitorCount: vi.fn().mockResolvedValue(0),
    getNotificationPreferences: vi.fn().mockResolvedValue(undefined),
    upsertNotificationPreferences: vi.fn(),
    deleteNotificationPreferences: vi.fn(),
    getMonitorChannels: vi.fn().mockResolvedValue([]),
    upsertMonitorChannel: vi.fn(),
    deleteMonitorChannel: vi.fn(),
    addDeliveryLog: vi.fn(),
    getDeliveryLog: vi.fn().mockResolvedValue([]),
    getSlackConnection: vi.fn(),
    upsertSlackConnection: vi.fn(),
    deleteSlackConnection: vi.fn(),
    deleteSlackChannelsForUser: vi.fn(),
    listUserTags: (...args: any[]) => mockListUserTags(...args),
    countUserTags: (...args: any[]) => mockCountUserTags(...args),
    createTag: (...args: any[]) => mockCreateTag(...args),
    getTag: (...args: any[]) => mockGetTag(...args),
    updateTag: (...args: any[]) => mockUpdateTag(...args),
    deleteTag: (...args: any[]) => mockDeleteTag(...args),
    setMonitorTags: (...args: any[]) => mockSetMonitorTags(...args),
    getMonitorTags: vi.fn().mockResolvedValue([]),
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
  notificationTablesExist: vi.fn().mockResolvedValue(true),
  channelTablesExist: (...args: any[]) => mockChannelTablesExist(...args),
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

function resetMocks() {
  mockListUserTags.mockReset();
  mockCountUserTags.mockReset();
  mockCreateTag.mockReset();
  mockGetTag.mockReset();
  mockUpdateTag.mockReset();
  mockDeleteTag.mockReset();
  mockGetMonitor.mockReset();
  mockSetMonitorTags.mockReset();
  mockGetMonitorWithTags.mockReset();
  mockGetMonitorsWithTags.mockReset();
  mockGetUser.mockReset();
  mockChannelTablesExist.mockReset().mockResolvedValue(true);
}

// ---------------------------------------------------------------------------
// Tests: GET /api/tags
// ---------------------------------------------------------------------------
describe("GET /api/tags", () => {
  beforeEach(async () => {
    await ensureRoutes();
    resetMocks();
  });

  it("returns user's tags", async () => {
    const tags = [
      { id: 1, userId: "user1", name: "Work", nameLower: "work", colour: "#ef4444", createdAt: new Date() },
      { id: 2, userId: "user1", name: "Personal", nameLower: "personal", colour: "#3b82f6", createdAt: new Date() },
    ];
    mockListUserTags.mockResolvedValueOnce(tags);

    const res = await callHandler("get", "/api/tags", makeReq());
    expect(res._status).toBe(200);
    expect(res._json).toHaveLength(2);
    expect(res._json[0].name).toBe("Work");
    expect(mockListUserTags).toHaveBeenCalledWith("user1");
  });

  it("returns empty array when user has no tags", async () => {
    mockListUserTags.mockResolvedValueOnce([]);

    const res = await callHandler("get", "/api/tags", makeReq());
    expect(res._status).toBe(200);
    expect(res._json).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Tests: POST /api/tags
// ---------------------------------------------------------------------------
describe("POST /api/tags", () => {
  beforeEach(async () => {
    await ensureRoutes();
    resetMocks();
  });

  it("creates a tag for pro user", async () => {
    mockGetUser.mockResolvedValueOnce({ tier: "pro" });
    mockCountUserTags.mockResolvedValueOnce(3);
    mockListUserTags.mockResolvedValueOnce([]);
    const newTag = { id: 1, userId: "user1", name: "Work", nameLower: "work", colour: "#ef4444", createdAt: new Date() };
    mockCreateTag.mockResolvedValueOnce(newTag);

    const req = makeReq("user1", {
      body: { name: "Work", colour: "#ef4444" },
    });
    const res = await callHandler("post", "/api/tags", req);
    expect(res._status).toBe(201);
    expect(res._json.name).toBe("Work");
    expect(mockCreateTag).toHaveBeenCalledWith("user1", "Work", "work", "#ef4444");
  });

  it("returns 400 for free tier user (limit 0)", async () => {
    mockGetUser.mockResolvedValueOnce({ tier: "free" });
    mockCountUserTags.mockResolvedValueOnce(0);

    const req = makeReq("user1", {
      body: { name: "Work", colour: "#ef4444" },
    });
    const res = await callHandler("post", "/api/tags", req);
    expect(res._status).toBe(400);
    expect(res._json.code).toBe("TAG_LIMIT_REACHED");
    expect(res._json.message).toContain("Free plan");
  });

  it("returns 400 when pro user hits tag limit", async () => {
    mockGetUser.mockResolvedValueOnce({ tier: "pro" });
    mockCountUserTags.mockResolvedValueOnce(10);

    const req = makeReq("user1", {
      body: { name: "Work", colour: "#ef4444" },
    });
    const res = await callHandler("post", "/api/tags", req);
    expect(res._status).toBe(400);
    expect(res._json.code).toBe("TAG_LIMIT_REACHED");
    expect(res._json.message).toContain("pro plan limit");
  });

  it("returns 409 for duplicate tag name (case-insensitive)", async () => {
    mockGetUser.mockResolvedValueOnce({ tier: "pro" });
    mockCountUserTags.mockResolvedValueOnce(1);
    mockListUserTags.mockResolvedValueOnce([
      { id: 1, userId: "user1", name: "Work", nameLower: "work", colour: "#ef4444" },
    ]);

    const req = makeReq("user1", {
      body: { name: "work", colour: "#3b82f6" },
    });
    const res = await callHandler("post", "/api/tags", req);
    expect(res._status).toBe(409);
    expect(res._json.code).toBe("TAG_NAME_CONFLICT");
  });

  it("returns 400 for invalid input (missing name)", async () => {
    mockGetUser.mockResolvedValueOnce({ tier: "pro" });
    mockCountUserTags.mockResolvedValueOnce(0);

    const req = makeReq("user1", {
      body: { colour: "#ef4444" },
    });
    const res = await callHandler("post", "/api/tags", req);
    expect(res._status).toBe(400);
  });

  it("returns 400 for invalid colour not in preset list", async () => {
    mockGetUser.mockResolvedValueOnce({ tier: "pro" });
    mockCountUserTags.mockResolvedValueOnce(0);

    const req = makeReq("user1", {
      body: { name: "Work", colour: "#ff0000" },
    });
    const res = await callHandler("post", "/api/tags", req);
    expect(res._status).toBe(400);
  });

  it("returns 409 on DB unique constraint race (23505)", async () => {
    mockGetUser.mockResolvedValueOnce({ tier: "pro" });
    mockCountUserTags.mockResolvedValueOnce(1);
    mockListUserTags.mockResolvedValueOnce([]); // app-level check passes
    const dbError: any = new Error("duplicate key value violates unique constraint");
    dbError.code = "23505";
    mockCreateTag.mockRejectedValueOnce(dbError);

    const req = makeReq("user1", {
      body: { name: "Work", colour: "#ef4444" },
    });
    const res = await callHandler("post", "/api/tags", req);
    expect(res._status).toBe(409);
    expect(res._json.code).toBe("TAG_NAME_CONFLICT");
  });

  it("allows power tier with many existing tags", async () => {
    mockGetUser.mockResolvedValueOnce({ tier: "power" });
    mockCountUserTags.mockResolvedValueOnce(999);
    mockListUserTags.mockResolvedValueOnce([]);
    const newTag = { id: 100, userId: "user1", name: "Test", nameLower: "test", colour: "#ef4444", createdAt: new Date() };
    mockCreateTag.mockResolvedValueOnce(newTag);

    const req = makeReq("user1", {
      body: { name: "Test", colour: "#ef4444" },
    });
    const res = await callHandler("post", "/api/tags", req);
    expect(res._status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// Tests: PATCH /api/tags/:id
// ---------------------------------------------------------------------------
describe("PATCH /api/tags/:id", () => {
  beforeEach(async () => {
    await ensureRoutes();
    resetMocks();
  });

  it("updates tag name", async () => {
    mockGetTag.mockResolvedValueOnce({ id: 1, userId: "user1", name: "Old", nameLower: "old", colour: "#ef4444" });
    mockListUserTags.mockResolvedValueOnce([]);
    mockUpdateTag.mockResolvedValueOnce({ id: 1, userId: "user1", name: "New", nameLower: "new", colour: "#ef4444" });

    const req = makeReq("user1", {
      params: { id: "1" },
      body: { name: "New" },
    });
    const res = await callHandler("patch", "/api/tags/:id", req);
    expect(res._status).toBe(200);
    expect(res._json.name).toBe("New");
  });

  it("updates tag colour", async () => {
    mockGetTag.mockResolvedValueOnce({ id: 1, userId: "user1", name: "Work", nameLower: "work", colour: "#ef4444" });
    mockUpdateTag.mockResolvedValueOnce({ id: 1, userId: "user1", name: "Work", nameLower: "work", colour: "#3b82f6" });

    const req = makeReq("user1", {
      params: { id: "1" },
      body: { colour: "#3b82f6" },
    });
    const res = await callHandler("patch", "/api/tags/:id", req);
    expect(res._status).toBe(200);
    expect(res._json.colour).toBe("#3b82f6");
  });

  it("returns 404 when tag does not exist", async () => {
    mockGetTag.mockResolvedValueOnce(undefined);

    const req = makeReq("user1", {
      params: { id: "999" },
      body: { name: "New" },
    });
    const res = await callHandler("patch", "/api/tags/:id", req);
    expect(res._status).toBe(404);
  });

  it("returns 409 for duplicate name on update", async () => {
    mockGetTag.mockResolvedValueOnce({ id: 1, userId: "user1", name: "Old", nameLower: "old", colour: "#ef4444" });
    mockListUserTags.mockResolvedValueOnce([
      { id: 2, userId: "user1", name: "Existing", nameLower: "existing", colour: "#3b82f6" },
    ]);

    const req = makeReq("user1", {
      params: { id: "1" },
      body: { name: "Existing" },
    });
    const res = await callHandler("patch", "/api/tags/:id", req);
    expect(res._status).toBe(409);
    expect(res._json.code).toBe("TAG_NAME_CONFLICT");
  });

  it("allows renaming to same name (case unchanged)", async () => {
    mockGetTag.mockResolvedValueOnce({ id: 1, userId: "user1", name: "Work", nameLower: "work", colour: "#ef4444" });
    mockUpdateTag.mockResolvedValueOnce({ id: 1, userId: "user1", name: "Work", nameLower: "work", colour: "#ef4444" });

    const req = makeReq("user1", {
      params: { id: "1" },
      body: { name: "Work" },
    });
    const res = await callHandler("patch", "/api/tags/:id", req);
    // Same nameLower, so no conflict check needed — skips the uniqueness path
    expect(res._status).toBe(200);
  });

  it("returns 409 on DB unique constraint race during update (23505)", async () => {
    mockGetTag.mockResolvedValueOnce({ id: 1, userId: "user1", name: "Old", nameLower: "old", colour: "#ef4444" });
    mockListUserTags.mockResolvedValueOnce([]); // app-level check passes
    const dbError: any = new Error("duplicate key value violates unique constraint");
    dbError.code = "23505";
    mockUpdateTag.mockRejectedValueOnce(dbError);

    const req = makeReq("user1", {
      params: { id: "1" },
      body: { name: "Conflict" },
    });
    const res = await callHandler("patch", "/api/tags/:id", req);
    expect(res._status).toBe(409);
    expect(res._json.code).toBe("TAG_NAME_CONFLICT");
  });

  it("returns 400 for invalid update body (empty object)", async () => {
    mockGetTag.mockResolvedValueOnce({ id: 1, userId: "user1", name: "Work", nameLower: "work", colour: "#ef4444" });

    const req = makeReq("user1", {
      params: { id: "1" },
      body: {},
    });
    const res = await callHandler("patch", "/api/tags/:id", req);
    expect(res._status).toBe(400);
  });

  it("returns 404 when tag deleted concurrently (TOCTOU race)", async () => {
    // Existence check passes — tag exists at time of getTag call
    mockGetTag.mockResolvedValueOnce({ id: 1, userId: "user1", name: "Work", nameLower: "work", colour: "#ef4444" });
    // But updateTag returns undefined — tag deleted between check and update
    mockUpdateTag.mockResolvedValueOnce(undefined);

    const req = makeReq("user1", {
      params: { id: "1" },
      body: { colour: "#3b82f6" },
    });
    const res = await callHandler("patch", "/api/tags/:id", req);
    expect(res._status).toBe(404);
    expect(res._json).toEqual({ message: "Not found", code: "NOT_FOUND" });
  });
});

// ---------------------------------------------------------------------------
// Tests: DELETE /api/tags/:id
// ---------------------------------------------------------------------------
describe("DELETE /api/tags/:id", () => {
  beforeEach(async () => {
    await ensureRoutes();
    resetMocks();
  });

  it("deletes tag successfully", async () => {
    mockGetTag.mockResolvedValueOnce({ id: 1, userId: "user1", name: "Work", nameLower: "work", colour: "#ef4444" });
    mockDeleteTag.mockResolvedValueOnce(undefined);

    const req = makeReq("user1", { params: { id: "1" } });
    const res = await callHandler("delete", "/api/tags/:id", req);
    expect(res._status).toBe(204);
    expect(mockDeleteTag).toHaveBeenCalledWith(1, "user1");
  });

  it("returns 404 when tag does not exist", async () => {
    mockGetTag.mockResolvedValueOnce(undefined);

    const req = makeReq("user1", { params: { id: "999" } });
    const res = await callHandler("delete", "/api/tags/:id", req);
    expect(res._status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Tests: PUT /api/monitors/:id/tags (setTags)
// ---------------------------------------------------------------------------
describe("PUT /api/monitors/:id/tags", () => {
  beforeEach(async () => {
    await ensureRoutes();
    resetMocks();
  });

  it("sets tags on a monitor", async () => {
    mockGetMonitor.mockResolvedValueOnce({ id: 1, userId: "user1" });
    mockListUserTags.mockResolvedValueOnce([
      { id: 10, userId: "user1", name: "Work", nameLower: "work", colour: "#ef4444" },
      { id: 20, userId: "user1", name: "Personal", nameLower: "personal", colour: "#3b82f6" },
    ]);
    mockGetUser.mockResolvedValueOnce({ tier: "pro" });
    mockSetMonitorTags.mockResolvedValueOnce(undefined);
    const updated = { id: 1, userId: "user1", name: "Monitor", tags: [{ id: 10, name: "Work", colour: "#ef4444" }] };
    mockGetMonitorWithTags.mockResolvedValueOnce(updated);

    const req = makeReq("user1", {
      params: { id: "1" },
      body: { tagIds: [10] },
    });
    const res = await callHandler("put", "/api/monitors/:id/tags", req);
    expect(res._status).toBe(200);
    expect(res._json.tags).toHaveLength(1);
    expect(mockSetMonitorTags).toHaveBeenCalledWith(1, [10]);
  });

  it("clears all tags with empty array", async () => {
    mockGetMonitor.mockResolvedValueOnce({ id: 1, userId: "user1" });
    mockSetMonitorTags.mockResolvedValueOnce(undefined);
    const updated = { id: 1, userId: "user1", tags: [] };
    mockGetMonitorWithTags.mockResolvedValueOnce(updated);

    const req = makeReq("user1", {
      params: { id: "1" },
      body: { tagIds: [] },
    });
    const res = await callHandler("put", "/api/monitors/:id/tags", req);
    expect(res._status).toBe(200);
    expect(res._json.tags).toEqual([]);
  });

  it("returns 404 when monitor does not exist", async () => {
    mockGetMonitor.mockResolvedValueOnce(undefined);

    const req = makeReq("user1", {
      params: { id: "999" },
      body: { tagIds: [1] },
    });
    const res = await callHandler("put", "/api/monitors/:id/tags", req);
    expect(res._status).toBe(404);
  });

  it("returns 403 when user does not own monitor", async () => {
    mockGetMonitor.mockResolvedValueOnce({ id: 1, userId: "other-user" });

    const req = makeReq("user1", {
      params: { id: "1" },
      body: { tagIds: [1] },
    });
    const res = await callHandler("put", "/api/monitors/:id/tags", req);
    expect(res._status).toBe(403);
  });

  it("returns 422 for foreign tag IDs", async () => {
    mockGetMonitor.mockResolvedValueOnce({ id: 1, userId: "user1" });
    mockListUserTags.mockResolvedValueOnce([
      { id: 10, userId: "user1", name: "Work", nameLower: "work", colour: "#ef4444" },
    ]);

    const req = makeReq("user1", {
      params: { id: "1" },
      body: { tagIds: [10, 999] },
    });
    const res = await callHandler("put", "/api/monitors/:id/tags", req);
    expect(res._status).toBe(422);
    expect(res._json.code).toBe("INVALID_TAG");
  });

  it("returns 400 when exceeding assignment limit", async () => {
    mockGetMonitor.mockResolvedValueOnce({ id: 1, userId: "user1" });
    mockListUserTags.mockResolvedValueOnce([
      { id: 10, userId: "user1", name: "A", nameLower: "a", colour: "#ef4444" },
      { id: 20, userId: "user1", name: "B", nameLower: "b", colour: "#3b82f6" },
      { id: 30, userId: "user1", name: "C", nameLower: "c", colour: "#22c55e" },
    ]);
    mockGetUser.mockResolvedValueOnce({ tier: "pro" }); // pro limit = 2

    const req = makeReq("user1", {
      params: { id: "1" },
      body: { tagIds: [10, 20, 30] },
    });
    const res = await callHandler("put", "/api/monitors/:id/tags", req);
    expect(res._status).toBe(400);
    expect(res._json.code).toBe("TAG_ASSIGNMENT_LIMIT_REACHED");
  });

  it("returns 400 for invalid body (non-array tagIds)", async () => {
    mockGetMonitor.mockResolvedValueOnce({ id: 1, userId: "user1" });

    const req = makeReq("user1", {
      params: { id: "1" },
      body: { tagIds: "not-an-array" },
    });
    const res = await callHandler("put", "/api/monitors/:id/tags", req);
    expect(res._status).toBe(400);
  });

  it("allows power tier with many tags", async () => {
    const manyTags = Array.from({ length: 20 }, (_, i) => ({
      id: i + 1, userId: "user1", name: `Tag${i}`, nameLower: `tag${i}`, colour: "#ef4444",
    }));
    const manyIds = manyTags.map(t => t.id);

    mockGetMonitor.mockResolvedValueOnce({ id: 1, userId: "user1" });
    mockListUserTags.mockResolvedValueOnce(manyTags);
    mockGetUser.mockResolvedValueOnce({ tier: "power" }); // unlimited
    mockSetMonitorTags.mockResolvedValueOnce(undefined);
    mockGetMonitorWithTags.mockResolvedValueOnce({ id: 1, tags: manyTags });

    const req = makeReq("user1", {
      params: { id: "1" },
      body: { tagIds: manyIds },
    });
    const res = await callHandler("put", "/api/monitors/:id/tags", req);
    expect(res._status).toBe(200);
  });

  it("returns 404 when monitor deleted concurrently (TOCTOU race — post-write)", async () => {
    // Ownership check passes — monitor exists at time of getMonitor call
    mockGetMonitor.mockResolvedValueOnce({ id: 1, userId: "user1" });
    mockSetMonitorTags.mockResolvedValueOnce(undefined);
    // But getMonitorWithTags returns undefined — monitor deleted between setMonitorTags and fetch
    mockGetMonitorWithTags.mockResolvedValueOnce(undefined);

    const req = makeReq("user1", {
      params: { id: "1" },
      body: { tagIds: [] },
    });
    const res = await callHandler("put", "/api/monitors/:id/tags", req);
    expect(res._status).toBe(404);
    expect(res._json).toEqual({ message: "Not found", code: "NOT_FOUND" });
  });

  it("returns 404 when setMonitorTags hits FK violation (TOCTOU race — mid-write)", async () => {
    // Ownership check passes — monitor exists at time of getMonitor call
    mockGetMonitor.mockResolvedValueOnce({ id: 1, userId: "user1" });
    mockListUserTags.mockResolvedValueOnce([
      { id: 10, userId: "user1", name: "Work", nameLower: "work", colour: "#ef4444" },
    ]);
    mockGetUser.mockResolvedValueOnce({ tier: "pro" });
    // Monitor deleted before setMonitorTags — FK violation
    const fkError: any = new Error("insert or update on table violates foreign key constraint");
    fkError.code = "23503";
    mockSetMonitorTags.mockRejectedValueOnce(fkError);

    const req = makeReq("user1", {
      params: { id: "1" },
      body: { tagIds: [10] },
    });
    const res = await callHandler("put", "/api/monitors/:id/tags", req);
    expect(res._status).toBe(404);
    expect(res._json).toEqual({ message: "Not found", code: "NOT_FOUND" });
  });
});

// ---------------------------------------------------------------------------
// Tests: GET /api/monitors (includes tags)
// ---------------------------------------------------------------------------
describe("GET /api/monitors (with tags)", () => {
  beforeEach(async () => {
    await ensureRoutes();
    resetMocks();
  });

  it("returns monitors with tags from getMonitorsWithTags", async () => {
    const monitorsData = [
      { id: 1, userId: "user1", name: "Site A", tags: [{ id: 10, name: "Work", colour: "#ef4444" }] },
      { id: 2, userId: "user1", name: "Site B", tags: [] },
    ];
    mockGetMonitorsWithTags.mockResolvedValueOnce(monitorsData);

    const res = await callHandler("get", "/api/monitors", makeReq());
    expect(res._status).toBe(200);
    expect(res._json).toHaveLength(2);
    expect(res._json[0].tags).toHaveLength(1);
    expect(res._json[1].tags).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Tests: GET /api/monitors/:id (includes tags)
// ---------------------------------------------------------------------------
describe("GET /api/monitors/:id (with tags)", () => {
  beforeEach(async () => {
    await ensureRoutes();
    resetMocks();
  });

  it("returns single monitor with tags", async () => {
    const monitor = { id: 1, userId: "user1", name: "Site A", tags: [{ id: 10, name: "Work", colour: "#ef4444" }] };
    mockGetMonitorWithTags.mockResolvedValueOnce(monitor);

    const res = await callHandler("get", "/api/monitors/:id", makeReq());
    expect(res._status).toBe(200);
    expect(res._json.tags).toHaveLength(1);
  });

  it("returns each tag exactly once (no duplicates)", async () => {
    const monitor = {
      id: 1,
      userId: "user1",
      name: "Site A",
      tags: [
        { id: 10, name: "Work", colour: "#ef4444" },
        { id: 20, name: "Personal", colour: "#3b82f6" },
      ],
    };
    mockGetMonitorWithTags.mockResolvedValueOnce(monitor);

    const res = await callHandler("get", "/api/monitors/:id", makeReq());
    expect(res._status).toBe(200);
    const tagIds = res._json.tags.map((t: any) => t.id);
    const uniqueIds = [...new Set(tagIds)];
    expect(tagIds).toEqual(uniqueIds);
    expect(tagIds).toHaveLength(2);
  });

  it("returns 404 when monitor not found", async () => {
    mockGetMonitorWithTags.mockResolvedValueOnce(undefined);

    const res = await callHandler("get", "/api/monitors/:id", makeReq());
    expect(res._status).toBe(404);
  });

  it("returns 403 when user does not own monitor", async () => {
    mockGetMonitorWithTags.mockResolvedValueOnce({ id: 1, userId: "other-user", tags: [] });

    const res = await callHandler("get", "/api/monitors/:id", makeReq("user1"));
    expect(res._status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Tests: GET /api/monitors (no duplicate tags in list response)
// ---------------------------------------------------------------------------
describe("GET /api/monitors (tag uniqueness)", () => {
  beforeEach(async () => {
    await ensureRoutes();
    resetMocks();
  });

  it("each monitor's tags array contains no duplicate tag IDs", async () => {
    const monitorsData = [
      {
        id: 1,
        userId: "user1",
        name: "Site A",
        tags: [
          { id: 10, name: "Work", colour: "#ef4444" },
          { id: 20, name: "Personal", colour: "#3b82f6" },
        ],
      },
      { id: 2, userId: "user1", name: "Site B", tags: [{ id: 10, name: "Work", colour: "#ef4444" }] },
    ];
    mockGetMonitorsWithTags.mockResolvedValueOnce(monitorsData);

    const res = await callHandler("get", "/api/monitors", makeReq());
    expect(res._status).toBe(200);
    for (const monitor of res._json) {
      const tagIds = monitor.tags.map((t: any) => t.id);
      expect(tagIds).toEqual([...new Set(tagIds)]);
    }
  });
});
