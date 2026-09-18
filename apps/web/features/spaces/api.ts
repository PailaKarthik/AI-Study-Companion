import type { CreateSpaceInput, UpdateSpaceInput } from "@ai-study-companion/validation";
import type { Paginated, SpaceDetail, SpaceSummary } from "@ai-study-companion/shared";
import { api } from "@/lib/api/client";

export interface SpaceListParams {
  page?: number;
  pageSize?: number;
  q?: string;
}

function toSearch(params: SpaceListParams): string {
  const search = new URLSearchParams();
  if (params.page !== undefined) search.set("page", String(params.page));
  if (params.pageSize !== undefined) search.set("pageSize", String(params.pageSize));
  if (params.q) search.set("q", params.q);
  const query = search.toString();
  return query ? `/api/spaces?${query}` : "/api/spaces";
}

export async function fetchSpaces(params: SpaceListParams, signal?: AbortSignal) {
  const { data } = await api.get<Paginated<SpaceSummary>>(toSearch(params), { signal });
  return data;
}

export async function fetchSpace(spaceId: string, signal?: AbortSignal) {
  const { data } = await api.get<SpaceDetail>(`/api/spaces/${spaceId}`, { signal });
  return data;
}

export async function createSpaceRequest(input: CreateSpaceInput) {
  const { data } = await api.post<SpaceDetail>("/api/spaces", input);
  return data;
}

export async function updateSpaceRequest(spaceId: string, input: UpdateSpaceInput) {
  const { data } = await api.patch<SpaceDetail>(`/api/spaces/${spaceId}`, input);
  return data;
}

export async function deleteSpaceRequest(spaceId: string) {
  const { data } = await api.delete<{ id: string }>(`/api/spaces/${spaceId}`);
  return data;
}
