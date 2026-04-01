/**
 * Tests: FixSelectorModal component (Fix Selector flow)
 * Coverage: suggestion flow, selector application, error handling, state transitions
 * MSW handlers: POST /api/monitors/:id/suggest-selectors, PATCH /api/monitors/:id,
 *               POST /api/monitors/:id/check
 *
 * @vitest-environment happy-dom
 */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { api } from "@shared/routes";
import { server } from "../test/server";
import { renderWithProviders } from "../test/test-utils";
import { FixSelectorModal } from "./FixSelectorModal";
import type { Monitor } from "@shared/schema";

const mockMonitor: Monitor = {
  id: 1,
  userId: "user-1",
  name: "Price check",
  url: "https://example.com",
  selector: ".old-price",
  frequency: "daily",
  lastChecked: null,
  lastChanged: null,
  currentValue: null,
  lastStatus: "selector_missing",
  lastError: "Selector not found",
  active: true,
  emailEnabled: true,
  consecutiveFailures: 3,
  pauseReason: null,
  healthAlertSentAt: null,
  lastHealthyAt: null,
  pendingRetryAt: null,
  createdAt: new Date("2024-01-01"),
} as any;

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("FixSelectorModal", () => {
  it("renders the Fix selector trigger button", () => {
    renderWithProviders(<FixSelectorModal monitor={mockMonitor} />);
    expect(screen.getByTestId("button-fix-selector")).toBeInTheDocument();
    expect(screen.getByText("Fix selector")).toBeInTheDocument();
  });

  it("opens the dialog when trigger button is clicked", async () => {
    const user = userEvent.setup();
    renderWithProviders(<FixSelectorModal monitor={mockMonitor} />);

    await user.click(screen.getByTestId("button-fix-selector"));

    await waitFor(() => {
      expect(screen.getByText("Fix Selector")).toBeInTheDocument();
    });
    expect(screen.getByTestId("input-expected-text")).toBeInTheDocument();
    expect(screen.getByTestId("button-suggest-selectors")).toBeInTheDocument();
  });

  it("fetches suggestions and displays them", async () => {
    const user = userEvent.setup();

    server.use(
      http.post(api.monitors.suggestSelectors.path, () =>
        HttpResponse.json({
          currentSelector: { selector: ".old-price", count: 0, valid: false },
          suggestions: [
            { selector: ".new-price", count: 1, sampleText: "$90.00" },
            { selector: "span.cost", count: 2, sampleText: "$90" },
          ],
        })
      )
    );

    renderWithProviders(<FixSelectorModal monitor={mockMonitor} />);
    await user.click(screen.getByTestId("button-fix-selector"));

    await waitFor(() => {
      expect(screen.getByTestId("input-expected-text")).toBeInTheDocument();
    });

    await user.type(screen.getByTestId("input-expected-text"), "$90");
    await user.click(screen.getByTestId("button-suggest-selectors"));

    await waitFor(() => {
      expect(screen.getByTestId("text-selector-0")).toHaveTextContent(".new-price");
    });
    expect(screen.getByTestId("text-selector-1")).toHaveTextContent("span.cost");
    expect(screen.getByTestId("text-sample-0")).toHaveTextContent("$90.00");
    expect(screen.getByText("Found 2 suggestions")).toBeInTheDocument();
  });

  it("shows no results message when current selector is invalid and no suggestions", async () => {
    const user = userEvent.setup();

    server.use(
      http.post(api.monitors.suggestSelectors.path, () =>
        HttpResponse.json({
          currentSelector: { selector: ".old-price", count: 0, valid: false },
          suggestions: [],
        })
      )
    );

    renderWithProviders(<FixSelectorModal monitor={mockMonitor} />);
    await user.click(screen.getByTestId("button-fix-selector"));

    await waitFor(() => {
      expect(screen.getByTestId("button-suggest-selectors")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("button-suggest-selectors"));

    await waitFor(() => {
      expect(screen.getByText("No matching selectors found.")).toBeInTheDocument();
    });
  });

  it("applies a selector and shows successful check result", async () => {
    const user = userEvent.setup();
    let patchedSelector: string | undefined;

    server.use(
      http.post(api.monitors.suggestSelectors.path, () =>
        HttpResponse.json({
          currentSelector: { selector: ".old-price", count: 0, valid: false },
          suggestions: [
            { selector: ".new-price", count: 1, sampleText: "$90.00" },
          ],
        })
      ),
      http.patch(api.monitors.update.path, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        patchedSelector = body.selector as string;
        return HttpResponse.json({
          ...mockMonitor,
          selector: patchedSelector,
        });
      }),
      http.post(api.monitors.check.path, () =>
        HttpResponse.json({
          changed: false,
          currentValue: "$90.00",
          status: "ok",
          error: null,
        })
      )
    );

    renderWithProviders(<FixSelectorModal monitor={mockMonitor} />);
    await user.click(screen.getByTestId("button-fix-selector"));

    await waitFor(() => {
      expect(screen.getByTestId("button-suggest-selectors")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("button-suggest-selectors"));

    await waitFor(() => {
      expect(screen.getByTestId("button-use-selector-0")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("button-use-selector-0"));

    await waitFor(() => {
      expect(screen.getByTestId("badge-check-status")).toBeInTheDocument();
    });

    expect(patchedSelector).toBe(".new-price");
    expect(screen.getByTestId("text-extracted-value")).toHaveTextContent("$90.00");
  });

  it("shows error when applying selector fails", async () => {
    const user = userEvent.setup();

    server.use(
      http.post(api.monitors.suggestSelectors.path, () =>
        HttpResponse.json({
          currentSelector: { selector: ".old-price", count: 0, valid: false },
          suggestions: [
            { selector: ".broken", count: 1, sampleText: "test" },
          ],
        })
      ),
      http.patch(api.monitors.update.path, () =>
        HttpResponse.json(
          { message: "Failed to update" },
          { status: 500 }
        )
      )
    );

    renderWithProviders(<FixSelectorModal monitor={mockMonitor} />);
    await user.click(screen.getByTestId("button-fix-selector"));

    await waitFor(() => {
      expect(screen.getByTestId("button-suggest-selectors")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("button-suggest-selectors"));

    await waitFor(() => {
      expect(screen.getByTestId("button-use-selector-0")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("button-use-selector-0"));

    await waitFor(() => {
      expect(screen.getByTestId("text-check-error")).toBeInTheDocument();
    });
  });

  it("shows suggestion error when API fails", async () => {
    const user = userEvent.setup();

    server.use(
      http.post(api.monitors.suggestSelectors.path, () =>
        HttpResponse.json(
          { message: "Page could not be loaded" },
          { status: 500 }
        )
      )
    );

    renderWithProviders(<FixSelectorModal monitor={mockMonitor} />);
    await user.click(screen.getByTestId("button-fix-selector"));

    await waitFor(() => {
      expect(screen.getByTestId("button-suggest-selectors")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("button-suggest-selectors"));

    await waitFor(() => {
      expect(screen.getByText("Page could not be loaded")).toBeInTheDocument();
    });
  });

  it("shows current selector info when it is still valid", async () => {
    const user = userEvent.setup();

    server.use(
      http.post(api.monitors.suggestSelectors.path, () =>
        HttpResponse.json({
          currentSelector: { selector: ".price", count: 1, valid: true },
          suggestions: [
            { selector: ".price", count: 1, sampleText: "$100" },
          ],
        })
      )
    );

    renderWithProviders(<FixSelectorModal monitor={mockMonitor} />);
    await user.click(screen.getByTestId("button-fix-selector"));

    await waitFor(() => {
      expect(screen.getByTestId("button-suggest-selectors")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("button-suggest-selectors"));

    await waitFor(() => {
      expect(
        screen.getByText(/Your current selector already matches 1 element/)
      ).toBeInTheDocument();
    });
  });
});
