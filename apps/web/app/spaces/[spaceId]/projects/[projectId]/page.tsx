"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  BarChart3,
  BookOpen,
  FileText,
  GraduationCap,
  MessagesSquare,
  Pencil,
  Sprout,
  Trash2,
} from "lucide-react";
import { Suspense, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/app-shell";
import { FadeIn } from "@/components/shared/motion";
import { PageContainer } from "@/components/shared/page";
import { SectionCard } from "@/components/shared/cards";
import {
  EmptyState,
  ErrorState,
  NotFoundState,
  PageLoading,
} from "@/components/shared/states";
import { ProjectSkeleton } from "@/components/shared/skeletons";
import { StatusBadge, projectStatusTone } from "@/components/shared/status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RequireAuth } from "@/features/auth";
import { SearchPanel } from "@/features/search";
import { MaterialsTab } from "@/features/materials";
import { QuizTab } from "@/features/quiz";
import { GrowthTab } from "@/features/growth";
import { AnalyticsTab } from "@/features/analytics";
import { TutorPanel } from "@/features/tutor";
import {
  DeleteProjectDialog,
  EditProjectDialog,
  useProject,
  useProjectOverview,
} from "@/features/projects";
import { statusOf } from "@/lib/api/http-status";
import { queryKeys } from "@/lib/query/keys";
import { fetchProjectMaterials } from "@/features/materials/api";
import { fetchConversations } from "@/features/tutor/api";
import { fetchProjectConcepts, fetchProjectQuizzes } from "@/features/quiz/api";
import { fetchGrowth, fetchRecommendations } from "@/features/growth/api";

const TABS = [
  { id: "overview", label: "Overview", icon: BookOpen },
  { id: "materials", label: "Materials", icon: FileText },
  { id: "tutor", label: "Tutor", icon: MessagesSquare },
  { id: "quiz", label: "Quiz", icon: GraduationCap },
  { id: "growth", label: "Growth", icon: Sprout },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
] as const;

type TabId = (typeof TABS)[number]["id"];

const TAB_IDS = TABS.map((t) => t.id) as readonly string[];

function isTabId(value: string | null): value is TabId {
  return value !== null && (TAB_IDS as readonly string[]).includes(value);
}

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
 * Project dashboard. Header + Overview are API-backed; other tabs keep
 * explicit placeholders until their stages land. Active tab lives in ?tab=.
 */
function ProjectDashboard({ spaceId, projectId }: { spaceId: string; projectId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const project = useProject(projectId);
  const overview = useProjectOverview(projectId);
  const queryClient = useQueryClient();

  const activeTab: TabId = isTabId(searchParams.get("tab"))
    ? (searchParams.get("tab") as TabId)
    : "overview";

  /**
   * Hover/keyboard prefetch: warm the next tab's queries while the user
   * is still deciding, so the switch renders data instead of skeletons.
   * prefetchQuery is staleTime-aware — fresh data is never refetched.
   * Failures are swallowed: a prefetch must never surface an error UI.
   */
  const prefetchedTabs = useRef<Set<TabId>>(new Set());
  function prefetchTab(tab: TabId) {
    if (tab === activeTab || tab === "overview" || tab === "analytics") return;
    if (prefetchedTabs.current.has(tab)) return;
    prefetchedTabs.current.add(tab);
    const safe = (promise: Promise<unknown>) =>
      promise.catch(() => undefined);
    // NOTE: call as queryClient.prefetchQuery(...) — never destructure the
    // method, it needs its `this` binding.
    if (tab === "materials") {
      void safe(
        queryClient.prefetchQuery({
          queryKey: queryKeys.materials(projectId),
          queryFn: ({ signal }) => fetchProjectMaterials(projectId, signal),
        })
      );
    } else if (tab === "tutor") {
      void safe(
        queryClient.prefetchQuery({
          queryKey: queryKeys.conversations(projectId),
          queryFn: ({ signal }) => fetchConversations(projectId, signal),
        })
      );
    } else if (tab === "quiz") {
      void safe(
        queryClient.prefetchQuery({
          queryKey: queryKeys.quizzes(projectId),
          queryFn: ({ signal }) => fetchProjectQuizzes(projectId, signal),
        })
      );
      void safe(
        queryClient.prefetchQuery({
          queryKey: queryKeys.concepts(projectId),
          queryFn: ({ signal }) => fetchProjectConcepts(projectId, signal),
        })
      );
    } else if (tab === "growth") {
      void safe(
        queryClient.prefetchQuery({
          queryKey: queryKeys.growth(projectId),
          queryFn: ({ signal }) => fetchGrowth(projectId, signal),
        })
      );
      void safe(
        queryClient.prefetchQuery({
          queryKey: queryKeys.recommendations(projectId),
          queryFn: ({ signal }) => fetchRecommendations(projectId, signal),
        })
      );
    }
  }

  function handleTabChange(next: string) {
    if (!isTabId(next) || next === activeTab) return;
    const params = new URLSearchParams(searchParams.toString());
    if (next === "overview") params.delete("tab");
    else params.set("tab", next);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  if (project.isPending) {
    return (
      <AppShell
        crumbs={[{ label: "Spaces", href: "/spaces" }, { label: "Project" }]}
        title="Project"
      >
        <PageContainer>
          <ProjectSkeleton />
        </PageContainer>
      </AppShell>
    );
  }

  if (project.isError) {
    const status = statusOf(project.error);
    return (
      <AppShell
        crumbs={[{ label: "Spaces", href: "/spaces" }, { label: "Project" }]}
        title="Project"
      >
        <PageContainer>
          {status === 404 ? (
            <NotFoundState onRetry={() => router.replace(`/spaces/${spaceId}`)} />
          ) : (
            <ErrorState status={status} onRetry={() => project.refetch()} />
          )}
        </PageContainer>
      </AppShell>
    );
  }

  const detail = project.data;

  // Chain integrity: the URL's space must match the project's real space.
  // Both endpoints enforce ownership server-side; this only fixes the
  // breadcrumb/header when someone hand-edits the URL.
  if (detail.space.id !== spaceId) {
    return (
      <AppShell
        crumbs={[{ label: "Spaces", href: "/spaces" }, { label: "Project" }]}
        title="Project"
      >
        <PageContainer>
          <NotFoundState onRetry={() => router.replace("/spaces")} />
        </PageContainer>
      </AppShell>
    );
  }

  return (
    <AppShell
      crumbs={[
        { label: "Spaces", href: "/spaces" },
        { label: detail.space.name, href: `/spaces/${detail.space.id}` },
        { label: detail.name },
      ]}
      title={detail.name}
    >
      <PageContainer className="flex flex-col gap-6">
        <FadeIn>
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={projectStatusTone(detail.status)}>
                {detail.status.charAt(0) + detail.status.slice(1).toLowerCase()}
              </StatusBadge>
              <span className="text-sm text-muted-foreground">
                {detail.space.name} · Active {formatDateTime(detail.lastActivityAt)}
              </span>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 flex-col gap-1.5">
                <h1 className="text-3xl font-semibold tracking-tight">{detail.name}</h1>
                <p className="max-w-2xl text-muted-foreground">
                  {detail.goal ||
                    detail.description ||
                    "No goal set yet — edit the project to add one."}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                  <Pencil aria-hidden /> Edit
                </Button>
                <Button variant="outline" size="sm" onClick={() => setDeleteOpen(true)}>
                  <Trash2 aria-hidden /> Delete
                </Button>
              </div>
            </div>
          </div>
        </FadeIn>

        <Tabs value={activeTab} onValueChange={handleTabChange} className="flex flex-col gap-6">
          <div className="overflow-x-auto scroll-smooth pb-1">
            <TabsList
              aria-label="Project sections"
              className="h-auto w-full justify-start gap-1 border bg-white p-1.5 sm:w-fit dark:border-slate-800 dark:bg-slate-950"
            >
              {TABS.map((tab) => {
                const Icon = tab.icon;
                return (
                  <TabsTrigger
                    key={tab.id}
                    value={tab.id}
                    className="gap-1.5 px-4 py-2 data-[state=active]:bg-slate-950 data-[state=active]:text-white dark:data-[state=active]:bg-white dark:data-[state=active]:text-slate-950"
                    onMouseEnter={() => prefetchTab(tab.id)}
                    onFocus={() => prefetchTab(tab.id)}
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                    {tab.label}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </div>

          <TabsContent value="overview" tabIndex={-1} className="animate-fade-slide-in motion-reduce:animate-none">
            <OverviewTabContent projectId={projectId} />
          </TabsContent>
          <TabsContent value="materials" tabIndex={-1} className="animate-fade-slide-in motion-reduce:animate-none">
            <div className="flex flex-col gap-6">
              <MaterialsTab projectId={projectId} />
              <SearchPanel projectId={projectId} />
            </div>
          </TabsContent>
          <TabsContent value="tutor" tabIndex={-1} className="animate-fade-slide-in motion-reduce:animate-none">
            <TutorPanel projectId={projectId} />
          </TabsContent>
          <TabsContent value="quiz" tabIndex={-1} className="animate-fade-slide-in motion-reduce:animate-none">
            <QuizTab projectId={projectId} />
          </TabsContent>
          <TabsContent value="growth" tabIndex={-1} className="animate-fade-slide-in motion-reduce:animate-none">
            <GrowthTab projectId={projectId} />
          </TabsContent>
          <TabsContent value="analytics" tabIndex={-1} className="animate-fade-slide-in motion-reduce:animate-none">
            <AnalyticsTab projectId={projectId} />
          </TabsContent>
        </Tabs>

        <EditProjectDialog project={detail} open={editOpen} onOpenChange={setEditOpen} />
        <DeleteProjectDialog
          spaceId={detail.space.id}
          projectId={detail.id}
          projectName={detail.name}
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
        />
      </PageContainer>
    </AppShell>
  );
}

function OverviewTabContent({ projectId }: { projectId: string }) {
  const data = useProjectOverview(projectId);
  if (data.isPending) {
    return <PageLoading label="Loading overview…" />;
  }
  if (data.isError) {
    return <ErrorState status={statusOf(data.error)} onRetry={() => data.refetch()} />;
  }
  return <OverviewContent overview={data.data} />;
}

function OverviewContent({
  overview,
}: {
  overview: NonNullable<ReturnType<typeof useProjectOverview>["data"]>;
}) {
  const {
    project,
    counts,
    mastery,
    recentActivity,
    recommendations,
    attentionConcepts,
    growth,
    nextRecommendation,
  } = overview;
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl bg-slate-950 p-5 text-white sm:p-6 dark:bg-white dark:text-slate-950">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">
          Learning goal
        </p>
        <p className="mt-1.5 max-w-2xl text-base leading-relaxed sm:text-lg">
          {project.goal || project.description || "No goal set yet — edit the project to add one."}
        </p>
      </div>

      <SectionCard title="Learning progress" description="Computed from real mastery evidence.">
        {mastery.average === null ? (
          <EmptyState
            title="No progress yet"
            message={
              mastery.totalConcepts === 0
                ? "Concepts appear here once learning materials are processed."
                : "Complete quizzes or tutor sessions to record mastery for these concepts."
            }
          />
        ) : (
          <div className="flex flex-col gap-1">
            <p className="text-3xl font-semibold tracking-tight">
              {Math.round(mastery.average * 100)}%
            </p>
            <p className="text-sm text-muted-foreground">
              Average across {mastery.assessedConcepts} of {mastery.totalConcepts} concepts.
              {growth.improving > 0 ? ` ${growth.improving} improving.` : ""}
              {growth.needsAttention > 0 ? ` ${growth.needsAttention} need attention.` : ""}
            </p>
          </div>
        )}
      </SectionCard>

      {attentionConcepts.length > 0 ? (
        <SectionCard title="Needs attention" description="Weakest assessed concepts.">
          <ul className="flex flex-col gap-2">
            {attentionConcepts.map((concept) => (
              <li
                key={concept.conceptId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-2.5 text-sm"
              >
                <Link className="font-medium underline-offset-4 hover:underline" href="?tab=growth">
                  {concept.name}
                </Link>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {Math.round(concept.masteryScore * 100)}%
                </span>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      <SectionCard title="Recommended next action" description="What to do next, and why.">
        {nextRecommendation ? (
          <div className="rounded-2xl border p-4">
            <p className="text-sm font-medium">{nextRecommendation.title}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{nextRecommendation.priority.toLowerCase()}</Badge>
              <Button type="button" size="sm" asChild>
                <Link href="?tab=quiz">Practice now</Link>
              </Button>
              <Button type="button" size="sm" variant="outline" asChild>
                <Link href="?tab=growth">Why this?</Link>
              </Button>
            </div>
          </div>
        ) : recommendations.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {recommendations.map((rec) => (
              <li key={rec.id} className="rounded-lg border p-4">
                <p className="text-sm font-medium">{rec.title}</p>
                {rec.description ? (
                  <p className="mt-1 text-sm text-muted-foreground">{rec.description}</p>
                ) : null}
                <p className="mt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Priority: {rec.priority.toLowerCase()}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title="No recommendations yet"
            message="As you learn, the workspace will suggest the single most useful next step here."
          />
        )}
      </SectionCard>

      <div className="grid gap-4 sm:grid-cols-3">
        <SectionCard title="Materials">
          <p className="text-2xl font-semibold">{counts.materials}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {counts.materials === 0
              ? "Upload a PDF to begin building your learning context."
              : "Documents in this project."}
          </p>
        </SectionCard>
        <SectionCard title="Concepts">
          <p className="text-2xl font-semibold">{counts.concepts}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {counts.concepts === 0
              ? "Extracted from materials in a later stage."
              : "Tracked ideas."}
          </p>
        </SectionCard>
        <SectionCard title="Assessments">
          <p className="text-2xl font-semibold">{counts.assessments}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {counts.assessments === 0
              ? "Complete some learning activity before starting an adaptive assessment."
              : "Graded evaluations."}
          </p>
        </SectionCard>
      </div>

      <SectionCard title="Recent activity" description="Latest events in this project.">
        {recentActivity.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {recentActivity.map((event) => (
              <li
                key={event.id}
                className="flex items-center justify-between gap-3 rounded-xl border px-4 py-2.5 text-sm"
              >
                <span className="font-medium">
                  {event.eventType.replaceAll("_", " ").toLowerCase()}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatDateTime(event.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState preset="analytics" />
        )}
      </SectionCard>
    </div>
  );
}

export default function ProjectDetailPage({
  params,
}: {
  params: { spaceId: string; projectId: string };
}) {
  return (
    <RequireAuth>
      <Suspense fallback={<PageLoading label="Loading project…" />}>
        <ProjectDashboard spaceId={params.spaceId} projectId={params.projectId} />
      </Suspense>
    </RequireAuth>
  );
}
