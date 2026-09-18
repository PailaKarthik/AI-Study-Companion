import type {
  AdminActivityItem,
  AdminAIEvaluationItem,
  AdminAIUsageItem,
  AdminJobItem,
  AdminLearningAnalytics,
  AdminOverview,
  AdminSystemHealth,
  AdminUserDetail,
  AdminUserSummary,
  Paginated,
} from "@ai-study-companion/shared";
import { api } from "@/lib/api/client";

export interface AdminListParams {
  page?: number;
  pageSize?: number;
  q?: string;
}

export interface AdminActivityParams extends AdminListParams {
  from?: string;
  to?: string;
  userId?: string;
  eventType?: string;
  spaceId?: string;
  projectId?: string;
  sort?: "asc" | "desc";
}

export interface AdminAIUsageParams extends AdminListParams {
  from?: string;
  to?: string;
  feature?: string;
  provider?: string;
  status?: string;
  sort?: "asc" | "desc";
}

export interface AdminJobsParams extends AdminListParams {
  from?: string;
  to?: string;
  type?: string;
  status?: string;
  sort?: "asc" | "desc";
}

function query(params: object): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

export interface DateRange {
  from?: string;
  to?: string;
}

export async function fetchAdminOverview(range: DateRange = {}, signal?: AbortSignal) {
  const { data } = await api.get<AdminOverview>(`/api/admin/overview${query(range)}`, { signal });
  return data;
}

export async function fetchAdminUsers(
  params: AdminListParams & { role?: string } = {},
  signal?: AbortSignal
) {
  const { data } = await api.get<Paginated<AdminUserSummary>>(`/api/admin/users${query(params)}`, {
    signal,
  });
  return data;
}

export async function fetchAdminUser(userId: string, signal?: AbortSignal) {
  const { data } = await api.get<AdminUserDetail>(`/api/admin/users/${userId}`, { signal });
  return data;
}

export async function fetchAdminSpaces(params: AdminListParams = {}, signal?: AbortSignal) {
  const { data } = await api.get<Paginated<{ id: string; name: string }>>(
    `/api/admin/spaces${query(params)}`,
    { signal }
  );
  return data;
}

export async function fetchAdminProjects(params: AdminListParams = {}, signal?: AbortSignal) {
  const { data } = await api.get<Paginated<{ id: string; name: string }>>(
    `/api/admin/projects${query(params)}`,
    { signal }
  );
  return data;
}

export async function fetchAdminActivity(params: AdminActivityParams = {}, signal?: AbortSignal) {
  const { data } = await api.get<Paginated<AdminActivityItem>>(
    `/api/admin/activity${query(params)}`,
    { signal }
  );
  return data;
}

export async function fetchAdminLearning(range: DateRange = {}, signal?: AbortSignal) {
  const { data } = await api.get<AdminLearningAnalytics>(`/api/admin/learning${query(range)}`, {
    signal,
  });
  return data;
}

export async function fetchAdminAIUsage(params: AdminAIUsageParams = {}, signal?: AbortSignal) {
  const { data } = await api.get<Paginated<AdminAIUsageItem>>(
    `/api/admin/ai-usage${query(params)}`,
    { signal }
  );
  return data;
}

export async function fetchAdminAIEvaluations(
  params: AdminListParams & { feature?: string; sort?: string } = {},
  signal?: AbortSignal
) {
  const { data } = await api.get<Paginated<AdminAIEvaluationItem>>(
    `/api/admin/ai-evaluations${query(params)}`,
    { signal }
  );
  return data;
}

export async function fetchAdminJobs(params: AdminJobsParams = {}, signal?: AbortSignal) {
  const { data } = await api.get<Paginated<AdminJobItem>>(`/api/admin/jobs${query(params)}`, {
    signal,
  });
  return data;
}

export async function fetchAdminSystemHealth(signal?: AbortSignal) {
  const { data } = await api.get<AdminSystemHealth>("/api/admin/system-health", { signal });
  return data;
}
