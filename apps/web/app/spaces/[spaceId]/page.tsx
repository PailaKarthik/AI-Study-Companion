"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { FadeIn, StaggerGroup, StaggerItem } from "@/components/shared/motion";
import { PageContainer, PageHeader } from "@/components/shared/page";
import { CardSkeleton, EmptyState, ErrorState, NotFoundState } from "@/components/shared/states";
import { SpaceDetailSkeleton } from "@/components/shared/skeletons";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RequireAuth } from "@/features/auth";
import { CreateProjectDialog, ProjectCard } from "@/features/projects";
import { DeleteSpaceDialog, EditSpaceDialog, useSpace } from "@/features/spaces";
import { useProjects, useProjectStatusCounts } from "@/features/projects";
import type { ProjectStatusFilter } from "@/features/projects/api";
import { statusOf } from "@/lib/api/http-status";

const STATUS_TABS: { id: ProjectStatusFilter; label: string }[] = [
  { id: "ALL", label: "All" },
  { id: "ACTIVE", label: "Active" },
  { id: "COMPLETED", label: "Completed" },
  { id: "ARCHIVED", label: "Archived" },
];

function isStatusFilter(value: string | null): value is ProjectStatusFilter {
  return value === "ALL" || value === "ACTIVE" || value === "COMPLETED" || value === "ARCHIVED";
}

/**
 * Space detail: real name/description/count, real project list, real
 * create/edit/delete. Unknown or foreign spaces render NotFoundState —
 * the API answers 404 for both, so nothing leaks.
 */
function SpaceContent({ spaceId }: { spaceId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const space = useSpace(spaceId);

  // Server-side status filter in ?status= — survives refresh and is
  // shareable. "ALL" (default) omits the param entirely.
  const statusParam = searchParams.get("status");
  const statusFilter: ProjectStatusFilter = isStatusFilter(statusParam) ? statusParam : "ALL";
  const projects = useProjects(spaceId, {
    page: 1,
    pageSize: 50,
    ...(statusFilter === "ALL" ? {} : { status: statusFilter }),
  });
  const counts = useProjectStatusCounts(spaceId);

  function handleStatusChange(next: string) {
    if (!isStatusFilter(next) || next === statusFilter) return;
    const params = new URLSearchParams(searchParams.toString());
    if (next === "ALL") params.delete("status");
    else params.set("status", next);
    const query = params.toString();
    router.replace(query ? `?${query}` : "?", { scroll: false });
  }

  if (space.isPending) {
    return (
      <AppShell crumbs={[{ label: "Spaces", href: "/spaces" }, { label: "Space" }]} title="Space">
        <PageContainer className="flex flex-col gap-6">
          <SpaceDetailSkeleton />
        </PageContainer>
      </AppShell>
    );
  }

  if (space.isError) {
    const status = statusOf(space.error);
    return (
      <AppShell crumbs={[{ label: "Spaces", href: "/spaces" }, { label: "Space" }]} title="Space">
        <PageContainer>
          {status === 404 ? (
            <NotFoundState onRetry={() => router.replace("/spaces")} />
          ) : (
            <ErrorState status={status} onRetry={() => space.refetch()} />
          )}
        </PageContainer>
      </AppShell>
    );
  }

  const detail = space.data;

  return (
    <AppShell
      crumbs={[{ label: "Spaces", href: "/spaces" }, { label: detail.name }]}
      title={detail.name}
    >
      <PageContainer className="flex flex-col gap-6">
        <FadeIn>
          <PageHeader
            title={detail.name}
            description={
              detail.description ||
              "No description yet — edit the space to describe what you'll learn here."
            }
            actions={
              <>
                {counts.data ? (
                  <span
                    className="rounded-full bg-slate-950 px-3 py-1 text-xs font-semibold tabular-nums text-white dark:bg-white dark:text-slate-950"
                    aria-live="polite"
                  >
                    {counts.data.all === 1 ? "1 project" : `${counts.data.all} projects`}
                  </span>
                ) : null}
                <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                  <Pencil aria-hidden /> Edit
                </Button>
                <Button variant="outline" size="sm" onClick={() => setDeleteOpen(true)}>
                  <Trash2 aria-hidden /> Delete
                </Button>
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  <Plus aria-hidden /> New project
                </Button>
              </>
            }
          />
        </FadeIn>

        {projects.isPending ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Loading projects">
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </div>
        ) : projects.isError ? (
          <ErrorState status={statusOf(projects.error)} onRetry={() => projects.refetch()} />
        ) : (
          <div className="flex flex-col gap-4">
            <Tabs value={statusFilter} onValueChange={handleStatusChange}>
              <div className="overflow-x-auto pb-1">
                <TabsList aria-label="Filter projects by status">
                  {STATUS_TABS.map((tab) => {
                    const count = tab.id === "ALL" ? counts.data?.all : counts.data?.[tab.id];
                    return (
                      <TabsTrigger
                        key={tab.id}
                        value={tab.id}
                        className="gap-1.5 data-[state=active]:bg-slate-950 data-[state=active]:text-white dark:data-[state=active]:bg-white dark:data-[state=active]:text-slate-950"
                      >
                        {tab.label}
                        <span
                          className="rounded-full bg-slate-950/10 px-1.5 py-0.5 text-[11px] tabular-nums dark:bg-white/15"
                          aria-label={`${count ?? "…"} ${tab.label.toLowerCase()} projects`}
                        >
                          {count ?? "…"}
                        </span>
                      </TabsTrigger>
                    );
                  })}
                </TabsList>
              </div>
            </Tabs>
            {projects.isFetching ? (
              <p className="text-xs text-muted-foreground" role="status">
                Updating list…
              </p>
            ) : null}
            {projects.data.total === 0 ? (
              statusFilter === "ALL" ? (
                <EmptyState
                  preset="projects"
                  action={
                    <Button onClick={() => setCreateOpen(true)} variant="outline" size="sm">
                      <Plus aria-hidden /> Create your first project
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  title={`No ${statusFilter.toLowerCase()} projects`}
                  message={
                    statusFilter === "ACTIVE"
                      ? "Every project here is completed or archived. Start something new."
                      : statusFilter === "COMPLETED"
                        ? "Finished projects will land here once you mark them complete."
                        : "Archived projects are kept here for reference."
                  }
                  action={
                    <Button onClick={() => setCreateOpen(true)} variant="outline" size="sm">
                      <Plus aria-hidden /> New project
                    </Button>
                  }
                />
              )
            ) : (
              <StaggerGroup className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {projects.data.items.map((project) => (
                  <StaggerItem key={project.id}>
                    <ProjectCard project={project} />
                  </StaggerItem>
                ))}
              </StaggerGroup>
            )}
          </div>
        )}

        <CreateProjectDialog spaceId={spaceId} open={createOpen} onOpenChange={setCreateOpen} />
        <EditSpaceDialog space={detail} open={editOpen} onOpenChange={setEditOpen} />
        <DeleteSpaceDialog
          spaceId={spaceId}
          spaceName={detail.name}
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
        />
      </PageContainer>
    </AppShell>
  );
}

export default function SpaceDetailPage({ params }: { params: { spaceId: string } }) {
  return (
    <RequireAuth>
      <SpaceContent spaceId={params.spaceId} />
    </RequireAuth>
  );
}
