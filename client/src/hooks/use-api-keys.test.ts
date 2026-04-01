/**
 * Tests: use-api-keys hooks
 * Coverage: useApiKeys, useCreateApiKey, useRevokeApiKey
 * MSW handlers: GET /api/keys, POST /api/keys, DELETE /api/keys/:id
 *
 * @vitest-environment jsdom
 */
import { renderHook, waitFor, act } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { apiV1 } from "@shared/routes";
import { server } from "../test/server";
import { createWrapper } from "../test/test-utils";
import { useApiKeys, useCreateApiKey, useRevokeApiKey } from "./use-api-keys";

const mockKeys = [
  {
    id: 1,
    name: "Production key",
    keyPrefix: "ftc_abc",
    lastUsedAt: null,
    createdAt: "2024-01-01T00:00:00.000Z",
  },
  {
    id: 2,
    name: "Test key",
    keyPrefix: "ftc_def",
    lastUsedAt: "2024-02-01T00:00:00.000Z",
    createdAt: "2024-01-15T00:00:00.000Z",
  },
];

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("useApiKeys", () => {
  it("lists active keys from GET /api/keys", async () => {
    server.use(
      http.get(apiV1.keys.list.path, () => HttpResponse.json(mockKeys))
    );

    const { result } = renderHook(() => useApiKeys(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data![0].name).toBe("Production key");
    expect(result.current.data![1].keyPrefix).toBe("ftc_def");
  });

  it("returns empty array on 403 (non-Power tier)", async () => {
    server.use(
      http.get(apiV1.keys.list.path, () =>
        HttpResponse.json({ message: "Forbidden" }, { status: 403 })
      )
    );

    const { result } = renderHook(() => useApiKeys(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it("surfaces non-403 errors", async () => {
    server.use(
      http.get(apiV1.keys.list.path, () =>
        HttpResponse.json({ message: "Internal Server Error" }, { status: 500 })
      )
    );

    const { result } = renderHook(() => useApiKeys(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Failed to fetch API keys");
  });
});

describe("useCreateApiKey", () => {
  it("returns the full key in the mutation response", async () => {
    server.use(
      http.post(apiV1.keys.create.path, () =>
        HttpResponse.json({
          id: 3,
          name: "New key",
          keyPrefix: "ftc_ghi",
          key: "test_fake_key_not_real_000000",
          createdAt: "2024-03-01T00:00:00.000Z",
        })
      )
    );

    const { result } = renderHook(() => useCreateApiKey(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate({ name: "New key" });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({
      keyPrefix: "ftc_ghi",
      key: "test_fake_key_not_real_000000",
    });
  });

  it("surfaces creation errors", async () => {
    server.use(
      http.post(apiV1.keys.create.path, () =>
        HttpResponse.json(
          { message: "Max API keys reached" },
          { status: 400 }
        )
      )
    );

    const { result } = renderHook(() => useCreateApiKey(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate({ name: "Another key" });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Max API keys reached");
  });
});

describe("useRevokeApiKey", () => {
  it("calls DELETE /api/keys/:id", async () => {
    let deletedId: string | undefined;

    server.use(
      http.delete(apiV1.keys.revoke.path, ({ params }) => {
        deletedId = params.id as string;
        return new HttpResponse(null, { status: 204 });
      })
    );

    const { result } = renderHook(() => useRevokeApiKey(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate(1);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(deletedId).toBe("1");
  });

  it("invalidates the keys query on success", async () => {
    let fetchCount = 0;

    server.use(
      http.get(apiV1.keys.list.path, () => {
        fetchCount++;
        return HttpResponse.json(mockKeys);
      }),
      http.delete(apiV1.keys.revoke.path, () =>
        new HttpResponse(null, { status: 204 })
      )
    );

    const wrapper = createWrapper();

    // First, mount the query so it fetches
    const { result: keysResult } = renderHook(() => useApiKeys(), { wrapper });
    await waitFor(() => expect(keysResult.current.isSuccess).toBe(true));

    const fetchCountAfterInitial = fetchCount;

    // Now revoke a key
    const { result: revokeResult } = renderHook(() => useRevokeApiKey(), {
      wrapper,
    });

    act(() => {
      revokeResult.current.mutate(1);
    });

    await waitFor(() => expect(revokeResult.current.isSuccess).toBe(true));

    // The invalidation should trigger a re-fetch
    await waitFor(() => expect(fetchCount).toBeGreaterThan(fetchCountAfterInitial));
  });

  it("surfaces revocation errors", async () => {
    server.use(
      http.delete(apiV1.keys.revoke.path, () =>
        HttpResponse.json(
          { message: "Key not found" },
          { status: 404 }
        )
      )
    );

    const { result } = renderHook(() => useRevokeApiKey(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate(999);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Key not found");
  });
});
