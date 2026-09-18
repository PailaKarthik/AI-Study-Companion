"use client";

import { CircleAlert, CircleCheck, CircleX, RotateCcw } from "lucide-react";
import type { AttemptState } from "@ai-study-companion/shared";
import { MarkdownText } from "@/components/shared/markdown";
import { QuizReviewSkeleton } from "@/components/shared/skeletons";
import { StatusBadge, attemptStatusTone } from "@/components/shared/status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SectionCard } from "@/components/shared/cards";
import { useQuizAttempt } from "../hooks";

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}

/**
 * Historical review of one attempt, built from persisted attempt state —
 * never from ephemeral client answers. Correct → green, incorrect → red,
 * unanswered → amber; every question shows the learner's answer, the
 * correct answer, the explanation, concept, and difficulty.
 */
export function QuizReviewView({
  attemptId,
  quizTitle,
  onBack,
  onRetry,
}: {
  attemptId: string;
  quizTitle: string;
  onBack: () => void;
  onRetry: () => void;
}) {
  const attempt = useQuizAttempt(attemptId);

  if (attempt.isPending) {
    return <QuizReviewSkeleton />;
  }

  if (attempt.isError || !attempt.data) {
    return (
      <div className="flex flex-col gap-3">
        <p role="alert" className="text-sm text-destructive">
          Couldn&apos;t load this review. The attempt may have been removed.
        </p>
        <Button type="button" variant="outline" size="sm" className="w-fit" onClick={onBack}>
          Back to quizzes
        </Button>
      </div>
    );
  }

  return (
    <QuizReviewContent
      attempt={attempt.data}
      quizTitle={quizTitle}
      onBack={onBack}
      onRetry={onRetry}
    />
  );
}

function QuizReviewContent({
  attempt,
  quizTitle,
  onBack,
  onRetry,
}: {
  attempt: AttemptState;
  quizTitle: string;
  onBack: () => void;
  onRetry: () => void;
}) {
  const correct = attempt.questions.filter((q) => q.isCorrect === true).length;
  const incorrect = attempt.questions.filter((q) => q.isCorrect === false).length;
  const unanswered = attempt.questions.filter((q) => !q.answered).length;
  const accuracy =
    attempt.questionCount > 0 ? Math.round((correct / attempt.questionCount) * 100) : 0;
  const status = attemptStatusTone(attempt.status);
  const weakConcepts = [
    ...new Map(
      attempt.questions
        .filter((q) => q.isCorrect === false && q.conceptName)
        .map((q) => [q.conceptId ?? q.conceptName, q.conceptName as string])
    ).values(),
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onBack}>
          Back to quizzes
        </Button>
        <Button type="button" size="sm" onClick={onRetry}>
          <RotateCcw className="mr-2 h-4 w-4" aria-hidden /> Retry quiz
        </Button>
      </div>

      <SectionCard
        title={quizTitle}
        description={`Reviewed ${formatDateTime(attempt.completedAt ?? attempt.startedAt)}`}
      >
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-3xl font-semibold tracking-tight">
            {attempt.score !== null ? attempt.score.toFixed(1) : "—"}
            <span className="ml-2 text-lg text-muted-foreground">
              / {attempt.questionCount} · {accuracy}%
            </span>
          </p>
          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {correct} correct · {incorrect} incorrect · {unanswered} unanswered
        </p>
        {weakConcepts.length > 0 ? (
          <p className="mt-2 text-sm">
            <span className="font-medium">Weak concepts: </span>
            {weakConcepts.join(", ")}
          </p>
        ) : null}
      </SectionCard>

      <div className="flex flex-col gap-3">
        {attempt.questions.map((question, index) => {
          const state = !question.answered
            ? "unanswered"
            : question.isCorrect
              ? "correct"
              : "incorrect";
          return (
            <Card key={question.id}>
              <CardContent className="flex flex-col gap-2 p-4 sm:p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge
                    tone={
                      state === "correct" ? "success" : state === "incorrect" ? "danger" : "warning"
                    }
                    invert={state === "correct"}
                  >
                    {state === "correct" ? (
                      <span className="inline-flex items-center gap-1">
                        <CircleCheck className="h-3.5 w-3.5" aria-hidden /> Correct
                      </span>
                    ) : state === "incorrect" ? (
                      <span className="inline-flex items-center gap-1">
                        <CircleX className="h-3.5 w-3.5" aria-hidden /> Incorrect
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <CircleAlert className="h-3.5 w-3.5" aria-hidden /> Not answered
                      </span>
                    )}
                  </StatusBadge>
                  <span className="text-xs text-muted-foreground">
                    Question {index + 1} of {attempt.questionCount}
                  </span>
                  {question.conceptName ? (
                    <Badge variant="outline">{question.conceptName}</Badge>
                  ) : null}
                  {question.difficulty ? (
                    <Badge variant="outline">{question.difficulty.toLowerCase()}</Badge>
                  ) : null}
                </div>

                <MarkdownText text={question.prompt} />

                <div className="flex flex-col gap-1.5 rounded-lg bg-muted/40 px-3 py-2 text-sm">
                  <p>
                    <span className="font-medium">Your answer: </span>
                    {question.selectedOption ?? question.responseText ?? (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </p>
                  {question.correctAnswer ? (
                    <p>
                      <span className="font-medium">Correct answer: </span>
                      <span className="font-medium">{question.correctAnswer}</span>
                    </p>
                  ) : null}
                </div>

                {question.explanation ? (
                  <div className="flex flex-col gap-1 text-sm">
                    <p className="font-medium">Explanation</p>
                    <MarkdownText text={question.explanation} className="text-muted-foreground" />
                  </div>
                ) : null}
                {question.feedback ? (
                  <div className="flex flex-col gap-1 text-sm">
                    <p className="font-medium">Feedback</p>
                    <MarkdownText text={question.feedback} className="text-muted-foreground" />
                  </div>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
