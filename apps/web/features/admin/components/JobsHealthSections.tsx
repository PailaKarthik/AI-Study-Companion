"use client";

import { useState } from "react";
import { Database, Cpu, HardDrive, Sparkles, Briefcase, HeartPulse } from "lucide-react";
import { SectionCard, StatCard } from "@/components/shared/cards";
import { Progress } from "@/components/ui/progress";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { AdminTableSkeleton } from "@/components/shared/skeletons";
import { HealthDot, StatusBadge, jobStatusTone } from "@/components/shared/status";
import { statusOf } from "@/lib/api/http-status";
import { useAdminJobs, useAdminSystemHealth } from "../hooks";
import { ALL_OPTION, Pager, SelectFilter } from "./filters";

const STATUSES = ["QUEUED", "PROCESSING", "COMPLETED", "FAILED"] as const;
const TYPES = ["TEXT_EXTRACTION", "CHUNKING", "EMBEDDING", "FULL_INGEST"] as const;

/** Persisted background-job explorer with type/status filters. */
export function JobsSection() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const jobs = useAdminJobs({
    page,
    pageSize: 15,
    status: status || undefined,
    type: type || undefined,
  });

  return (
    <SectionCard
      title="Background jobs"
      description="Durable job history (persisted rows are authoritative; BullMQ holds live depth only)."
      icon={Briefcase}
    >
      <div className="mb-4 flex flex-wrap gap-3">
        <SelectFilter
          id="admin-jobs-status"
          label="Status"
          value={status}
          options={[ALL_OPTION, ...STATUSES.map((s) => ({ value: s, label: s.toLowerCase() }))]}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
        />
        <SelectFilter
          id="admin-jobs-type"
          label="Type"
          value={type}
          options={[ALL_OPTION, ...TYPES.map((t) => ({ value: t, label: t.toLowerCase() }))]}
          onChange={(value) => {
            setType(value);
            setPage(1);
          }}
        />
      </div>
      {jobs.isPending ? (
        <AdminTableSkeleton />
      ) : jobs.isError ? (
        <ErrorState status={statusOf(jobs.error)} onRetry={() => jobs.refetch()} />
      ) : jobs.data.items.length === 0 ? (
        <EmptyState title="No jobs found" message="Adjust the filters." />
      ) : (
        <div className="flex flex-col gap-3">
          <ul className="flex flex-col gap-2">
            {jobs.data.items.map((job) => (
              <li
                key={job.id}
                className="flex flex-col gap-1 rounded-xl border px-4 py-2.5 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone={jobStatusTone(job.status)}>
                    {job.status.toLowerCase()}
                  </StatusBadge>
                  <span className="font-medium">
                    {job.materialName ?? job.materialId.slice(0, 8)} · {job.type.toLowerCase()}
                  </span>
                </div>
                <span className="text-xs tabular-nums text-muted-foreground">
                  Attempt {job.attempts}/{job.maxAttempts}
                  {job.durationMs !== null ? ` · ${Math.round(job.durationMs)}ms` : ""}
                  {" · "}
                  {new Date(job.createdAt).toLocaleString()}
                </span>
                <Progress
                  value={
                    job.maxAttempts > 0
                      ? Math.min(100, Math.round((job.attempts / job.maxAttempts) * 100))
                      : 0
                  }
                  aria-label={`Attempt ${job.attempts} of ${job.maxAttempts}`}
                  className="h-1.5"
                />
                {job.error ? (
                  <span className="text-xs text-destructive">{job.error.slice(0, 300)}</span>
                ) : null}
              </li>
            ))}
          </ul>
          <Pager
            page={jobs.data.page}
            pageSize={jobs.data.pageSize}
            total={jobs.data.total}
            onPage={setPage}
          />
        </div>
      )}
    </SectionCard>
  );
}

/** Lightweight service matrix — presence checks only, never secrets. */
export function SystemHealthSection() {
  const health = useAdminSystemHealth();

  if (health.isPending) return <AdminTableSkeleton rows={6} />;
  if (health.isError) {
    return <ErrorState status={statusOf(health.error)} onRetry={() => health.refetch()} />;
  }
  const data = health.data;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          tone="dark"
          icon={HeartPulse}
          label="Overall"
          value={data.status}
          hint={`API v${data.version}`}
        />
        <StatCard
          label="Database"
          value={
            <HealthDot
              tone={jobStatusTone(data.services.database.status)}
              label={data.services.database.status}
            />
          }
          hint={
            data.services.database.latencyMs !== undefined
              ? `${data.services.database.latencyMs}ms ping`
              : (data.services.database.detail ?? "No detail")
          }
          icon={Database}
        />
        <StatCard
          label="Worker"
          value={
            <HealthDot
              tone={jobStatusTone(data.services.worker.status)}
              label={data.services.worker.status}
            />
          }
          hint={data.services.worker.detail ?? "No job history yet"}
          icon={Cpu}
        />
        <StatCard
          label="Redis"
          value={
            <HealthDot
              tone={jobStatusTone(data.services.redis.status)}
              label={data.services.redis.status}
            />
          }
          hint={data.services.redis.detail}
        />
        <StatCard
          label="Storage"
          value={
            <HealthDot
              tone={jobStatusTone(data.services.storage.status)}
              label={data.services.storage.status}
            />
          }
          hint={data.services.storage.detail ?? ""}
          icon={HardDrive}
        />
        <StatCard
          label="AI providers"
          value={`Groq ${data.services.ai.groq.status === "configured" ? "✓" : "✗"} · Gemini ${
            data.services.ai.gemini.status === "configured" ? "✓" : "✗"
          }`}
          hint="Key presence only — values never leave the server"
          icon={Sparkles}
        />
      </div>
    </div>
  );
}
