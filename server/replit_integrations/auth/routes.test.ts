import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();

vi.mock("./storage", () => ({
  authStorage: {
    getUser: (...args: any[]) => mockGetUser(...args),
    updateNotificationEmail: vi.fn(),
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
