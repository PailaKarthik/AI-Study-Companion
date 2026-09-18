import type { CreateProjectInput, UpdateProjectInput } from "@ai-study-companion/validation";
import type {
  Paginated,
  ProjectDetail,
  ProjectOverview,
  ProjectStatus,
  ProjectStatusCounts,
  ProjectSummary,
} from "@ai-study-companion/shared";
import { api } from "@/lib/api/client";

export type ProjectStatusFilter = ProjectStatus | "ALL";

export interface ProjectListParams {
  page?: number;
  pageSize?: number;
  q?: string;
  status?: ProjectStatus;
}

function toSearch(params: ProjectListParams): string {
  const search = new URLSearchParams();
  if (params.page !== undefined) search.set("page", String(params.page));
  if (params.pageSize !== undefined) search.set("pageSize", String(params.pageSize));
  if (params.q) search.set("q", params.q);
  if (params.status) search.set("status", params.status);
  const query = search.toString();
  return query ? `?${query}` : "";
}

export async function fetchProjects(
  spaceId: string,
  params: ProjectListParams,
  signal?: AbortSignal
) {
  const { data } = await api.get<Paginated<ProjectSummary>>(
    `/api/spaces/${spaceId}/projects${toSearch(params)}`,
    { signal }
  );
  return data;
}

/** Real per-status counts for the All/Active/Completed/Archived filter. */
export async function fetchProjectStatusCounts(spaceId: string, signal?: AbortSignal) {
  const { data } = await api.get<ProjectStatusCounts>(
    `/api/spaces/${spaceId}/projects/counts`,
    { signal }
  );
  return data;
}

export async function fetchProject(projectId: string, signal?: AbortSignal) {
  const { data } = await api.get<ProjectDetail>(`/api/projects/${projectId}`, { signal });
  return data;
}

export async function fetchProjectOverview(projectId: string, signal?: AbortSignal) {
  const { data } = await api.get<ProjectOverview>(`/api/projects/${projectId}/overview`, {
    signal,
  });
  return data;
}

export async function createProjectRequest(spaceId: string, input: CreateProjectInput) {
  const { data } = await api.post<ProjectSummary>(`/api/spaces/${spaceId}/projects`, input);
  return data;
}

export async function updateProjectRequest(projectId: string, input: UpdateProjectInput) {
  const { data } = await api.patch<ProjectSummary>(`/api/projects/${projectId}`, input);
  return data;
}

export async function deleteProjectRequest(projectId: string) {
  const { data } = await api.delete<{ id: string }>(`/api/projects/${projectId}`);
  return data;
}
