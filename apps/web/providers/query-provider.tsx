"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { isRetryable } from "@/lib/api/errors";

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            // Retry once, but ONLY for retryable failures (network/5xx/
            // 429). A 4xx means the request itself is wrong — retrying it
            // is pure load. Feature hooks that need stricter behavior set
            // retry:false explicitly.
            retry: (failureCount, error) => failureCount < 1 && isRetryable(error),
            refetchOnWindowFocus: false,
          },
          mutations: {
            retry: 0,
          },
        },
      })
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
