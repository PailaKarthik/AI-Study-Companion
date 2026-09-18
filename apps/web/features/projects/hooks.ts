"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateProjectInput, UpdateProjectInput } from "@ai-study-companion/validation";
import { queryKeys } from "@/lib/query/keys";
import {
  createProjectRequest,
  deleteProjectRequest,
  fetchProject,
  fetchProjectOverview,
  fetchProjectStatusCounts,
  fetchProjects,
  updateProjectRequest,
  type ProjectListParams,
} from "./api";

export function useProjects(spaceId: string, params: ProjectListParams = {}) {
  const { page = 1, pageSize = 20, q, status } = params;
  const scoped = { page, pageSize, ...(q ? { q } : {}), ...(status ? { status } : {}) };
  return useQuery({
    queryKey: queryKeys.projects(spaceId, scoped),
    queryFn: ({ signal }) => fetchProjects(spaceId, scoped, signal),
    placeholderData: (previous) => previous,
  });
}

/** Live per-status counts; invalidated alongside every project mutation. */
export function useProjectStatusCounts(spaceId: string) {
  return useQuery({
    queryKey: queryKeys.projectStatusCounts(spaceId),
    queryFn: ({ signal }) => fetchProjectStatusCounts(spaceId, signal),
    retry: false,
  });
}

export function useProject(projectId: string) {
  return useQuery({
    queryKey: queryKeys.project(projectId),
    queryFn: ({ signal }) => fetchProject(projectId, signal),
    retry: false,
  });
}

export function useProjectOverview(projectId: string) {
  return useQuery({
    queryKey: queryKeys.projectOverview(projectId),
    queryFn: ({ signal }) => fetchProjectOverview(projectId, signal),
    retry: false,
  });
}

export function useCreateProject(spaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProjectInput) => createProjectRequest(spaceId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["spaces", spaceId, "projects"] });
      void queryClient.invalidateQueries({ queryKey: ["spaces", spaceId] });
      void queryClient.invalidateQueries({ queryKey: ["spaces"] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.home });
    },
  });
}

export function useUpdateProject(projectId: string, spaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateProjectInput) => updateProjectRequest(projectId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectOverview(projectId) });
      void queryClient.invalidateQueries({ queryKey: ["spaces", spaceId, "projects"] });
      void queryClient.invalidateQueries({ queryKey: ["spaces", spaceId] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.home });
    },
  });
}

export function useDeleteProject(spaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string) => deleteProjectRequest(projectId),
    onSuccess: (_data, projectId) => {
      queryClient.removeQueries({ queryKey: queryKeys.project(projectId) });
      queryClient.removeQueries({ queryKey: queryKeys.projectOverview(projectId) });
      void queryClient.invalidateQueries({ queryKey: ["spaces", spaceId, "projects"] });
      void queryClient.invalidateQueries({ queryKey: ["spaces", spaceId] });
      void queryClient.invalidateQueries({ queryKey: ["spaces"] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.home });
    },
  });
}
