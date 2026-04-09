/**
 * Tests: ExtensionAuth page
 * Coverage: token fetch (no Content-Type on bodyless POST), error states,
 *           401 redirect, retry-on-failure, and success flow
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

  it("shows server error message when token endpoint returns non-OK", async () => {
    // Both attempts (initial + retry) return 500
    server.use(
      http.post("/api/extension/token", () =>
        HttpResponse.json({ message: "Extension signing key not configured" }, { status: 500 }),
      ),
    );

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    renderWithProviders(<ExtensionAuth />);

    // Retry adds ~1 s of delay before the error is shown
    await waitFor(() => {
      expect(screen.getByText("Extension signing key not configured")).toBeDefined();
    }, { timeout: 5000 });

    consoleSpy.mockRestore();
  });

  it("redirects to login on 401 response", async () => {
    server.use(
      http.post("/api/extension/token", () =>
        HttpResponse.json({ message: "Unauthorized" }, { status: 401 }),
      ),
    );

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    // jsdom doesn't support navigation; spy on the setter
    const originalLocation = window.location;
    const assignSpy = vi.fn();
    // @ts-ignore — replacing read-only property in test
    delete (window as any).location;
    window.location = { ...originalLocation, href: originalLocation.href } as Location;
    Object.defineProperty(window.location, "href", {
      get: () => originalLocation.href,
      set: assignSpy,
      configurable: true,
    });

    renderWithProviders(<ExtensionAuth />);

    await waitFor(() => {
      expect(assignSpy).toHaveBeenCalledWith("/api/login?returnTo=/extension-auth");
    }, { timeout: 3000 });

    // Restore
    window.location = originalLocation;
    consoleSpy.mockRestore();
  });

  it("retries once before showing error (makes at least 2 requests)", async () => {
    let callCount = 0;
    server.use(
      http.post("/api/extension/token", () => {
        callCount++;
        return HttpResponse.json({ message: "Server error" }, { status: 500 });
      }),
    );

    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    renderWithProviders(<ExtensionAuth />);

    // Both attempts fail → error is shown after the retry delay
    await waitFor(() => {
      expect(screen.getByText("Server error")).toBeDefined();
    }, { timeout: 8000 });

    // Retry means at least 2 requests were made (initial + retry)
    expect(callCount).toBeGreaterThanOrEqual(2);
  }, 15000);

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
    vi.spyOn(console, "warn").mockImplementation(() => {});

    renderWithProviders(<ExtensionAuth />);

    await waitFor(() => {
      expect(screen.getByText("Unexpected response format from server")).toBeDefined();
    }, { timeout: 5000 });

    consoleSpy.mockRestore();
  });

  it("shows error when 200 response has malformed token payload", async () => {
    const postMessageSpy = vi.spyOn(window, "postMessage");
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    server.use(
      http.post("/api/extension/token", () =>
        HttpResponse.json({ unexpected: "shape" }),
      ),
    );

    renderWithProviders(<ExtensionAuth />);

    await waitFor(() => {
      expect(screen.getByText("Invalid token payload from server")).toBeDefined();
    }, { timeout: 5000 });

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
