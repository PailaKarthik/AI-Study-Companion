"use client";

import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  BookOpenText,
  Brain,
  FolderPlus,
  Lightbulb,
  Sparkles,
  Target,
  TrendingUp,
  Upload,
} from "lucide-react";
import { FadeIn, SlideUp, StaggerGroup, StaggerItem } from "@/components/shared/motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const LOOP_STEPS = [
  {
    icon: FolderPlus,
    title: "Create a project",
    text: "Name what you're learning — Operating Systems, Cell Biology, anything.",
    accent: "bg-slate-950 text-white dark:bg-white dark:text-slate-950",
  },
  {
    icon: Upload,
    title: "Upload materials",
    text: "Drop in PDFs. Text is extracted, images OCR'd, knowledge indexed.",
    accent: "bg-slate-950 text-white dark:bg-white dark:text-slate-950",
  },
  {
    icon: Sparkles,
    title: "Learn with the AI tutor",
    text: "Ask anything. Every answer cites the exact source and page.",
    accent: "bg-slate-950 text-white dark:bg-white dark:text-slate-950",
  },
  {
    icon: Brain,
    title: "Take adaptive quizzes",
    text: "Questions target the concepts you need most — exactly as many as you ask for.",
    accent: "bg-slate-950 text-white dark:bg-white dark:text-slate-950",
  },
  {
    icon: Target,
    title: "Understand weaknesses",
    text: "Per-question review shows what slipped, why, and which concept it belongs to.",
    accent: "bg-slate-950 text-white dark:bg-white dark:text-slate-950",
  },
  {
    icon: TrendingUp,
    title: "Track mastery & growth",
    text: "Watch each concept move from needs-attention to strong over time.",
    accent: "bg-slate-950 text-white dark:bg-white dark:text-slate-950",
  },
  {
    icon: Lightbulb,
    title: "Get the next action",
    text: "One recommended step, with the reason behind it. Never a generic feed.",
    accent: "bg-slate-950 text-white dark:bg-white dark:text-slate-950",
  },
] as const;

const FEATURES = [
  {
    icon: Sparkles,
    title: "Grounded tutor",
    text: "Answers come only from your documents, with [n] citations you can verify.",
    accent: "bg-slate-950 text-white dark:bg-white dark:text-slate-950",
  },
  {
    icon: Brain,
    title: "Adaptive quizzes",
    text: "Difficulty fits your evidence; MCQs and open-ended with fair grading.",
    accent: "bg-slate-950 text-white dark:bg-white dark:text-slate-950",
  },
  {
    icon: TrendingUp,
    title: "Mastery that remembers",
    text: "Every answer updates per-concept mastery — progress that actually persists.",
    accent: "bg-slate-950 text-white dark:bg-white dark:text-slate-950",
  },
  {
    icon: BarChart3,
    title: "Honest analytics",
    text: "Activity, accuracy, and trends computed from your real history. No sample data.",
    accent: "bg-slate-950 text-white dark:bg-white dark:text-slate-950",
  },
] as const;

/**
 * Public welcome experience: what the product is, how the learning loop
 * works, and where to start. Shown at `/` for signed-out visitors and
 * linked from login/register — never any mock product data.
 */
export function WelcomeLanding() {
  return (
    <main className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-16 overflow-hidden px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
      {/* Subtle ambient gradients */}

      <FadeIn>
        <header className="flex flex-wrap items-center justify-between gap-3">
          <span className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
              AI
            </span>
            <span className="text-lg font-semibold tracking-tight">Study Companion</span>
          </span>
          <nav className="flex items-center gap-2" aria-label="Account">
            <Button asChild variant="ghost" size="sm">
              <Link href="/login">Log in</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/register">
                Get started <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </Button>
          </nav>
        </header>
      </FadeIn>

      <section className="flex flex-col items-center gap-6 py-8 text-center sm:py-12">
        <FadeIn>
          <p className="inline-flex items-center gap-2 rounded-full border bg-muted/50 px-3 py-1 text-xs font-medium text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            Your AI learning companion
          </p>
        </FadeIn>
        <SlideUp>
          <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
            Learn anything,{" "}
            <span className="bg-gradient-to-r from-slate-950 to-slate-500 bg-clip-text text-transparent dark:from-white dark:to-slate-400">
              deeply
            </span>
            .
          </h1>
        </SlideUp>
        <FadeIn delay={0.1}>
          <p className="max-w-2xl text-base text-muted-foreground sm:text-lg">
            Upload your study materials and learn with a tutor that cites its sources, quizzes that
            adapt to your weaknesses, and mastery tracking that shows real progress.
          </p>
        </FadeIn>
        <FadeIn delay={0.15}>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg">
              <Link href="/register">
                Start learning free <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/login">Log in</Link>
            </Button>
          </div>
        </FadeIn>
      </section>

      <section aria-labelledby="loop-heading" className="flex flex-col gap-8">
        <SlideUp>
          <div className="mx-auto flex max-w-2xl flex-col items-center gap-2 text-center">
            <h2 id="loop-heading" className="text-2xl font-semibold tracking-tight sm:text-3xl">
              One loop, from reading to mastery
            </h2>
            <p className="text-sm text-muted-foreground sm:text-base">
              Every step feeds the next. Your documents become conversations, conversations reveal
              gaps, gaps become quizzes, quizzes become progress.
            </p>
          </div>
        </SlideUp>
        <StaggerGroup className="relative mx-auto flex w-full max-w-2xl flex-col gap-0">
          {LOOP_STEPS.map((step, i) => {
            const Icon = step.icon;
            const last = i === LOOP_STEPS.length - 1;
            return (
              <StaggerItem key={step.title} className="relative flex gap-4 pb-6 last:pb-0">
                <div className="flex flex-col items-center" aria-hidden>
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${step.accent}`}
                  >
                    <Icon className="h-5 w-5" />
                  </span>
                  {!last ? <span className="mt-1 w-px flex-1 bg-border" /> : null}
                </div>
                <div className="flex flex-col gap-0.5 pb-1 pt-1">
                  <p className="text-sm font-semibold">
                    <span className="mr-2 tabular-nums text-muted-foreground">{i + 1}</span>
                    {step.title}
                  </p>
                  <p className="text-sm text-muted-foreground">{step.text}</p>
                </div>
              </StaggerItem>
            );
          })}
        </StaggerGroup>
      </section>

      <section aria-labelledby="features-heading" className="flex flex-col gap-6">
        <SlideUp>
          <h2
            id="features-heading"
            className="text-center text-2xl font-semibold tracking-tight sm:text-3xl"
          >
            Built for real studying
          </h2>
        </SlideUp>
        <StaggerGroup className="grid gap-4 sm:grid-cols-2">
          {FEATURES.map((feature) => {
            const Icon = feature.icon;
            return (
              <StaggerItem key={feature.title}>
                <Card className="h-full">
                  <CardContent className="flex flex-col gap-3 pt-6">
                    <span
                      className={`flex h-10 w-10 items-center justify-center rounded-xl ${feature.accent}`}
                    >
                      <Icon className="h-5 w-5" aria-hidden />
                    </span>
                    <p className="text-base font-semibold">{feature.title}</p>
                    <p className="text-sm text-muted-foreground">{feature.text}</p>
                  </CardContent>
                </Card>
              </StaggerItem>
            );
          })}
        </StaggerGroup>
      </section>

      <section aria-label="Study with sources" className="mx-auto w-full max-w-3xl">
        <SlideUp>
          <div className="flex items-start gap-3 rounded-2xl border bg-muted/30 p-5 sm:p-6">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-white dark:bg-white dark:text-slate-950">
              <BookOpenText className="h-5 w-5" aria-hidden />
            </span>
            <div className="flex flex-col gap-1">
              <p className="text-base font-semibold">No material, no guessing</p>
              <p className="text-sm text-muted-foreground">
                The tutor answers only from your uploaded documents and says so plainly when
                evidence is missing. Citations look like “Source: notes.pdf — Page 3”, so you can
                always verify.
              </p>
            </div>
          </div>
        </SlideUp>
      </section>

      <section className="flex flex-col items-center gap-4 py-4 text-center">
        <FadeIn>
          <h2 className="text-2xl font-semibold tracking-tight">Bring your first PDF.</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Create a free account, start a project, and ask your first question in minutes.
          </p>
        </FadeIn>
        <FadeIn delay={0.1}>
          <Button asChild size="lg">
            <Link href="/register">
              Create free account <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
        </FadeIn>
      </section>

      <footer className="border-t py-6 text-center text-xs text-muted-foreground">
        AI Study Companion — grounded tutoring, adaptive quizzes, and mastery you can see.
      </footer>
    </main>
  );
}
