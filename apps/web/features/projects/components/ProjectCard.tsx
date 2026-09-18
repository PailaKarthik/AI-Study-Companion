import Link from "next/link";
import { ArrowRight, BookOpen } from "lucide-react";
import type { ProjectSummary } from "@ai-study-companion/shared";
import { StatusBadge, projectStatusTone } from "@/components/shared/status";

const STATUS_LABEL: Record<ProjectSummary["status"], string> = {
  ACTIVE: "Active",
  ARCHIVED: "Archived",
  COMPLETED: "Completed",
};

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** Project card: identity, goal, status, counts, activity footer. Links to the project. */
export function ProjectCard({ project }: { project: ProjectSummary }) {
  const href = `/spaces/${project.spaceId}/projects/${project.id}`;
  return (
    <Link
      href={href}
      className="block h-full rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`Open project ${project.name}`}
    >
      <article className="group flex h-full flex-col gap-3 rounded-2xl border bg-card p-5 transition-transform hover:-translate-y-0.5 motion-reduce:transform-none">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-950 text-white dark:bg-white dark:text-slate-950">
              <BookOpen className="h-4 w-4" aria-hidden />
            </span>
            <StatusBadge tone={projectStatusTone(project.status)}>
              {STATUS_LABEL[project.status]}
            </StatusBadge>
          </span>
          <ArrowRight
            className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none"
            aria-hidden
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="truncate text-base font-semibold tracking-tight">{project.name}</h3>
          <p className="line-clamp-2 min-h-10 text-sm text-muted-foreground">
            {project.goal || project.description || "No goal set yet."}
          </p>
        </div>
        <div className="mt-auto flex items-center gap-2 border-t pt-3 text-xs text-muted-foreground">
          <span className="font-medium text-foreground tabular-nums">
            {project.materialCount === 1 ? "1 material" : `${project.materialCount} materials`}
          </span>
          <span aria-hidden>·</span>
          <span className="tabular-nums">
            {project.conceptCount === 1 ? "1 concept" : `${project.conceptCount} concepts`}
          </span>
          {formatDate(project.lastActivityAt) ? (
            <>
              <span aria-hidden>·</span>
              <span className="ml-auto shrink-0">{formatDate(project.lastActivityAt)}</span>
            </>
          ) : null}
        </div>
      </article>
    </Link>
  );
}
