"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/keys";
import { askTutorRequest, fetchConversation, fetchConversations, type TutorAskParams } from "./api";

/**
 * Tutor thread list for one project. Latest first, server-side ownership
 * enforced — the client never filters conversations itself.
 */
export function useConversations(projectId: string) {
  return useQuery({
    queryKey: queryKeys.conversations(projectId),
    queryFn: ({ signal }) => fetchConversations(projectId, signal),
    retry: false,
  });
}

export function useConversation(projectId: string, conversationId: string | null) {
  return useQuery({
    queryKey: queryKeys.conversation(projectId, conversationId ?? "none"),
    queryFn: ({ signal }) => fetchConversation(projectId, conversationId as string, signal),
    enabled: conversationId !== null,
    retry: false,
  });
}

/**
 * One tutor turn. A mutation (never a cached query): every submit hits
 * POST …/tutor/ask fresh. On success the thread list refreshes and the
 * active thread detail is replaced with the authoritative server copy.
 */
export function useTutorAsk(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: TutorAskParams) => askTutorRequest(projectId, params),
    retry: false,
    onSuccess: (response) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.conversations(projectId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.conversation(projectId, response.conversationId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.projectOverview(projectId),
      });
      // A tutor turn writes activity + engagement markers consumed by
      // home, analytics, and growth — refresh all of them (prefix keys
      // fan out across range variants).
      void queryClient.invalidateQueries({ queryKey: queryKeys.home });
      void queryClient.invalidateQueries({
        queryKey: ["projects", projectId, "analytics"],
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.growth(projectId) });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.recommendations(projectId),
      });
    },
  });
}
