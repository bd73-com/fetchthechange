/**
 * Tests: use-auth hook
 * Coverage: useAuth — user fetch, authenticated state, null on 401
 *
 * @vitest-environment happy-dom
 */
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../test/server";
import { createWrapper } from "../test/test-utils";
import { useAuth } from "./use-auth";

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("useAuth", () => {
  it("returns authenticated user from GET /api/auth/user", async () => {
    // Default MSW handler already returns a user fixture
    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user!.email).toBe("test@example.com");
    expect(result.current.user!.tier).toBe("power");
  });

  it("returns null user when unauthenticated (401)", async () => {
    server.use(
      http.get("/api/auth/user", () =>
        new HttpResponse(null, { status: 401 })
      )
    );

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
  });

  it("returns null user when not found (404)", async () => {
    server.use(
      http.get("/api/auth/user", () =>
        new HttpResponse(null, { status: 404 })
      )
    );

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
  });

  it("throws on unexpected server errors", async () => {
    server.use(
      http.get("/api/auth/user", () =>
        HttpResponse.json({ message: "Internal error" }, { status: 500 })
      )
    );

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(),
    });

    // The hook uses retry: false, so it should error quickly
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // On 500, fetchUser throws so user remains undefined (not null)
    expect(result.current.user).toBeUndefined();
    expect(result.current.isAuthenticated).toBe(false);
  });

  it("exposes logout function", async () => {
    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(typeof result.current.logout).toBe("function");
    expect(result.current.isLoggingOut).toBe(false);
  });
});
