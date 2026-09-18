"use client";

import { CircleCheck, CircleX } from "lucide-react";
import type { QuizResult } from "@ai-study-companion/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SectionCard } from "@/components/shared/cards";

/**
 * Completed-attempt result. This is an ASSESSMENT RESULT — evidence the
 * future mastery engine will consume — explicitly not a long-term
 * mastery percentage.
 */
export function QuizResultView({
  result,
  onBack,
  onRetry,
}: {
  result: QuizResult;
  onBack: () => void;
  onRetry: () => void;
}) {
  const percentage = result.maxScore > 0 ? Math.round((result.score / result.maxScore) * 100) : 0;
  return (
    <div className="flex flex-col gap-4">
      <SectionCard title="Assessment result" description="This attempt's score — not long-term mastery.">
        <div className="flex flex-col gap-1">
          <p className="text-3xl font-semibold tracking-tight">
            {result.score.toFixed(1)} / {result.maxScore}
            <span className="ml-2 text-lg text-muted-foreground">{percentage}%</span>
          </p>
          <p className="text-sm text-muted-foreground">
            {result.correctCount} correct · {result.incorrectCount} incorrect ·{" "}
            {result.openEndedCount} open-ended
          </p>
        </div>
      </SectionCard>

      {result.conceptPerformance.length > 0 ? (
        <SectionCard title="Concept performance" description="Per-concept breakdown of this attempt.">
          <ul className="flex flex-col gap-2">
            {result.conceptPerformance.map((concept) => (
              <li
                key={concept.conceptId ?? concept.conceptName}
                className="flex items-center justify-between gap-3 rounded-lg border px-4 py-2.5 text-sm"
              >
                <span className="font-medium">{concept.conceptName}</span>
                <span className="flex items-center gap-2 text-muted-foreground">
                  {concept.correct}/{concept.answered} correct
                  {concept.averageScore !== null ? (
                    <Badge variant="outline">{Math.round(concept.averageScore * 100)}%</Badge>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      {result.openEndedReviews.length > 0 ? (
        <SectionCard title="Open-ended feedback" description="What you got right, what's missing, what to review.">
          <div className="flex flex-col gap-3">
            {result.openEndedReviews.map((review) => (
              <Card key={review.questionId}>
                <CardContent className="flex flex-col gap-2 pt-6">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    {review.correct ? (
                      <CircleCheck className="h-4 w-4" aria-hidden />
                    ) : (
                      <CircleX className="h-4 w-4" aria-hidden />
                    )}
                    {review.prompt}
                  </p>
                  <p className="text-sm leading-relaxed">{review.feedback}</p>
                  {review.missingConcepts.length > 0 ? (
                    <p className="text-sm">
                      <span className="font-medium">Review next: </span>
                      {review.missingConcepts.join(", ")}
                    </p>
                  ) : null}
                  {review.misconceptions.length > 0 ? (
                    <p className="text-sm">
                      <span className="font-medium">Misconceptions: </span>
                      {review.misconceptions.join("; ")}
                    </p>
                  ) : null}
                  {review.sourceRefs.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {review.sourceRefs.map((ref) => (
                        <Badge key={ref} variant="outline">
                          {ref}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        </SectionCard>
      ) : null}

      {(result.strengths.length > 0 || result.weakAreas.length > 0) && (
        <SectionCard title="Areas to review" description="Concepts worth revisiting from this attempt.">
          <div className="flex flex-col gap-2 text-sm">
            {result.weakAreas.length > 0 ? (
              <p>
                <span className="font-medium">Needs work: </span>
                {result.weakAreas.join(", ")}
              </p>
            ) : null}
            {result.strengths.length > 0 ? (
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground">Solid: </span>
                {result.strengths.join(", ")}
              </p>
            ) : null}
          </div>
        </SectionCard>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={onRetry}>
          Practice again
        </Button>
        <Button type="button" variant="outline" onClick={onBack}>
          Back to quizzes
        </Button>
      </div>
    </div>
  );
}
