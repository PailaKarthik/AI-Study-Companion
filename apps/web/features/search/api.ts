import type { SearchResponse } from "@ai-study-companion/shared";
import { api } from "@/lib/api/client";

export interface ProjectSearchParams {
  query: string;
  limit?: number;
}

export async function searchProjectRequest(
  projectId: string,
  params: ProjectSearchParams,
  signal?: AbortSignal
) {
  const { data } = await api.post<SearchResponse>(`/api/projects/${projectId}/search`, params, {
    signal,
  });
  return data;
}
