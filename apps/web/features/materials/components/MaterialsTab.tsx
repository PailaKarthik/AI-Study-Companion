"use client";

import { useRef, useState } from "react";
import { Check, Circle, Download, FileText, RefreshCw, Trash2, Upload, X } from "lucide-react";
import { ApiErrorAlert } from "@/components/shared/api-error-alert";
import { EmptyState, ErrorState, LoadingBar, Spinner } from "@/components/shared/states";
import { MaterialsSkeleton } from "@/components/shared/skeletons";
import {
  StatusBadge,
  docStatusTone,
  knowledgeStatusTone,
} from "@/components/shared/status";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ApiClientError, toUserMessage } from "@/lib/api/errors";
import {
  useDeleteMaterial,
  useProjectMaterials,
  useReindexMaterial,
  useReprocessMaterial,
  useUploadMaterial,
} from "../hooks";
import { MAX_UPLOAD_BYTES, materialFileUrl, type MaterialItem } from "../api";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Materials tab: real PDF upload → object-storage pipeline (queued →
 * extraction/OCR → ready) → knowledge indexing, with view/download,
 * extracted-image counts, retry, delete. Every row comes from
 * GET …/materials; the server owns validation, dedup, and bytes — the
 * UI never fabricates state. The list polls while any material is
 * mid-pipeline so Upload → Ready renders live.
 */
export function MaterialsTab({ projectId }: { projectId: string }) {
  const materials = useProjectMaterials(projectId);
  const upload = useUploadMaterial(projectId);
  const remove = useDeleteMaterial(projectId);
  const reindex = useReindexMaterial(projectId);
  const reprocess = useReprocessMaterial(projectId);
  const [localError, setLocalError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [uploadingName, setUploadingName] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    // UX pre-checks only; the server revalidates everything (magic
    // bytes, size ceiling, checksum dedup) and is always authoritative.
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      setLocalError("Only PDF files are accepted.");
      return;
    }
    if (file.size === 0) {
      setLocalError("That file is empty.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setLocalError(
        `That file is ${formatBytes(file.size)}; uploads are capped at ${formatBytes(MAX_UPLOAD_BYTES)}.`
      );
      return;
    }
    setLocalError(null);
    setUploadingName(file.name);
    try {
      await upload.mutateAsync(file);
    } catch {
      // Displayed via the shared error alert below.
    } finally {
      setUploadingName(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleDelete(materialId: string) {
    try {
      await remove.mutateAsync(materialId);
      setConfirmId(null);
    } catch {
      // Displayed via the shared error alert below.
    }
  }

  async function handleRetry(material: MaterialItem) {
    try {
      // Document failures re-run extraction (reprocess); a READY
      // document with failed knowledge just rebuilds the index.
      if (material.status === "FAILED") {
        await reprocess.mutateAsync(material.id);
      } else {
        await reindex.mutateAsync(material.id);
      }
    } catch {
      // Displayed via the shared error alert below.
    }
  }

  const mutationError = upload.error ?? remove.error ?? reindex.error ?? reprocess.error;
  const busy = upload.isPending || remove.isPending || reindex.isPending || reprocess.isPending;

  return (
    <div className="flex flex-col gap-4">
      <div
        className={`flex flex-col gap-3 rounded-2xl border border-dashed p-4 transition-colors sm:flex-row sm:items-center sm:justify-between ${
          dragActive ? "border-slate-500 bg-slate-500/[0.06]" : "border-slate-300 bg-muted/20 dark:border-slate-700"
        }`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragActive(false);
          void handleFile(event.dataTransfer.files?.[0]);
        }}
        aria-label="Upload PDFs by dropping files or choosing them"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-white dark:bg-white dark:text-slate-950">
            <FileText className="h-5 w-5" aria-hidden />
          </span>
          <div className="flex min-w-0 flex-col">
            <p className="text-sm font-medium">
              {dragActive ? "Drop the PDF to upload" : "Drag a PDF here, or choose a file"}
            </p>
            <p className="text-xs text-muted-foreground">
              Stored securely · queued for extraction & indexing · max {formatBytes(MAX_UPLOAD_BYTES)}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            aria-label="Choose a PDF to upload"
            disabled={upload.isPending}
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />
          <Button
            type="button"
            size="sm"
            disabled={upload.isPending}
            onClick={() => fileRef.current?.click()}
          >
            {upload.isPending ? (
              <>
                <Spinner className="mr-2" label="Uploading…" /> Uploading…
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" aria-hidden /> Upload PDF
              </>
            )}
          </Button>
        </div>
      </div>

      {localError ? (
        <p role="alert" className="text-sm text-destructive">
          {localError}
        </p>
      ) : null}
      {mutationError ? (
        <ApiErrorAlert
          message={toUserMessage(mutationError)}
          requestId={mutationError instanceof ApiClientError ? mutationError.requestId : undefined}
        />
      ) : null}

      {materials.isPending ? <MaterialsSkeleton /> : null}
      {materials.isError ? (
        <ErrorState
          status={materials.error instanceof ApiClientError ? materials.error.status : undefined}
          title="Couldn't load materials"
          onRetry={() => void materials.refetch()}
        />
      ) : null}

      {upload.isPending && uploadingName ? (
        <Card aria-live="polite">
          <CardContent className="flex flex-col gap-2 pt-6">
            <div className="flex items-center gap-2">
              <Spinner label={`Uploading ${uploadingName}…`} />
              <p className="truncate text-sm font-medium">{uploadingName}</p>
            </div>
            <LoadingBar label={`Uploading ${uploadingName}`} />
            <p className="text-xs text-muted-foreground">Uploading… extraction starts next.</p>
          </CardContent>
        </Card>
      ) : null}

      {materials.data && materials.data.items.length === 0 && !upload.isPending ? (
        <EmptyState
          title="No learning materials yet"
          message="Upload a PDF to give the tutor something to ground answers in."
        />
      ) : null}

      {materials.data && materials.data.items.length > 0 ? (
        <div className="flex flex-col gap-3" aria-live="polite">
          {materials.data.items.map((material) => (
            <MaterialCard
              key={material.id}
              material={material}
              busy={busy}
              confirming={confirmId === material.id}
              onConfirm={() => setConfirmId(material.id)}
              onCancelConfirm={() => setConfirmId(null)}
              onDelete={() => void handleDelete(material.id)}
              onRetry={() => void handleRetry(material)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function MaterialCard({
  material,
  busy,
  confirming,
  onConfirm,
  onCancelConfirm,
  onDelete,
  onRetry,
}: {
  material: MaterialItem;
  busy: boolean;
  confirming: boolean;
  onConfirm: () => void;
  onCancelConfirm: () => void;
  onDelete: () => void;
  onRetry: () => void;
}) {
  const failed = material.knowledgeStatus === "FAILED" || material.status === "FAILED";
  const documentFailed = material.status === "FAILED";
  const doc = docStatusTone(material.status);
  const know = knowledgeStatusTone(material.knowledgeStatus);
  const docActive = material.status === "QUEUED" || material.status === "PROCESSING";
  const knowledgeActive =
    material.knowledgeStatus === "QUEUED" || material.knowledgeStatus === "PROCESSING";
  const pipelineActive = docActive || knowledgeActive;
  const stageLabel = docActive
    ? material.status === "QUEUED"
      ? "Queued for text extraction…"
      : "Extracting text & images…"
    : knowledgeActive
      ? material.knowledgeStatus === "QUEUED"
        ? "Queued for knowledge indexing…"
        : "Indexing knowledge…"
      : null;
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <p className="flex items-center gap-1.5 truncate text-sm font-medium">
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-label="PDF document" />
            <span className="truncate">{material.filename}</span>
          </p>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <StatusBadge tone={doc.tone} pulse={doc.live}>
              {doc.label}
            </StatusBadge>
            <StatusBadge tone={know.tone} pulse={know.live}>
              {know.label}
            </StatusBadge>
            <span>{formatBytes(material.sizeBytes)}</span>
            {material.pageCount !== null ? <span>{material.pageCount} pages</span> : null}
            {material.chunkCount > 0 ? <span>{material.chunkCount} chunks</span> : null}
            {material.imageCount > 0 ? <span>{material.imageCount} images</span> : null}
            {!material.hasFile ? <span>file missing — re-upload required</span> : null}
          </div>
          {pipelineActive && stageLabel ? (
            <div className="flex min-w-0 flex-col gap-1.5 pt-1" aria-live="polite">
              <PipelineSteps
                docState={
                  material.status === "FAILED"
                    ? "failed"
                    : material.status === "READY"
                      ? "done"
                      : docActive
                        ? "active"
                        : "waiting"
                }
                knowledgeState={
                  material.knowledgeStatus === "FAILED"
                    ? "failed"
                    : material.knowledgeStatus === "READY"
                      ? "done"
                      : knowledgeActive
                        ? "active"
                        : "waiting"
                }
              />
              <LoadingBar label={stageLabel} />
              <p className="text-xs text-muted-foreground">{stageLabel}</p>
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {material.hasFile ? (
            <Button type="button" size="sm" variant="outline" asChild>
              <a href={materialFileUrl(material.id)} target="_blank" rel="noreferrer">
                <Download className="mr-2 h-4 w-4" aria-hidden /> View
              </a>
            </Button>
          ) : null}
          {failed ? (
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onRetry}>
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden />{" "}
              {documentFailed ? "Retry extraction" : "Retry indexing"}
            </Button>
          ) : null}
          {confirming ? (
            <>
              <span className="text-xs text-muted-foreground">Delete this material?</span>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={busy}
                onClick={onDelete}
              >
                Confirm
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={onCancelConfirm}
              >
                Keep
              </Button>
            </>
          ) : (
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onConfirm}>
              <Trash2 className="mr-2 h-4 w-4" aria-hidden /> Delete
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** Two-stage pipeline stepper: extraction → knowledge index. */
function PipelineSteps({
  docState,
  knowledgeState,
}: {
  docState: "waiting" | "active" | "done" | "failed";
  knowledgeState: "waiting" | "active" | "done" | "failed";
}) {
  return (
    <ol className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <PipelineStep label="Extraction" state={docState} />
      <span className="text-muted-foreground" aria-hidden>
        →
      </span>
      <PipelineStep label="Knowledge index" state={knowledgeState} />
    </ol>
  );
}

function PipelineStep({
  label,
  state,
}: {
  label: string;
  state: "waiting" | "active" | "done" | "failed";
}) {
  return (
    <li className="flex items-center gap-1.5 text-muted-foreground">
      {state === "done" ? (
        <Check className="h-3.5 w-3.5 text-primary" aria-hidden />
      ) : state === "active" ? (
        <Spinner label={`${label} in progress`} />
      ) : state === "failed" ? (
        <X className="h-3.5 w-3.5 text-destructive" aria-hidden />
      ) : (
        <Circle className="h-3.5 w-3.5 opacity-40" aria-hidden />
      )}
      <span className={state === "active" ? "font-medium text-foreground" : undefined}>
        {label}
      </span>
    </li>
  );
}
