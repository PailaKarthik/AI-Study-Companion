import { Skeleton } from "@/components/ui/skeleton";

/**
 * Page-matched loading skeletons. Each mirrors its real layout (same
 * grids, rows, and proportions) so content replaces shapes 1:1 without
 * layout shift. Generic spinners are for small actions only.
 */

function Label({ children }: { children: string }) {
  return <span className="sr-only">{children}</span>;
}

export function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-label="Loading dashboard">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="h-9 w-32" />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Skeleton className="h-[124px] w-full rounded-2xl" />
        <Skeleton className="h-[124px] w-full rounded-2xl" />
        <Skeleton className="h-[124px] w-full rounded-2xl" />
      </div>
      <Skeleton className="h-44 w-full rounded-3xl" />
      <div className="grid items-stretch gap-4 lg:grid-cols-2">
        <Skeleton className="h-64 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
      <Label>Loading your dashboard…</Label>
    </div>
  );
}

export function SpacesGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
      role="status"
      aria-label="Loading spaces"
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex flex-col gap-4 rounded-2xl border p-5">
          <div className="flex items-start justify-between">
            <Skeleton className="h-11 w-11 rounded-xl" />
            <Skeleton className="h-4 w-4 rounded" />
          </div>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-full" />
          </div>
          <Skeleton className="h-4 w-1/2" />
        </div>
      ))}
      <Label>Loading spaces…</Label>
    </div>
  );
}

export function SpaceDetailSkeleton() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-label="Loading space">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-28" />
        </div>
      </div>
      <Skeleton className="h-10 w-full max-w-md rounded-full" />
      <SpacesGridSkeleton count={3} />
      <Label>Loading space…</Label>
    </div>
  );
}

export function ProjectSkeleton() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-label="Loading project">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-9 w-72 max-w-full" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <div className="flex gap-2 overflow-hidden">
        {["w-24", "w-28", "w-20", "w-20", "w-24", "w-24"].map((w, i) => (
          <Skeleton key={i} className={`h-8 ${w} shrink-0 rounded-full`} />
        ))}
      </div>
      <Skeleton className="h-32 w-full rounded-2xl" />
      <div className="grid gap-4 sm:grid-cols-3">
        <Skeleton className="h-28 w-full rounded-2xl" />
        <Skeleton className="h-28 w-full rounded-2xl" />
        <Skeleton className="h-28 w-full rounded-2xl" />
      </div>
      <Label>Loading project…</Label>
    </div>
  );
}

export function MaterialsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3" role="status" aria-label="Loading materials">
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="flex flex-col gap-2 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"
        >
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-48 max-w-full" />
            <div className="flex gap-2">
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-4 w-24" />
            </div>
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-8 w-20" />
          </div>
        </div>
      ))}
      <Label>Loading materials…</Label>
    </div>
  );
}

export function QuizHistorySkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2" role="status" aria-label="Loading quizzes">
      <Skeleton className="hidden h-4 w-full sm:block" />
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="grid grid-cols-1 gap-2 rounded-2xl border p-4 sm:grid-cols-[minmax(0,1fr)_80px_90px_130px_190px] sm:items-center sm:p-5"
        >
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-56 max-w-full" />
            <div className="flex gap-2">
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-4 w-24" />
            </div>
          </div>
          <Skeleton className="h-4 w-12 sm:justify-self-end" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-5 w-24 rounded-full" />
          <div className="flex gap-2 sm:justify-end">
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-8 w-20" />
          </div>
        </div>
      ))}
      <Label>Loading quizzes…</Label>
    </div>
  );
}

export function QuizTakerSkeleton() {
  return (
    <div className="flex flex-col gap-4" role="status" aria-label="Loading attempt">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-8 w-16" />
      </div>
      <Skeleton className="h-2 w-full rounded-full" />
      <div className="flex flex-col gap-4 rounded-2xl border p-4 sm:p-6">
        <div className="flex gap-2">
          <Skeleton className="h-5 w-28 rounded-full" />
          <Skeleton className="h-5 w-24 rounded-full" />
        </div>
        <Skeleton className="h-5 w-3/4" />
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 w-full rounded-xl" />
          ))}
        </div>
      </div>
      <Label>Loading attempt…</Label>
    </div>
  );
}

export function QuizReviewSkeleton() {
  return (
    <div className="flex flex-col gap-4" role="status" aria-label="Loading review">
      <div className="flex gap-2">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-8 w-28" />
      </div>
      <div className="flex flex-col gap-3 rounded-2xl border p-5">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64 max-w-full" />
      </div>
      {[0, 1].map((i) => (
        <div key={i} className="flex flex-col gap-2 rounded-2xl border p-4 sm:p-5">
          <div className="flex gap-2">
            <Skeleton className="h-5 w-24 rounded-full" />
            <Skeleton className="h-4 w-32" />
          </div>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      ))}
      <Label>Loading review…</Label>
    </div>
  );
}

export function GrowthSkeleton() {
  return (
    <div className="flex flex-col gap-4" role="status" aria-label="Loading growth">
      <div className="flex flex-col gap-2 rounded-2xl border p-5">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-2 w-full rounded-full" />
        <Skeleton className="h-4 w-64 max-w-full" />
      </div>
      <div className="flex flex-col gap-2 rounded-2xl border p-5">
        <Skeleton className="h-4 w-48" />
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-2.5 flex-1 rounded-full" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-2 rounded-2xl border px-4 py-2.5">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-40" />
            <div className="flex gap-2">
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-5 w-24 rounded-full" />
            </div>
          </div>
          <Skeleton className="h-2 w-full rounded-full" />
        </div>
      ))}
      <Label>Loading growth…</Label>
    </div>
  );
}

export function AnalyticsSkeleton() {
  return (
    <div className="flex flex-col gap-4" role="status" aria-label="Loading analytics">
      <div className="flex gap-2">
        <Skeleton className="h-8 w-20 rounded-full" />
        <Skeleton className="h-8 w-20 rounded-full" />
        <Skeleton className="h-8 w-20 rounded-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[124px] w-full rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-48 w-full rounded-2xl" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-56 w-full rounded-2xl" />
        <Skeleton className="h-56 w-full rounded-2xl" />
      </div>
      <Label>Loading analytics…</Label>
    </div>
  );
}

export function AdminTableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-4" role="status" aria-label="Loading records">
      <div className="flex flex-wrap gap-3">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-9 w-40" />
      </div>
      <div className="flex flex-col gap-2">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-xl border px-4 py-2.5">
            <div className="flex items-center gap-2">
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-4 w-48 max-w-full" />
            </div>
            <Skeleton className="h-3 w-72 max-w-full" />
          </div>
        ))}
      </div>
      <Label>Loading records…</Label>
    </div>
  );
}

export function AdminOverviewSkeleton() {
  return (
    <div className="flex flex-col gap-4" role="status" aria-label="Loading overview">
      <Skeleton className="h-44 w-full rounded-3xl" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[124px] w-full rounded-2xl" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-56 w-full rounded-2xl" />
        <Skeleton className="h-56 w-full rounded-2xl" />
      </div>
      <Label>Loading overview…</Label>
    </div>
  );
}

export function ConversationSkeleton() {
  return (
    <div className="flex flex-col gap-3" role="status" aria-label="Loading conversation">
      <div className="flex flex-col gap-2 rounded-2xl border p-4 sm:p-5">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-16 w-full rounded-xl" />
      </div>
      <div className="flex justify-end">
        <Skeleton className="h-12 w-2/3 rounded-2xl" />
      </div>
      <div className="flex flex-col gap-2 rounded-2xl border p-4 sm:p-5">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
      </div>
      <Label>Loading conversation…</Label>
    </div>
  );
}
