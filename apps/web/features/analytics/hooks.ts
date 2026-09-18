"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/keys";
import { fetchHomeAnalytics, fetchProjectAnalytics, type AnalyticsRange } from "./api";

/**
 * Analytics hooks. Server-aggregated only — the browser never computes
 * metrics from raw event streams. Ranges are UTC ISO bounds.
 */
export function useProjectAnalytics(projectId: string, range: AnalyticsRange = {}) {
  return useQuery({
    queryKey: queryKeys.projectAnalytics(projectId, range),
    queryFn: ({ signal }) => fetchProjectAnalytics(projectId, range, signal),
    retry: false,
  });
}

export function useHomeAnalytics(range: AnalyticsRange = {}) {
  return useQuery({
    queryKey: queryKeys.homeAnalytics(range),
    queryFn: ({ signal }) => fetchHomeAnalytics(range, signal),
    retry: false,
  });
}
