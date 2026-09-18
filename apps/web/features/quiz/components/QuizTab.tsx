"use client";

import { useState } from "react";
import { Eye, Play, RotateCcw } from "lucide-react";
import type { QuizResult } from "@ai-study-companion/shared";
import { ApiErrorAlert } from "@/components/shared/api-error-alert";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { QuizHistorySkeleton } from "@/components/shared/skeletons";
import { StatusBadge, attemptStatusTone } from "@/components/shared/status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ApiClientError, toUserMessage } from "@/lib/api/errors";
import { useProjectQuizzes, useStartAttempt } from "../hooks";
import { QuizCreateForm } from "./QuizCreateForm";
import { QuizResultView } from "./QuizResultView";
import { QuizReviewView } from "./QuizReviewView";
import { QuizTaker } from "./QuizTaker";

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((today.getTime() - day.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Quiz tab orchestrator: list → create → take → result. Attempt identity
 * lives server-side (start resumes the active attempt), so a browser
 * refresh never destroys progress — reopening the quiz resumes it.
 */
export function QuizTab({ projectId }: { projectId: string }) {
  const quizzes = useProjectQuizzes(projectId);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [result, setResult] = useState<QuizResult | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [review, setReview] = useState<{ attemptId: string; quizId: string; title: string } | null>(null);
  const start = useStartAttempt();

  function handleCreated() {
    setAttemptId(null);
    setResult(null);
    setReview(null);
    setShowCreate(false);
  }

  async function handleStart(quizId: string, restart = false) {
    setResult(null);
    setReview(null);
    // mutateAsync rejects on failure — catch it: the error already lands
    // in start.error for display, and an unhandled rejection would only
    // add console noise (never a crash, but never clean either).
    try {
      const attempt = await start.mutateAsync({ quizId, restart });
      setAttemptId(attempt.id);
    } catch {
      // Displayed via startError below.
    }
  }

  function handleExit() {
    setAttemptId(null);
    setResult(null);
    setReview(null);
  }

  const startError = start.error;
  const startRequestId = startError instanceof ApiClientError ? startError.requestId : undefined;

  if (attemptId && !result) {
    return (
      <QuizTaker
        attemptId={attemptId}
        onCompleted={(completed) => setResult(completed)}
        onExit={handleExit}
      />
    );
  }

  if (result) {
    return (
      <QuizResultView
        result={result}
        onBack={() => {
          setResult(null);
          setAttemptId(null);
        }}
        onRetry={() => {
          const quizId = result.quizId;
          setResult(null);
          setAttemptId(null);
          void handleStart(quizId, true);
        }}
      />
    );
  }

  if (review) {
    return (
      <QuizReviewView
        attemptId={review.attemptId}
        quizTitle={review.title}
        onBack={() => setReview(null)}
        onRetry={() => {
          const quizId = review.quizId;
          setReview(null);
          void handleStart(quizId, true);
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Adaptive quizzes generated from this project&apos;s materials — never mock questions.
        </p>
        <Button
          type="button"
          variant={showCreate ? "secondary" : "default"}
          size="sm"
          onClick={() => setShowCreate((v) => !v)}
        >
          {showCreate ? "Hide form" : "New quiz"}
        </Button>
      </div>

      {showCreate ? <QuizCreateForm projectId={projectId} onCreated={handleCreated} /> : null}

      {quizzes.isPending ? <QuizHistorySkeleton /> : null}
      {quizzes.isError ? (
        <ErrorState
          status={quizzes.error instanceof ApiClientError ? quizzes.error.status : undefined}
          title="Couldn't load quizzes"
          onRetry={() => void quizzes.refetch()}
        />
      ) : null}

      {quizzes.data && quizzes.data.length === 0 && !showCreate ? (
        <EmptyState
          title="No quizzes yet"
          message="Generate your first adaptive quiz from this project's materials. Questions target the concepts you need most."
          action={
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowCreate(true)}
            >
              <Play className="mr-2 h-4 w-4" aria-hidden /> Take a quiz
            </Button>
          }
        />
      ) : null}

      {startError ? (
        <ApiErrorAlert message={toUserMessage(startError)} requestId={startRequestId} />
      ) : null}

      {quizzes.data && quizzes.data.length > 0 ? (
        <div className="flex flex-col gap-2" role="table" aria-label="Quiz history">
          <div
            className="hidden grid-cols-[minmax(0,1fr)_80px_90px_130px_190px] items-center gap-3 px-5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground sm:grid"
            role="row"
            aria-hidden
          >
            <span>Quiz</span>
            <span className="text-right">Score</span>
            <span>Date</span>
            <span>Status</span>
            <span className="text-right">Actions</span>
          </div>
          {quizzes.data.map((quiz) => {
            const latest = quiz.latestAttempt;
            const status = latest ? attemptStatusTone(latest.status) : null;
            const starting = start.isPending && start.variables?.quizId === quiz.id;
            return (
              <Card key={quiz.id} role="row">
                <CardContent className="grid grid-cols-1 gap-x-3 gap-y-2 p-4 sm:grid-cols-[minmax(0,1fr)_80px_90px_130px_190px] sm:items-center sm:p-5">
                  <div className="flex min-w-0 flex-col justify-center gap-1">
                    <p className="truncate text-sm font-medium leading-5">{quiz.title}</p>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <Badge variant="secondary">{quiz.mode.toLowerCase().replace("_", " ")}</Badge>
                      <span className="tabular-nums">
                        {quiz.questionCount}{" "}
                        {quiz.questionCount === 1 ? "Question" : "Questions"}
                      </span>
                      <span className="tabular-nums">
                        {quiz.attemptCount} {quiz.attemptCount === 1 ? "attempt" : "attempts"}
                      </span>
                    </div>
                  </div>
                  <p className="text-sm tabular-nums sm:text-right">
                    <span className="text-muted-foreground sm:hidden">Score: </span>
                    {latest?.score !== null && latest?.score !== undefined
                      ? latest.score.toFixed(1)
                      : "—"}
                  </p>
                  <p className="whitespace-nowrap text-sm text-muted-foreground">
                    <span className="sm:hidden">Date: </span>
                    {formatDate(quiz.createdAt)}
                  </p>
                  <p className="flex sm:justify-start">
                    {status ? (
                      <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                    ) : (
                      <span className="text-xs text-muted-foreground">Not attempted</span>
                    )}
                  </p>
                  <div className="flex shrink-0 items-center gap-2 sm:justify-end">
                    {latest?.status === "COMPLETED" ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={start.isPending}
                        onClick={() =>
                          setReview({ attemptId: latest.id, quizId: quiz.id, title: quiz.title })
                        }
                      >
                        <Eye className="mr-2 h-4 w-4" aria-hidden /> Review
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      size="sm"
                      disabled={start.isPending}
                      onClick={() => void handleStart(quiz.id, false)}
                    >
                      {starting ? (
                        "Starting…"
                      ) : latest?.status === "ACTIVE" ? (
                        <>
                          <RotateCcw className="mr-2 h-4 w-4" aria-hidden /> Resume
                        </>
                      ) : (
                        <>
                          <Play className="mr-2 h-4 w-4" aria-hidden /> Start
                        </>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {quizzes.isFetching && !quizzes.isPending ? <QuizHistorySkeleton rows={1} /> : null}
        </div>
      ) : null}
    </div>
  );
}
