"use client";

import { useState } from "react";
import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { SectionCard } from "@/components/shared/cards";
import { DistributionBars } from "@/components/shared/charts";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { GrowthSkeleton, MaterialsSkeleton } from "@/components/shared/skeletons";
import { StatusBadge } from "@/components/shared/status";
import type { ConceptGrowth } from "@ai-study-companion/shared";
import { statusOf } from "@/lib/api/http-status";
import { useProjectGrowth, useRecommendations, useRefreshRecommendations } from "../hooks";
import { ConceptDetailPanel } from "./ConceptDetailPanel";
import { RecommendationCard } from "./RecommendationCard";

function TrendBadge({ trend }: { trend: ConceptGrowth["trend"] }) {
  if (trend === "INSUFFICIENT_DATA") {
    return <Badge variant="outline">insufficient data</Badge>;
  }
  if (trend === "IMPROVING") {
    return (
      <StatusBadge tone="success">
        <span className="inline-flex items-center gap-1">
          <TrendingUp className="h-3.5 w-3.5" aria-hidden /> Improving
        </span>
      </StatusBadge>
    );
  }
  if (trend === "NEEDS_ATTENTION") {
    return (
      <StatusBadge tone="danger">
        <span className="inline-flex items-center gap-1">
          <TrendingDown className="h-3.5 w-3.5" aria-hidden /> Needs attention
        </span>
      </StatusBadge>
    );
  }
  return (
    <StatusBadge tone="neutral">
      <span className="inline-flex items-center gap-1">
        <Minus className="h-3.5 w-3.5" aria-hidden /> Stable
      </span>
    </StatusBadge>
  );
}

function masteryStatusTone(
  status: ConceptGrowth["status"]
): "success" | "neutral" | "warning" | "danger" {
  switch (status) {
    case "STRONG":
      return "success";
    case "STABLE":
      return "neutral";
    case "DEVELOPING":
      return "warning";
    case "NEEDS_ATTENTION":
      return "danger";
  }
}

/**
 * Growth tab: real mastery board. Overall progress renders only with
 * assessed evidence; attention lists only analyzer-flagged concepts;
 * recommendations carry evidence-derived reasons and working CTAs.
 */
export function GrowthTab({ projectId }: { projectId: string }) {
  const growth = useProjectGrowth(projectId);
  const recommendations = useRecommendations(projectId);
  const refresh = useRefreshRecommendations(projectId);
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(null);

  if (selected) {
    return (
      <ConceptDetailPanel
        projectId={projectId}
        conceptId={selected.id}
        conceptName={selected.name}
        onClose={() => setSelected(null)}
      />
    );
  }

  if (growth.isPending) {
    return <GrowthSkeleton />;
  }
  if (growth.isError) {
    return <ErrorState status={statusOf(growth.error)} onRetry={() => growth.refetch()} />;
  }

  const data = growth.data;

  if (data.totalConcepts === 0) {
    return (
      <EmptyState
        title="No concepts yet"
        message="Concepts appear here once learning materials are processed and quizzes generate them."
      />
    );
  }

  const bandCounts = {
    Strong: data.concepts.filter((c) => c.status === "STRONG").length,
    Stable: data.concepts.filter((c) => c.status === "STABLE").length,
    Developing: data.concepts.filter((c) => c.status === "DEVELOPING").length,
    "Needs attention": data.concepts.filter((c) => c.status === "NEEDS_ATTENTION").length,
  };

  return (
    <div className="flex flex-col gap-4">
      <SectionCard title="Overall progress" description="Estimated from real assessed evidence.">
        {data.averageMastery === null ? (
          <EmptyState
            title="No mastery data yet"
            message="Complete a quiz or assessment to start building your learning profile."
          />
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-3xl font-semibold tracking-tight">
              {Math.round(data.averageMastery * 100)}%
            </p>
            <Progress
              value={Math.round(data.averageMastery * 100)}
              aria-label={`Average mastery ${Math.round(data.averageMastery * 100)} percent`}
            />
            <p className="text-sm text-muted-foreground">
              Average across {data.assessedConcepts} of {data.totalConcepts} concepts.
            </p>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Mastery distribution" description="Assessed concepts by status band.">
        <DistributionBars
          ariaLabel="Concept mastery distribution"
          slices={Object.entries(bandCounts).map(([label, value]) => ({
            label,
            value,
            tone:
              label === "Strong"
                ? ("success" as const)
                : label === "Stable"
                  ? ("info" as const)
                  : label === "Developing"
                    ? ("warning" as const)
                    : ("danger" as const),
          }))}
        />
      </SectionCard>

      {data.needsAttention.length > 0 ? (
        <SectionCard title="Needs attention" description="Flagged by the growth analyzer.">
          <ul className="flex flex-col gap-2">
            {data.needsAttention.map((concept) => (
              <li key={concept.conceptId} className="rounded-2xl border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    className="text-left text-sm font-medium underline-offset-4 hover:underline"
                    onClick={() =>
                      setSelected({ id: concept.conceptId, name: concept.conceptName })
                    }
                  >
                    {concept.conceptName}
                  </button>
                  <TrendBadge trend={concept.trend} />
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {concept.reasons[0] ?? "Low recent performance."}
                </p>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      <SectionCard title="Concept mastery" description="Per-concept estimate and trend.">
        <ul className="flex flex-col gap-2">
          {data.concepts.map((concept) => (
            <li
              key={concept.conceptId}
              className="flex flex-col gap-2 rounded-2xl border px-4 py-2.5 text-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left font-medium underline-offset-4 hover:underline"
                  onClick={() => setSelected({ id: concept.conceptId, name: concept.conceptName })}
                >
                  {concept.conceptName}
                </button>
                <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
                  {concept.evidenceCount > 0 ? `${Math.round(concept.masteryScore * 100)}%` : "—"}
                  <StatusBadge tone={masteryStatusTone(concept.status)}>
                    {concept.status.toLowerCase().replace("_", " ")}
                  </StatusBadge>
                  <TrendBadge trend={concept.trend} />
                </span>
              </div>
              {concept.evidenceCount > 0 ? (
                <Progress
                  value={Math.round(concept.masteryScore * 100)}
                  aria-label={`${concept.conceptName} mastery ${Math.round(concept.masteryScore * 100)} percent`}
                />
              ) : null}
            </li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard
        title="Recommended next actions"
        description="Ranked by the deterministic engine from your evidence."
      >
        {recommendations.isPending ? (
          <MaterialsSkeleton rows={2} />
        ) : recommendations.isError ? (
          <ErrorState
            status={statusOf(recommendations.error)}
            onRetry={() => recommendations.refetch()}
          />
        ) : recommendations.data.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {recommendations.data.map((rec) => (
              <RecommendationCard key={rec.id} projectId={projectId} recommendation={rec} />
            ))}
          </ul>
        ) : (
          <EmptyState
            title="No recommendations yet"
            message="As you learn, the workspace will suggest the most useful next steps here."
          />
        )}
        <div className="mt-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={refresh.isPending}
            onClick={() => refresh.mutate()}
          >
            {refresh.isPending ? "Refreshing…" : "Refresh recommendations"}
          </Button>
        </div>
      </SectionCard>
    </div>
  );
}
