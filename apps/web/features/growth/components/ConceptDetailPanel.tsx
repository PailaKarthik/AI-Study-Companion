"use client";

import { useEffect, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/shared/cards";
import { MasteryTrendChart } from "@/components/shared/charts";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { GrowthSkeleton } from "@/components/shared/skeletons";
import { statusOf } from "@/lib/api/http-status";
import { requestIdOf } from "@/lib/api/errors";
import { useConceptDetail } from "../hooks";

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? "Unknown"
    : date.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}

/**
 * Concept inspector inside the Growth tab (no new page): estimate, trend,
 * real event history (actual points only — gaps are gaps), recent
 * evidence, mistakes, and the concept's pending recommendations.
 */
export function ConceptDetailPanel({
  projectId,
  conceptId,
  conceptName,
  onClose,
}: {
  projectId: string;
  conceptId: string;
  conceptName: string;
  onClose: () => void;
}) {
  const detail = useConceptDetail(projectId, conceptId);
  // Drilling in replaces the whole tab — move focus to the heading so
  // keyboard/screen-reader users land on the new content.
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [conceptId]);

  if (detail.isPending) {
    return <GrowthSkeleton />;
  }
  if (detail.isError) {
    return (
      <ErrorState
        status={statusOf(detail.error)}
        requestId={requestIdOf(detail.error)}
        onRetry={() => detail.refetch()}
      />
    );
  }

  const data = detail.data;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h3 ref={headingRef} tabIndex={-1} className="text-lg font-semibold outline-none">
          {conceptName}
        </h3>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Back to concepts
        </Button>
      </div>

      {data.mastery ? (
        <SectionCard
          title="Mastery estimate"
          description="Estimated signal, not a precise measurement."
        >
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-3xl font-semibold tracking-tight">
              {Math.round(data.mastery.masteryScore * 100)}%
            </p>
            <Badge variant="secondary">{data.mastery.status.toLowerCase().replace("_", " ")}</Badge>
            {data.growth && data.growth.trend !== "INSUFFICIENT_DATA" ? (
              <Badge variant="outline">{data.growth.trend.toLowerCase().replace("_", " ")}</Badge>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Based on {data.mastery.evidenceCount} assessed{" "}
            {data.mastery.evidenceCount === 1 ? "item" : "items"}
            {data.mastery.scoreChange !== null
              ? ` · last change ${data.mastery.scoreChange >= 0 ? "+" : ""}${data.mastery.scoreChange.toFixed(2)}`
              : ""}
            .
          </p>
          {data.growth && data.growth.trend !== "INSUFFICIENT_DATA" ? (
            <ul className="mt-2 flex flex-col gap-1">
              {data.growth.reasons.map((reason) => (
                <li key={reason} className="text-sm text-muted-foreground">
                  · {reason}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              Not enough assessed evidence yet for a trend.
            </p>
          )}
        </SectionCard>
      ) : (
        <EmptyState
          title="No mastery data yet"
          message="Complete a quiz or assessment to start building this concept's learning profile."
        />
      )}

      <SectionCard title="Mastery history" description="One point per real assessment event.">
        {data.history.length > 0 ? (
          <div className="flex flex-col gap-4">
            <MasteryTrendChart
              points={data.history}
              ariaLabel={`${conceptName} mastery over time`}
            />
            <ul className="flex flex-col gap-2">
              {data.history.map((point) => (
                <li
                  key={point.masteryEventId}
                  className="flex items-center justify-between gap-3 rounded-xl border px-4 py-2.5 text-sm"
                >
                  <span className="font-medium">{Math.round(point.newScore * 100)}%</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {point.sourceType.toLowerCase().replaceAll("_", " ")} ·{" "}
                    {formatDateTime(point.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <EmptyState preset="analytics" />
        )}
      </SectionCard>

      {data.mistakes.length > 0 ? (
        <SectionCard title="Recent mistakes" description="Incorrect answers for this concept.">
          <ul className="flex flex-col gap-2">
            {data.mistakes.map((mistake) => (
              <li key={mistake.responseId} className="rounded-2xl border p-4">
                <p className="text-sm font-medium">{mistake.questionPrompt}</p>
                {mistake.feedback ? (
                  <p className="mt-1 text-sm text-muted-foreground">{mistake.feedback}</p>
                ) : null}
                <p className="mt-2 text-xs text-muted-foreground">
                  {formatDateTime(mistake.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      {data.recentEvidence.length > 0 ? (
        <SectionCard title="Recent assessment evidence" description="Latest graded evaluations.">
          <ul className="flex flex-col gap-2">
            {data.recentEvidence.map((item) => (
              <li
                key={item.assessmentId}
                className="flex items-center justify-between gap-3 rounded-xl border px-4 py-2.5 text-sm"
              >
                <span className="font-medium">
                  {item.correct === null ? "Evaluated" : item.correct ? "Correct" : "Incorrect"}
                  {item.score !== null ? ` · ${Math.round(item.score * 100)}%` : ""}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatDateTime(item.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}
    </div>
  );
}
