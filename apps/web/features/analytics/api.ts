import type { HomeAnalytics, ProjectAnalytics } from "@ai-study-companion/shared";
import { api } from "@/lib/api/client";

export interface AnalyticsRange {
  from?: string;
  to?: string;
}

function rangeParams(range: AnalyticsRange): string {
  const params = new URLSearchParams();
  if (range.from) params.set("from", range.from);
  if (range.to) params.set("to", range.to);
  const query = params.toString();
  return query ? `?${query}` : "";
}

export async function fetchProjectAnalytics(
  projectId: string,
  range: AnalyticsRange = {},
  signal?: AbortSignal
) {
  const { data } = await api.get<ProjectAnalytics>(
    `/api/projects/${projectId}/analytics${rangeParams(range)}`,
    { signal }
  );
  return data;
}

export async function fetchHomeAnalytics(range: AnalyticsRange = {}, signal?: AbortSignal) {
  const { data } = await api.get<HomeAnalytics>(`/api/home/analytics${rangeParams(range)}`, {
    signal,
  });
  return data;
}
