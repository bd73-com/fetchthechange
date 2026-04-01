/**
 * Tests: use-campaigns hooks
 * Coverage: useCampaigns, useCampaign, useCampaignDashboard, useCampaignAnalytics,
 *           useCreateCampaign, useUpdateCampaign, useDeleteCampaign,
 *           usePreviewRecipients, useSendTestCampaign, useSendCampaign,
 *           useRecoverCampaigns, useCancelCampaign,
 *           useAutomatedCampaigns, useUpdateAutomatedCampaign, useTriggerAutomatedCampaign
 *
 * @vitest-environment happy-dom
 */
import { renderHook, waitFor, act } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../test/server";
import { createWrapper } from "../test/test-utils";
import {
  useCampaigns,
  useCampaign,
  useCampaignDashboard,
  useCampaignAnalytics,
  useCreateCampaign,
  useUpdateCampaign,
  useDeleteCampaign,
  usePreviewRecipients,
  useSendTestCampaign,
  useSendCampaign,
  useRecoverCampaigns,
  useCancelCampaign,
  useAutomatedCampaigns,
  useUpdateAutomatedCampaign,
  useTriggerAutomatedCampaign,
} from "./use-campaigns";

const CAMPAIGNS = "/api/admin/campaigns";
const DASHBOARD = "/api/admin/campaigns/dashboard";
const AUTO = "/api/admin/automated-campaigns";

const mockCampaign = {
  id: 1,
  name: "Welcome",
  subject: "Welcome to FTC",
  htmlBody: "<h1>Hi</h1>",
  textBody: "Hi",
  status: "draft",
  filters: {},
  totalRecipients: 0,
  sentCount: 0,
  openedCount: 0,
  clickedCount: 0,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
};

const mockDashboard = {
  totalCampaigns: 5,
  totalSent: 100,
  totalOpened: 40,
  totalClicked: 10,
  avgOpenRate: 0.4,
  avgClickRate: 0.1,
  recentCampaigns: [mockCampaign],
};

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("useCampaigns", () => {
  it("returns all campaigns", async () => {
    server.use(
      http.get(CAMPAIGNS, () => HttpResponse.json([mockCampaign]))
    );

    const { result } = renderHook(() => useCampaigns(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0].name).toBe("Welcome");
  });

  it("filters campaigns by status", async () => {
    let requestUrl = "";

    server.use(
      http.get(CAMPAIGNS, ({ request }) => {
        requestUrl = request.url;
        return HttpResponse.json([mockCampaign]);
      })
    );

    const { result } = renderHook(() => useCampaigns("draft"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requestUrl).toContain("?status=draft");
  });
});

describe("useCampaign", () => {
  it("returns a single campaign by id", async () => {
    server.use(
      http.get(`${CAMPAIGNS}/:id`, () => HttpResponse.json(mockCampaign))
    );

    const { result } = renderHook(() => useCampaign(1), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.name).toBe("Welcome");
  });

  it("is disabled when id is 0", () => {
    const { result } = renderHook(() => useCampaign(0), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe("idle");
  });
});

describe("useCampaignDashboard", () => {
  it("returns dashboard stats", async () => {
    server.use(
      http.get(DASHBOARD, () => HttpResponse.json(mockDashboard))
    );

    const { result } = renderHook(() => useCampaignDashboard(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.totalCampaigns).toBe(5);
    expect(result.current.data!.avgOpenRate).toBe(0.4);
  });
});

describe("useCampaignAnalytics", () => {
  it("returns analytics for a campaign", async () => {
    const mockAnalytics = {
      campaign: mockCampaign,
      recipientBreakdown: { sent: 50, opened: 20 },
      recipients: [],
      pagination: { page: 1, limit: 50, total: 50, totalPages: 1 },
    };

    server.use(
      http.get(`${CAMPAIGNS}/:id/analytics`, () =>
        HttpResponse.json(mockAnalytics)
      )
    );

    const { result } = renderHook(() => useCampaignAnalytics(1), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.pagination.total).toBe(50);
  });

  it("is disabled when id is 0", () => {
    const { result } = renderHook(() => useCampaignAnalytics(0), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe("idle");
  });
});

describe("useCreateCampaign", () => {
  it("calls POST /api/admin/campaigns", async () => {
    let capturedBody: unknown;

    server.use(
      http.post(CAMPAIGNS, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ ...mockCampaign, id: 2 }, { status: 201 });
      })
    );

    const { result } = renderHook(() => useCreateCampaign(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate({
        name: "New Campaign",
        subject: "Hello",
        htmlBody: "<p>Hi</p>",
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedBody).toMatchObject({ name: "New Campaign", subject: "Hello" });
  });

  it("surfaces creation errors", async () => {
    server.use(
      http.post(CAMPAIGNS, () =>
        HttpResponse.json({ message: "Bad request" }, { status: 400 })
      )
    );

    const { result } = renderHook(() => useCreateCampaign(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate({ name: "Bad", subject: "", htmlBody: "" });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Bad request");
  });
});

describe("useUpdateCampaign", () => {
  it("calls PATCH /api/admin/campaigns/:id", async () => {
    let capturedBody: unknown;

    server.use(
      http.patch(`${CAMPAIGNS}/:id`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ ...mockCampaign, subject: "Updated" });
      })
    );

    const { result } = renderHook(() => useUpdateCampaign(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate({ id: 1, subject: "Updated" });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedBody).toMatchObject({ subject: "Updated" });
  });
});

describe("useDeleteCampaign", () => {
  it("calls DELETE /api/admin/campaigns/:id", async () => {
    server.use(
      http.delete(`${CAMPAIGNS}/:id`, () =>
        new HttpResponse(null, { status: 204 })
      )
    );

    const { result } = renderHook(() => useDeleteCampaign(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate(1);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe("usePreviewRecipients", () => {
  it("returns preview count and users", async () => {
    let capturedBody: unknown;

    server.use(
      http.post(`${CAMPAIGNS}/:id/preview`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({
          count: 2,
          users: [
            { id: "u1", email: "a@b.com", firstName: "A", tier: "free", monitorCount: 1 },
          ],
        });
      })
    );

    const { result } = renderHook(() => usePreviewRecipients(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate({ id: 1, filters: { tier: "free" } });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.count).toBe(2);
    expect(capturedBody).toMatchObject({ filters: { tier: "free" } });
  });
});

describe("useSendTestCampaign", () => {
  it("sends a test email", async () => {
    let capturedBody: unknown;

    server.use(
      http.post(`${CAMPAIGNS}/:id/send-test`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ sentTo: "test@example.com" });
      })
    );

    const { result } = renderHook(() => useSendTestCampaign(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate({ id: 1, testEmail: "test@example.com" });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedBody).toMatchObject({ testEmail: "test@example.com" });
  });
});

describe("useSendCampaign", () => {
  it("sends a campaign", async () => {
    server.use(
      http.post(`${CAMPAIGNS}/:id/send`, () =>
        HttpResponse.json({ totalRecipients: 50 })
      )
    );

    const { result } = renderHook(() => useSendCampaign(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate(1);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("surfaces send errors", async () => {
    server.use(
      http.post(`${CAMPAIGNS}/:id/send`, () =>
        HttpResponse.json({ message: "Campaign already sent" }, { status: 400 })
      )
    );

    const { result } = renderHook(() => useSendCampaign(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate(1);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Campaign already sent");
  });
});

describe("useRecoverCampaigns", () => {
  it("recovers campaigns and reports count", async () => {
    server.use(
      http.post(`${CAMPAIGNS}/recover`, () =>
        HttpResponse.json({
          recovered: 2,
          campaigns: [
            { id: 1, name: "Recovered", subject: "Hi", totalRecipients: 10 },
          ],
        })
      )
    );

    const { result } = renderHook(() => useRecoverCampaigns(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate();
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.recovered).toBe(2);
  });

  it("handles no campaigns to recover", async () => {
    server.use(
      http.post(`${CAMPAIGNS}/recover`, () =>
        HttpResponse.json({
          recovered: 0,
          campaigns: [],
          message: "No orphaned recipient data found.",
        })
      )
    );

    const { result } = renderHook(() => useRecoverCampaigns(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate();
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.recovered).toBe(0);
  });
});

describe("useCancelCampaign", () => {
  it("cancels a campaign", async () => {
    server.use(
      http.post(`${CAMPAIGNS}/:id/cancel`, () =>
        HttpResponse.json({ sentSoFar: 10, cancelled: 40 })
      )
    );

    const { result } = renderHook(() => useCancelCampaign(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate(1);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe("useAutomatedCampaigns", () => {
  it("returns automated campaign configs", async () => {
    const mockAutoConfig = {
      key: "welcome",
      subject: "Welcome!",
      htmlBody: "<p>Welcome</p>",
      textBody: "Welcome",
      enabled: true,
      lastRunAt: null,
    };

    server.use(
      http.get(AUTO, () => HttpResponse.json([mockAutoConfig]))
    );

    const { result } = renderHook(() => useAutomatedCampaigns(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0].key).toBe("welcome");
  });
});

describe("useUpdateAutomatedCampaign", () => {
  it("calls PATCH /api/admin/automated-campaigns/:key", async () => {
    let capturedBody: unknown;

    server.use(
      http.patch(`${AUTO}/:key`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ key: "welcome", enabled: false });
      })
    );

    const { result } = renderHook(() => useUpdateAutomatedCampaign(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate({ key: "welcome", enabled: false });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedBody).toMatchObject({ enabled: false });
  });
});

describe("useTriggerAutomatedCampaign", () => {
  it("triggers an automated campaign", async () => {
    server.use(
      http.post(`${AUTO}/:key/trigger`, () =>
        HttpResponse.json({ totalRecipients: 25 })
      )
    );

    const { result } = renderHook(() => useTriggerAutomatedCampaign(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate({ key: "welcome" });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("reports when no new recipients", async () => {
    server.use(
      http.post(`${AUTO}/:key/trigger`, () =>
        HttpResponse.json({ skipped: true })
      )
    );

    const { result } = renderHook(() => useTriggerAutomatedCampaign(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate({ key: "welcome" });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.skipped).toBe(true);
  });
});
