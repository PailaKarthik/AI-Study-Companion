"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/keys";
import {
  completeRecommendationRequest,
  dismissRecommendationRequest,
  fetchConceptDetail,
  fetchGrowth,
  fetchRecommendations,
  refreshRecommendationsRequest,
} from "./api";

/**
 * Growth hooks. Server state only — trends and recommendations are
 * computed API-side from persisted evidence; the UI never derives them.
 * Quiz completion invalidates growth + recommendations + overview + home
 * (see features/quiz useCompleteAttempt).
 */
export function useProjectGrowth(projectId: string) {
  return useQuery({
    queryKey: queryKeys.growth(projectId),
    queryFn: ({ signal }) => fetchGrowth(projectId, signal),
    retry: false,
  });
}

export function useConceptDetail(projectId: string, conceptId: string | null) {
  return useQuery({
    queryKey: queryKeys.conceptDetail(projectId, conceptId ?? "none"),
    queryFn: ({ signal }) => fetchConceptDetail(projectId, conceptId as string, signal),
    enabled: conceptId !== null,
    retry: false,
  });
}

export function useRecommendations(projectId: string) {
  return useQuery({
    queryKey: queryKeys.recommendations(projectId),
    queryFn: ({ signal }) => fetchRecommendations(projectId, signal),
    retry: false,
  });
}

function invalidateRecs(queryClient: ReturnType<typeof useQueryClient>, projectId: string) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.recommendations(projectId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.projectOverview(projectId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.home });
  void queryClient.invalidateQueries({ queryKey: queryKeys.growth(projectId) });
  void queryClient.invalidateQueries({
    queryKey: ["projects", projectId, "analytics"],
  });
}

export function useRefreshRecommendations(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => refreshRecommendationsRequest(projectId),
    retry: false,
    onSuccess: () => invalidateRecs(queryClient, projectId),
  });
}

export function useCompleteRecommendation(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (recommendationId: string) => completeRecommendationRequest(recommendationId),
    retry: false,
    onSuccess: () => invalidateRecs(queryClient, projectId),
  });
}

export function useDismissRecommendation(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (recommendationId: string) => dismissRecommendationRequest(recommendationId),
    retry: false,
    onSuccess: () => invalidateRecs(queryClient, projectId),
  });
}
