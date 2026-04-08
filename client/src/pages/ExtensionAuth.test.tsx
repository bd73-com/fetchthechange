/**
 * Tests: ExtensionAuth page
 * Coverage: token fetch (no Content-Type on bodyless POST), error states, success flow
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../test/server";
import { renderWithProviders, screen, waitFor } from "../test/test-utils";
import ExtensionAuth from "./ExtensionAuth";

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => server.close());

describe("ExtensionAuth", () => {
  it("shows sign-in link when user is not authenticated", async () => {
    server.use(
      http.get("/api/auth/user", () => new HttpResponse(null, { status: 401 })),
    );

    renderWithProviders(<ExtensionAuth />);

    await waitFor(() => {
      expect(screen.getByText("Sign in to FetchTheChange")).toBeDefined();
    });
  });

  it("sends POST without Content-Type header when user is authenticated", async () => {
    // Track the actual fetch request to verify no Content-Type header
    let capturedHeaders: Headers | undefined;

    server.use(
      http.post("/api/extension/token", ({ request }) => {
        capturedHeaders = request.headers;
        return HttpResponse.json({
          token: "test-jwt-token",
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        });
      }),
    );

    renderWithProviders(<ExtensionAuth />);

    await waitFor(() => {
      expect(capturedHeaders).toBeDefined();
    });

    // The fix: no Content-Type: application/json on a bodyless POST
    expect(capturedHeaders!.get("content-type")).toBeNull();
  });

  it("shows error message when token endpoint returns non-OK", async () => {
    server.use(
      http.post("/api/extension/token", () =>
        HttpResponse.json({ message: "Failed" }, { status: 500 }),
      ),
    );

    renderWithProviders(<ExtensionAuth />);

    await waitFor(() => {
      expect(screen.getByText("Failed to generate token (500). Please try again.")).toBeDefined();
    });
  });

  it("shows error when token response is not valid JSON", async () => {
    server.use(
      http.post("/api/extension/token", () =>
        new HttpResponse("not-json", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        }),
      ),
    );

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    renderWithProviders(<ExtensionAuth />);

    await waitFor(() => {
      expect(screen.getByText("Something went wrong. Please try again.")).toBeDefined();
    });

    consoleSpy.mockRestore();
  });

  it("shows error when 200 response has malformed token payload", async () => {
    const postMessageSpy = vi.spyOn(window, "postMessage");
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    server.use(
      http.post("/api/extension/token", () =>
        HttpResponse.json({ unexpected: "shape" }),
      ),
    );

    renderWithProviders(<ExtensionAuth />);

    await waitFor(() => {
      expect(screen.getByText("Something went wrong. Please try again.")).toBeDefined();
    });

    // postMessage should NOT have been called with a token
    expect(postMessageSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "FTC_EXTENSION_TOKEN" }),
      expect.anything(),
    );

    consoleSpy.mockRestore();
  });

  it("posts token via postMessage and shows success on valid response", async () => {
    const postMessageSpy = vi.spyOn(window, "postMessage");

    server.use(
      http.post("/api/extension/token", () =>
        HttpResponse.json({
          token: "jwt-abc",
          expiresAt: "2099-01-01T00:00:00.000Z",
        }),
      ),
    );

    renderWithProviders(<ExtensionAuth />);

    await waitFor(() => {
      expect(screen.getByText("Connected!")).toBeDefined();
    });

    expect(postMessageSpy).toHaveBeenCalledWith(
      { type: "FTC_EXTENSION_TOKEN", token: "jwt-abc", expiresAt: "2099-01-01T00:00:00.000Z" },
      window.location.origin,
    );
  });

  it("shows Connected! when done=1 query param is present (fallback callback)", async () => {
    let tokenRequestMade = false;
    server.use(
      http.post("/api/extension/token", () => {
        tokenRequestMade = true;
        return HttpResponse.json({ token: "test", expiresAt: "2099-01-01T00:00:00.000Z" });
      }),
    );

    // Simulate the fallback callback URL
    const originalSearch = window.location.search;
    Object.defineProperty(window, "location", {
      value: { ...window.location, search: "?done=1" },
      writable: true,
    });

    renderWithProviders(<ExtensionAuth />);

    await waitFor(() => {
      expect(screen.getByText("Connected!")).toBeDefined();
    });

    // Verify no token request was made (isDone skips token generation)
    expect(tokenRequestMade).toBe(false);

    Object.defineProperty(window, "location", {
      value: { ...window.location, search: originalSearch },
      writable: true,
    });
  });

  it("includes credentials in the token request", async () => {
    const originalFetch = window.fetch;
    let fetchOptions: RequestInit | undefined;

    // Spy on window.fetch to capture the actual options passed
    const fetchSpy = vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
      if (url.includes("/api/extension/token")) {
        fetchOptions = init;
      }
      return originalFetch(input, init);
    });

    server.use(
      http.post("/api/extension/token", () =>
        HttpResponse.json({
          token: "jwt-test",
          expiresAt: "2099-01-01T00:00:00.000Z",
        }),
      ),
    );

    renderWithProviders(<ExtensionAuth />);

    await waitFor(() => {
      expect(fetchOptions).toBeDefined();
    });

    expect(fetchOptions!.credentials).toBe("include");
    fetchSpy.mockRestore();
  });
});
