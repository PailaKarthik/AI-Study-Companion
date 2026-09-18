"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { FadeIn, StaggerGroup, StaggerItem } from "@/components/shared/motion";
import { PageContainer, PageHeader } from "@/components/shared/page";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/shared/states";
import { SpacesGridSkeleton } from "@/components/shared/skeletons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RequireAuth } from "@/features/auth";
import { CreateSpaceDialog, SpaceCard, useSpaces } from "@/features/spaces";
import { statusOf } from "@/lib/api/http-status";
import { useDebouncedValue } from "@/lib/use-debounced-value";

/**
 * Spaces index: real list (paginated + searchable), real create dialog,
 * real cards. Loading skeletons while fetching; honest empty state.
 */
function SpacesContent() {
  const [createOpen, setCreateOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 300);
  const spaces = useSpaces({ page, pageSize: 12, q: debouncedQuery || undefined });

  function handleSearch(value: string) {
    setQuery(value);
    setPage(1);
  }

  const totalPages =
    spaces.data !== undefined
      ? Math.max(1, Math.ceil(spaces.data.total / spaces.data.pageSize))
      : 1;

  return (
    <AppShell crumbs={[{ label: "Spaces" }]} title="Spaces">
      <PageContainer className="flex flex-col gap-6">
        <FadeIn>
          <PageHeader
            title="Spaces"
            description="Group your learning by subject — Machine Learning, Mathematics, and beyond."
            actions={
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {spaces.data ? (
                  <span
                    className="rounded-full bg-slate-950 px-3 py-1 text-xs font-semibold tabular-nums text-white dark:bg-white dark:text-slate-950"
                    aria-live="polite"
                  >
                    {spaces.data.total === 1 ? "1 space" : `${spaces.data.total} spaces`}
                  </span>
                ) : null}
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus aria-hidden /> New space
                </Button>
              </div>
            }
          />
        </FadeIn>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <label htmlFor="space-search" className="sr-only">
            Search spaces
          </label>
          <Input
            id="space-search"
            type="search"
            placeholder="Search by name…"
            autoComplete="off"
            value={query}
            onChange={(event) => handleSearch(event.target.value)}
            className="sm:max-w-xs"
          />
        </div>

        {spaces.isPending ? (
          <SpacesGridSkeleton count={6} />
        ) : spaces.isError ? (
          <ErrorState status={statusOf(spaces.error)} onRetry={() => spaces.refetch()} />
        ) : spaces.data.total === 0 && !debouncedQuery ? (
          <EmptyState
            preset="spaces"
            action={
              <Button onClick={() => setCreateOpen(true)} variant="outline" size="sm">
                <Plus aria-hidden /> Create your first space
              </Button>
            }
          />
        ) : spaces.data.total === 0 ? (
          <EmptyState
            title="No spaces match your search"
            message={`Nothing named “${debouncedQuery}” yet. Try a different term or create it.`}
            action={
              <Button onClick={() => setCreateOpen(true)} variant="outline" size="sm">
                <Plus aria-hidden /> Create space
              </Button>
            }
          />
        ) : (
          <>
            <StaggerGroup className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {spaces.data.items.map((space) => (
                <StaggerItem key={space.id}>
                  <SpaceCard space={space} />
                </StaggerItem>
              ))}
            </StaggerGroup>
            {totalPages > 1 ? (
              <nav aria-label="Spaces pages" className="flex items-center justify-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1 || spaces.isFetching}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <p className="text-sm text-muted-foreground" aria-live="polite">
                  Page {page} of {totalPages} · {spaces.data.total} total
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages || spaces.isFetching}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next
                </Button>
              </nav>
            ) : null}
          </>
        )}

        {spaces.isFetching && !spaces.isPending ? <ListSkeleton rows={1} /> : null}

        <CreateSpaceDialog open={createOpen} onOpenChange={setCreateOpen} />
      </PageContainer>
    </AppShell>
  );
}

export default function SpacesPage() {
  return (
    <RequireAuth>
      <SpacesContent />
    </RequireAuth>
  );
}
