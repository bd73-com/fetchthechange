/**
 * Tests: use-notification-preferences hooks
 * Coverage: useNotificationPreferences, useUpdateNotificationPreferences, useDeleteNotificationPreferences
 *
 * @vitest-environment happy-dom
 */
import { renderHook, waitFor, act } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { api } from "@shared/routes";
import { server } from "../test/server";
import { createWrapper } from "../test/test-utils";
import {
  useNotificationPreferences,
  useUpdateNotificationPreferences,
  useDeleteNotificationPreferences,
} from "./use-notification-preferences";

const mockPrefs = {
  id: 1,
  monitorId: 1,
  quietHoursStart: "22:00",
  quietHoursEnd: "08:00",
  timezone: "America/New_York",
  digestMode: false,
  sensitivityThreshold: 0,
  notificationEmail: null,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
};

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("useNotificationPreferences", () => {
  it("returns preferences from GET /api/monitors/:id/notification-preferences", async () => {
    server.use(
      http.get(api.monitors.notificationPreferences.get.path, () =>
        HttpResponse.json(mockPrefs)
      )
    );

    const { result } = renderHook(() => useNotificationPreferences(1), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.quietHoursStart).toBe("22:00");
    expect(result.current.data!.timezone).toBe("America/New_York");
  });

  it("is disabled when monitorId is 0", () => {
    const { result } = renderHook(() => useNotificationPreferences(0), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe("idle");
  });

  it("surfaces fetch errors", async () => {
    server.use(
      http.get(api.monitors.notificationPreferences.get.path, () =>
        HttpResponse.json({ message: "Not found" }, { status: 404 })
      )
    );

    const { result } = renderHook(() => useNotificationPreferences(1), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe(
      "Failed to fetch notification preferences"
    );
  });
});

describe("useUpdateNotificationPreferences", () => {
  it("calls PUT /api/monitors/:id/notification-preferences with data", async () => {
    let capturedBody: unknown;

    server.use(
      http.put(api.monitors.notificationPreferences.put.path, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ ...mockPrefs, digestMode: true });
      })
    );

    const { result } = renderHook(() => useUpdateNotificationPreferences(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate({
        monitorId: 1,
        digestMode: true,
        quietHoursStart: "22:00",
        quietHoursEnd: "08:00",
        timezone: "America/New_York",
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedBody).toMatchObject({
      digestMode: true,
      quietHoursStart: "22:00",
    });
  });

  it("surfaces update errors", async () => {
    server.use(
      http.put(api.monitors.notificationPreferences.put.path, () =>
        HttpResponse.json(
          { message: "Failed to update notification preferences" },
          { status: 422 }
        )
      )
    );

    const { result } = renderHook(() => useUpdateNotificationPreferences(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate({ monitorId: 1, digestMode: true });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe(
      "Failed to update notification preferences"
    );
  });
});

describe("useDeleteNotificationPreferences", () => {
  it("calls DELETE /api/monitors/:id/notification-preferences", async () => {
    server.use(
      http.delete(api.monitors.notificationPreferences.delete.path, () =>
        new HttpResponse(null, { status: 204 })
      )
    );

    const { result } = renderHook(() => useDeleteNotificationPreferences(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate(1);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("surfaces deletion errors", async () => {
    server.use(
      http.delete(api.monitors.notificationPreferences.delete.path, () =>
        HttpResponse.json(
          { message: "Failed to delete notification preferences" },
          { status: 404 }
        )
      )
    );

    const { result } = renderHook(() => useDeleteNotificationPreferences(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate(999);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe(
      "Failed to delete notification preferences"
    );
  });
});
