"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateSpaceInput, UpdateSpaceInput } from "@ai-study-companion/validation";
import { queryKeys } from "@/lib/query/keys";
import {
  createSpaceRequest,
  deleteSpaceRequest,
  fetchSpace,
  fetchSpaces,
  updateSpaceRequest,
  type SpaceListParams,
} from "./api";

export function useSpaces(params: SpaceListParams = {}) {
  const { page = 1, pageSize = 20, q } = params;
  return useQuery({
    queryKey: queryKeys.spaces({ page, pageSize, ...(q ? { q } : {}) }),
    queryFn: ({ signal }) => fetchSpaces({ page, pageSize, ...(q ? { q } : {}) }, signal),
    placeholderData: (previous) => previous,
  });
}

export function useSpace(spaceId: string) {
  return useQuery({
    queryKey: queryKeys.space(spaceId),
    queryFn: ({ signal }) => fetchSpace(spaceId, signal),
    retry: false,
  });
}

export function useCreateSpace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSpaceInput) => createSpaceRequest(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["spaces"] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.home });
    },
  });
}

export function useUpdateSpace(spaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateSpaceInput) => updateSpaceRequest(spaceId, input),
    onSuccess: (space) => {
      queryClient.setQueryData(queryKeys.space(spaceId), space);
      void queryClient.invalidateQueries({ queryKey: ["spaces"] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.home });
    },
  });
}

export function useDeleteSpace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (spaceId: string) => deleteSpaceRequest(spaceId),
    onSuccess: (_data, spaceId) => {
      queryClient.removeQueries({ queryKey: queryKeys.space(spaceId) });
      void queryClient.invalidateQueries({ queryKey: ["spaces"] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.home });
    },
  });
}
