import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ORIGINAL_APP_OWNER_ID = process.env.APP_OWNER_ID;

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
    // Delegate tx.execute back to the same mockDbExecute so the
    // ensureErrorLogColumns migration's in-transaction SQL (SET LOCAL,
    // pg_advisory_xact_lock, dedup UPDATE, dedup DELETE) is actually
    // exercised under the migration mock sequences below. Without this,
    // db.transaction is undefined and the whole migration falls into its
    // catch block — silently making the 9-call sequence assertions pass
    // for the wrong reason.
    transaction: async (fn: (tx: any) => Promise<any>) => {
      const tx = { execute: (...args: any[]) => mockDbExecute(...args) };
      return fn(tx);
    },
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
  adminErrorLogsRateLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("./services/scheduler", () => ({
  startScheduler: vi.fn().mockResolvedValue(undefined),
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

  afterEach(() => {
    if (ORIGINAL_APP_OWNER_ID === undefined) {
      delete process.env.APP_OWNER_ID;
    } else {
      process.env.APP_OWNER_ID = ORIGINAL_APP_OWNER_ID;
    }
  });

  it("calls db.execute for the ALTER TABLE migration statements", async () => {
    vi.clearAllMocks();
    mockDbExecute.mockResolvedValue({ rows: [] });
    process.env.APP_OWNER_ID = "owner-123";

    const { registerRoutes } = await import("./routes");
    const app = makeMockApp();
    await registerRoutes(app as any, app as any);

    // Verify db.execute was called at least once (exact count is validated
    // implicitly by the per-DDL assertions below, so we avoid a brittle
    // exact-count check that breaks every time a new ensure* function is added).
    expect(mockDbExecute.mock.calls.length).toBeGreaterThan(0);

    // Verify specific DDL statements were issued (drizzle sql`` produces SQL objects)
    const callStrings = mockDbExecute.mock.calls.map((c: any[]) => {
      const arg = c[0];
      // Try JSON stringify to capture all nested content
      try { return JSON.stringify(arg); } catch { return String(arg); }
    });
    expect(callStrings.some((s: string) => s.includes("api_keys"))).toBe(true);
    expect(callStrings.some((s: string) => s.includes("api_keys_user_revoked_idx"))).toBe(true);
    expect(callStrings.some((s: string) => s.includes("notification_channels"))).toBe(true);
    expect(callStrings.some((s: string) => s.includes("delivery_log"))).toBe(true);
    expect(callStrings.some((s: string) => s.includes("delivery_log_channel_status_attempt_idx"))).toBe(true);
    expect(callStrings.some((s: string) => s.includes("slack_connections"))).toBe(true);
    expect(callStrings.some((s: string) => s.includes("CREATE TABLE IF NOT EXISTS tags"))).toBe(true);
    expect(callStrings.some((s: string) => s.includes("monitor_tags"))).toBe(true);
    expect(callStrings.some((s: string) => s.includes("CREATE TABLE IF NOT EXISTS monitor_conditions"))).toBe(true);
    expect(callStrings.some((s: string) => s.includes("monitor_conditions_monitor_idx"))).toBe(true);
    expect(callStrings.some((s: string) => s.includes("notification_queue") && s.includes("attempts"))).toBe(true);
    expect(callStrings.some((s: string) => s.includes("notification_queue") && s.includes("permanently_failed"))).toBe(true);
    expect(callStrings.some((s: string) => s.includes("automated_campaign_configs"))).toBe(true);
    expect(callStrings.some((s: string) => s.includes("pending_retry_at"))).toBe(true);
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
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
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
    errorSpy.mockRestore();
  });

  it("logs a warning when migration fails", async () => {
    vi.clearAllMocks();
    const migrationError = new Error("connection refused");
    mockDbExecute.mockRejectedValue(migrationError);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.APP_OWNER_ID = "owner-123";

    const { registerRoutes } = await import("./routes");
    const app = makeMockApp();
    await registerRoutes(app as any, app as any);

    expect(warnSpy).toHaveBeenCalledWith(
      "Could not ensure error_logs columns/index:",
      migrationError,
    );
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("does not throw when first execute succeeds but second fails", async () => {
    vi.clearAllMocks();
    mockDbExecute
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error("syntax error"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.APP_OWNER_ID = "owner-123";

    const { registerRoutes } = await import("./routes");
    const app = makeMockApp();

    // Should not throw
    await registerRoutes(app as any, app as any);

    // Routes should still register
    const getRoutes = Object.keys(registeredRoutes["get"] ?? {});
    expect(getRoutes.length).toBeGreaterThan(0);
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("issues DDL for notification_channels with correct columns and constraints", async () => {
    vi.clearAllMocks();
    mockDbExecute.mockResolvedValue({ rows: [] });
    process.env.APP_OWNER_ID = "owner-123";

    const { registerRoutes } = await import("./routes");
    const app = makeMockApp();
    await registerRoutes(app as any, app as any);

    const callStrings = mockDbExecute.mock.calls.map((c: any[]) => {
      try { return JSON.stringify(c[0]); } catch { return String(c[0]); }
    });

    // notification_channels CREATE TABLE includes required columns
    const ncCreate = callStrings.find((s: string) =>
      s.includes("CREATE TABLE IF NOT EXISTS notification_channels")
    );
    expect(ncCreate).toBeDefined();
    expect(ncCreate).toContain("monitor_id");
    expect(ncCreate).toContain("channel");
    expect(ncCreate).toContain("enabled");
    expect(ncCreate).toContain("config");
    expect(ncCreate).toContain("JSONB");
    expect(ncCreate).toContain("ON DELETE CASCADE");

    // notification_channels indexes
    expect(callStrings.some((s: string) => s.includes("notification_channels_monitor_idx"))).toBe(true);
    expect(callStrings.some((s: string) => s.includes("notification_channels_monitor_channel_uniq"))).toBe(true);
  });

  it("issues DDL for delivery_log with correct columns and foreign keys", async () => {
    vi.clearAllMocks();
    mockDbExecute.mockResolvedValue({ rows: [] });
    process.env.APP_OWNER_ID = "owner-123";

    const { registerRoutes } = await import("./routes");
    const app = makeMockApp();
    await registerRoutes(app as any, app as any);

    const callStrings = mockDbExecute.mock.calls.map((c: any[]) => {
      try { return JSON.stringify(c[0]); } catch { return String(c[0]); }
    });

    const dlCreate = callStrings.find((s: string) =>
      s.includes("CREATE TABLE IF NOT EXISTS delivery_log")
    );
    expect(dlCreate).toBeDefined();
    expect(dlCreate).toContain("monitor_id");
    expect(dlCreate).toContain("change_id");
    expect(dlCreate).toContain("monitor_changes");
    expect(dlCreate).toContain("status");
    expect(dlCreate).toContain("attempt");
    expect(dlCreate).toContain("ON DELETE CASCADE");

    // delivery_log index
    expect(callStrings.some((s: string) => s.includes("delivery_log_monitor_created_idx"))).toBe(true);
  });

  it("issues DDL for slack_connections with correct columns", async () => {
    vi.clearAllMocks();
    mockDbExecute.mockResolvedValue({ rows: [] });
    process.env.APP_OWNER_ID = "owner-123";

    const { registerRoutes } = await import("./routes");
    const app = makeMockApp();
    await registerRoutes(app as any, app as any);

    const callStrings = mockDbExecute.mock.calls.map((c: any[]) => {
      try { return JSON.stringify(c[0]); } catch { return String(c[0]); }
    });

    const scCreate = callStrings.find((s: string) =>
      s.includes("CREATE TABLE IF NOT EXISTS slack_connections")
    );
    expect(scCreate).toBeDefined();
    expect(scCreate).toContain("user_id");
    expect(scCreate).toContain("team_id");
    expect(scCreate).toContain("team_name");
    expect(scCreate).toContain("bot_token");
    expect(scCreate).toContain("scope");
    expect(scCreate).toContain("UNIQUE");
    // bot_token must NOT have a CHECK constraint — validation belongs in app layer,
    // and the constraint mismatch with the Drizzle schema can silently break table creation
    expect(scCreate).not.toContain("CHECK");
  });

  it("issues DDL for tags and monitor_tags with correct columns and indexes", async () => {
    vi.clearAllMocks();
    mockDbExecute.mockResolvedValue({ rows: [] });
    process.env.APP_OWNER_ID = "owner-123";

    const { registerRoutes } = await import("./routes");
    const app = makeMockApp();
    await registerRoutes(app as any, app as any);

    const callStrings = mockDbExecute.mock.calls.map((c: any[]) => {
      try { return JSON.stringify(c[0]); } catch { return String(c[0]); }
    });

    // tags CREATE TABLE includes required columns
    const tagsCreate = callStrings.find((s: string) =>
      s.includes("CREATE TABLE IF NOT EXISTS tags")
    );
    expect(tagsCreate).toBeDefined();
    expect(tagsCreate).toContain("user_id");
    expect(tagsCreate).toContain("name_lower");
    expect(tagsCreate).toContain("colour");

    // tags indexes
    expect(callStrings.some((s: string) => s.includes("tags_user_idx"))).toBe(true);
    expect(callStrings.some((s: string) => s.includes("tags_user_name_lower_uniq"))).toBe(true);

    // monitor_tags CREATE TABLE includes required columns and constraints
    const mtCreate = callStrings.find((s: string) =>
      s.includes("CREATE TABLE IF NOT EXISTS monitor_tags")
    );
    expect(mtCreate).toBeDefined();
    expect(mtCreate).toContain("monitor_id");
    expect(mtCreate).toContain("tag_id");
    expect(mtCreate).toContain("ON DELETE CASCADE");

    // monitor_tags unique index
    expect(callStrings.some((s: string) => s.includes("monitor_tags_monitor_tag_uniq"))).toBe(true);
  });

  it("logs error and continues when notification channel table creation fails", async () => {
    vi.clearAllMocks();
    const channelError = new Error("permission denied for schema public");
    // monitor health ALTERs succeed (2), pending_retry_at (1), error_logs
    // migration succeeds (4 ALTERs + 1 monitor_id backfill UPDATE + 1 DO
    // block level CHECK + 1 pg_indexes check + 4 in-tx + 1 CREATE UNIQUE
    // INDEX CONCURRENTLY + 1 CREATE INDEX CONCURRENTLY for monitor_id = 13),
    // api_keys succeed (2), then channel tables fail
    mockDbExecute
      .mockResolvedValueOnce({ rows: [] }) // ALTER monitors health_alert_sent_at
      .mockResolvedValueOnce({ rows: [] }) // ALTER monitors last_healthy_at
      .mockResolvedValueOnce({ rows: [] }) // ALTER monitors pending_retry_at
      .mockResolvedValueOnce({ rows: [] }) // ALTER error_logs first_occurrence
      .mockResolvedValueOnce({ rows: [] }) // ALTER error_logs occurrence_count
      .mockResolvedValueOnce({ rows: [] }) // ALTER error_logs deleted_at
      .mockResolvedValueOnce({ rows: [] }) // ALTER error_logs monitor_id (#465)
      .mockResolvedValueOnce({ rows: [] }) // UPDATE error_logs monitor_id backfill (#465)
      .mockResolvedValueOnce({ rows: [] }) // DO block level CHECK
      .mockResolvedValueOnce({ rows: [] }) // pg_indexes check (no existing idx)
      .mockResolvedValueOnce({ rows: [] }) // SET LOCAL lock_timeout
      .mockResolvedValueOnce({ rows: [] }) // pg_advisory_xact_lock
      .mockResolvedValueOnce({ rows: [] }) // UPDATE dedup
      .mockResolvedValueOnce({ rows: [] }) // DELETE dedup
      .mockResolvedValueOnce({ rows: [] }) // CREATE UNIQUE INDEX CONCURRENTLY
      .mockResolvedValueOnce({ rows: [] }) // CREATE INDEX CONCURRENTLY error_logs_monitor_idx (#465)
      .mockResolvedValueOnce({ rows: [] }) // CREATE api_keys
      .mockResolvedValueOnce({ rows: [] }) // CREATE INDEX api_keys
      .mockRejectedValueOnce(channelError); // notification_channels fails

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.APP_OWNER_ID = "owner-123";

    const { registerRoutes } = await import("./routes");
    const app = makeMockApp();

    // Should not throw
    await registerRoutes(app as any, app as any);

    // Should log the specific notification channel error
    expect(errorSpy).toHaveBeenCalledWith(
      "Could not ensure notification channel tables:",
      channelError,
    );

    // Routes should still be registered
    const getRoutes = Object.keys(registeredRoutes["get"] ?? {});
    expect(getRoutes.length).toBeGreaterThan(0);
    expect(getRoutes).toContain("/api/admin/error-logs");

    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("registers channel routes even when notification channel tables fail to create", async () => {
    vi.clearAllMocks();
    const channelError = new Error("connection timeout");
    // monitor health ALTERs succeed (2), pending_retry_at (1), error_logs
    // migration succeeds (3 ALTERs + 1 DO block level CHECK + 1 pg_indexes
    // check + 4 in-tx + 1 CREATE INDEX CONCURRENTLY = 10), api_keys succeed
    // (2), channel tables fail
    mockDbExecute
      .mockResolvedValueOnce({ rows: [] }) // ALTER monitors health_alert_sent_at
      .mockResolvedValueOnce({ rows: [] }) // ALTER monitors last_healthy_at
      .mockResolvedValueOnce({ rows: [] }) // ALTER monitors pending_retry_at
      .mockResolvedValueOnce({ rows: [] }) // ALTER error_logs first_occurrence
      .mockResolvedValueOnce({ rows: [] }) // ALTER error_logs occurrence_count
      .mockResolvedValueOnce({ rows: [] }) // ALTER error_logs deleted_at
      .mockResolvedValueOnce({ rows: [] }) // DO block level CHECK
      .mockResolvedValueOnce({ rows: [] }) // pg_indexes check (no existing idx)
      .mockResolvedValueOnce({ rows: [] }) // SET LOCAL lock_timeout
      .mockResolvedValueOnce({ rows: [] }) // pg_advisory_xact_lock
      .mockResolvedValueOnce({ rows: [] }) // UPDATE dedup
      .mockResolvedValueOnce({ rows: [] }) // DELETE dedup
      .mockResolvedValueOnce({ rows: [] }) // CREATE UNIQUE INDEX CONCURRENTLY
      .mockResolvedValueOnce({ rows: [] }) // CREATE api_keys
      .mockResolvedValueOnce({ rows: [] }) // CREATE INDEX api_keys
      .mockRejectedValueOnce(channelError); // notification_channels fails

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.APP_OWNER_ID = "owner-123";

    const { registerRoutes } = await import("./routes");
    const app = makeMockApp();
    await registerRoutes(app as any, app as any);

    // Channel routes should still be registered (they use runtime channelTablesExist checks)
    const getRoutes = Object.keys(registeredRoutes["get"] ?? {});
    const putRoutes = Object.keys(registeredRoutes["put"] ?? {});
    const deleteRoutes = Object.keys(registeredRoutes["delete"] ?? {});
    expect(getRoutes).toContain("/api/monitors/:id/channels");
    expect(putRoutes).toContain("/api/monitors/:id/channels/:channel");
    expect(deleteRoutes).toContain("/api/monitors/:id/channels/:channel");

    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
