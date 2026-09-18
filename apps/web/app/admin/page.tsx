"use client";

import { Suspense } from "react";
import dynamic from "next/dynamic";
import {
  Activity,
  Bot,
  Briefcase,
  GraduationCap,
  HeartPulse,
  LayoutDashboard,
  Receipt,
  Users,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { FadeIn } from "@/components/shared/motion";
import { PageContainer, PageHeader } from "@/components/shared/page";
import { CardSkeleton, PageLoading } from "@/components/shared/states";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RequireAdmin } from "@/features/auth";
import { OverviewSection } from "@/features/admin";

/**
 * Heavy admin sections load per tab: each is its own chunk fetched on
 * first visit, with skeletons so tab switches feel instant.
 */
const UsersSection = dynamic(() => import("@/features/admin").then((m) => m.UsersSection), {
  loading: () => <CardSkeleton />,
});
const ActivitySection = dynamic(() => import("@/features/admin").then((m) => m.ActivitySection), {
  loading: () => <CardSkeleton />,
});
const LearningSection = dynamic(() => import("@/features/admin").then((m) => m.LearningSection), {
  loading: () => <CardSkeleton />,
});
const AIUsageSection = dynamic(() => import("@/features/admin").then((m) => m.AIUsageSection), {
  loading: () => <CardSkeleton />,
});
const AIEvaluationsSection = dynamic(
  () => import("@/features/admin").then((m) => m.AIEvaluationsSection),
  { loading: () => <CardSkeleton /> }
);
const JobsSection = dynamic(() => import("@/features/admin").then((m) => m.JobsSection), {
  loading: () => <CardSkeleton />,
});
const SystemHealthSection = dynamic(
  () => import("@/features/admin").then((m) => m.SystemHealthSection),
  { loading: () => <CardSkeleton /> }
);

const SECTIONS = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "users", label: "Users", icon: Users },
  { id: "activity", label: "Activity", icon: Activity },
  { id: "learning", label: "Learning", icon: GraduationCap },
  { id: "ai-usage", label: "AI Usage", icon: Receipt },
  { id: "ai-evaluations", label: "AI Evaluations", icon: Bot },
  { id: "jobs", label: "Jobs", icon: Briefcase },
  { id: "health", label: "Health", icon: HeartPulse },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

const SECTION_IDS = SECTIONS.map((s) => s.id) as readonly string[];

function isSectionId(value: string | null): value is SectionId {
  return value !== null && (SECTION_IDS as readonly string[]).includes(value);
}

/**
 * Admin dashboard. Every section reads requireAdmin API endpoints —
 * RequireAdmin guards the route client-side, but authorization is
 * enforced server-side (non-admins get 403 on every call).
 */
function AdminDashboard() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active: SectionId = isSectionId(searchParams.get("section"))
    ? (searchParams.get("section") as SectionId)
    : "overview";

  function handleChange(next: string) {
    if (!isSectionId(next) || next === active) return;
    const params = new URLSearchParams(searchParams.toString());
    if (next === "overview") params.delete("section");
    else params.set("section", next);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <AppShell crumbs={[{ label: "Admin" }]} title="Admin dashboard">
      <PageContainer className="flex flex-col gap-6">
        <FadeIn>
          <PageHeader
            title="Admin dashboard"
            description="System activity, learning, AI usage, jobs, and health — all from persisted data."
          />
        </FadeIn>

        <Tabs value={active} onValueChange={handleChange} className="flex flex-col gap-6">
          <div className="overflow-x-auto pb-1">
            <TabsList aria-label="Admin sections">
              {SECTIONS.map((section) => {
                const Icon = section.icon;
                return (
                  <TabsTrigger
                    key={section.id}
                    value={section.id}
                    className="gap-1.5 data-[state=active]:bg-slate-950 data-[state=active]:text-white dark:data-[state=active]:bg-white dark:data-[state=active]:text-slate-950"
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                    {section.label}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </div>

          <TabsContent value="overview" tabIndex={-1}>
            <OverviewSection />
          </TabsContent>
          <TabsContent value="users" tabIndex={-1}>
            <UsersSection />
          </TabsContent>
          <TabsContent value="activity" tabIndex={-1}>
            <ActivitySection />
          </TabsContent>
          <TabsContent value="learning" tabIndex={-1}>
            <LearningSection />
          </TabsContent>
          <TabsContent value="ai-usage" tabIndex={-1}>
            <AIUsageSection />
          </TabsContent>
          <TabsContent value="ai-evaluations" tabIndex={-1}>
            <AIEvaluationsSection />
          </TabsContent>
          <TabsContent value="jobs" tabIndex={-1}>
            <JobsSection />
          </TabsContent>
          <TabsContent value="health" tabIndex={-1}>
            <SystemHealthSection />
          </TabsContent>
        </Tabs>
      </PageContainer>
    </AppShell>
  );
}

export default function AdminPage() {
  return (
    <RequireAdmin>
      <Suspense fallback={<PageLoading label="Loading admin…" />}>
        <AdminDashboard />
      </Suspense>
    </RequireAdmin>
  );
}
