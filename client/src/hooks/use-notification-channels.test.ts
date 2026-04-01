/**
 * Tests: use-notification-channels hooks
 * Coverage: useNotificationChannels, useUpsertNotificationChannel, useDeleteNotificationChannel,
 *           useRevealWebhookSecret, useDeliveryLog
 *
 * @vitest-environment jsdom
 */
import { renderHook, waitFor, act } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { api } from "@shared/routes";
import { server } from "../test/server";
import { createWrapper } from "../test/test-utils";
import {
  useNotificationChannels,
  useUpsertNotificationChannel,
  useDeleteNotificationChannel,
  useRevealWebhookSecret,
  useDeliveryLog,
} from "./use-notification-channels";

const mockChannel = {
  id: 1,
  monitorId: 1,
  channel: "webhook",
  enabled: true,
  config: { url: "https://hooks.example.com/notify" },
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
};

const mockDelivery = {
  id: 10,
  monitorId: 1,
  channel: "webhook",
  status: "delivered",
  sentAt: "2024-02-01T00:00:00.000Z",
  responseCode: 200,
};

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("useNotificationChannels", () => {
  it("returns channels from GET /api/monitors/:id/channels", async () => {
    server.use(
      http.get(api.monitors.channels.list.path, () =>
        HttpResponse.json([mockChannel])
      )
    );

    const { result } = renderHook(() => useNotificationChannels(1), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0].channel).toBe("webhook");
  });

  it("is disabled when monitorId is 0", () => {
    const { result } = renderHook(() => useNotificationChannels(0), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe("idle");
  });

  it("surfaces fetch errors", async () => {
    server.use(
      http.get(api.monitors.channels.list.path, () =>
        HttpResponse.json({ message: "Not found" }, { status: 404 })
      )
    );

    const { result } = renderHook(() => useNotificationChannels(1), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("useUpsertNotificationChannel", () => {
  it("calls PUT /api/monitors/:id/channels/:channel with config", async () => {
    let capturedBody: unknown;

    server.use(
      http.put(api.monitors.channels.put.path, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(mockChannel);
      })
    );

    const { result } = renderHook(() => useUpsertNotificationChannel(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate({
        monitorId: 1,
        channel: "webhook",
        enabled: true,
        config: { url: "https://hooks.example.com/notify" },
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedBody).toMatchObject({
      enabled: true,
      config: { url: "https://hooks.example.com/notify" },
    });
  });

  it("surfaces upsert errors", async () => {
    server.use(
      http.put(api.monitors.channels.put.path, () =>
        HttpResponse.json({ message: "Failed to update channel" }, { status: 400 })
      )
    );

    const { result } = renderHook(() => useUpsertNotificationChannel(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate({
        monitorId: 1,
        channel: "webhook",
        enabled: true,
        config: {},
      });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Failed to update channel");
  });
});

describe("useDeleteNotificationChannel", () => {
  it("calls DELETE /api/monitors/:id/channels/:channel", async () => {
    let deletedParams: Record<string, string | readonly string[]> = {};

    server.use(
      http.delete(api.monitors.channels.delete.path, ({ params }) => {
        deletedParams = params;
        return new HttpResponse(null, { status: 204 });
      })
    );

    const { result } = renderHook(() => useDeleteNotificationChannel(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate({ monitorId: 1, channel: "webhook" });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(deletedParams.id).toBe("1");
    expect(deletedParams.channel).toBe("webhook");
  });

  it("surfaces deletion errors", async () => {
    server.use(
      http.delete(api.monitors.channels.delete.path, () =>
        HttpResponse.json({ message: "Failed to delete channel" }, { status: 404 })
      )
    );

    const { result } = renderHook(() => useDeleteNotificationChannel(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate({ monitorId: 1, channel: "webhook" });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Failed to delete channel");
  });
});

describe("useRevealWebhookSecret", () => {
  it("returns secret from POST /api/monitors/:id/channels/webhook/reveal-secret", async () => {
    server.use(
      http.post(api.monitors.channels.revealSecret.path, () =>
        HttpResponse.json({ secret: "whsec_abc123" })
      )
    );

    const { result } = renderHook(() => useRevealWebhookSecret(1), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate();
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({ secret: "whsec_abc123" });
  });

  it("surfaces reveal errors", async () => {
    server.use(
      http.post(api.monitors.channels.revealSecret.path, () =>
        HttpResponse.json({ message: "Failed to reveal secret" }, { status: 404 })
      )
    );

    const { result } = renderHook(() => useRevealWebhookSecret(1), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate();
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Failed to reveal secret");
  });
});

describe("useDeliveryLog", () => {
  it("returns delivery log from GET /api/monitors/:id/deliveries", async () => {
    server.use(
      http.get(api.monitors.channels.deliveries.path, () =>
        HttpResponse.json([mockDelivery])
      )
    );

    const { result } = renderHook(() => useDeliveryLog(1), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0].status).toBe("delivered");
  });

  it("is disabled when monitorId is 0", () => {
    const { result } = renderHook(() => useDeliveryLog(0), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe("idle");
  });

  it("appends channel filter when provided", async () => {
    let requestUrl = "";

    server.use(
      http.get(api.monitors.channels.deliveries.path, ({ request }) => {
        requestUrl = request.url;
        return HttpResponse.json([mockDelivery]);
      })
    );

    const { result } = renderHook(() => useDeliveryLog(1, "webhook"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requestUrl).toContain("?channel=webhook");
  });

  it("surfaces fetch errors", async () => {
    server.use(
      http.get(api.monitors.channels.deliveries.path, () =>
        HttpResponse.json({ message: "Server error" }, { status: 500 })
      )
    );

    const { result } = renderHook(() => useDeliveryLog(1), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
