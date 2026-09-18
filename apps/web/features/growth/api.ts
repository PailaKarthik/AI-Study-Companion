import type {
  ConceptDetailData,
  GrowthData,
  RecommendationDetail,
} from "@ai-study-companion/shared";
import { api } from "@/lib/api/client";

export async function fetchGrowth(projectId: string, signal?: AbortSignal) {
  const { data } = await api.get<GrowthData>(`/api/projects/${projectId}/growth`, { signal });
  return data;
}

export async function fetchConceptDetail(
  projectId: string,
  conceptId: string,
  signal?: AbortSignal
) {
  const { data } = await api.get<ConceptDetailData>(
    `/api/projects/${projectId}/concepts/${conceptId}`,
    { signal }
  );
  return data;
}

export async function fetchRecommendations(projectId: string, signal?: AbortSignal) {
  const { data } = await api.get<RecommendationDetail[]>(
    `/api/projects/${projectId}/recommendations`,
    { signal }
  );
  return data;
}

export async function refreshRecommendationsRequest(projectId: string, signal?: AbortSignal) {
  const { data } = await api.post<RecommendationDetail[]>(
    `/api/projects/${projectId}/recommendations/refresh`,
    {},
    { signal }
  );
  return data;
}

export async function completeRecommendationRequest(
  recommendationId: string,
  signal?: AbortSignal
) {
  const { data } = await api.post<RecommendationDetail>(
    `/api/recommendations/${recommendationId}/complete`,
    {},
    { signal }
  );
  return data;
}

export async function dismissRecommendationRequest(
  recommendationId: string,
  signal?: AbortSignal
) {
  const { data } = await api.post<RecommendationDetail>(
    `/api/recommendations/${recommendationId}/dismiss`,
    {},
    { signal }
  );
  return data;
}
