"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, Check, Lightbulb, X } from "lucide-react";
import type { RecommendationAction, RecommendationDetail } from "@ai-study-companion/shared";
import { StatusBadge } from "@/components/shared/status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toUserMessage } from "@/lib/api/errors";
import { useCompleteRecommendation, useDismissRecommendation } from "../hooks";

function actionHref(pathname: string, action: RecommendationAction | null): string {
  if (!action) return pathname;
  switch (action.kind) {
    case "PRACTICE_CONCEPT":
    case "TAKE_QUIZ":
      return `${pathname}?tab=quiz`;
    case "REVIEW_MATERIAL":
      return `${pathname}?tab=materials`;
    case "OPEN_PROJECT":
      return pathname;
  }
}

/**
 * One recommendation: factual reason, real CTA target, learner-driven
 * lifecycle actions. CTAs navigate to existing tabs — never dead buttons.
 */
export function RecommendationCard({
  projectId,
  recommendation,
}: {
  projectId: string;
  recommendation: RecommendationDetail;
}) {
  const pathname = usePathname();
  const complete = useCompleteRecommendation(projectId);
  const dismiss = useDismissRecommendation(projectId);
  const busy = complete.isPending || dismiss.isPending;
  // Lifecycle failures were previously silent (busy just unlocked). Show
  // the failure inline so the learner knows the click did nothing.
  const actionError = complete.error ?? dismiss.error;

  return (
    <li className="flex flex-col gap-2 rounded-2xl border p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-950 text-white dark:bg-white dark:text-slate-950">
          <Lightbulb className="h-4 w-4" aria-hidden />
        </span>
        <StatusBadge
          tone={
            recommendation.priority === "URGENT" || recommendation.priority === "HIGH"
              ? "danger"
              : recommendation.priority === "MEDIUM"
                ? "warning"
                : "neutral"
          }
        >
          {recommendation.priority.toLowerCase()} priority
        </StatusBadge>
        <Badge variant="outline">{recommendation.type.toLowerCase().replace("_", " ")}</Badge>
        {recommendation.conceptName ? (
          <span className="text-sm font-medium">{recommendation.conceptName}</span>
        ) : null}
      </div>
      <p className="text-sm font-medium">{recommendation.title}</p>
      {recommendation.reason ? (
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Why: </span>
          {recommendation.reason}
        </p>
      ) : null}
      <div className="mt-1 flex flex-wrap gap-2">
        <Button type="button" size="sm" asChild>
          <Link href={actionHref(pathname, recommendation.action)}>
            {recommendation.action?.label ?? "Open"} <ArrowRight aria-hidden />
          </Link>
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => complete.mutate(recommendation.id)}
        >
          <Check aria-hidden /> Done
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => dismiss.mutate(recommendation.id)}
        >
          <X aria-hidden /> Dismiss
        </Button>
      </div>
      {actionError ? (
        <p role="alert" className="text-xs text-destructive">
          Couldn&apos;t update: {toUserMessage(actionError)}
        </p>
      ) : null}
    </li>
  );
}
