/**
 * Tests: use-slack hooks
 * Coverage: useSlackStatus, useSlackChannels, useDisconnectSlack
 *
 * @vitest-environment happy-dom
 */
import { renderHook, waitFor, act } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { api } from "@shared/routes";
import { server } from "../test/server";
import { createWrapper } from "../test/test-utils";
import {
  useSlackStatus,
  useSlackChannels,
  useDisconnectSlack,
} from "./use-slack";

const mockStatusConnected = {
  connected: true,
  teamName: "TestWorkspace",
  installedBy: "user-1",
  installedAt: "2024-01-01T00:00:00.000Z",
};

const mockStatusDisconnected = {
  connected: false,
  teamName: null,
  installedBy: null,
  installedAt: null,
};

const mockChannels = [
  { id: "C01", name: "general" },
  { id: "C02", name: "alerts" },
];

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("useSlackStatus", () => {
  it("returns connected status", async () => {
    server.use(
      http.get(api.integrations.slack.status.path, () =>
        HttpResponse.json(mockStatusConnected)
      )
    );

    const { result } = renderHook(() => useSlackStatus(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.connected).toBe(true);
    expect(result.current.data!.teamName).toBe("TestWorkspace");
  });

  it("returns disconnected status", async () => {
    server.use(
      http.get(api.integrations.slack.status.path, () =>
        HttpResponse.json(mockStatusDisconnected)
      )
    );

    const { result } = renderHook(() => useSlackStatus(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.connected).toBe(false);
  });

  it("surfaces fetch errors", async () => {
    server.use(
      http.get(api.integrations.slack.status.path, () =>
        HttpResponse.json({ message: "Unauthorized" }, { status: 401 })
      )
    );

    const { result } = renderHook(() => useSlackStatus(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("useSlackChannels", () => {
  it("returns channels when Slack is connected", async () => {
    server.use(
      http.get(api.integrations.slack.status.path, () =>
        HttpResponse.json(mockStatusConnected)
      ),
      http.get(api.integrations.slack.channels.path, () =>
        HttpResponse.json(mockChannels)
      )
    );

    const { result } = renderHook(() => useSlackChannels(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data![0].name).toBe("general");
  });

  it("does not fetch channels when Slack is disconnected", async () => {
    let channelsRequested = false;

    server.use(
      http.get(api.integrations.slack.status.path, () =>
        HttpResponse.json(mockStatusDisconnected)
      ),
      http.get(api.integrations.slack.channels.path, () => {
        channelsRequested = true;
        return HttpResponse.json([]);
      })
    );

    const wrapper = createWrapper();

    // Render status hook to confirm the disconnected response actually loaded
    const { result: statusResult } = renderHook(() => useSlackStatus(), { wrapper });
    await waitFor(() => expect(statusResult.current.isSuccess).toBe(true));
    expect(statusResult.current.data!.connected).toBe(false);

    // Now verify channels query stays idle and never fires
    const { result } = renderHook(() => useSlackChannels(), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(channelsRequested).toBe(false);
  });
});

describe("useDisconnectSlack", () => {
  it("calls DELETE /api/integrations/slack", async () => {
    let called = false;

    server.use(
      http.delete(api.integrations.slack.disconnect.path, () => {
        called = true;
        return new HttpResponse(null, { status: 204 });
      })
    );

    const { result } = renderHook(() => useDisconnectSlack(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate();
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(called).toBe(true);
  });

  it("surfaces disconnect errors", async () => {
    server.use(
      http.delete(api.integrations.slack.disconnect.path, () =>
        HttpResponse.json(
          { message: "Failed to disconnect Slack" },
          { status: 500 }
        )
      )
    );

    const { result } = renderHook(() => useDisconnectSlack(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate();
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Failed to disconnect Slack");
  });
});
