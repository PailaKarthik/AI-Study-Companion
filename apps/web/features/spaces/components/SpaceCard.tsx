import Link from "next/link";
import { ArrowUpRight, FolderOpen } from "lucide-react";
import type { SpaceSummary } from "@ai-study-companion/shared";

function safeColor(color: string | null): string | null {
  return color && /^#[0-9a-f]{6}$/i.test(color.trim()) ? color.trim() : null;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Space card: identity tile (user color + icon), name, meta row, hover
 * affordance. Color comes from the space itself — never invented.
 */
export function SpaceCard({ space }: { space: SpaceSummary }) {
  const accent = safeColor(space.color);
  return (
    <Link
      href={`/spaces/${space.id}`}
      className="block h-full rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`Open space ${space.name}`}
    >
      <article className="flex h-full flex-col gap-4 rounded-2xl border bg-card p-5 transition-transform hover:-translate-y-0.5 motion-reduce:transform-none">
        <div className="flex items-start justify-between gap-3">
          {accent ? (
            <span
              aria-hidden
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-lg font-semibold"
              style={{ backgroundColor: `${accent}1a`, color: accent }}
            >
              {space.icon ?? <FolderOpen className="h-5 w-5" />}
            </span>
          ) : (
            <span
              aria-hidden
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-lg text-white dark:bg-white dark:text-slate-950"
            >
              {space.icon ?? <FolderOpen className="h-5 w-5" />}
            </span>
          )}
          <ArrowUpRight
            className="h-4 w-4 shrink-0 text-muted-foreground transition-transform"
            aria-hidden
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="truncate text-base font-semibold tracking-tight">{space.name}</h3>
          <p className="line-clamp-2 min-h-10 text-sm text-muted-foreground">
            {space.description || "No description yet."}
          </p>
        </div>
        <div className="mt-auto flex items-center gap-2 border-t pt-3 text-xs text-muted-foreground">
          <span className="font-medium text-foreground tabular-nums">
            {space.projectCount === 1 ? "1 project" : `${space.projectCount} projects`}
          </span>
          {formatDate(space.updatedAt) ? <span aria-hidden>·</span> : null}
          {formatDate(space.updatedAt) ? <span>Updated {formatDate(space.updatedAt)}</span> : null}
        </div>
      </article>
    </Link>
  );
}
