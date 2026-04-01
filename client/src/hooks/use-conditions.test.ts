/**
 * Tests: use-conditions hooks
 * Coverage: useMonitorConditions, useAddCondition, useDeleteCondition
 *
 * @vitest-environment jsdom
 */
import { renderHook, waitFor, act } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { api } from "@shared/routes";
import { server } from "../test/server";
import { createWrapper } from "../test/test-utils";
import {
  useMonitorConditions,
  useAddCondition,
  useDeleteCondition,
} from "./use-conditions";

const mockCondition = {
  id: 1,
  monitorId: 1,
  type: "contains",
  value: "$90",
  groupIndex: 0,
  createdAt: "2024-01-01T00:00:00.000Z",
};

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("useMonitorConditions", () => {
  it("returns conditions from GET /api/monitors/:id/conditions", async () => {
    let capturedId: string | undefined;

    server.use(
      http.get(api.monitors.conditions.list.path, ({ params }) => {
        capturedId = params.id as string;
        return HttpResponse.json([mockCondition]);
      })
    );

    const { result } = renderHook(() => useMonitorConditions(1), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedId).toBe("1");
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0].type).toBe("contains");
  });

  it("is disabled when monitorId is 0", () => {
    const { result } = renderHook(() => useMonitorConditions(0), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe("idle");
  });

  it("surfaces fetch errors", async () => {
    server.use(
      http.get(api.monitors.conditions.list.path, () =>
        HttpResponse.json({ message: "Not found" }, { status: 404 })
      )
    );

    const { result } = renderHook(() => useMonitorConditions(1), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("useAddCondition", () => {
  it("calls POST /api/monitors/:id/conditions with correct body", async () => {
    let capturedBody: unknown;

    server.use(
      http.post(api.monitors.conditions.create.path, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(
          { ...mockCondition, id: 2 },
          { status: 201 }
        );
      })
    );

    const { result } = renderHook(() => useAddCondition(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate({
        monitorId: 1,
        type: "contains",
        value: "$90",
        groupIndex: 0,
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedBody).toMatchObject({
      type: "contains",
      value: "$90",
      groupIndex: 0,
    });
  });

  it("surfaces creation errors", async () => {
    server.use(
      http.post(api.monitors.conditions.create.path, () =>
        HttpResponse.json(
          { message: "Tier limit", code: "TIER_LIMIT_REACHED" },
          { status: 403 }
        )
      )
    );

    const { result } = renderHook(() => useAddCondition(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate({
        monitorId: 1,
        type: "contains",
        value: "test",
        groupIndex: 0,
      });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Tier limit");
  });
});

describe("useDeleteCondition", () => {
  it("calls DELETE /api/monitors/:id/conditions/:conditionId", async () => {
    let deletedParams: Record<string, string | readonly string[]> = {};

    server.use(
      http.delete(api.monitors.conditions.delete.path, ({ params }) => {
        deletedParams = params;
        return new HttpResponse(null, { status: 204 });
      })
    );

    const { result } = renderHook(() => useDeleteCondition(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate({ monitorId: 1, conditionId: 5 });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(deletedParams.id).toBe("1");
    expect(deletedParams.conditionId).toBe("5");
  });

  it("surfaces deletion errors", async () => {
    server.use(
      http.delete(api.monitors.conditions.delete.path, () =>
        HttpResponse.json({ message: "Condition not found" }, { status: 404 })
      )
    );

    const { result } = renderHook(() => useDeleteCondition(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate({ monitorId: 1, conditionId: 999 });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Condition not found");
  });
});
