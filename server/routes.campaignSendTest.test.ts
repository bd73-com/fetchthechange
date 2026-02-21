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
  mockOrderByFn,
  mockUpdateSetFn,
  mockUpdateWhereFn,
  mockUpdateReturningFn,
  mockSendTestCampaignEmail,
} = vi.hoisted(() => {
  const mockLimitFn = vi.fn();
  const mockOrderByFn = vi.fn(() => ({ limit: mockLimitFn }));
  const mockSelectWhereFn = vi.fn(() => ({ limit: mockLimitFn, orderBy: mockOrderByFn }));
  const mockSelectFromFn = vi.fn(() => ({ where: mockSelectWhereFn, orderBy: mockOrderByFn }));
  const mockDbSelect = vi.fn(() => ({ from: mockSelectFromFn }));

  const mockDeleteWhereFn = vi.fn().mockResolvedValue(undefined);
  const mockDbDelete = vi.fn(() => ({ where: mockDeleteWhereFn }));

  const mockUpdateReturningFn = vi.fn().mockResolvedValue([]);
  const mockUpdateWhereFn = vi.fn(() => ({ returning: mockUpdateReturningFn }));
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
    mockOrderByFn,
    mockUpdateSetFn,
    mockUpdateWhereFn,
    mockUpdateReturningFn,
    mockSendTestCampaignEmail: vi.fn(),
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

vi.mock("./services/campaignEmail", () => ({
  sendTestCampaignEmail: (...args: any[]) => mockSendTestCampaignEmail(...args),
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
  await registerRoutes(app as any, app as any);
  routesRegistered = true;
}

// ---------------------------------------------------------------------------
// Tests: POST /api/admin/campaigns/:id/send-test
// ---------------------------------------------------------------------------
describe("POST /api/admin/campaigns/:id/send-test", () => {
  const ENDPOINT = "/api/admin/campaigns/:id/send-test";

  const mockCampaign = {
    id: 1,
    name: "Test Campaign",
    subject: "Hello Users",
    htmlBody: "<h1>Welcome</h1>",
    textBody: "Welcome",
    status: "draft",
    filters: {},
  };

  beforeEach(async () => {
    await ensureRoutes();
    vi.clearAllMocks();

    // Reset chain mocks
    mockOrderByFn.mockReturnValue({ limit: mockLimitFn });
    mockSelectWhereFn.mockReturnValue({ limit: mockLimitFn, orderBy: mockOrderByFn });
    mockSelectFromFn.mockReturnValue({ where: mockSelectWhereFn, orderBy: mockOrderByFn });
    mockDbSelect.mockReturnValue({ from: mockSelectFromFn });
    mockUpdateSetFn.mockReturnValue({ where: mockUpdateWhereFn });
    mockUpdateWhereFn.mockReturnValue({ returning: mockUpdateReturningFn });
    mockDbUpdate.mockReturnValue({ set: mockUpdateSetFn });
  });

  it("returns 401 when user is not authenticated", async () => {
    const req = { user: null, params: { id: "1" }, body: {} };
    const res = await callHandler("post", ENDPOINT, req);
    expect(res._status).toBe(401);
    expect(res._json).toEqual({ message: "Unauthorized" });
  });

  it("returns 403 when user is not power tier", async () => {
    mockGetUser.mockResolvedValue({ tier: "pro", email: "a@b.com" });
    const req = { user: { claims: { sub: "user-1" } }, params: { id: "1" }, body: {} };
    const res = await callHandler("post", ENDPOINT, req);
    expect(res._status).toBe(403);
    expect(res._json).toEqual({ message: "Admin access required" });
  });

  it("returns 403 when power user is not app owner", async () => {
    mockGetUser.mockResolvedValue({ tier: "power", email: "a@b.com" });
    const req = { user: { claims: { sub: "not-the-owner" } }, params: { id: "1" }, body: {} };
    const res = await callHandler("post", ENDPOINT, req);
    expect(res._status).toBe(403);
    expect(res._json).toEqual({ message: "Owner access required" });
  });

  it("returns 404 when campaign does not exist", async () => {
    mockGetUser.mockResolvedValue({ tier: "power", email: "owner@test.com" });
    mockLimitFn.mockResolvedValue([]);

    const req = { user: { claims: { sub: "owner-123" } }, params: { id: "999" }, body: {} };
    const res = await callHandler("post", ENDPOINT, req);
    expect(res._status).toBe(404);
    expect(res._json).toEqual({ message: "Campaign not found" });
  });

  it("sends test email using campaign data from database", async () => {
    mockGetUser.mockResolvedValue({ tier: "power", email: "owner@test.com" });
    mockLimitFn.mockResolvedValue([mockCampaign]);
    mockSendTestCampaignEmail.mockResolvedValue({ success: true, resendId: "test_123" });

    const req = { user: { claims: { sub: "owner-123" } }, params: { id: "1" }, body: {} };
    const res = await callHandler("post", ENDPOINT, req);

    expect(res._status).toBe(200);
    expect(res._json).toEqual({ success: true, resendId: "test_123", sentTo: "owner@test.com" });
    expect(mockSendTestCampaignEmail).toHaveBeenCalledWith(mockCampaign, "owner@test.com");
  });

  it("passes the full campaign object to sendTestCampaignEmail (including htmlBody and subject)", async () => {
    const campaignWithContent = {
      ...mockCampaign,
      subject: "Updated Subject",
      htmlBody: "<h1>Updated Content</h1>",
      textBody: "Updated text",
    };
    mockGetUser.mockResolvedValue({ tier: "power", email: "owner@test.com" });
    mockLimitFn.mockResolvedValue([campaignWithContent]);
    mockSendTestCampaignEmail.mockResolvedValue({ success: true, resendId: "test_456" });

    const req = { user: { claims: { sub: "owner-123" } }, params: { id: "1" }, body: {} };
    const res = await callHandler("post", ENDPOINT, req);

    expect(res._status).toBe(200);
    // Verify the campaign object passed to the service contains the DB content
    const passedCampaign = mockSendTestCampaignEmail.mock.calls[0][0];
    expect(passedCampaign.subject).toBe("Updated Subject");
    expect(passedCampaign.htmlBody).toBe("<h1>Updated Content</h1>");
    expect(passedCampaign.textBody).toBe("Updated text");
  });

  it("uses testEmail from request body when provided", async () => {
    mockGetUser.mockResolvedValue({ tier: "power", email: "owner@test.com" });
    mockLimitFn.mockResolvedValue([mockCampaign]);
    mockSendTestCampaignEmail.mockResolvedValue({ success: true, resendId: "test_789" });

    const req = {
      user: { claims: { sub: "owner-123" } },
      params: { id: "1" },
      body: { testEmail: "custom@test.com" },
    };
    const res = await callHandler("post", ENDPOINT, req);

    expect(res._status).toBe(200);
    expect(res._json.sentTo).toBe("custom@test.com");
    expect(mockSendTestCampaignEmail).toHaveBeenCalledWith(mockCampaign, "custom@test.com");
  });

  it("prefers notificationEmail over regular email", async () => {
    mockGetUser.mockResolvedValue({
      tier: "power",
      email: "owner@test.com",
      notificationEmail: "alerts@test.com",
    });
    mockLimitFn.mockResolvedValue([mockCampaign]);
    mockSendTestCampaignEmail.mockResolvedValue({ success: true, resendId: "test_abc" });

    const req = { user: { claims: { sub: "owner-123" } }, params: { id: "1" }, body: {} };
    const res = await callHandler("post", ENDPOINT, req);

    expect(res._status).toBe(200);
    expect(res._json.sentTo).toBe("alerts@test.com");
  });

  it("returns 400 when no email address is available", async () => {
    mockGetUser.mockResolvedValue({ tier: "power", email: null, notificationEmail: null });
    mockLimitFn.mockResolvedValue([mockCampaign]);

    const req = { user: { claims: { sub: "owner-123" } }, params: { id: "1" }, body: {} };
    const res = await callHandler("post", ENDPOINT, req);

    expect(res._status).toBe(400);
    expect(res._json).toEqual({ message: "No email address available" });
  });

  it("returns 400 when sendTestCampaignEmail fails", async () => {
    mockGetUser.mockResolvedValue({ tier: "power", email: "owner@test.com" });
    mockLimitFn.mockResolvedValue([mockCampaign]);
    mockSendTestCampaignEmail.mockResolvedValue({ success: false, error: "RESEND_API_KEY not configured" });

    const req = { user: { claims: { sub: "owner-123" } }, params: { id: "1" }, body: {} };
    const res = await callHandler("post", ENDPOINT, req);

    expect(res._status).toBe(400);
    expect(res._json).toEqual({ success: false, error: "RESEND_API_KEY not configured" });
  });

  it("returns 500 when an exception is thrown", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockGetUser.mockResolvedValue({ tier: "power", email: "owner@test.com" });
    mockLimitFn.mockRejectedValue(new Error("DB connection lost"));

    const req = { user: { claims: { sub: "owner-123" } }, params: { id: "1" }, body: {} };
    const res = await callHandler("post", ENDPOINT, req);

    expect(res._status).toBe(500);
    expect(res._json).toEqual({ message: "Failed to send test campaign" });
    errorSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Tests: PATCH /api/admin/campaigns/:id
// ---------------------------------------------------------------------------
describe("PATCH /api/admin/campaigns/:id", () => {
  const ENDPOINT = "/api/admin/campaigns/:id";

  const existingCampaign = {
    id: 1,
    name: "Original Name",
    subject: "Original Subject",
    htmlBody: "<p>Original</p>",
    textBody: "Original text",
    status: "draft",
    filters: {},
  };

  beforeEach(async () => {
    await ensureRoutes();
    vi.clearAllMocks();

    mockOrderByFn.mockReturnValue({ limit: mockLimitFn });
    mockSelectWhereFn.mockReturnValue({ limit: mockLimitFn, orderBy: mockOrderByFn });
    mockSelectFromFn.mockReturnValue({ where: mockSelectWhereFn, orderBy: mockOrderByFn });
    mockDbSelect.mockReturnValue({ from: mockSelectFromFn });
    mockUpdateSetFn.mockReturnValue({ where: mockUpdateWhereFn });
    mockUpdateWhereFn.mockReturnValue({ returning: mockUpdateReturningFn });
    mockDbUpdate.mockReturnValue({ set: mockUpdateSetFn });
  });

  it("returns 401 when user is not authenticated", async () => {
    const req = { user: null, params: { id: "1" }, body: {} };
    const res = await callHandler("patch", ENDPOINT, req);
    expect(res._status).toBe(401);
    expect(res._json).toEqual({ message: "Unauthorized" });
  });

  it("returns 403 when user is not app owner", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    const req = { user: { claims: { sub: "not-the-owner" } }, params: { id: "1" }, body: {} };
    const res = await callHandler("patch", ENDPOINT, req);
    expect(res._status).toBe(403);
    expect(res._json).toEqual({ message: "Owner access required" });
  });

  it("returns 404 when campaign does not exist", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockLimitFn.mockResolvedValue([]);

    const req = { user: { claims: { sub: "owner-123" } }, params: { id: "999" }, body: {} };
    const res = await callHandler("patch", ENDPOINT, req);
    expect(res._status).toBe(404);
    expect(res._json).toEqual({ message: "Campaign not found" });
  });

  it("returns 400 when campaign is not in draft status", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockLimitFn.mockResolvedValue([{ ...existingCampaign, status: "sent" }]);

    const req = { user: { claims: { sub: "owner-123" } }, params: { id: "1" }, body: { subject: "New" } };
    const res = await callHandler("patch", ENDPOINT, req);
    expect(res._status).toBe(400);
    expect(res._json).toEqual({ message: "Only draft campaigns can be edited" });
  });

  it("updates campaign subject and htmlBody", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockLimitFn.mockResolvedValue([existingCampaign]);
    const updatedCampaign = {
      ...existingCampaign,
      subject: "Updated Subject",
      htmlBody: "<h1>Updated</h1>",
    };
    mockUpdateReturningFn.mockResolvedValue([updatedCampaign]);

    const req = {
      user: { claims: { sub: "owner-123" } },
      params: { id: "1" },
      body: { subject: "Updated Subject", htmlBody: "<h1>Updated</h1>" },
    };
    const res = await callHandler("patch", ENDPOINT, req);

    expect(res._status).toBe(200);
    expect(res._json.subject).toBe("Updated Subject");
    expect(res._json.htmlBody).toBe("<h1>Updated</h1>");
    // Verify db.update was called with correct fields
    expect(mockUpdateSetFn).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Updated Subject",
        htmlBody: "<h1>Updated</h1>",
      })
    );
  });

  it("only includes provided fields in the update", async () => {
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockLimitFn.mockResolvedValue([existingCampaign]);
    mockUpdateReturningFn.mockResolvedValue([{ ...existingCampaign, textBody: "New text" }]);

    const req = {
      user: { claims: { sub: "owner-123" } },
      params: { id: "1" },
      body: { textBody: "New text" },
    };
    const res = await callHandler("patch", ENDPOINT, req);

    expect(res._status).toBe(200);
    // Should only set textBody, not other fields
    const setArg = mockUpdateSetFn.mock.calls[0][0];
    expect(setArg).toEqual({ textBody: "New text" });
    expect(setArg).not.toHaveProperty("subject");
    expect(setArg).not.toHaveProperty("htmlBody");
  });

  it("returns 500 when database throws an error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockGetUser.mockResolvedValue({ tier: "power" });
    mockLimitFn.mockRejectedValue(new Error("DB error"));

    const req = { user: { claims: { sub: "owner-123" } }, params: { id: "1" }, body: {} };
    const res = await callHandler("patch", ENDPOINT, req);

    expect(res._status).toBe(500);
    expect(res._json).toEqual({ message: "Failed to update campaign" });
    errorSpy.mockRestore();
  });
});
