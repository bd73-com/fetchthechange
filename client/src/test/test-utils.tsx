import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions } from "@testing-library/react";
import type { ReactElement } from "react";
import { getQueryFn } from "@/lib/queryClient";

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        queryFn: getQueryFn({ on401: "throw" }),
        retry: false,
        gcTime: 0,
      },
      mutations: { retry: false },
    },
  });
}

export function renderWithProviders(
  ui: ReactElement,
  options?: Omit<RenderOptions, "wrapper">,
) {
  const queryClient = createTestQueryClient();
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  }
  return { ...render(ui, { wrapper: Wrapper, ...options }), queryClient };
}

export { default as userEvent } from "@testing-library/user-event";
export * from "@testing-library/react";
