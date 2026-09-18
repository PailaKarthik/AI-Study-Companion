"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/keys";
import {
  deleteMaterialRequest,
  fetchMaterialImages,
  fetchProjectMaterials,
  reindexMaterialRequest,
  reprocessMaterialRequest,
  uploadMaterialRequest,
  type MaterialItem,
} from "./api";

/** Poll while any material is mid-pipeline so Upload → Ready renders live. */
function isPipelineActive(items: MaterialItem[] | undefined): boolean {
  if (!items) return false;
  return items.some(
    (m) =>
      m.status === "QUEUED" ||
      m.status === "PROCESSING" ||
      m.knowledgeStatus === "QUEUED" ||
      m.knowledgeStatus === "PROCESSING"
  );
}

/**
 * Materials hooks. List is server-paginated; mutations invalidate the
 * project list + overview/home/analytics consumers (uploads write
 * activity consumed by all of them). The list polls every 3s while any
 * material is mid-pipeline so processing progress renders without a
 * manual refresh (polling stops when everything settles).
 */
export function useProjectMaterials(projectId: string) {
  return useQuery({
    queryKey: queryKeys.materials(projectId),
    queryFn: ({ signal }) => fetchProjectMaterials(projectId, signal),
    retry: false,
    refetchInterval: (query) => (isPipelineActive(query.state.data?.items) ? 3000 : false),
  });
}

function invalidateMaterials(queryClient: ReturnType<typeof useQueryClient>, projectId: string) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.materials(projectId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.projectOverview(projectId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.home });
  void queryClient.invalidateQueries({ queryKey: ["projects", projectId, "analytics"] });
}

export function useUploadMaterial(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => uploadMaterialRequest(projectId, file),
    retry: false,
    onSuccess: () => invalidateMaterials(queryClient, projectId),
  });
}

export function useDeleteMaterial(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (materialId: string) => deleteMaterialRequest(materialId),
    retry: false,
    onSuccess: () => invalidateMaterials(queryClient, projectId),
  });
}

export function useReindexMaterial(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (materialId: string) => reindexMaterialRequest(materialId),
    retry: false,
    onSuccess: () => invalidateMaterials(queryClient, projectId),
  });
}

export function useReprocessMaterial(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (materialId: string) => reprocessMaterialRequest(materialId),
    retry: false,
    onSuccess: () => invalidateMaterials(queryClient, projectId),
  });
}

/** Extracted-image metadata for one material (bytes stay in the bucket). */
export function useMaterialImages(materialId: string | null) {
  return useQuery({
    queryKey: ["materials", materialId, "images"],
    queryFn: ({ signal }) => fetchMaterialImages(materialId as string, signal),
    enabled: materialId !== null,
    retry: false,
  });
}
