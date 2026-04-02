/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { getQueryFn } from "./queryClient";

describe("getQueryFn", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns parsed JSON on a valid 200 response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 1 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const fn = getQueryFn<{ id: number }>({ on401: "throw" });
    const result = await fn({ queryKey: ["/api/test"], signal: new AbortController().signal, meta: undefined });
    expect(result).toEqual({ id: 1 });
  });

  it("returns null on 401 when on401 is returnNull", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 }),
    );

    const fn = getQueryFn<{ id: number }>({ on401: "returnNull" });
    const result = await fn({ queryKey: ["/api/test"], signal: new AbortController().signal, meta: undefined });
    expect(result).toBeNull();
  });

  it("throws on 401 when on401 is throw", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 }),
    );

    const fn = getQueryFn<{ id: number }>({ on401: "throw" });
    await expect(
      fn({ queryKey: ["/api/test"], signal: new AbortController().signal, meta: undefined }),
    ).rejects.toThrow("401");
  });

  it("throws descriptive error when 200 response has non-JSON body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("<html>Not JSON</html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const fn = getQueryFn<unknown>({ on401: "throw" });
    await expect(
      fn({ queryKey: ["/api/test"], signal: new AbortController().signal, meta: undefined }),
    ).rejects.toThrow("Unexpected response format from server");
  });

  it("throws descriptive error when 200 response has empty body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("", { status: 200 }),
    );

    const fn = getQueryFn<unknown>({ on401: "throw" });
    await expect(
      fn({ queryKey: ["/api/test"], signal: new AbortController().signal, meta: undefined }),
    ).rejects.toThrow("Unexpected response format from server");
  });
});
