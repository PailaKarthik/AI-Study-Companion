"use client";

import { useMemo, useState } from "react";
import { BookOpenText, MessagesSquare, ShieldCheck, Users } from "lucide-react";
import { SectionCard, StatCard } from "@/components/shared/cards";
import { ActivityBars, DistributionBars } from "@/components/shared/charts";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { AdminOverviewSkeleton } from "@/components/shared/skeletons";
import { HealthDot, jobStatusTone } from "@/components/shared/status";
import { Button } from "@/components/ui/button";
import { statusOf } from "@/lib/api/http-status";
import { hourTruncatedFrom } from "@/lib/query/range";
import { useAdminOverview, useAdminSystemHealth } from "../hooks";

const RANGES = [
  { id: "7d", label: "7 days", days: 7 },
  { id: "30d", label: "30 days", days: 30 },
  { id: "90d", label: "90 days", days: 90 },
] as const;

function cost(value: number | null): string {
  return value === null ? "—" : `$${value.toFixed(4)}`;
}

/** System-wide counts: users, content, learning, AI spend, jobs. */
export function OverviewSection() {
  const [rangeId, setRangeId] = useState<(typeof RANGES)[number]["id"]>("30d");
  const days = RANGES.find((r) => r.id === rangeId)?.days ?? 30;
  // Memoized + hour-truncated for a stable query key (see lib/query/range).
  const range = useMemo(() => hourTruncatedFrom(days), [days]);
  const overview = useAdminOverview(range);

  if (overview.isPending) return <AdminOverviewSkeleton />;
  if (overview.isError) {
    return <ErrorState status={statusOf(overview.error)} onRetry={() => overview.refetch()} />;
  }
  const data = overview.data;

  return (
    <div className="flex flex-col gap-4">
      <AdminHero />
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Date range">
        {RANGES.map((range) => (
          <Button
            key={range.id}
            type="button"
            size="sm"
            variant={rangeId === range.id ? "default" : "outline"}
            aria-pressed={rangeId === range.id}
            onClick={() => setRangeId(range.id)}
          >
            {range.label}
          </Button>
        ))}
      </div>

      <div className="grid items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          tone="dark"
          className="h-full"
          href="?section=users"
          label="Users"
          value={String(data.users.total)}
          hint={`${data.users.active} active · ${data.users.recent} new (7d)`}
          icon={Users}
        />
        <StatCard
          tone="dark"
          className="h-full"
          label="Spaces / projects"
          value={`${data.spaces.total} / ${data.spaces.projects}`}
          hint="Totals across all users"
          icon={BookOpenText}
        />
        <StatCard
          tone="dark"
          className="h-full"
          href="?section=jobs"
          label="Materials"
          value={String(data.materials.uploaded)}
          hint={`${data.materials.ready} ready · ${data.materials.processing} processing · ${data.materials.failed} failed`}
        />
        <StatCard
          tone="dark"
          className="h-full"
          href="?section=learning"
          label="Learning days"
          value={String(data.learning.activeDays)}
          hint={`${data.learning.tutorInteractions} tutor turns · ${data.learning.quizAttempts} attempts`}
          icon={MessagesSquare}
        />
      </div>

      <div className="grid items-stretch gap-4 lg:grid-cols-2">
        <SectionCard
          className="h-full"
          title="AI usage"
          description="Provider calls, tokens, and estimated spend in range."
        >
          {data.ai.calls === 0 ? (
            <EmptyState
              title="No AI calls yet"
              message="Tutor turns, quiz generation, and embeddings will appear here."
            />
          ) : (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-2xl font-semibold tabular-nums">{data.ai.calls}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {data.ai.successful} ok · {data.ai.failed} failed
                  </p>
                </div>
                <div>
                  <p className="text-2xl font-semibold tabular-nums">
                    {cost(data.ai.estimatedCostUsd)}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Estimated spend ·{" "}
                    {(data.ai.inputTokens + data.ai.outputTokens).toLocaleString()} tokens
                  </p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                Avg latency{" "}
                {data.ai.averageLatencyMs === null
                  ? "—"
                  : `${Math.round(data.ai.averageLatencyMs)}ms`}
              </p>
            </div>
          )}
        </SectionCard>
        <SectionCard className="h-full" title="Background jobs" description="Persisted job outcomes in range.">
          {data.jobs.queued + data.jobs.processing + data.jobs.completed + data.jobs.failed ===
          0 ? (
            <EmptyState
              title="No jobs yet"
              message="Knowledge processing jobs will appear here once materials are indexed."
            />
          ) : (
            <DistributionBars
              ariaLabel="Background job outcomes"
              slices={[
                { label: "Completed", value: data.jobs.completed, tone: "success" },
                { label: "Processing", value: data.jobs.processing, tone: "info" },
                { label: "Queued", value: data.jobs.queued, tone: "warning" },
                { label: "Failed", value: data.jobs.failed, tone: "danger" },
              ]}
            />
          )}
          {data.jobs.failureRate !== null ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Failure rate {Math.round(data.jobs.failureRate * 100)}%
              {data.jobs.averageDurationMs !== null
                ? ` · avg duration ${Math.round(data.jobs.averageDurationMs)}ms`
                : ""}
            </p>
          ) : null}
        </SectionCard>
      </div>
    </div>
  );
}

/**
 * Hero status banner: dark gradient, platform name, and LIVE service
 * health dots from /ready — every dot reflects a real check, and the
 * banner degrades to a plain title while health loads or fails.
 */
function AdminHero() {
  const health = useAdminSystemHealth();
  const dots =
    health.data !== undefined
      ? [
          { label: `API ${health.data.status}`, tone: jobStatusTone(health.data.status) },
          {
            label: `Database ${health.data.services.database.status}`,
            tone: jobStatusTone(health.data.services.database.status),
          },
          {
            label: `Redis ${health.data.services.redis.status}`,
            tone: jobStatusTone(health.data.services.redis.status),
          },
          {
            label: `Worker ${health.data.services.worker.status}`,
            tone: jobStatusTone(health.data.services.worker.status),
          },
        ]
      : [];
  return (
    <div className="relative overflow-hidden rounded-3xl bg-slate-950 p-6 text-slate-100 sm:p-8 dark:bg-white dark:text-slate-950">
      <div className="relative flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10">
            <ShieldCheck className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <p className="text-lg font-semibold tracking-tight">Platform Overview</p>
            <p className="text-sm text-slate-300">AI Study Companion · live system status</p>
          </div>
        </div>
        {health.isPending ? (
          <p className="text-sm text-slate-400" role="status">
            Checking services…
          </p>
        ) : health.isError ? (
          <p className="text-sm text-slate-400" role="status">
            Live status unavailable — see the Health tab for details.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-x-5 gap-y-2 [&_span]:!text-slate-200">
            {dots.map((dot) => (
              <li key={dot.label}>
                <HealthDot tone={dot.tone} label={dot.label} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
