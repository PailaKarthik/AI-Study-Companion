"use client";

import Link from "next/link";
import { ArrowRight, Compass, Lightbulb, Target, FolderKanban } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { SectionCard, StatCard } from "@/components/shared/cards";
import { ActivityBars } from "@/components/shared/charts";
import { EmptyState, ErrorState, PageLoading } from "@/components/shared/states";
import { DashboardSkeleton } from "@/components/shared/skeletons";
import { FadeIn, SlideUp, StaggerGroup, StaggerItem } from "@/components/shared/motion";
import { PageContainer, PageHeader } from "@/components/shared/page";
import { Button } from "@/components/ui/button";
import { RequireAuth, useCurrentUser } from "@/features/auth";
import { WelcomeLanding, useHome } from "@/features/home";
import { useHomeAnalytics } from "@/features/analytics";
import { getAuthStatus } from "@/lib/auth/status";
import { statusOf } from "@/lib/api/http-status";

/**
 * Home dashboard, fully API-backed (GET /api/home). Answers Where was I /
 * How am I doing / What next from persisted state only — nulls and empty
 * lists render honest empty states, never fabricated progress.
 */
function DashboardContent() {
  const { data: user } = useCurrentUser();
  const home = useHome();
  const activity = useHomeAnalytics();
  const firstName = user?.name?.trim().split(/\s+/)[0] || "there";

  if (home.isPending) {
    return (
      <AppShell crumbs={[{ label: "Home" }]} title="Home">
        <PageContainer>
          <DashboardSkeleton />
        </PageContainer>
      </AppShell>
    );
  }

  if (home.isError) {
    return (
      <AppShell crumbs={[{ label: "Home" }]} title="Home">
        <PageContainer>
          <ErrorState status={statusOf(home.error)} onRetry={() => home.refetch()} />
        </PageContainer>
      </AppShell>
    );
  }

  const data = home.data;
  const hasProjects = data.stats.projectCount > 0;
  const progressValue =
    data.progress.average === null ? "—" : `${Math.round(data.progress.average * 100)}%`;
  const continueHref = data.continueLearning
    ? `/spaces/${data.continueLearning.spaceId}/projects/${data.continueLearning.id}`
    : null;
  const nextActionSpaceId = data.nextAction
    ? (data.recentProjects.find((p) => p.id === data.nextAction?.projectId)?.spaceId ?? null)
    : null;
  const nextActionHref =
    data.nextAction && nextActionSpaceId
      ? `/spaces/${nextActionSpaceId}/projects/${data.nextAction.projectId}`
      : null;

  return (
    <AppShell crumbs={[{ label: "Home" }]} title="Home">
      <PageContainer className="flex flex-col gap-6">
        <FadeIn>
          <PageHeader
            title={`Welcome back, ${firstName}`}
            description="Pick up where you left off, check your progress, and see what's next."
            actions={
              <Button asChild>
                <Link href="/spaces">
                  Go to spaces <ArrowRight aria-hidden />
                </Link>
              </Button>
            }
          />
        </FadeIn>

        <StaggerGroup className="grid items-stretch gap-4 sm:grid-cols-3">
          <StaggerItem className="h-full min-w-0">
            <StatCard
              tone="dark"
              className="h-full"
              label="Active projects"
              value={hasProjects ? String(data.stats.activeProjectCount) : "—"}
              hint={
                hasProjects
                  ? `${data.stats.projectCount} total across ${data.stats.spaceCount} ${data.stats.spaceCount === 1 ? "space" : "spaces"}`
                  : "Counts appear once projects exist"
              }
              icon={FolderKanban}
              href="/spaces"
            />
          </StaggerItem>
          <StaggerItem className="h-full min-w-0">
            <StatCard
              tone="dark"
              className="h-full"
              label="Overall mastery"
              value={progressValue}
              hint={
                data.progress.average === null
                  ? "Tracked per concept as you learn"
                  : `${data.progress.assessedConcepts} of ${data.progress.totalConcepts} concepts assessed`
              }
              icon={Target}
              href={continueHref ? `${continueHref}?tab=growth` : undefined}
            />
          </StaggerItem>
          <StaggerItem className="h-full min-w-0">
            <StatCard
              tone="dark"
              className="h-full"
              label="Due for review"
              value={data.attention.length > 0 ? String(data.attention.length) : "—"}
              hint={
                data.attention.length > 0
                  ? "Concepts scoring below 70% with learning evidence"
                  : "Suggested reviews appear as you learn"
              }
              icon={Lightbulb}
              href={continueHref ? `${continueHref}?tab=quiz` : undefined}
            />
          </StaggerItem>
        </StaggerGroup>

        <SlideUp delay={0.05}>
          {data.continueLearning ? (
            <Link
              href={`/spaces/${data.continueLearning.spaceId}/projects/${data.continueLearning.id}`}
              className="group relative block overflow-hidden rounded-3xl bg-slate-950 p-6 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-8 dark:bg-white dark:text-slate-950"
              aria-label={`Continue learning ${data.continueLearning.name}`}
            >
              <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div className="flex min-w-0 flex-col gap-1.5">
                  <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                    Continue learning
                  </p>
                  <p className="truncate text-2xl font-semibold tracking-tight sm:text-3xl">
                    {data.continueLearning.name}
                  </p>
                  <p className="line-clamp-2 max-w-xl text-sm text-slate-300 dark:text-slate-600">
                    {data.continueLearning.goal ||
                      data.continueLearning.description ||
                      "No goal set yet."}
                  </p>
                </div>
                <span className="inline-flex w-fit shrink-0 items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-slate-950 transition-transform group-hover:translate-x-1 motion-reduce:transform-none dark:bg-slate-950 dark:text-white">
                  Continue <ArrowRight className="h-4 w-4" aria-hidden />
                </span>
              </div>
            </Link>
          ) : (
            <SectionCard
              title="Continue learning"
              description="Jump straight back into your most recent project."
            >
              <EmptyState
                title="Nothing in progress yet"
                message="Create a space and start your first project — it will show up here."
                action={
                  <Button asChild variant="outline" size="sm">
                    <Link href="/spaces">Browse spaces</Link>
                  </Button>
                }
              />
            </SectionCard>
          )}
        </SlideUp>

        <div className="grid items-stretch gap-4 lg:grid-cols-2">
          <SlideUp delay={0.08} className="h-full min-w-0">
            <SectionCard
              className="card-edge h-full"
              title="Recent projects"
              description="Your latest learning journeys."
              action={
                <Button asChild variant="ghost" size="sm">
                  <Link href="/spaces">
                    View all <ArrowRight aria-hidden />
                  </Link>
                </Button>
              }
            >
              {data.recentProjects.length > 0 ? (
                <ul className="flex flex-col gap-2">
                  {data.recentProjects.map((project) => (
                    <li key={project.id} className="min-w-0">
                      <Link
                        href={`/spaces/${project.spaceId}/projects/${project.id}`}
                        className="flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm font-medium transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="truncate">{project.name}</span>
                        <ArrowRight
                          className="h-4 w-4 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState preset="projects" />
              )}
            </SectionCard>
          </SlideUp>
          <SlideUp delay={0.12} className="h-full min-w-0">
            <SectionCard
              className="card-edge h-full"
              title="Recommended next action"
              description="What to do next, and why."
            >
              {data.nextAction ? (
                <div className="flex flex-col gap-3 rounded-2xl border p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-950 text-white dark:bg-white dark:text-slate-950">
                      <Lightbulb className="h-4 w-4" aria-hidden />
                    </span>

                    <p className="text-base font-semibold tracking-tight">
                      {data.nextAction.title}
                    </p>
                  </div>
                  {data.nextAction.description ? (
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      <span className="font-medium text-foreground">Why: </span>
                      {data.nextAction.description}
                    </p>
                  ) : null}
                  {nextActionHref ? (
                    <Button asChild size="sm" className="w-fit">
                      <Link href={nextActionHref}>
                        Open project <ArrowRight className="h-4 w-4" aria-hidden />
                      </Link>
                    </Button>
                  ) : null}
                </div>
              ) : (
                <EmptyState
                  title="No recommendations yet"
                  message="As you learn, the workspace will suggest the single most useful next step here."
                />
              )}
            </SectionCard>
          </SlideUp>
        </div>

        <SlideUp delay={0.1}>
          <SectionCard
            className="card-edge"
            title="Areas requiring attention"
            description="Concepts that need a revisit."
          >
            {data.attention.length > 0 ? (
              <ul className="grid gap-2 sm:grid-cols-2">
                {data.attention.map((concept) => (
                  <li
                    key={concept.conceptId}
                    className="flex min-w-0 items-center justify-between gap-3 rounded-xl border px-4 py-3"
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium">{concept.name}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {concept.projectName}
                      </span>
                    </div>
                    <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold tabular-nums">
                      {Math.round(concept.masteryScore * 100)}%
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState preset="growth" />
            )}
          </SectionCard>
        </SlideUp>

        <SlideUp delay={0.14}>
          <SectionCard
            title="Learning activity"
            description="Your daily learning events over the last 30 days (UTC)."
          >
            {activity.isPending ? (
              <PageLoading label="Loading activity…" />
            ) : activity.isError ? (
              <ErrorState status={statusOf(activity.error)} onRetry={() => activity.refetch()} />
            ) : activity.data.totals.quizAttempts +
                activity.data.totals.tutorInteractions +
                activity.data.totals.assessmentsCompleted ===
              0 ? (
              // Learning-only emptiness: account events (register/login)
              // live in recentActivity but are not learning — the chart
              // covers tutor turns, quiz answers, and assessments.
              <EmptyState
                title="No learning activity yet"
                message="Tutor turns, quiz answers, and completed assessments will chart here."
              />
            ) : (
              <div className="flex flex-col gap-3">
                <ActivityBars
                  points={activity.data.activityOverTime}
                  ariaLabel="Your learning activity per day"
                />
                <p className="text-sm text-muted-foreground">
                  {activity.data.totals.tutorInteractions} tutor turns ·{" "}
                  {activity.data.totals.quizAttempts} quiz attempts ·{" "}
                  {activity.data.totals.assessmentsCompleted} assessments ·{" "}
                  {activity.data.totals.activeDays} active days
                </p>
              </div>
            )}
          </SectionCard>
        </SlideUp>

        <FadeIn className="flex items-start gap-3 rounded-2xl border bg-muted/30 p-5 text-sm text-muted-foreground">
          <Compass className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>
            This dashboard fills in as you learn — spaces, projects and progress will appear here
            once they exist. Nothing here is sample data.
          </p>
        </FadeIn>
      </PageContainer>
    </AppShell>
  );
}

export default function HomePage() {
  return <HomeRoute />;
}

/**
 * Signed-out visitors meet the welcome experience (what this is, how the
 * loop works, where to start) instead of an instant login redirect.
 * Signed-in users get the dashboard as before.
 */
function HomeRoute() {
  const { data: user, isPending, isError } = useCurrentUser();
  const status = getAuthStatus({ isPending, isError, user });

  if (status === "loading") {
    return (
      <main className="mx-auto w-full max-w-2xl space-y-3 p-6" aria-label="Loading">
        <PageLoading label="Loading…" />
      </main>
    );
  }

  if (status === "unauthenticated") {
    return <WelcomeLanding />;
  }

  return (
    <RequireAuth>
      <DashboardContent />
    </RequireAuth>
  );
}
