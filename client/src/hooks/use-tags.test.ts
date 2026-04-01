/**
 * Tests: use-tags hooks
 * Coverage: useTags, useCreateTag, useUpdateTag, useDeleteTag, useSetMonitorTags
 *
 * @vitest-environment jsdom
 */
import { renderHook, waitFor, act } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { api, buildUrl } from "@shared/routes";
import { server } from "../test/server";
import { createWrapper } from "../test/test-utils";
import {
  useTags,
  useCreateTag,
  useUpdateTag,
  useDeleteTag,
  useSetMonitorTags,
} from "./use-tags";

const mockTag = {
  id: 1,
  userId: "user-1",
  name: "Important",
  colour: "red",
  createdAt: "2024-01-01T00:00:00.000Z",
};

const mockTag2 = {
  id: 2,
  userId: "user-1",
  name: "Pricing",
  colour: "blue",
  createdAt: "2024-01-02T00:00:00.000Z",
};

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("useTags", () => {
  it("returns tags list from GET /api/tags", async () => {
    server.use(
      http.get(api.tags.list.path, () => HttpResponse.json([mockTag, mockTag2]))
    );

    const { result } = renderHook(() => useTags(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data![0].name).toBe("Important");
  });

  it("parses response through Zod schema", async () => {
    server.use(
      http.get(api.tags.list.path, () =>
        HttpResponse.json([mockTag])
      )
    );

    const { result } = renderHook(() => useTags(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Verify the parsed result has the expected shape (Zod validates this)
    expect(result.current.data![0]).toHaveProperty("id");
    expect(result.current.data![0]).toHaveProperty("name");
    expect(result.current.data![0]).toHaveProperty("colour");
  });

  it("surfaces API errors", async () => {
    server.use(
      http.get(api.tags.list.path, () =>
        HttpResponse.json({ message: "Unauthorized" }, { status: 401 })
      )
    );

    const { result } = renderHook(() => useTags(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("useCreateTag", () => {
  it("calls POST /api/tags with name and colour", async () => {
    let capturedBody: unknown;

    server.use(
      http.post(api.tags.create.path, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(
          { ...mockTag, id: 3, name: "New" },
          { status: 201 }
        );
      })
    );

    const { result } = renderHook(() => useCreateTag(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate({ name: "New", colour: "green" });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedBody).toMatchObject({ name: "New", colour: "green" });
  });

  it("surfaces creation errors", async () => {
    server.use(
      http.post(api.tags.create.path, () =>
        HttpResponse.json(
          { message: "Tag name already exists", code: "DUPLICATE" },
          { status: 409 }
        )
      )
    );

    const { result } = renderHook(() => useCreateTag(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate({ name: "Important", colour: "red" });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Tag name already exists");
  });
});

describe("useUpdateTag", () => {
  it("calls PATCH /api/tags/:id with updates", async () => {
    let capturedBody: unknown;
    let patchedId: string | undefined;

    server.use(
      http.patch(api.tags.update.path, async ({ params, request }) => {
        patchedId = params.id as string;
        capturedBody = await request.json();
        return HttpResponse.json({ ...mockTag, name: "Updated" });
      })
    );

    const { result } = renderHook(() => useUpdateTag(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate({ id: 1, name: "Updated" });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(patchedId).toBe("1");
    expect(capturedBody).toMatchObject({ name: "Updated" });
  });

  it("surfaces update errors", async () => {
    server.use(
      http.patch(api.tags.update.path, () =>
        HttpResponse.json({ message: "Not found" }, { status: 404 })
      )
    );

    const { result } = renderHook(() => useUpdateTag(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate({ id: 999, name: "Nope" });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Not found");
  });
});

describe("useDeleteTag", () => {
  it("calls DELETE /api/tags/:id", async () => {
    let deletedId: string | undefined;

    server.use(
      http.delete(api.tags.delete.path, ({ params }) => {
        deletedId = params.id as string;
        return new HttpResponse(null, { status: 204 });
      })
    );

    const { result } = renderHook(() => useDeleteTag(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate(1);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(deletedId).toBe("1");
  });

  it("surfaces deletion errors", async () => {
    server.use(
      http.delete(api.tags.delete.path, () =>
        HttpResponse.json({ message: "Tag not found" }, { status: 404 })
      )
    );

    const { result } = renderHook(() => useDeleteTag(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate(999);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Tag not found");
  });
});

describe("useSetMonitorTags", () => {
  it("calls PUT /api/monitors/:id/tags with tagIds", async () => {
    let capturedBody: unknown;

    server.use(
      http.put(api.monitors.setTags.path, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ id: 1, tags: [mockTag, mockTag2] });
      })
    );

    const { result } = renderHook(() => useSetMonitorTags(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate({ monitorId: 1, tagIds: [1, 2] });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedBody).toMatchObject({ tagIds: [1, 2] });
  });

  it("surfaces tag assignment errors", async () => {
    server.use(
      http.put(api.monitors.setTags.path, () =>
        HttpResponse.json({ message: "Failed to update tags" }, { status: 400 })
      )
    );

    const { result } = renderHook(() => useSetMonitorTags(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate({ monitorId: 1, tagIds: [999] });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Failed to update tags");
  });
});
