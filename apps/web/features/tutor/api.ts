import type {
  ConversationDetail,
  ConversationSummary,
  TutorAskResponse,
} from "@ai-study-companion/shared";
import { api } from "@/lib/api/client";

export interface TutorAskParams {
  message: string;
  conversationId?: string;
}

export async function askTutorRequest(
  projectId: string,
  params: TutorAskParams,
  signal?: AbortSignal
) {
  const { data } = await api.post<TutorAskResponse>(
    `/api/projects/${projectId}/tutor/ask`,
    params,
    { signal }
  );
  return data;
}

export async function fetchConversations(projectId: string, signal?: AbortSignal) {
  const { data } = await api.get<ConversationSummary[]>(
    `/api/projects/${projectId}/conversations`,
    { signal }
  );
  return data;
}

export async function fetchConversation(
  projectId: string,
  conversationId: string,
  signal?: AbortSignal
) {
  const { data } = await api.get<ConversationDetail>(
    `/api/projects/${projectId}/conversations/${conversationId}`,
    { signal }
  );
  return data;
}
