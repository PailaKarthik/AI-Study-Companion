"use client";

import { useState } from "react";
import { Bot, Receipt } from "lucide-react";
import { SectionCard } from "@/components/shared/cards";
import { EmptyState, ErrorState, PageLoading } from "@/components/shared/states";
import { AdminTableSkeleton } from "@/components/shared/skeletons";
import { StatusBadge } from "@/components/shared/status";
import { Badge } from "@/components/ui/badge";
import { statusOf } from "@/lib/api/http-status";
import { useAdminAIEvaluations, useAdminAIUsage } from "../hooks";
import { ALL_OPTION, Pager, SelectFilter } from "./filters";

const FEATURES = [
  "TUTOR",
  "QUIZ_GENERATION",
  "ASSESSMENT",
  "RECOMMENDATION",
  "EMBEDDING",
  "DOCUMENT_UNDERSTANDING",
  "EVALUATION",
] as const;

function cost(value: number | null): string {
  return value === null ? "unavailable" : `$${value.toFixed(6)}`;
}

/** AI call ledger with provider/feature/status filters. */
export function AIUsageSection() {
  const [page, setPage] = useState(1);
  const [feature, setFeature] = useState("");
  const [provider, setProvider] = useState("");
  const [status, setStatus] = useState("");
  const usage = useAdminAIUsage({
    page,
    pageSize: 15,
    feature: feature || undefined,
    provider: provider || undefined,
    status: status || undefined,
  });

  return (
    <SectionCard
      title="AI usage"
      description="Every provider call with tokens, latency, and estimated cost."
      icon={Receipt}
    >
      <div className="mb-4 flex flex-wrap gap-3">
        <SelectFilter
          id="admin-usage-feature"
          label="Feature"
          value={feature}
          options={[ALL_OPTION, ...FEATURES.map((f) => ({ value: f, label: f.toLowerCase() }))]}
          onChange={(value) => {
            setFeature(value);
            setPage(1);
          }}
        />
        <SelectFilter
          id="admin-usage-provider"
          label="Provider"
          value={provider}
          options={[
            ALL_OPTION,
            { value: "GROQ", label: "Groq" },
            { value: "GEMINI", label: "Gemini" },
            { value: "SYSTEM", label: "System" },
          ]}
          onChange={(value) => {
            setProvider(value);
            setPage(1);
          }}
        />
        <SelectFilter
          id="admin-usage-status"
          label="Status"
          value={status}
          options={[
            ALL_OPTION,
            { value: "SUCCESS", label: "Success" },
            { value: "FAILED", label: "Failed" },
            { value: "TIMEOUT", label: "Timeout" },
          ]}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
        />
      </div>
      {usage.isPending ? (
        <PageLoading label="Loading AI usage…" />
      ) : usage.isError ? (
        <ErrorState status={statusOf(usage.error)} onRetry={() => usage.refetch()} />
      ) : usage.data.items.length === 0 ? (
        <EmptyState title="No AI calls found" message="Adjust the filters." />
      ) : (
        <div className="flex flex-col gap-3">
          <ul className="flex flex-col gap-2">
            {usage.data.items.map((row) => (
              <li
                key={row.id}
                className="flex flex-col gap-1 rounded-xl border px-4 py-2.5 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone={row.status === "SUCCESS" ? "success" : "danger"}>
                    {row.status.toLowerCase()}
                  </StatusBadge>
                  <span className="font-medium">{row.feature.toLowerCase()}</span>
                  <span className="text-muted-foreground">
                    {row.provider.toLowerCase()} · {row.model}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {row.totalTokens ?? 0} tokens · {row.latencyMs ?? "—"}ms · est.{" "}
                  {cost(row.estimatedCostUsd)} · {new Date(row.createdAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
          <Pager
            page={usage.data.page}
            pageSize={usage.data.pageSize}
            total={usage.data.total}
            onPage={setPage}
          />
        </div>
      )}
    </SectionCard>
  );
}

/** Quality evaluations with available-metric keys (values stay server-side). */
export function AIEvaluationsSection() {
  const [page, setPage] = useState(1);
  const [feature, setFeature] = useState("");
  const evals = useAdminAIEvaluations({
    page,
    pageSize: 15,
    feature: feature || undefined,
  });

  return (
    <SectionCard
      title="AI evaluations"
      description="Deterministic quality checks; missing metrics show as unavailable."
      icon={Bot}
    >
      <div className="mb-4 flex flex-wrap gap-3">
        <SelectFilter
          id="admin-evals-feature"
          label="Feature"
          value={feature}
          options={[ALL_OPTION, ...FEATURES.map((f) => ({ value: f, label: f.toLowerCase() }))]}
          onChange={(value) => {
            setFeature(value);
            setPage(1);
          }}
        />
      </div>
      {evals.isPending ? (
        <PageLoading label="Loading evaluations…" />
      ) : evals.isError ? (
        <ErrorState status={statusOf(evals.error)} onRetry={() => evals.refetch()} />
      ) : evals.data.items.length === 0 ? (
        <EmptyState
          title="No evaluations yet"
          message="Tutor answers, attempts, quizzes, and recommendations are evaluated asynchronously once the worker runs."
        />
      ) : (
        <div className="flex flex-col gap-3">
          <ul className="flex flex-col gap-2">
            {evals.data.items.map((row) => (
              <li
                key={row.id}
                className="flex flex-col gap-1 rounded-xl border px-4 py-2.5 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{row.feature.toLowerCase()}</span>
                  <Badge variant="outline">{row.evaluator ?? "unknown evaluator"}</Badge>
                </div>
                <span className="text-xs text-muted-foreground">
                  {row.targetType ?? "untargeted"} · {new Date(row.createdAt).toLocaleString()}
                </span>
                <span className="text-xs text-muted-foreground">
                  Metrics: {row.scoreKeys.length > 0 ? row.scoreKeys.join(", ") : "unavailable"}
                </span>
              </li>
            ))}
          </ul>
          <Pager
            page={evals.data.page}
            pageSize={evals.data.pageSize}
            total={evals.data.total}
            onPage={setPage}
          />
        </div>
      )}
    </SectionCard>
  );
}
