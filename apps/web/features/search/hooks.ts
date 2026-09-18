"use client";

import { useMutation } from "@tanstack/react-query";
import { searchProjectRequest, type ProjectSearchParams } from "./api";

/**
 * Project evidence search. A mutation (not a cached query): every submit
 * hits POST /api/projects/:id/search fresh, scoped server-side to the
 * caller's project. No client-side filtering, no mock results.
 */
export function useProjectSearch(projectId: string) {
  return useMutation({
    mutationFn: (params: ProjectSearchParams) => searchProjectRequest(projectId, params),
    retry: false,
  });
}
