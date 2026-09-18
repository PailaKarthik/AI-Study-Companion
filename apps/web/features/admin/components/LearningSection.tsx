"use client";

import { useMemo, useState } from "react";
import { Brain, FileCheck, GraduationCap, Target } from "lucide-react";
import { SectionCard, StatCard } from "@/components/shared/cards";
import { ActivityBars, DistributionBars } from "@/components/shared/charts";
import { EmptyState, ErrorState, PageLoading } from "@/components/shared/states";
import { AdminTableSkeleton } from "@/components/shared/skeletons";
import { Button } from "@/components/ui/button";
import { statusOf } from "@/lib/api/http-status";
import { hourTruncatedFrom } from "@/lib/query/range";
import { useAdminLearning } from "../hooks";

const RANGES = [
  { id: "7d", label: "7 days", days: 7 },
  { id: "30d", label: "30 days", days: 30 },
  { id: "90d", label: "90 days", days: 90 },
] as const;

function rate(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

/** System learning analytics: completion, accuracy, mastery, recs. */
export function LearningSection() {
  const [rangeId, setRangeId] = useState<(typeof RANGES)[number]["id"]>("30d");
  const days = RANGES.find((r) => r.id === rangeId)?.days ?? 30;
  // Memoized + hour-truncated for a stable query key (see lib/query/range).
  const range = useMemo(() => hourTruncatedFrom(days), [days]);
  const learning = useAdminLearning(range);

  if (learning.isPending) return <PageLoading label="Loading learning analytics…" />;
  if (learning.isError) {
    return <ErrorState status={statusOf(learning.error)} onRetry={() => learning.refetch()} />;
  }
  const data = learning.data;

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
          icon={Brain}
          label="Quiz completion"
          value={rate(data.quizzes.completionRate)}
          hint={`${data.quizzes.completed}/${data.quizzes.attempts} attempts finished`}
        />
        <StatCard
          tone="dark"
          icon={Target}
          label="Answer accuracy"
          value={rate(data.accuracy.rate)}
          hint={`${data.accuracy.correct}/${data.accuracy.answered} correct`}
        />
        <StatCard
          tone="dark"
          icon={FileCheck}
          label="Avg assessment score"
          value={data.assessments.averageScore === null ? "—" : rate(data.assessments.averageScore)}
          hint={`${data.assessments.completed} graded evaluations`}
        />
        <StatCard
          tone="dark"
          icon={GraduationCap}
          label="Recommendation completion"
          value={rate(data.recommendations.completionRate)}
          hint={`${data.recommendations.completed}/${data.recommendations.created} finished`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
        title="Mastery distribution"
        description="Assessed concepts by status band."
        icon={GraduationCap}
      >
          <DistributionBars
            ariaLabel="System mastery distribution"
            slices={[
              { label: "Needs attention", value: data.masteryDistribution.needsAttention },
              { label: "Developing", value: data.masteryDistribution.developing },
              { label: "Stable", value: data.masteryDistribution.stable },
              { label: "Strong", value: data.masteryDistribution.strong },
              { label: "Unassessed", value: data.masteryDistribution.unassessed },
            ]}
          />
          <p className="mt-2 text-sm text-muted-foreground">
            {data.improving} concepts improving on average · {data.needingAttention} needing
            attention. Improving counts positive mean deltas (a labeled proxy — full trends live on
            each project's growth board).
          </p>
        </SectionCard>
        <SectionCard title="Activity over time" description="Daily learning events (UTC).">
          <ActivityBars points={data.activityOverTime} ariaLabel="System activity per day" />
        </SectionCard>
      </div>

      <SectionCard
        title="Repeated mistakes"
        description="Persisted recurring-difficulty patterns across learners."
      >
        {data.repeatedMistakes.length === 0 ? (
          <EmptyState
            title="No repeated mistakes"
            message="Multi-attempt weak patterns will appear here when detected."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {data.repeatedMistakes.map((row) => (
              <li
                key={row.conceptId}
                className="flex items-center justify-between gap-3 rounded-xl border px-4 py-2.5 text-sm"
              >
                <span className="truncate font-medium">{row.conceptName}</span>
                <span className="shrink-0 rounded-full bg-slate-950 px-2.5 py-0.5 text-xs font-medium tabular-nums text-white dark:bg-white dark:text-slate-950">
                  {row.incorrectCount} incorrect
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
