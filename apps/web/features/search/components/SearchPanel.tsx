"use client";

import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { Search, X } from "lucide-react";
import { ApiErrorAlert } from "@/components/shared/api-error-alert";
import { EmptyState, Spinner } from "@/components/shared/states";
import { MaterialsSkeleton } from "@/components/shared/skeletons";
import { SectionCard } from "@/components/shared/cards";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ApiClientError, toUserMessage } from "@/lib/api/errors";
import { useProjectSearch } from "../hooks";

/**
 * Retrieval test interface. Lives in the project materials area so the
 * search layer can be verified before Tutor integration: real endpoint,
 * real project evidence, loading/empty/error states — never mock results.
 */
export function SearchPanel({ projectId }: { projectId: string }) {
  const [query, setQuery] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const search = useProjectSearch(projectId);
  // Last-wins guard: mutations resolve in any order, so a slow first
  // submit must never overwrite the results of a newer one. The query
  // each resolution belongs to is captured at submit time and compared
  // at render — stale data is hidden, never shown.
  const submittedQuery = useRef<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = query.replace(/\s+/g, " ").trim();
    if (normalized.length === 0) {
      setLocalError("Type a question or keyword to search this project's materials.");
      return;
    }
    if (normalized.length > 500) {
      setLocalError("Keep the query under 500 characters.");
      return;
    }
    setLocalError(null);
    submittedQuery.current = normalized;
    search.mutate({ query: normalized });
  }

  function handleClear() {
    setQuery("");
    setLocalError(null);
    // Invalidate any in-flight resolution so a late response for the old
    // query cannot repopulate results the user just cleared.
    submittedQuery.current = null;
    search.reset();
  }

  const error = search.error;
  const requestId = error instanceof ApiClientError ? error.requestId : undefined;
  // Only the latest submission's response may render. A stale resolution
  // (slow first submit, cleared query) stays in the mutation cache but is
  // never shown — and it is replaced the moment the newer one lands.
  const freshData =
    search.data && search.data.query === submittedQuery.current ? search.data : null;

  return (
    <SectionCard
      title="Search materials"
      description="Test hybrid retrieval over this project's indexed knowledge."
    >
      <div className="flex flex-col gap-4">
        <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row" role="search">
          <label htmlFor="project-search" className="sr-only">
            Search project materials
          </label>
          <Input
            id="project-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Try a concept, keyword, or question…"
            autoComplete="off"
            maxLength={500}
            className="flex-1"
          />
          <div className="flex gap-2">
            <Button type="submit" disabled={search.isPending}>
              {search.isPending ? (
                <>
                  <Spinner className="mr-2" label="Searching…" /> Searching…
                </>
              ) : (
                <>
                  <Search className="mr-2 h-4 w-4" aria-hidden /> Search
                </>
              )}
            </Button>
            {(query || freshData || search.isError) && (
              <Button type="button" variant="outline" onClick={handleClear}>
                <X className="mr-2 h-4 w-4" aria-hidden /> Clear
              </Button>
            )}
          </div>
        </form>

        {localError ? (
          <p role="alert" className="text-sm text-destructive">
            {localError}
          </p>
        ) : null}

        {error ? <ApiErrorAlert message={toUserMessage(error)} requestId={requestId} /> : null}

        {search.isPending ? <MaterialsSkeleton rows={2} /> : null}

        {freshData && freshData.results.length === 0 ? (
          <EmptyState
            title="No relevant evidence found"
            message="Nothing in this project's indexed materials matches. Try different keywords, or check back after materials finish processing."
          />
        ) : null}

        {freshData && freshData.results.length > 0 ? (
          <div className="flex flex-col gap-3" aria-live="polite">
            <p className="text-sm text-muted-foreground">
              {freshData.meta.resultCount} {freshData.meta.resultCount === 1 ? "result" : "results"}{" "}
              in {freshData.meta.totalMs}ms
              {freshData.meta.semanticMs === 0 ? " (lexical only)" : null}
            </p>
            {freshData.results.map((result) => (
              <Card key={result.chunkId}>
                <CardContent className="flex flex-col gap-2 p-4 sm:p-5">
                  <p className="text-sm leading-relaxed">{result.content}</p>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="secondary">{result.materialName}</Badge>
                    {result.pageNumber !== null ? <span>Page {result.pageNumber}</span> : null}
                    <span title="Combined hybrid relevance score (0–1 similarity, not a probability)">
                      Score {result.score.toFixed(2)}
                    </span>
                    {result.retrieval.semantic !== null ? (
                      <span title="Semantic (pgvector cosine) similarity">
                        semantic {result.retrieval.semantic.toFixed(2)}
                      </span>
                    ) : (
                      <span title="No semantic match — lexical only">lexical only</span>
                    )}
                    {result.retrieval.lexical !== null ? (
                      <span title="Lexical (full-text) similarity">
                        lexical {result.retrieval.lexical.toFixed(2)}
                      </span>
                    ) : (
                      <span title="No keyword match — semantic only">semantic only</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}
