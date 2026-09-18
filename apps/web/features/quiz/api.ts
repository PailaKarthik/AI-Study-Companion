import type {
  AttemptQuestionState,
  AttemptState,
  ConceptListItem,
  QuizDetail,
  QuizResult,
  QuizSummary,
} from "@ai-study-companion/shared";
import type { CreateQuizInput } from "@ai-study-companion/validation";
import { api } from "@/lib/api/client";

export async function fetchProjectQuizzes(projectId: string, signal?: AbortSignal) {
  const { data } = await api.get<QuizSummary[]>(`/api/projects/${projectId}/quizzes`, {
    signal,
  });
  return data;
}

export async function createQuizRequest(
  projectId: string,
  input: CreateQuizInput,
  signal?: AbortSignal
) {
  const { data } = await api.post<QuizDetail>(`/api/projects/${projectId}/quizzes`, input, {
    signal,
  });
  return data;
}

export async function fetchQuiz(quizId: string, signal?: AbortSignal) {
  const { data } = await api.get<QuizDetail>(`/api/quizzes/${quizId}`, { signal });
  return data;
}

export async function fetchProjectConcepts(projectId: string, signal?: AbortSignal) {
  const { data } = await api.get<ConceptListItem[]>(
    `/api/projects/${projectId}/concepts`,
    { signal }
  );
  return data;
}

export async function startAttemptRequest(
  quizId: string,
  input: { restart?: boolean } = {},
  signal?: AbortSignal
) {
  const { data } = await api.post<AttemptState>(`/api/quizzes/${quizId}/attempts`, input, {
    signal,
  });
  return data;
}

export async function fetchAttempt(attemptId: string, signal?: AbortSignal) {
  const { data } = await api.get<AttemptState>(`/api/quiz-attempts/${attemptId}`, { signal });
  return data;
}

export async function submitResponseRequest(
  attemptId: string,
  input: { questionId: string; selectedOption?: string; responseText?: string },
  signal?: AbortSignal
) {
  const { data } = await api.post<AttemptQuestionState>(
    `/api/quiz-attempts/${attemptId}/responses`,
    input,
    { signal }
  );
  return data;
}

export async function completeAttemptRequest(attemptId: string, signal?: AbortSignal) {
  const { data } = await api.post<QuizResult>(
    `/api/quiz-attempts/${attemptId}/complete`,
    {},
    { signal }
  );
  return data;
}
