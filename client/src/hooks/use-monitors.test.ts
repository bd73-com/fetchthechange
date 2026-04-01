/**
 * Tests: use-monitors hooks
 * Coverage: useMonitors, useMonitor, useMonitorHistory, useCreateMonitor, useUpdateMonitor,
 *           useDeleteMonitor, useCheckMonitor, useSuggestSelectors, useUpdateMonitorSilent,
 *           useCheckMonitorSilent
 * MSW handlers: GET /api/monitors, GET /api/monitors/:id, GET /api/monitors/:id/history,
 *               POST /api/monitors, PATCH /api/monitors/:id, DELETE /api/monitors/:id,
 *               POST /api/monitors/:id/check, POST /api/monitors/:id/suggest-selectors
 *
 * @vitest-environment happy-dom
 */
import { renderHook, waitFor, act } from "@testing-library/react";
import { http, HttpResponse } from "msw";
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
      http.get("/api/monitors", () => HttpResponse.json([mockMonitor]))
    );

    const { result } = renderHook(() => useMonitors(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0].name).toBe("Price check");
  });

  it("surfaces API errors through the hook", async () => {
    server.use(
      http.get("/api/monitors", () =>
        HttpResponse.json({ message: "Unauthorized" }, { status: 401 })
      )
    );

    const { result } = renderHook(() => useMonitors(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("useMonitor", () => {
  it("returns a single monitor from GET /api/monitors/:id", async () => {
    server.use(
      http.get("/api/monitors/:id", ({ params }) => {
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
      http.get("/api/monitors/:id/history", () =>
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
});

describe("useCreateMonitor", () => {
  it("calls POST /api/monitors with the correct body", async () => {
    let capturedBody: unknown;

    server.use(
      http.post("/api/monitors", async ({ request }) => {
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

  it("surfaces tier limit errors", async () => {
    server.use(
      http.post("/api/monitors", () =>
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
});

describe("useUpdateMonitor", () => {
  it("calls PATCH /api/monitors/:id with updates", async () => {
    let capturedBody: unknown;
    let patchedId: string | undefined;

    server.use(
      http.patch("/api/monitors/:id", async ({ params, request }) => {
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
});

describe("useDeleteMonitor", () => {
  it("calls DELETE /api/monitors/:id", async () => {
    let deletedId: string | undefined;

    server.use(
      http.delete("/api/monitors/:id", ({ params }) => {
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
      http.delete("/api/monitors/:id", () =>
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
      http.post("/api/monitors/:id/check", () =>
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

  it("surfaces rate limit errors", async () => {
    server.use(
      http.post("/api/monitors/:id/check", () =>
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
      http.post("/api/monitors/:id/check", () =>
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
});

describe("useSuggestSelectors", () => {
  it("returns selector suggestions from POST /api/monitors/:id/suggest-selectors", async () => {
    let capturedBody: unknown;

    server.use(
      http.post("/api/monitors/:id/suggest-selectors", async ({ request }) => {
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
});

describe("useUpdateMonitorSilent", () => {
  it("calls PATCH /api/monitors/:id silently", async () => {
    let patchedId: string | undefined;

    server.use(
      http.patch("/api/monitors/:id", ({ params }) => {
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
