/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/test-utils";
import { CreateMonitorDialog } from "./CreateMonitorDialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ReactElement } from "react";

// Radix UI Switch uses ResizeObserver which jsdom doesn't provide
beforeAll(() => {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any;
});

// Mock useAuth to provide a user with tier info
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: "user1", tier: "free", email: "test@example.com" } }),
}));

// Mutable mock for useCreateMonitor — default passes through real behavior,
// individual tests can override via mockMutateFn.
let mockMutateFn: ((...args: any[]) => void) | null = null;
vi.mock("@/hooks/use-monitors", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/hooks/use-monitors")>();
  return {
    ...orig,
    useCreateMonitor: () => ({
      mutate: (...args: any[]) => {
        if (mockMutateFn) return mockMutateFn(...args);
        return orig.useCreateMonitor().mutate(...(args as [any]));
      },
      isPending: false,
    }),
  };
});

function renderDialog(ui: ReactElement) {
  return renderWithProviders(<TooltipProvider>{ui}</TooltipProvider>);
}

describe("CreateMonitorDialog", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockMutateFn = null;
  });

  it("renders the trigger button", () => {
    renderDialog(<CreateMonitorDialog />);
    expect(screen.getByText("Add Page")).toBeInTheDocument();
  });

  it("pre-fills form fields when initialValues and externalOpen are provided", async () => {
    const initialValues = {
      url: "https://example.com/page",
      selector: ".price-tag",
      name: "Test Monitor",
    };

    renderDialog(
      <CreateMonitorDialog
        initialValues={initialValues}
        externalOpen={true}
        onExternalOpenChange={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Monitor New Page")).toBeInTheDocument();
    });

    const urlInput = screen.getByPlaceholderText("https://example.com/monitoring") as HTMLInputElement;
    const nameInput = screen.getByPlaceholderText("Monitor name") as HTMLInputElement;
    const selectorInput = screen.getByPlaceholderText(".price-tag or #main-content") as HTMLInputElement;

    expect(urlInput.value).toBe("https://example.com/page");
    expect(selectorInput.value).toBe(".price-tag");
    expect(nameInput.value).toBe("Test Monitor");
  });

  it("opens the dialog when externalOpen is true", async () => {
    renderDialog(
      <CreateMonitorDialog
        externalOpen={true}
        onExternalOpenChange={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Monitor New Page")).toBeInTheDocument();
    });
  });

  it("does not open the dialog when externalOpen is undefined", () => {
    renderDialog(<CreateMonitorDialog />);
    expect(screen.queryByText("Monitor New Page")).not.toBeInTheDocument();
  });

  it("calls onExternalOpenChange(false) on successful creation", async () => {
    let capturedOnSuccess: (() => void) | null = null;
    mockMutateFn = vi.fn((_data: any, opts: any) => {
      capturedOnSuccess = () => opts.onSuccess({ monitor: { id: 1 }, selectorWarning: null });
    });

    const user = userEvent.setup();
    const onExternalOpenChange = vi.fn();

    renderDialog(
      <CreateMonitorDialog
        initialValues={{ url: "https://example.com", selector: ".test", name: "Test" }}
        externalOpen={true}
        onExternalOpenChange={onExternalOpenChange}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Monitor New Page")).toBeInTheDocument();
    });

    // Submit the form
    await user.click(screen.getByRole("button", { name: "Create Monitor" }));

    // mutate should have been called
    expect(mockMutateFn).toHaveBeenCalled();

    // Simulate server success
    capturedOnSuccess?.();

    // The success handler should call handleOpenChange(false) → onExternalOpenChange(false)
    expect(onExternalOpenChange).toHaveBeenCalledWith(false);
  });

  it("calls onExternalOpenChange when Cancel is clicked", async () => {
    const user = userEvent.setup();
    const onExternalOpenChange = vi.fn();

    renderDialog(
      <CreateMonitorDialog
        initialValues={{ url: "https://example.com", selector: ".test" }}
        externalOpen={true}
        onExternalOpenChange={onExternalOpenChange}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Monitor New Page")).toBeInTheDocument();
    });

    // Click the Cancel button
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onExternalOpenChange).toHaveBeenCalledWith(false);
  });
});
