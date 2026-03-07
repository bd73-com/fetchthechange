/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/test-utils";
import { UpgradeDialog } from "./UpgradeDialog";

const mockPlans = {
  plans: [
    {
      id: "plan_pro",
      name: "Pro",
      description: "For professionals",
      metadata: { tier: "pro", monitor_limit: "100" },
      prices: [{ id: "price_1", unit_amount: 900, currency: "usd", recurring: { interval: "month" } }],
    },
  ],
};

describe("UpgradeDialog", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the trigger button", () => {
    renderWithProviders(<UpgradeDialog currentTier="free" />);
    expect(screen.getByTestId("button-upgrade")).toBeInTheDocument();
  });

  it("shows dialog title when opened", async () => {
    const user = userEvent.setup();
    renderWithProviders(<UpgradeDialog currentTier="free" />);
    await user.click(screen.getByTestId("button-upgrade"));
    expect(screen.getByText("Upgrade Your Plan")).toBeInTheDocument();
  });

  it("shows plan cards when plans are loaded", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockPlans), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    renderWithProviders(<UpgradeDialog currentTier="free" />);
    await user.click(screen.getByTestId("button-upgrade"));

    await waitFor(() => {
      expect(screen.getByTestId("card-plan-pro")).toBeInTheDocument();
    });
    expect(screen.getByText("Pro")).toBeInTheDocument();
    expect(screen.getByText("Upgrade to Pro")).toBeInTheDocument();
  });

  it("renders custom children as trigger instead of default button", () => {
    renderWithProviders(
      <UpgradeDialog currentTier="free">
        <button data-testid="custom-trigger">Custom</button>
      </UpgradeDialog>,
    );
    expect(screen.getByTestId("custom-trigger")).toBeInTheDocument();
    expect(screen.queryByTestId("button-upgrade")).not.toBeInTheDocument();
  });

  it("shows empty state when no plans are returned", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ plans: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    renderWithProviders(<UpgradeDialog currentTier="free" />);
    await user.click(screen.getByTestId("button-upgrade"));

    await waitFor(() => {
      expect(screen.getByText("No plans available at the moment.")).toBeInTheDocument();
    });
  });

  it("displays formatted price and feature list for a plan", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockPlans), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    renderWithProviders(<UpgradeDialog currentTier="free" />);
    await user.click(screen.getByTestId("button-upgrade"));

    await waitFor(() => {
      expect(screen.getByTestId("card-plan-pro")).toBeInTheDocument();
    });
    expect(screen.getByText("$9.00")).toBeInTheDocument();
    expect(screen.getByText("/month")).toBeInTheDocument();
    expect(screen.getByText("Up to 100 monitors")).toBeInTheDocument();
    expect(screen.getByText("Full change history")).toBeInTheDocument();
  });

  it("disables checkout button for current plan", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockPlans), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    renderWithProviders(<UpgradeDialog currentTier="pro" />);
    await user.click(screen.getByTestId("button-upgrade"));

    await waitFor(() => {
      expect(screen.getByTestId("button-checkout-pro")).toBeInTheDocument();
    });
    expect(screen.getByTestId("button-checkout-pro")).toBeDisabled();
  });

  it("shows 'Current Plan' badge when plan matches currentTier", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockPlans), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    renderWithProviders(<UpgradeDialog currentTier="pro" />);
    await user.click(screen.getByTestId("button-upgrade"));

    await waitFor(() => {
      expect(screen.getByTestId("card-plan-pro")).toBeInTheDocument();
    });
    const currentPlanElements = screen.getAllByText("Current Plan");
    expect(currentPlanElements.length).toBeGreaterThanOrEqual(1);
  });
});
