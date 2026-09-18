"use client";

import { useMemo, useState } from "react";
import { Activity, Brain, FileCheck, FileText, MessagesSquare } from "lucide-react";
import { SectionCard, StatCard } from "@/components/shared/cards";
import { ActivityBars, DistributionBars } from "@/components/shared/charts";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { AnalyticsSkeleton } from "@/components/shared/skeletons";
import { Button } from "@/components/ui/button";
import { statusOf } from "@/lib/api/http-status";
import { hourTruncatedFrom } from "@/lib/query/range";
import { useProjectAnalytics } from "../hooks";

const RANGES = [
  { id: "7d", label: "7 days", days: 7 },
  { id: "30d", label: "30 days", days: 30 },
  { id: "90d", label: "90 days", days: 90 },
] as const;

type RangeId = (typeof RANGES)[number]["id"];

function rangeFor(id: RangeId): { from: string } {
  const days = RANGES.find((r) => r.id === id)?.days ?? 30;
  return hourTruncatedFrom(days);
}

function score(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

function eventIcon(eventType: string) {
  if (eventType.startsWith("QUIZ") || eventType.startsWith("ASSESSMENT")) return Brain;
  if (eventType.startsWith("TUTOR")) return MessagesSquare;
  if (eventType.startsWith("MATERIAL") || eventType.startsWith("DOCUMENT")) return FileText;
  return Activity;
}

/**
 * Project analytics tab. Every number comes from GET
 * /api/projects/:id/analytics (PostgreSQL aggregations over persisted
 * rows); ranges switch the UTC window server-side. Empty projects render
 * zero/empty states — never invented activity.
 */
export function AnalyticsTab({ projectId }: { projectId: string }) {
  const [rangeId, setRangeId] = useState<RangeId>("30d");
  // Memoized: a fresh timestamp per render would change the query key and
  // refetch forever. Day-granularity is plenty for UTC buckets.
  const range = useMemo(() => rangeFor(rangeId), [rangeId]);
  const analytics = useProjectAnalytics(projectId, range);

  if (analytics.isPending) {
    return <AnalyticsSkeleton />;
  }
  if (analytics.isError) {
    return <ErrorState status={statusOf(analytics.error)} onRetry={() => analytics.refetch()} />;
  }

  const data = analytics.data;
  const t = data.totals;

  return (
    <div className="flex flex-col gap-4">
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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          tone="dark"
          label="Learning activity"
          value={String(t.activity)}
          hint={`${t.activityDays} active days · ${t.learningStreakDays}-day streak`}
          icon={Activity}
        />
        <StatCard
          tone="dark"
          label="Quiz attempts"
          value={String(t.quizAttempts)}
          hint={`${t.quizzesCompleted} completed · ${t.quizzes} quizzes`}
          icon={Brain}
        />
        <StatCard
          tone="dark"
          label="Avg assessment score"
          value={score(t.averageAssessmentScore)}
          hint={`${t.assessments} graded evaluations`}
          icon={FileCheck}
        />
        <StatCard
          tone="dark"
          label="Materials ready"
          value={String(t.materialsReady)}
          hint={`${t.materials} total · ${t.materialsProcessing} processing · ${t.materialsFailed} failed`}
          icon={FileText}
        />
      </div>

      <SectionCard
        title="Activity over time"
        description="Daily learning events (UTC buckets) in the selected range."
      >
        {t.activity === 0 ? (
          <EmptyState
            title="No activity yet"
            message="Tutor turns, quiz answers, and completed assessments will appear here as daily bars."
          />
        ) : (
          <ActivityBars points={data.activityOverTime} ariaLabel="Learning activity per day" />
        )}
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title="Mastery distribution"
          description="Assessed concepts by status band; unassessed concepts counted separately."
        >
          <DistributionBars
            ariaLabel="Mastery distribution"
            slices={[
              { label: "Strong", value: data.masteryDistribution.strong, tone: "success" },
              { label: "Stable", value: data.masteryDistribution.stable, tone: "info" },
              { label: "Developing", value: data.masteryDistribution.developing, tone: "warning" },
              {
                label: "Needs attention",
                value: data.masteryDistribution.needsAttention,
                tone: "danger",
              },
              { label: "Unassessed", value: data.masteryDistribution.unassessed, tone: "neutral" },
            ]}
          />
        </SectionCard>
        <SectionCard
          title="Recommendations"
          description="Created, completed, and dismissed in range."
        >
          <DistributionBars
            ariaLabel="Recommendation outcomes"
            slices={[
              { label: "Created", value: t.recommendationsCreated, tone: "info" },
              { label: "Completed", value: t.recommendationsCompleted, tone: "success" },
              { label: "Dismissed", value: t.recommendationsDismissed, tone: "neutral" },
            ]}
          />
        </SectionCard>
      </div>

      <SectionCard
        title="Concepts & tutor"
        description="Coverage and grounded help in the selected range."
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-2xl font-semibold tabular-nums">
              {t.conceptsAssessed}/{t.conceptsTracked}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">Concepts assessed / tracked</p>
          </div>
          <div>
            <p className="text-2xl font-semibold tabular-nums">{t.tutorInteractions}</p>
            <p className="mt-1 text-sm text-muted-foreground">Tutor interactions</p>
          </div>
          <div>
            <p className="text-2xl font-semibold tabular-nums">{t.assessments}</p>
            <p className="mt-1 text-sm text-muted-foreground">Graded assessments</p>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Recent activity" description="Latest events in this project.">
        {data.recentActivity.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {data.recentActivity.map((event) => {
              const Icon = eventIcon(event.eventType);
              return (
                <li
                  key={event.id}
                  className="flex items-center justify-between gap-3 rounded-xl border px-4 py-2.5 text-sm"
                >
                  <span className="flex min-w-0 items-center gap-2.5 font-medium">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <Icon className="h-3.5 w-3.5" aria-hidden />
                    </span>
                    <span className="truncate">
                      {event.eventType.replaceAll("_", " ").toLowerCase()}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {new Date(event.createdAt).toLocaleString()}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState preset="analytics" />
        )}
      </SectionCard>
    </div>
  );
}
