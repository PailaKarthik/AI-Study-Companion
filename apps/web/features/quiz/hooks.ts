"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateQuizInput } from "@ai-study-companion/validation";
import { queryKeys } from "@/lib/query/keys";
import {
  completeAttemptRequest,
  createQuizRequest,
  fetchAttempt,
  fetchProjectConcepts,
  fetchProjectQuizzes,
  fetchQuiz,
  startAttemptRequest,
  submitResponseRequest,
} from "./api";

/**
 * Quiz hooks. Server state only — answers persist via mutations, progress
 * resumes from GET attempt, and invalidation is targeted per resource.
 */
export function useProjectQuizzes(projectId: string) {
  return useQuery({
    queryKey: queryKeys.quizzes(projectId),
    queryFn: ({ signal }) => fetchProjectQuizzes(projectId, signal),
    retry: false,
  });
}

export function useProjectConcepts(projectId: string) {
  return useQuery({
    queryKey: queryKeys.concepts(projectId),
    queryFn: ({ signal }) => fetchProjectConcepts(projectId, signal),
    retry: false,
  });
}

export function useQuiz(quizId: string | null) {
  return useQuery({
    queryKey: queryKeys.quiz(quizId ?? "none"),
    queryFn: ({ signal }) => fetchQuiz(quizId as string, signal),
    enabled: quizId !== null,
    retry: false,
  });
}

export function useCreateQuiz(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateQuizInput) => createQuizRequest(projectId, input),
    retry: false,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.quizzes(projectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectOverview(projectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.home });
    },
  });
}

export function useStartAttempt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ quizId, restart }: { quizId: string; restart?: boolean }) =>
      startAttemptRequest(quizId, { restart }),
    retry: false,
    onSuccess: (attempt) => {
      queryClient.setQueryData(queryKeys.attempt(attempt.id), attempt);
      void queryClient.invalidateQueries({ queryKey: queryKeys.quiz(attempt.quizId) });
      // The history table shows attemptCount + latest attempt — refresh it
      // immediately so Start/Resume flips without a manual reload.
      void queryClient.invalidateQueries({ queryKey: queryKeys.quizzes(attempt.projectId) });
    },
  });
}

export function useQuizAttempt(attemptId: string | null) {
  return useQuery({
    queryKey: queryKeys.attempt(attemptId ?? "none"),
    queryFn: ({ signal }) => fetchAttempt(attemptId as string, signal),
    enabled: attemptId !== null,
    retry: false,
  });
}

export function useSubmitResponse(attemptId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { questionId: string; selectedOption?: string; responseText?: string }) =>
      submitResponseRequest(attemptId, input),
    retry: false,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.attempt(attemptId) });
    },
  });
}

export function useCompleteAttempt(attemptId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => completeAttemptRequest(attemptId),
    retry: false,
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.attempt(attemptId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.quiz(result.quizId) });
      // Scores land in the history table — invalidate the list too, or the
      // just-finished quiz keeps showing its pre-completion state.
      void queryClient.invalidateQueries({ queryKey: queryKeys.quizzes(result.projectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectOverview(result.projectId) });
      // Completion feeds the learning loop server-side — refresh every
      // consumer of mastery, growth, and recommendations.
      void queryClient.invalidateQueries({ queryKey: queryKeys.growth(result.projectId) });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.recommendations(result.projectId),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.home });
    },
  });
}
