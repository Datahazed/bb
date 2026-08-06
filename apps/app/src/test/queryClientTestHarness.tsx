import { Provider as JotaiProvider } from "jotai";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { JSX, ReactNode } from "react";
import { createAppQueryClient } from "@/lib/query-client";

interface QueryClientTestWrapperProps {
  children: ReactNode;
}

type QueryClientTestWrapper = (
  props: QueryClientTestWrapperProps,
) => JSX.Element;

export interface QueryClientTestHarness {
  queryClient: QueryClient;
  wrapper: QueryClientTestWrapper;
}

/**
 * The app's query client with retries off, so a request a test never stubs
 * fails once instead of being retried past the assertion's timeout.
 */
export function createTestQueryClient(): QueryClient {
  return createAppQueryClient({
    defaultOptions: {
      mutations: {
        retry: false,
      },
      queries: {
        gcTime: Infinity,
        retry: false,
      },
    },
  });
}

export function createQueryClientTestHarness(): QueryClientTestHarness {
  const queryClient = createTestQueryClient();

  const wrapper: QueryClientTestWrapper = ({ children }) => (
    <JotaiProvider>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </JotaiProvider>
  );

  return {
    queryClient,
    wrapper,
  };
}
