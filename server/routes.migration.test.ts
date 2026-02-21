import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mock variables
// ---------------------------------------------------------------------------
const {
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
  const mockDbExecute = vi.fn().mockResolvedValue({ rows: [] });

  return {
    mockDbExecute,
    mockDbSelect,
    mockLimitFn,
    mockSelectWhereFn,
    mockSelectFromFn,
    mockOrderByFn,
  };
});

// ---------------------------------------------------------------------------
// Module mocks (same pattern as other route tests)
// ---------------------------------------------------------------------------
vi.mock("./replit_integrations/auth", () => ({
  setupAuth: vi.fn().mockResolvedValue(undefined),
  registerAuthRoutes: vi.fn(),
  isAuthenticated: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("./replit_integrations/auth/storage", () => ({
  authStorage: {
    getUser: vi.fn(),
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
    getMonitorCount: vi.fn().mockResolvedValue(0),
  },
}));

vi.mock("./db", () => ({
  db: {
    select: (...args: any[]) => mockDbSelect(...args),
    delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }) }),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }) }) }),
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
  startScheduler: vi.fn(),
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("error_logs dedup column migration at startup", () => {
  beforeEach(() => {
    // Clear registered routes for fresh registration
    for (const method of Object.keys(registeredRoutes)) {
      delete registeredRoutes[method];
    }
  });

  it("calls db.execute for the two ALTER TABLE migration statements", async () => {
    vi.clearAllMocks();
    mockDbExecute.mockResolvedValue({ rows: [] });
    process.env.APP_OWNER_ID = "owner-123";

    const { registerRoutes } = await import("./routes");
    const app = makeMockApp();
    await registerRoutes(app as any, app as any);

    // db.execute should have been called at least 2 times for the ALTER TABLE statements
    expect(mockDbExecute).toHaveBeenCalledTimes(2);
  });

  it("still registers all route groups when migration succeeds", async () => {
    vi.clearAllMocks();
    mockDbExecute.mockResolvedValue({ rows: [] });
    process.env.APP_OWNER_ID = "owner-123";

    const { registerRoutes } = await import("./routes");
    const app = makeMockApp();
    await registerRoutes(app as any, app as any);

    const getRoutes = Object.keys(registeredRoutes["get"] ?? {});
    expect(getRoutes).toContain("/api/admin/error-logs");
    expect(getRoutes).toContain("/api/admin/error-logs/count");
  });

  it("still registers routes when migration fails", async () => {
    vi.clearAllMocks();
    mockDbExecute.mockRejectedValue(new Error("relation \"error_logs\" does not exist"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.APP_OWNER_ID = "owner-123";

    const { registerRoutes } = await import("./routes");
    const app = makeMockApp();

    // Should not throw even though migration failed
    await registerRoutes(app as any, app as any);

    // Routes should still be registered despite migration failure
    const getRoutes = Object.keys(registeredRoutes["get"] ?? {});
    expect(getRoutes).toContain("/api/admin/error-logs");
    expect(getRoutes).toContain("/api/admin/error-logs/count");
    const deleteRoutes = Object.keys(registeredRoutes["delete"] ?? {});
    expect(deleteRoutes).toContain("/api/admin/error-logs/:id");

    warnSpy.mockRestore();
  });

  it("logs a warning when migration fails", async () => {
    vi.clearAllMocks();
    const migrationError = new Error("connection refused");
    mockDbExecute.mockRejectedValue(migrationError);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.APP_OWNER_ID = "owner-123";

    const { registerRoutes } = await import("./routes");
    const app = makeMockApp();
    await registerRoutes(app as any, app as any);

    expect(warnSpy).toHaveBeenCalledWith(
      "Could not ensure error_logs dedup columns:",
      migrationError,
    );
    warnSpy.mockRestore();
  });

  it("does not throw when first execute succeeds but second fails", async () => {
    vi.clearAllMocks();
    mockDbExecute
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error("syntax error"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.APP_OWNER_ID = "owner-123";

    const { registerRoutes } = await import("./routes");
    const app = makeMockApp();

    // Should not throw
    await registerRoutes(app as any, app as any);

    // Routes should still register
    const getRoutes = Object.keys(registeredRoutes["get"] ?? {});
    expect(getRoutes.length).toBeGreaterThan(0);
    warnSpy.mockRestore();
  });
});
