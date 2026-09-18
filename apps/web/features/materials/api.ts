import type { Paginated } from "@ai-study-companion/shared";
import { ApiClientError } from "@/lib/api/errors";
import { REQUEST_ID_HEADER, api } from "@/lib/api/client";

export interface MaterialItem {
  id: string;
  projectId: string;
  spaceId: string;
  filename: string;
  status: string;
  knowledgeStatus: string;
  knowledgeUpdatedAt: string | null;
  pageCount: number | null;
  chunkCount: number;
  imageCount: number;
  sizeBytes: number;
  hasFile: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MaterialImageItem {
  id: string;
  materialId: string;
  pageNumber: number | null;
  mimeType: string;
  width: number | null;
  height: number | null;
  sizeBytes: number;
  checksum: string;
  createdAt: string;
}

export interface UploadMaterialResult {
  material: MaterialItem;
  deduplicated: boolean;
  enqueued: boolean;
  jobId: string | null;
}

/** Client-side pre-check ceiling (mirrors the server default; the server enforces). */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

function apiBase(): string {
  const url = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  return url.replace(/\/$/, "");
}

function newRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `web_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function fetchProjectMaterials(projectId: string, signal?: AbortSignal) {
  const { data } = await api.get<Paginated<MaterialItem>>(
    `/api/projects/${projectId}/materials?pageSize=50`,
    { signal }
  );
  return data;
}

/**
 * Raw PDF upload (no multipart parser needed server-side). The File's
 * bytes travel as the request body; the server validates magic bytes,
 * size, and checksum authoritatively — client checks are UX only.
 */
export async function uploadMaterialRequest(
  projectId: string,
  file: File,
  signal?: AbortSignal
): Promise<UploadMaterialResult> {
  const requestId = newRequestId();
  const res = await fetch(
    `${apiBase()}/api/projects/${projectId}/materials?filename=${encodeURIComponent(file.name)}`,
    {
      method: "POST",
      body: file,
      credentials: "include",
      headers: {
        "Content-Type": "application/pdf",
        [REQUEST_ID_HEADER]: requestId,
      },
      signal,
    }
  );
  const responseRequestId = res.headers.get(REQUEST_ID_HEADER) ?? requestId;
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (!res.ok) {
    const envelope = json as {
      error?: { code?: string; message?: string; details?: unknown };
    } | null;
    throw new ApiClientError({
      code: envelope?.error?.code ?? "INTERNAL_ERROR",
      message: envelope?.error?.message ?? `Upload failed with status ${res.status}`,
      status: res.status,
      requestId: responseRequestId,
      details: envelope?.error?.details,
    });
  }
  const envelope = json as { data?: UploadMaterialResult } | null;
  if (!envelope?.data) {
    throw new ApiClientError({
      code: "INTERNAL_ERROR",
      message: "Upload succeeded but returned no material",
      status: 200,
      requestId: responseRequestId,
    });
  }
  return envelope.data;
}

/** Same-origin download URL (session cookie authenticates the navigation). */
export function materialFileUrl(materialId: string): string {
  return `${apiBase()}/api/materials/${materialId}/file`;
}

/** Same-origin extracted-image URL (session cookie authenticates `<img>`). */
export function materialImageFileUrl(materialId: string, imageId: string): string {
  return `${apiBase()}/api/materials/${materialId}/images/${imageId}/file`;
}

export async function fetchMaterialImages(materialId: string, signal?: AbortSignal) {
  const { data } = await api.get<MaterialImageItem[]>(`/api/materials/${materialId}/images`, {
    signal,
  });
  return data;
}

export async function deleteMaterialRequest(materialId: string) {
  const { data } = await api.delete<{ id: string; blobsDeleted: number }>(
    `/api/materials/${materialId}`
  );
  return data;
}

export async function reindexMaterialRequest(materialId: string) {
  const { data } = await api.post<{
    materialId: string;
    knowledgeStatus: string;
    jobId: string | null;
    enqueued: boolean;
  }>(`/api/materials/${materialId}/reindex`);
  return data;
}

export async function reprocessMaterialRequest(materialId: string) {
  const { data } = await api.post<{
    materialId: string;
    status: string;
    jobId: string | null;
    enqueued: boolean;
  }>(`/api/materials/${materialId}/reprocess`);
  return data;
}
