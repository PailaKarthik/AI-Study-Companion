"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import {
  ArrowUp,
  FileText,
  MessageSquarePlus,
  PanelLeft,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { ApiErrorAlert } from "@/components/shared/api-error-alert";
import { MarkdownText } from "@/components/shared/markdown";
import { EmptyState, ErrorState, ThinkingDots } from "@/components/shared/states";
import { ConversationSkeleton } from "@/components/shared/skeletons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ApiClientError, toUserMessage } from "@/lib/api/errors";
import { cn } from "@/lib/utils";
import type { ConversationSummary, TutorMessageItem } from "@ai-study-companion/shared";
import { useConversation, useConversations, useTutorAsk } from "../hooks";

const MAX_MESSAGE_LENGTH = 8000;

function dayGroup(iso: string | null): string {
  if (!iso) return "Earlier";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Earlier";
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const diff =
    startOfToday - new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  if (diff <= 0) return "Today";
  if (diff <= dayMs) return "Yesterday";
  if (diff <= 7 * dayMs) return "Previous 7 days";
  return "Earlier";
}

function formatGroupDate(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/* ---------------------------------- messages ---------------------------------- */

const AssistantMessage = memo(function AssistantMessage({ message }: { message: TutorMessageItem }) {
  return (
    <div className="flex items-start gap-2.5">
      <span
        className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-950 text-white dark:bg-white dark:text-slate-950"
        aria-hidden
      >
        <Sparkles className="h-4 w-4" />
      </span>
      <Card className="min-w-0 flex-1">
        <CardContent className="flex flex-col gap-2.5 p-4 sm:p-5">
          <MarkdownText text={message.content} />
          {message.evidence.length > 0 ? (
            <ul className="flex flex-col gap-1.5" aria-label="Cited sources">
              {message.evidence.map((source) => (
                <li
                  key={`${message.id}-${source.materialId}-${source.chunkId ?? "none"}`}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-muted/50 px-3 py-2 text-xs text-muted-foreground"
                >
                  <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span className="font-medium text-foreground">{source.citationLabel}</span>
                  {source.relevanceScore !== null ? (
                    <span
                      className="tabular-nums"
                      title="Hybrid retrieval similarity (0–1, not a probability)"
                    >
                      {source.relevanceScore.toFixed(2)}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
});

const UserMessage = memo(function UserMessage({ message }: { message: TutorMessageItem }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-slate-950 px-4 py-2.5 text-sm leading-relaxed text-white dark:bg-white dark:text-slate-950">
        <p className="whitespace-pre-wrap">{message.content}</p>
      </div>
    </div>
  );
});

/* ---------------------------------- composer ---------------------------------- */

/**
 * Self-contained composer: draft keystrokes re-render ONLY this component,
 * never the message list or history. `resetKey` (the active thread) clears
 * the box on thread switch via remount.
 */
function TutorComposer({
  pending,
  onSubmit,
}: {
  pending: boolean;
  onSubmit: (message: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow with content (up to ~6 rows), so long questions stay
  // readable without hijacking the layout with a fixed tall box.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    box.style.height = "auto";
    box.style.height = `${Math.min(box.scrollHeight, 160)}px`;
  }, [draft]);

  function send() {
    const message = draft.replace(/\s+/g, " ").trim();
    if (message.length === 0) {
      setLocalError("Type a question to ask the tutor.");
      return;
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      setLocalError(`Keep the question under ${MAX_MESSAGE_LENGTH} characters.`);
      return;
    }
    setLocalError(null);
    setDraft("");
    onSubmit(message);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    send();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends (Shift+Enter for a newline) — standard chat behavior.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-2 rounded-2xl border bg-card p-3 focus-within:ring-2 focus-within:ring-ring"
    >
      <label htmlFor="tutor-question" className="sr-only">
        Ask the tutor (Enter to send, Shift+Enter for a new line)
      </label>
      <Textarea
        id="tutor-question"
        ref={boxRef}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask anything about this project's materials…"
        rows={2}
        maxLength={MAX_MESSAGE_LENGTH}
        disabled={pending}
        className="max-h-40 resize-none overflow-y-auto border-0 bg-transparent p-1 shadow-none focus-visible:ring-0"
      />
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="text-xs tabular-nums text-muted-foreground" aria-live="polite">
          {draft.length}/{MAX_MESSAGE_LENGTH}
        </span>
        <Button
          type="submit"
          size="icon"
          disabled={pending || draft.trim().length === 0}
          aria-label={pending ? "Asking…" : "Send question"}
          className="h-9 w-9 rounded-full"
        >
          <ArrowUp className="h-4 w-4" aria-hidden />
        </Button>
      </div>
      {localError ? (
        <p role="alert" className="px-1 text-sm text-destructive">
          {localError}
        </p>
      ) : null}
    </form>
  );
}

/* ---------------------------------- history ---------------------------------- */

/**
 * Self-contained history sidebar: search keystrokes re-render ONLY this
 * component, never the chat. Data stays server-driven (≤50 threads).
 */
function HistorySidebar({
  projectId,
  activeId,
  onSelect,
  onNew,
  compact = false,
}: {
  projectId: string;
  activeId: string | null;
  onSelect: (id: string | null) => void;
  onNew: () => void;
  compact?: boolean;
}) {
  const threads = useConversations(projectId);
  const [query, setQuery] = useState("");

  const grouped = useMemo(() => {
    const list = threads.data ?? [];
    const q = query.trim().toLowerCase();
    const matching = q
      ? list.filter((t) => (t.title ?? "Untitled conversation").toLowerCase().includes(q))
      : list;
    const buckets = new Map<string, ConversationSummary[]>();
    for (const thread of matching) {
      const group = dayGroup(thread.lastMessageAt ?? thread.updatedAt);
      const bucket = buckets.get(group) ?? [];
      bucket.push(thread);
      buckets.set(group, bucket);
    }
    const order = ["Today", "Yesterday", "Previous 7 days", "Earlier"];
    return order
      .filter((g) => buckets.has(g))
      .map((g) => ({ group: g, threads: buckets.get(g) ?? [] }));
  }, [threads.data, query]);

  return (
    <div className={cn("flex h-full flex-col gap-3", compact && "overflow-y-auto")}>
      <Button type="button" size="sm" className="w-full shrink-0" onClick={onNew}>
        <MessageSquarePlus className="mr-2 h-4 w-4" aria-hidden /> New conversation
      </Button>
      <div className="relative shrink-0">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search conversations…"
          aria-label="Search conversations"
          className="pl-8"
        />
      </div>
      <div
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto"
        role="list"
        aria-label="Recent conversations"
      >
        {threads.isPending ? (
          <div className="flex flex-col gap-2" role="status" aria-label="Loading conversations">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <span className="sr-only">Loading conversations…</span>
          </div>
        ) : threads.isError ? (
          <ErrorState
            status={threads.error instanceof ApiClientError ? threads.error.status : undefined}
            title="Couldn't load conversations"
            onRetry={() => void threads.refetch()}
          />
        ) : grouped.length === 0 ? (
          <p className="rounded-xl border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
            {query ? `No conversations match “${query}”.` : "No conversations yet."}
          </p>
        ) : (
          grouped.map(({ group, threads: items }) => (
            <div key={group} className="flex flex-col gap-1.5">
              <p className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group}
              </p>
              {items.map((thread) => {
                const active = thread.id === activeId;
                return (
                  <button
                    key={thread.id}
                    type="button"
                    role="listitem"
                    onClick={() => onSelect(thread.id)}
                    aria-current={active ? "true" : undefined}
                    className={cn(
                      "flex flex-col gap-0.5 rounded-xl border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active
                        ? "border-transparent bg-slate-950 text-white dark:bg-white dark:text-slate-950"
                        : "border-transparent hover:bg-muted/60"
                    )}
                  >
                    <span className="truncate text-sm font-medium">
                      {thread.title ?? "Untitled conversation"}
                    </span>
                    <span className="flex items-center justify-between text-[11px] tabular-nums text-muted-foreground">
                      <span>
                        {thread.messageCount === 1
                          ? "1 message"
                          : `${thread.messageCount} messages`}
                      </span>
                      <span>{formatGroupDate(thread.lastMessageAt ?? thread.updatedAt)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ---------------------------------- panel ---------------------------------- */

/**
 * Project tutor: grounded Q&A over the project's indexed materials.
 * Real endpoint only — threads, answers, and citations come from the API.
 * Input state lives in isolated children so typing never re-renders the
 * thread (the lag source for long conversations).
 */
export function TutorPanel({ projectId }: { projectId: string }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const detail = useConversation(projectId, activeId);
  const ask = useTutorAsk(projectId);

  // Sequence guard against the thread-switch race: every manual thread
  // change bumps `navigationSeq`; a submit captures the current value, and
  // only a resolution from the LATEST submission may auto-switch threads.
  const navigationSeq = useRef(0);
  const submitSeq = useRef(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ask.data && submitSeq.current === navigationSeq.current) {
      if (ask.data.conversationId !== activeId) {
        setActiveId(ask.data.conversationId);
      }
    }
    // Intentionally keyed on the mutation result only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask.data]);

  const messages: TutorMessageItem[] = detail.data?.messages ?? [];

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    messagesEndRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "end" });
  }, [messages.length, ask.isPending, activeId]);

  function handleAsk(message: string) {
    submitSeq.current = navigationSeq.current;
    ask.mutate(
      { message, ...(activeId ? { conversationId: activeId } : {}) },
      undefined
    );
  }

  function switchThread(id: string | null) {
    navigationSeq.current += 1;
    setActiveId(id);
    setHistoryOpen(false);
    ask.reset();
  }

  const error = ask.error ?? detail.error;
  const requestId = error instanceof ApiClientError ? error.requestId : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Answers are grounded in this project&apos;s materials and cite their sources.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="lg:hidden"
          onClick={() => setHistoryOpen(true)}
          aria-haspopup="dialog"
        >
          <PanelLeft className="mr-2 h-4 w-4" aria-hidden /> Conversations
        </Button>
      </div>

      <div className="flex items-start gap-4 lg:h-[calc(100dvh-240px)] lg:min-h-[560px]">
        {/* Desktop history sidebar — static; only its list scrolls internally */}
        <aside
          className="hidden max-h-[70vh] w-64 shrink-0 rounded-2xl border bg-card p-3 lg:flex lg:max-h-none lg:h-full lg:flex-col"
          aria-label="Conversation history"
        >
          <HistorySidebar
            projectId={projectId}
            activeId={activeId}
            onSelect={switchThread}
            onNew={() => switchThread(null)}
          />
        </aside>

        {/* Mobile history drawer */}
        {historyOpen ? (
          <div
            className="fixed inset-0 z-50 lg:hidden"
            role="dialog"
            aria-modal="true"
            aria-label="Conversation history"
          >
            <div
              className="absolute inset-0 bg-background/80 backdrop-blur-sm"
              onClick={() => setHistoryOpen(false)}
              aria-hidden
            />
            <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col gap-3 overflow-y-auto border-r bg-card p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Conversations</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setHistoryOpen(false)}
                  aria-label="Close conversation history"
                >
                  <X className="h-4 w-4" aria-hidden />
                </Button>
              </div>
              <HistorySidebar
                projectId={projectId}
                activeId={activeId}
                onSelect={switchThread}
                onNew={() => switchThread(null)}
                compact
              />
            </div>
          </div>
        ) : null}

        <div
          className="flex min-w-0 flex-1 flex-col gap-3 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:pr-1"
          aria-live="polite"
        >
          {activeId === null && !ask.data ? (
            <EmptyState
              title="Ask your first question"
              message="The tutor reads this project's processed materials and answers with citations like “Source: notes.pdf — Page 3”. Uploads that are still processing are not included yet."
            />
          ) : null}

          {detail.isError && activeId !== null ? (
            <ErrorState
              status={detail.error instanceof ApiClientError ? detail.error.status : undefined}
              title="Couldn't load this conversation"
              onRetry={() => void detail.refetch()}
            />
          ) : null}

          {detail.data?.messagesTruncated ? (
            <p className="text-xs text-muted-foreground" role="note">
              Showing the {messages.length} most recent of {detail.data.messageCount} messages.
            </p>
          ) : null}

          {detail.isPending && activeId !== null && !ask.isPending ? <ConversationSkeleton /> : null}

          {messages.map((message) =>
            message.role === "ASSISTANT" ? (
              <AssistantMessage key={message.id} message={message} />
            ) : (
              <UserMessage key={message.id} message={message} />
            )
          )}

          {ask.isPending ? (
            <Card aria-live="polite">
              <CardContent className="flex flex-col gap-3 p-4 sm:p-5">
                <ThinkingDots label="Tutor is thinking…" />
                <div className="flex flex-col gap-2" aria-hidden>
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-11/12" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              </CardContent>
            </Card>
          ) : null}
          <div ref={messagesEndRef} aria-hidden />

          <div className="lg:sticky lg:bottom-0 lg:pb-1">
            <TutorComposer
              key={activeId ?? "new"}
              pending={ask.isPending}
              onSubmit={handleAsk}
            />
          </div>

          {error ? <ApiErrorAlert message={toUserMessage(error)} requestId={requestId} /> : null}

          {ask.data && !ask.data.grounded ? (
            <p className="text-sm text-muted-foreground" role="note">
              No relevant material was found for that question, so the tutor answered honestly instead
              of guessing. Try different keywords, or upload the right document first.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
