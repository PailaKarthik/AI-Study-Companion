"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { createQuizSchema } from "@ai-study-companion/validation";
import { ApiErrorAlert } from "@/components/shared/api-error-alert";
import { Field } from "@/components/shared/form";
import { Spinner } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ApiClientError, toUserMessage } from "@/lib/api/errors";
import { cn } from "@/lib/utils";
import { useCreateQuiz, useProjectConcepts } from "../hooks";

const formSchema = createQuizSchema;
type FormValues = z.infer<typeof formSchema>;

const MODE_OPTIONS = [
  { value: "ADAPTIVE", label: "Adaptive", hint: "Targets your weakest concepts automatically" },
  { value: "MIXED_REVIEW", label: "Mixed review", hint: "Broad coverage across concepts" },
  { value: "CONCEPT_FOCUS", label: "Concept focus", hint: "Drill specific concepts you pick" },
] as const;

const TYPE_OPTIONS = [
  { value: "", label: "Mixed" },
  { value: "MCQ", label: "Multiple choice" },
  { value: "OPEN_ENDED", label: "Open-ended" },
] as const;

const DIFFICULTY_OPTIONS = [
  { value: "", label: "Adaptive" },
  { value: "BEGINNER", label: "Beginner" },
  { value: "INTERMEDIATE", label: "Intermediate" },
  { value: "ADVANCED", label: "Advanced" },
] as const;

/**
 * Quiz creation form. Generation is server-side and grounded in project
 * materials; the form only collects count/mode/preferences. CONCEPT_FOCUS
 * requires picking concepts from the project's real concept list.
 */
export function QuizCreateForm({
  projectId,
  onCreated,
}: {
  projectId: string;
  onCreated: () => void;
}) {
  const createQuiz = useCreateQuiz(projectId);
  const concepts = useProjectConcepts(projectId);
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { questionCount: 5, mode: "ADAPTIVE" },
  });
  const mode = form.watch("mode");
  const questionCount = form.watch("questionCount");
  const selectedConcepts = form.watch("conceptIds") ?? [];

  async function onSubmit(values: FormValues) {
    // Generation failures surface via createQuiz.error below; catch the
    // rejection so failed submits don't produce unhandled rejections.
    try {
      await createQuiz.mutateAsync({
        ...values,
        conceptIds: values.mode === "CONCEPT_FOCUS" ? values.conceptIds : undefined,
      });
      form.reset({ questionCount: 5, mode: "ADAPTIVE" });
      onCreated();
    } catch {
      // Displayed via the error alert.
    }
  }

  function toggleConcept(id: string) {
    const current = form.getValues("conceptIds") ?? [];
    form.setValue(
      "conceptIds",
      current.includes(id) ? current.filter((c) => c !== id) : [...current, id],
      { shouldValidate: true }
    );
  }

  const error = createQuiz.error;
  const requestId = error instanceof ApiClientError ? error.requestId : undefined;

  return (
    <Card>
      <CardContent className="flex flex-col gap-6 p-4 sm:p-6">
        <div>
          <h3 className="text-base font-semibold tracking-tight">Create a quiz</h3>
          <p className="text-sm text-muted-foreground">
            Questions are generated from this project&apos;s materials and adapt to your
            performance. Generation can take up to a minute.
          </p>
        </div>
        <form className="flex flex-col gap-6" onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <section aria-labelledby="quiz-step-count" className="flex flex-col gap-3">
            <h4 id="quiz-step-count" className="flex items-center gap-2 text-sm font-semibold">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-950 text-[11px] font-bold text-white dark:bg-white dark:text-slate-950" aria-hidden>
                1
              </span>
              How many questions?
            </h4>
            <Field
              id="quiz-count"
              label="Number of questions"
              error={form.formState.errors.questionCount}
              registration={form.register("questionCount", { valueAsNumber: true })}
              inputProps={{ type: "number", min: 1, max: 20 }}
              hint="Between 1 and 20."
            />
            <div className="flex flex-wrap items-center gap-2" aria-label="Quick question counts">
              {[5, 10, 15].map((n) => (
                <Button
                  key={n}
                  type="button"
                  variant={questionCount === n ? "default" : "outline"}
                  size="sm"
                  aria-pressed={questionCount === n}
                  onClick={() => form.setValue("questionCount", n, { shouldValidate: true })}
                >
                  {n}
                </Button>
              ))}
              <span className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
                Number of questions:{" "}
                {Number.isInteger(questionCount) ? questionCount : "—"}
              </span>
            </div>
          </section>

          <section aria-labelledby="quiz-step-mode" className="flex flex-col gap-3">
            <h4 id="quiz-step-mode" className="flex items-center gap-2 text-sm font-semibold">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-950 text-[11px] font-bold text-white dark:bg-white dark:text-slate-950" aria-hidden>
                2
              </span>
              Which mode?
            </h4>
            <div className="flex flex-col gap-1.5">
            <span id="quiz-mode-label" className="sr-only">
              Mode
            </span>
            <div
              className="flex flex-wrap gap-2"
              role="radiogroup"
              aria-labelledby="quiz-mode-label"
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
                const values = MODE_OPTIONS.map((o) => o.value);
                const step = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1;
                const from = values.indexOf(mode);
                const next = values[(from + step + values.length) % values.length];
                if (next !== undefined) {
                  form.setValue("mode", next, { shouldValidate: true, shouldDirty: true });
                  const group = event.currentTarget;
                  group
                    .querySelectorAll<HTMLButtonElement>('[role="radio"]')
                    [values.indexOf(next)]?.focus();
                }
              }}
            >
              {MODE_OPTIONS.map((option, optionIndex) => (
                <Button
                  key={option.value}
                  type="button"
                  variant={mode === option.value ? "default" : "outline"}
                  size="sm"
                  role="radio"
                  aria-checked={mode === option.value}
                  tabIndex={mode === option.value || optionIndex === 0 ? 0 : -1}
                  title={option.hint}
                  onClick={() =>
                    form.setValue("mode", option.value, {
                      shouldValidate: true,
                      shouldDirty: true,
                    })
                  }
                >
                  {option.label}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {MODE_OPTIONS.find((o) => o.value === mode)?.hint}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="quiz-type" className="text-sm font-medium">
                Question types
              </label>
              <select
                id="quiz-type"
                className="rounded-xl border border-input bg-background px-3 py-2.5 text-sm"
                {...form.register("typePreference")}
              >
                {TYPE_OPTIONS.map((option) => (
                  <option key={option.label} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="quiz-difficulty" className="text-sm font-medium">
                Difficulty
              </label>
              <select
                id="quiz-difficulty"
                className="rounded-xl border border-input bg-background px-3 py-2.5 text-sm"
                {...form.register("difficulty")}
              >
                {DIFFICULTY_OPTIONS.map((option) => (
                  <option key={option.label} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          </section>

          {mode === "CONCEPT_FOCUS" ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Focus concepts</span>
              {concepts.isPending ? (
                <p className="text-sm text-muted-foreground">Loading concepts…</p>
              ) : concepts.isError ? (
                <div className="flex flex-col gap-2">
                  <p role="alert" className="text-sm text-destructive">
                    Couldn&apos;t load concepts. {toUserMessage(concepts.error)}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-fit"
                    onClick={() => void concepts.refetch()}
                  >
                    Retry
                  </Button>
                </div>
              ) : (concepts.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No concepts yet — they are extracted from your materials when the first quiz is
                  generated. Use Adaptive mode first.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {concepts.data?.map((concept) => {
                    const active = selectedConcepts.includes(concept.id);
                    return (
                      <Button
                        key={concept.id}
                        type="button"
                        variant={active ? "default" : "outline"}
                        size="sm"
                        aria-pressed={active}
                        onClick={() => toggleConcept(concept.id)}
                        className={cn(active && "border-primary")}
                      >
                        {concept.name}
                      </Button>
                    );
                  })}
                </div>
              )}
              {form.formState.errors.conceptIds?.message ? (
                <p role="alert" className="text-sm text-destructive">
                  {form.formState.errors.conceptIds.message}
                </p>
              ) : null}
            </div>
          ) : null}

          {error ? <ApiErrorAlert message={toUserMessage(error)} requestId={requestId} /> : null}

          <Button type="submit" disabled={createQuiz.isPending} className="w-fit">
            {createQuiz.isPending ? (
              <>
                <Spinner className="mr-2" label="Generating…" /> Generating quiz…
              </>
            ) : (
              "Generate quiz"
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
