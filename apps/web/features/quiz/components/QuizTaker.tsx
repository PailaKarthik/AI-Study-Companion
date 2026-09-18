"use client";

import { useEffect, useRef, useState } from "react";
import { Check, CircleCheck, CircleX } from "lucide-react";
import type { AttemptQuestionState, QuizResult } from "@ai-study-companion/shared";
import { ApiErrorAlert } from "@/components/shared/api-error-alert";
import { EmptyState, ErrorState, Spinner } from "@/components/shared/states";
import { QuizTakerSkeleton } from "@/components/shared/skeletons";
import { FadeIn } from "@/components/shared/motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { ApiClientError, toUserMessage } from "@/lib/api/errors";
import { cn } from "@/lib/utils";
import { useCompleteAttempt, useQuizAttempt, useSubmitResponse } from "../hooks";

/**
 * Server-backed quiz taker. Progress comes from GET attempt (refresh-safe),
 * answers persist per question, and completion aggregates server-side.
 * One question at a time; feedback appears only after that question is
 * answered — never the answer key upfront.
 */
export function QuizTaker({
  attemptId,
  onCompleted,
  onExit,
}: {
  attemptId: string;
  onCompleted: (result: QuizResult) => void;
  onExit: () => void;
}) {
  const attempt = useQuizAttempt(attemptId);
  const submit = useSubmitResponse(attemptId);
  const complete = useCompleteAttempt(attemptId);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [localError, setLocalError] = useState<string | null>(null);
  // Focus target for question changes (screen-reader + keyboard users must
  // not be left on a vanished Submit button when the question advances).
  const questionHeadingRef = useRef<HTMLParagraphElement>(null);
  // Derived BEFORE the early returns so hook order stays stable: the key
  // identifies the question that should hold focus (or "done"/null).
  const focusKey = (() => {
    const questions = attempt.data?.questions;
    if (!questions || attempt.isPending || attempt.isError) return null;
    const idx = questions.findIndex((q) => !q.answered);
    return idx === -1 ? "done" : (questions[idx]?.id ?? null);
  })();
  useEffect(() => {
    if (focusKey && focusKey !== "done") {
      questionHeadingRef.current?.focus({ preventScroll: true });
    }
  }, [focusKey]);

  if (attempt.isPending) {
    return <QuizTakerSkeleton />;
  }
  if (attempt.isError) {
    return (
      <ErrorState
        status={attempt.error instanceof ApiClientError ? attempt.error.status : undefined}
        title="Couldn't load this attempt"
        message={toUserMessage(attempt.error)}
        onRetry={() => void attempt.refetch()}
      />
    );
  }

  const state = attempt.data;
  // First unanswered question — or undefined when everything is answered
  // (findIndex returns -1; the old Math.max(0, …) wrongly rendered Q0
  // alongside Finish in that state).
  const firstUnanswered = state.questions.findIndex((q) => !q.answered);
  const current = firstUnanswered === -1 ? undefined : state.questions[firstUnanswered];
  const progress = state.questionCount > 0 ? (state.answeredCount / state.questionCount) * 100 : 0;

  // mutateAsync rejects on failure — the error surfaces via
  // submit.error/complete.error below; catch here to avoid unhandled
  // rejections (console noise, no crash, but never clean).
  async function handleSubmitMcq(question: AttemptQuestionState) {
    const option = (selected[question.id] ?? "").trim();
    if (!option) {
      setLocalError("Pick an option before submitting.");
      return;
    }
    setLocalError(null);
    try {
      await submit.mutateAsync({ questionId: question.id, selectedOption: option });
    } catch {
      // Displayed via the shared error alert.
    }
  }

  async function handleSubmitOpen(question: AttemptQuestionState) {
    const text = (drafts[question.id] ?? "").replace(/\s+/g, " ").trim();
    if (text.length === 0) {
      setLocalError("Write an answer before submitting.");
      return;
    }
    setLocalError(null);
    try {
      await submit.mutateAsync({ questionId: question.id, responseText: text });
    } catch {
      // Displayed via the shared error alert.
    }
  }

  async function handleRetry(question: AttemptQuestionState) {
    setLocalError(null);
    // Prefer the user's CURRENT edits over saved server values — retrying
    // after editing must resubmit the edits, not silently discard them.
    const payload =
      question.type === "MCQ"
        ? {
            questionId: question.id,
            selectedOption: (selected[question.id] ?? question.selectedOption ?? "").trim(),
          }
        : {
            questionId: question.id,
            responseText: (drafts[question.id] ?? question.responseText ?? "")
              .replace(/\s+/g, " ")
              .trim(),
          };
    try {
      await submit.mutateAsync(payload);
    } catch {
      // Displayed via the shared error alert.
    }
  }

  async function handleComplete() {
    setLocalError(null);
    try {
      const result = await complete.mutateAsync();
      onCompleted(result);
    } catch {
      // Displayed via the shared error alert.
    }
  }

  if (state.status === "COMPLETED") {
    return (
      <EmptyState
        title="Attempt already completed"
        message="This attempt is finished. Start a new attempt to practice again."
        action={
          <Button type="button" variant="outline" size="sm" onClick={onExit}>
            Back to quizzes
          </Button>
        }
      />
    );
  }

  const error = submit.error ?? complete.error;
  const requestId = error instanceof ApiClientError ? error.requestId : undefined;
  const busy = submit.isPending || complete.isPending;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          Question {state.answeredCount + (current && !current.answered ? 1 : 0)} of{" "}
          {state.questionCount} · {state.answeredCount} answered
        </p>
        <Button type="button" variant="ghost" size="sm" onClick={onExit}>
          Exit
        </Button>
      </div>
      <Progress
        value={progress}
        aria-label={`Answered ${state.answeredCount} of ${state.questionCount}`}
      />

      {current ? (
        <FadeIn key={current.id}>
          <Card>
            <CardContent className="flex flex-col gap-4 pt-6">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">
                  {current.type === "MCQ" ? "Multiple choice" : "Open-ended"}
                </Badge>
                {current.conceptName ? (
                  <Badge variant="outline">{current.conceptName}</Badge>
                ) : null}
                {current.difficulty ? (
                  <Badge variant="outline">{current.difficulty.toLowerCase()}</Badge>
                ) : null}
              </div>
              <p
                ref={questionHeadingRef}
                tabIndex={-1}
                aria-live="polite"
                className="text-base font-medium leading-relaxed outline-none"
              >
                {current.prompt}
              </p>

              {!current.answered ? (
                current.type === "MCQ" && current.options ? (
                  <div
                    className="flex flex-col gap-2"
                    role="radiogroup"
                    aria-label="Answer options"
                    // Roving radio semantics: arrow keys move AND select,
                    // matching native radio-group keyboard behavior.
                    onKeyDown={(event) => {
                      if (
                        event.key !== "ArrowDown" &&
                        event.key !== "ArrowUp" &&
                        event.key !== "ArrowRight" &&
                        event.key !== "ArrowLeft"
                      ) {
                        return;
                      }
                      event.preventDefault();
                      const options = current.options ?? [];
                      if (options.length === 0) return;
                      const step = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1;
                      const from = options.indexOf(selected[current.id] ?? "");
                      const next = options[(from + step + options.length) % options.length];
                      if (next !== undefined) {
                        setSelected((s) => ({ ...s, [current.id]: next }));
                        // Move DOM focus to the newly selected option.
                        const group = event.currentTarget;
                        const buttons = Array.from(
                          group.querySelectorAll<HTMLButtonElement>('[role="radio"]')
                        );
                        buttons[options.indexOf(next)]?.focus();
                      }
                    }}
                  >
                    {current.options.map((option, optionIndex) => {
                      const active = selected[current.id] === option;
                      // Roving tabindex: the selected option (or the first
                      // when nothing is selected) is the single tab stop.
                      const isTabStop = active || (!selected[current.id] && optionIndex === 0);
                      return (
                        <Button
                          key={option}
                          type="button"
                          variant={active ? "default" : "outline"}
                          role="radio"
                          aria-checked={active}
                          tabIndex={isTabStop ? 0 : -1}
                          disabled={busy}
                          className={cn(
                            "h-auto justify-start whitespace-normal py-3 text-left",
                            active && "ring-2 ring-primary ring-offset-2 ring-offset-background"
                          )}
                          onClick={() => setSelected((s) => ({ ...s, [current.id]: option }))}
                        >
                          <span className="flex w-full items-start gap-2">
                            <span
                              className={cn(
                                "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                                active
                                  ? "border-primary-foreground bg-primary-foreground/20"
                                  : "border-muted-foreground/40"
                              )}
                              aria-hidden
                            >
                              {active ? <Check className="h-3 w-3" /> : null}
                            </span>
                            <span className="min-w-0 flex-1">{option}</span>
                          </span>
                        </Button>
                      );
                    })}
                    <Button
                      type="button"
                      disabled={busy || !selected[current.id]}
                      className="mt-1 w-fit"
                      onClick={() => void handleSubmitMcq(current)}
                    >
                      {busy ? (
                        <>
                          <Spinner className="mr-2" label="Submitting…" /> Submitting…
                        </>
                      ) : (
                        "Submit answer"
                      )}
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    <label htmlFor={`answer-${current.id}`} className="sr-only">
                      Your answer
                    </label>
                    <Textarea
                      id={`answer-${current.id}`}
                      rows={5}
                      maxLength={4000}
                      disabled={busy}
                      value={drafts[current.id] ?? ""}
                      onChange={(event) =>
                        setDrafts((d) => ({ ...d, [current.id]: event.target.value }))
                      }
                      placeholder="Explain in your own words…"
                    />
                    <Button
                      type="button"
                      disabled={busy}
                      className="w-fit"
                      onClick={() => void handleSubmitOpen(current)}
                    >
                      {busy ? (
                        <>
                          <Spinner className="mr-2" label="Evaluating…" /> Submitting…
                        </>
                      ) : (
                        "Submit answer"
                      )}
                    </Button>
                  </div>
                )
              ) : (
                <AnswerFeedback
                  question={current}
                  busy={busy}
                  onRetry={() => void handleRetry(current)}
                />
              )}
            </CardContent>
          </Card>
        </FadeIn>
      ) : null}

      {state.answeredCount === state.questionCount && state.questionCount > 0 ? (
        <Button
          type="button"
          disabled={busy}
          className="w-fit"
          onClick={() => void handleComplete()}
        >
          {complete.isPending ? (
            <>
              <Spinner className="mr-2" label="Scoring…" /> Scoring…
            </>
          ) : (
            "Finish & see results"
          )}
        </Button>
      ) : null}

      {localError ? (
        <p role="alert" className="text-sm text-destructive">
          {localError}
        </p>
      ) : null}
      {error ? <ApiErrorAlert message={toUserMessage(error)} requestId={requestId} /> : null}
    </div>
  );
}

function AnswerFeedback({
  question,
  busy,
  onRetry,
}: {
  question: AttemptQuestionState;
  busy: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border p-4" aria-live="polite">
      <p className="flex items-center gap-2 text-sm font-medium">
        {question.isCorrect ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-950 px-2.5 py-0.5 text-xs font-medium text-white dark:bg-white dark:text-slate-950">
            <CircleCheck className="h-3.5 w-3.5" aria-hidden /> Correct
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            <CircleX className="h-3.5 w-3.5" aria-hidden />{" "}
            {question.score !== null && question.score > 0 ? "Partially correct" : "Incorrect"}
          </span>
        )}
        {question.score !== null ? (
          <span className="text-muted-foreground">· score {question.score.toFixed(2)}</span>
        ) : null}
      </p>
      {question.type === "MCQ" && question.selectedOption ? (
        <p className="text-sm">
          Your answer: <span className="font-medium">{question.selectedOption}</span>
        </p>
      ) : null}
      {question.feedback ? <p className="text-sm leading-relaxed">{question.feedback}</p> : null}
      {question.explanation ? (
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Why: </span>
          {question.explanation}
        </p>
      ) : null}
      {question.evaluationState === "EVALUATION_FAILED" ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-destructive">
            Evaluation failed — your answer is saved. Retry when ready.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            className="w-fit"
            onClick={onRetry}
          >
            Retry evaluation
          </Button>
        </div>
      ) : null}
    </div>
  );
}
