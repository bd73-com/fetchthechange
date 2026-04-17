/**
 * Tests: use-monitors hooks
 * Coverage: useMonitors, useMonitor, useMonitorHistory, useCreateMonitor, useUpdateMonitor,
 *           useDeleteMonitor, useCheckMonitor, useSuggestSelectors, useUpdateMonitorSilent,
 *           useCheckMonitorSilent
 * MSW handlers: GET /api/monitors, GET /api/monitors/:id, GET /api/monitors/:id/history,
 *               POST /api/monitors, PATCH /api/monitors/:id, DELETE /api/monitors/:id,
 *               POST /api/monitors/:id/check, POST /api/monitors/:id/suggest-selectors
 *
 * @vitest-environment jsdom
 */
import { renderHook, waitFor, act } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { api } from "@shared/routes";
import { server } from "../test/server";
import { createWrapper } from "../test/test-utils";
import {
  useMonitors,
  useMonitor,
  useMonitorHistory,
  useCreateMonitor,
  useUpdateMonitor,
  useDeleteMonitor,
  useCheckMonitor,
  useCheckMonitorSilent,
  useSuggestSelectors,
  useUpdateMonitorSilent,
} from "./use-monitors";

const mockMonitor = {
  id: 1,
  userId: "user-1",
  name: "Price check",
  url: "https://example.com",
  selector: ".price",
  frequency: "daily",
  lastChecked: null,
  lastChanged: null,
  currentValue: "$100",
  lastStatus: "ok",
  lastError: null,
  active: true,
  emailEnabled: true,
  consecutiveFailures: 0,
  pauseReason: null,
  healthAlertSentAt: null,
  lastHealthyAt: null,
  pendingRetryAt: null,
  createdAt: "2024-01-01T00:00:00.000Z",
};

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("useMonitors", () => {
  it("returns monitors list from GET /api/monitors", async () => {
    server.use(
      http.get(api.monitors.list.path, () => HttpResponse.json([mockMonitor]))
    );

    const { result } = renderHook(() => useMonitors(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0].name).toBe("Price check");
  });

  it("handles non-JSON success responses gracefully", async () => {
    server.use(
      http.get(api.monitors.list.path, () =>
        new HttpResponse("OK", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        })
      )
    );

    const { result } = renderHook(() => useMonitors(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Unexpected response format from server");
  });

  it("surfaces API errors through the hook", async () => {
    server.use(
      http.get(api.monitors.list.path, () =>
        HttpResponse.json({ message: "Unauthorized" }, { status: 401 })
      )
    );

    const { result } = renderHook(() => useMonitors(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Failed to fetch monitors");
  });
});

describe("useMonitor", () => {
  it("returns a single monitor from GET /api/monitors/:id", async () => {
    server.use(
      http.get(api.monitors.get.path, ({ params }) => {
        if (params.id === "1") return HttpResponse.json(mockMonitor);
        return HttpResponse.json({ message: "Not found" }, { status: 404 });
      })
    );

    const { result } = renderHook(() => useMonitor(1), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.id).toBe(1);
    expect(result.current.data!.name).toBe("Price check");
  });

  it("handles non-JSON success responses gracefully", async () => {
    server.use(
      http.get(api.monitors.get.path, () =>
        new HttpResponse("OK", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        })
      )
    );

    const { result } = renderHook(() => useMonitor(1), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Unexpected response format from server");
  });

  it("is disabled when id is 0", () => {
    const { result } = renderHook(() => useMonitor(0), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe("idle");
  });
});

describe("useMonitorHistory", () => {
  it("returns change history from GET /api/monitors/:id/history", async () => {
    const mockChange = {
      id: 10,
      monitorId: 1,
      oldValue: "$100",
      newValue: "$90",
      detectedAt: "2024-02-01T00:00:00.000Z",
    };

    server.use(
      http.get(api.monitors.history.path, () =>
        HttpResponse.json([mockChange])
      )
    );

    const { result } = renderHook(() => useMonitorHistory(1), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0].newValue).toBe("$90");
  });

  it("handles non-JSON success responses gracefully", async () => {
    server.use(
      http.get(api.monitors.history.path, () =>
        new HttpResponse("OK", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        })
      )
    );

    const { result } = renderHook(() => useMonitorHistory(1), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Unexpected response format from server");
  });
});

describe("useCreateMonitor", () => {
  it("calls POST /api/monitors with the correct body", async () => {
    let capturedBody: unknown;

    server.use(
      http.post(api.monitors.create.path, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(
          { ...mockMonitor, id: 2, name: "New monitor" },
          { status: 201 }
        );
      })
    );

    const { result } = renderHook(() => useCreateMonitor(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate({
        name: "New monitor",
        url: "https://example.com",
        selector: "h1",
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedBody).toMatchObject({
      name: "New monitor",
      selector: "h1",
    });
  });

  it("handles non-JSON error responses gracefully", async () => {
    server.use(
      http.post(api.monitors.create.path, () =>
        new HttpResponse("<html>502 Bad Gateway</html>", {
          status: 502,
          headers: { "Content-Type": "text/html" },
        })
      )
    );

    const { result } = renderHook(() => useCreateMonitor(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate({
        name: "Test",
        url: "https://example.com",
        selector: "h1",
      });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    // Falls back to generic message since res.json() returns {}
    expect(result.current.error?.message).toBe("Failed to create monitor");
  });

  it("handles non-JSON success responses gracefully", async () => {
    server.use(
      http.post(api.monitors.create.path, () =>
        new HttpResponse("OK", {
          status: 201,
          headers: { "Content-Type": "text/plain" },
        })
      )
    );

    const { result } = renderHook(() => useCreateMonitor(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate({
        name: "Test",
        url: "https://example.com",
        selector: "h1",
      });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Unexpected response format from server");
  });

  it("surfaces tier limit errors", async () => {
    server.use(
      http.post(api.monitors.create.path, () =>
        HttpResponse.json(
          { message: "Monitor limit reached", code: "TIER_LIMIT_REACHED" },
          { status: 403 }
        )
      )
    );

    const { result } = renderHook(() => useCreateMonitor(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate({
        name: "New monitor",
        url: "https://example.com",
        selector: "h1",
      });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Monitor limit reached");
  });

  it("surfaces SSRF rejection from the server", async () => {
    server.use(
      http.post(api.monitors.create.path, () =>
        HttpResponse.json(
          { message: "URL is not allowed (private network)" },
          { status: 400 }
        )
      )
    );

    const { result } = renderHook(() => useCreateMonitor(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate({
        name: "SSRF attempt",
        url: "http://169.254.169.254/latest/meta-data",
        selector: "body",
      });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe(
      "URL is not allowed (private network)"
    );
  });
});

describe("useUpdateMonitor", () => {
  it("calls PATCH /api/monitors/:id with updates", async () => {
    let capturedBody: unknown;
    let patchedId: string | undefined;

    server.use(
      http.patch(api.monitors.update.path, async ({ params, request }) => {
        patchedId = params.id as string;
        capturedBody = await request.json();
        return HttpResponse.json({
          ...mockMonitor,
          name: "Updated",
        });
      })
    );

    const { result } = renderHook(() => useUpdateMonitor(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate({ id: 1, name: "Updated" });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(patchedId).toBe("1");
    expect(capturedBody).toMatchObject({ name: "Updated" });
  });

  it("handles non-JSON error responses gracefully", async () => {
    server.use(
      http.patch(api.monitors.update.path, () =>
        new HttpResponse("<html>502 Bad Gateway</html>", {
          status: 502,
          headers: { "Content-Type": "text/html" },
        })
      )
    );

    const { result } = renderHook(() => useUpdateMonitor(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate({ id: 1, name: "Updated" });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Failed to update monitor");
  });

  it("surfaces server error messages from JSON error responses", async () => {
    server.use(
      http.patch(api.monitors.update.path, () =>
        HttpResponse.json({ message: "Monitor not found" }, { status: 404 })
      )
    );

    const { result } = renderHook(() => useUpdateMonitor(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate({ id: 999, name: "Updated" });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Monitor not found");
  });

  it("handles non-JSON success responses gracefully", async () => {
    server.use(
      http.patch(api.monitors.update.path, () =>
        new HttpResponse("OK", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        })
      )
    );

    const { result } = renderHook(() => useUpdateMonitor(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate({ id: 1, name: "Updated" });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Unexpected response format from server");
  });
});

describe("useDeleteMonitor", () => {
  it("calls DELETE /api/monitors/:id", async () => {
    let deletedId: string | undefined;

    server.use(
      http.delete(api.monitors.delete.path, ({ params }) => {
        deletedId = params.id as string;
        return new HttpResponse(null, { status: 204 });
      })
    );

    const { result } = renderHook(() => useDeleteMonitor(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate(42);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(deletedId).toBe("42");
  });

  it("surfaces deletion errors", async () => {
    server.use(
      http.delete(api.monitors.delete.path, () =>
        HttpResponse.json(
          { message: "Monitor not found" },
          { status: 404 }
        )
      )
    );

    const { result } = renderHook(() => useDeleteMonitor(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate(999);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Monitor not found");
  });
});

describe("useCheckMonitor", () => {
  it("returns check result with changed flag", async () => {
    server.use(
      http.post(api.monitors.check.path, () =>
        HttpResponse.json({
          changed: true,
          currentValue: "$90",
          status: "ok",
          error: null,
        })
      )
    );

    const { result } = renderHook(() => useCheckMonitor(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate(1);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({
      changed: true,
      currentValue: "$90",
    });
  });

  it("handles non-JSON success responses gracefully", async () => {
    server.use(
      http.post(api.monitors.check.path, () =>
        new HttpResponse("OK", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        })
      )
    );

    const { result } = renderHook(() => useCheckMonitor(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate(1);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Unexpected response format from server");
  });

  it("surfaces rate limit errors", async () => {
    server.use(
      http.post(api.monitors.check.path, () =>
        HttpResponse.json(
          { message: "Rate limit reached" },
          { status: 429 }
        )
      )
    );

    const { result } = renderHook(() => useCheckMonitor(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate(1);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Rate limit reached");
  });
});

describe("useCheckMonitorSilent", () => {
  it("returns check result without toast side effects", async () => {
    server.use(
      http.post(api.monitors.check.path, () =>
        HttpResponse.json({
          changed: false,
          currentValue: "$100",
          status: "ok",
          error: null,
        })
      )
    );

    const { result } = renderHook(() => useCheckMonitorSilent(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate(1);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({
      changed: false,
      currentValue: "$100",
    });
  });

  it("handles non-JSON error responses gracefully", async () => {
    server.use(
      http.post(api.monitors.check.path, () =>
        new HttpResponse("<html>502 Bad Gateway</html>", {
          status: 502,
          headers: { "Content-Type": "text/html" },
        })
      )
    );

    const { result } = renderHook(() => useCheckMonitorSilent(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate(1);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Failed to check monitor");
  });

  it("handles non-JSON success responses gracefully", async () => {
    server.use(
      http.post(api.monitors.check.path, () =>
        new HttpResponse("OK", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        })
      )
    );

    const { result } = renderHook(() => useCheckMonitorSilent(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate(1);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Unexpected response format from server");
  });
});

describe("useSuggestSelectors", () => {
  it("returns selector suggestions from POST /api/monitors/:id/suggest-selectors", async () => {
    let capturedBody: unknown;

    server.use(
      http.post(api.monitors.suggestSelectors.path, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({
          currentSelector: { selector: ".price", count: 0, valid: false },
          suggestions: [
            { selector: ".new-price", count: 1, sampleText: "$90" },
          ],
        });
      })
    );

    const { result } = renderHook(() => useSuggestSelectors(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate({ id: 1, expectedText: "$90" });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedBody).toMatchObject({ expectedText: "$90" });
    expect(result.current.data!.suggestions).toHaveLength(1);
    expect(result.current.data!.suggestions[0].selector).toBe(".new-price");
    expect(result.current.data!.currentSelector.valid).toBe(false);
  });

  it("handles non-JSON success responses gracefully", async () => {
    server.use(
      http.post(api.monitors.suggestSelectors.path, () =>
        new HttpResponse("OK", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        })
      )
    );

    const { result } = renderHook(() => useSuggestSelectors(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate({ id: 1, expectedText: "$90" });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Unexpected response format from server");
  });
});

describe("useUpdateMonitorSilent", () => {
  it("handles non-JSON error responses gracefully", async () => {
    server.use(
      http.patch(api.monitors.update.path, () =>
        new HttpResponse("<html>502 Bad Gateway</html>", {
          status: 502,
          headers: { "Content-Type": "text/html" },
        })
      )
    );

    const { result } = renderHook(() => useUpdateMonitorSilent(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate({ id: 1, selector: ".new-selector" });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Failed to update monitor");
  });

  it("handles non-JSON success responses gracefully", async () => {
    server.use(
      http.patch(api.monitors.update.path, () =>
        new HttpResponse("OK", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        })
      )
    );

    const { result } = renderHook(() => useUpdateMonitorSilent(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate({ id: 1, selector: ".new-selector" });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Unexpected response format from server");
  });

  it("calls PATCH /api/monitors/:id silently", async () => {
    let patchedId: string | undefined;

    server.use(
      http.patch(api.monitors.update.path, ({ params }) => {
        patchedId = params.id as string;
        return HttpResponse.json({
          ...mockMonitor,
          selector: ".new-selector",
        });
      })
    );

    const { result } = renderHook(() => useUpdateMonitorSilent(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate({ id: 1, selector: ".new-selector" });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(patchedId).toBe("1");
  });
});

describe("useCheckMonitor AbortSignal behavior (#437)", () => {
  it("aborts in-flight check fetches when the component unmounts", async () => {
    let aborted = false;
    server.use(
      http.post(api.monitors.check.path, async ({ request }) => {
        await new Promise<void>((resolve) => {
          request.signal.addEventListener("abort", () => {
            aborted = true;
            resolve();
          });
        });
        return new Promise(() => {}) as Promise<Response>;
      }),
    );

    const { result, unmount } = renderHook(() => useCheckMonitor(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate(1);
    });

    // Give the mutation a tick to dispatch the fetch
    await new Promise((r) => setTimeout(r, 20));
    unmount();
    await new Promise((r) => setTimeout(r, 20));

    expect(aborted).toBe(true);
  });

  it("useCheckMonitorSilent also aborts in-flight fetches on unmount", async () => {
    let aborted = false;
    server.use(
      http.post(api.monitors.check.path, async ({ request }) => {
        await new Promise<void>((resolve) => {
          request.signal.addEventListener("abort", () => {
            aborted = true;
            resolve();
          });
        });
        return new Promise(() => {}) as Promise<Response>;
      }),
    );

    const { result, unmount } = renderHook(() => useCheckMonitorSilent(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate(1);
    });

    await new Promise((r) => setTimeout(r, 20));
    unmount();
    await new Promise((r) => setTimeout(r, 20));

    expect(aborted).toBe(true);
  });
});
