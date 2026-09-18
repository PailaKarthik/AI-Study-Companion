"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/keys";
import {
  fetchAdminActivity,
  fetchAdminAIEvaluations,
  fetchAdminAIUsage,
  fetchAdminJobs,
  fetchAdminLearning,
  fetchAdminOverview,
  fetchAdminProjects,
  fetchAdminSpaces,
  fetchAdminSystemHealth,
  fetchAdminUser,
  fetchAdminUsers,
  type AdminActivityParams,
  type AdminAIUsageParams,
  type AdminJobsParams,
  type AdminListParams,
  type DateRange,
} from "./api";

/**
 * Admin hooks. All queries hit requireAdmin endpoints — non-admins get
 * 403s rendered as error states (the route itself is also guarded by
 * RequireAdmin). Paginated hooks keep previous data across page turns.
 */
export function useAdminOverview(range: DateRange = {}) {
  return useQuery({
    queryKey: queryKeys.adminOverview(range),
    queryFn: ({ signal }) => fetchAdminOverview(range, signal),
    retry: false,
  });
}

export function useAdminUsers(params: AdminListParams & { role?: string } = {}) {
  return useQuery({
    queryKey: queryKeys.adminUsers(params),
    queryFn: ({ signal }) => fetchAdminUsers(params, signal),
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useAdminUser(userId: string | null) {
  return useQuery({
    queryKey: queryKeys.adminUser(userId ?? "none"),
    queryFn: ({ signal }) => fetchAdminUser(userId as string, signal),
    enabled: userId !== null,
    retry: false,
  });
}

export function useAdminSpaces(params: AdminListParams = {}) {
  return useQuery({
    queryKey: queryKeys.adminSpaces(params),
    queryFn: ({ signal }) => fetchAdminSpaces(params, signal),
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useAdminProjects(params: AdminListParams = {}) {
  return useQuery({
    queryKey: queryKeys.adminProjects(params),
    queryFn: ({ signal }) => fetchAdminProjects(params, signal),
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useAdminActivity(params: AdminActivityParams = {}) {
  return useQuery({
    queryKey: queryKeys.adminActivity(params),
    queryFn: ({ signal }) => fetchAdminActivity(params, signal),
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useAdminLearning(range: DateRange = {}) {
  return useQuery({
    queryKey: queryKeys.adminLearning(range),
    queryFn: ({ signal }) => fetchAdminLearning(range, signal),
    retry: false,
  });
}

export function useAdminAIUsage(params: AdminAIUsageParams = {}) {
  return useQuery({
    queryKey: queryKeys.adminAIUsage(params),
    queryFn: ({ signal }) => fetchAdminAIUsage(params, signal),
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useAdminAIEvaluations(
  params: AdminListParams & { feature?: string; sort?: string } = {}
) {
  return useQuery({
    queryKey: queryKeys.adminAIEvaluations(params),
    queryFn: ({ signal }) => fetchAdminAIEvaluations(params, signal),
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useAdminJobs(params: AdminJobsParams = {}) {
  return useQuery({
    queryKey: queryKeys.adminJobs(params),
    queryFn: ({ signal }) => fetchAdminJobs(params, signal),
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useAdminSystemHealth() {
  return useQuery({
    queryKey: queryKeys.adminSystemHealth,
    queryFn: ({ signal }) => fetchAdminSystemHealth(signal),
    retry: false,
  });
}
