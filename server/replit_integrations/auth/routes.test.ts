import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockUpdateNotificationEmail = vi.fn();

vi.mock("./storage", () => ({
  authStorage: {
    getUser: (...args: any[]) => mockGetUser(...args),
    updateNotificationEmail: (...args: any[]) => mockUpdateNotificationEmail(...args),
  },
}));

vi.mock("./replitAuth", () => ({
  isAuthenticated: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../middleware/rateLimiter", () => ({
  emailUpdateRateLimiter: (_req: any, _res: any, next: any) => next(),
}));

import { registerAuthRoutes } from "./routes";

function createMockReqRes(userId = "user-123") {
  const req = {
    user: { claims: { sub: userId } },
  } as any;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as any;
  return { req, res };
}

describe("GET /api/auth/user handler", () => {
  let handler: (req: any, res: any) => Promise<void>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Extract the route handler by intercepting app.get
    const app = {
      get: vi.fn(),
      patch: vi.fn(),
    } as any;
    registerAuthRoutes(app);
    // The handler is the last argument (after path and middleware)
    const getCall = app.get.mock.calls.find(
      (call: any[]) => call[0] === "/api/auth/user"
    );
    handler = getCall[getCall.length - 1];
  });

  it("returns user data when user exists", async () => {
    const userData = { id: "user-123", tier: "free" };
    mockGetUser.mockResolvedValue(userData);
    const { req, res } = createMockReqRes();

    await handler(req, res);

    expect(mockGetUser).toHaveBeenCalledWith("user-123");
    expect(res.json).toHaveBeenCalledWith(userData);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 404 when user row is missing (undefined)", async () => {
    mockGetUser.mockResolvedValue(undefined);
    const { req, res } = createMockReqRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: "User not found" });
  });

  it("returns 404 when user row is null", async () => {
    mockGetUser.mockResolvedValue(null);
    const { req, res } = createMockReqRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: "User not found" });
  });

  it("returns 500 when storage throws", async () => {
    mockGetUser.mockRejectedValue(new Error("DB connection lost"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { req, res } = createMockReqRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ message: "Failed to fetch user" });
    consoleSpy.mockRestore();
  });
});

describe("PATCH /api/auth/user/notification-email handler", () => {
  let handler: (req: any, res: any) => Promise<void>;

  beforeEach(() => {
    vi.clearAllMocks();
    const app = {
      get: vi.fn(),
      patch: vi.fn(),
    } as any;
    registerAuthRoutes(app);
    const patchCall = app.patch.mock.calls.find(
      (call: any[]) => call[0] === "/api/auth/user/notification-email"
    );
    handler = patchCall[patchCall.length - 1];
  });

  it("returns updated user on success", async () => {
    const userData = { id: "user-123", notificationEmail: "new@example.com" };
    mockUpdateNotificationEmail.mockResolvedValue(userData);
    const { req, res } = createMockReqRes();
    req.body = { notificationEmail: "new@example.com" };

    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith(userData);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 404 when user does not exist", async () => {
    mockUpdateNotificationEmail.mockResolvedValue(undefined);
    const { req, res } = createMockReqRes();
    req.body = { notificationEmail: "new@example.com" };

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: "User not found" });
  });

  it("returns 400 for invalid email", async () => {
    const { req, res } = createMockReqRes();
    req.body = { notificationEmail: "not-an-email" };

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: "Invalid email address" });
  });

  it("returns 500 when storage throws", async () => {
    mockUpdateNotificationEmail.mockRejectedValue(new Error("DB error"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { req, res } = createMockReqRes();
    req.body = { notificationEmail: "valid@example.com" };

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ message: "Failed to update notification email" });
    consoleSpy.mockRestore();
  });

  it("accepts null to clear notification email", async () => {
    const userData = { id: "user-123", notificationEmail: null };
    mockUpdateNotificationEmail.mockResolvedValue(userData);
    const { req, res } = createMockReqRes();
    req.body = { notificationEmail: null };

    await handler(req, res);

    expect(mockUpdateNotificationEmail).toHaveBeenCalledWith("user-123", null);
    expect(res.json).toHaveBeenCalledWith(userData);
  });
});
