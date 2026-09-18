import {
  AlertTriangle,
  Ban,
  BarChart3,
  Brain,
  FileText,
  FolderKanban,
  Inbox,
  KeyRound,
  Layers,
  SearchX,
  Sparkles,
  Timer,
  TrendingUp,
} from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { errorStateForStatus } from "@/lib/api/http-status";
import { cn } from "@/lib/utils";

/* ---------------------------------- loading ---------------------------------- */

export function Spinner({ className, label = "Loading…" }: { className?: string; label?: string }) {
  return (
    <span
      role="status"
      aria-label={label}
      className={cn("inline-flex items-center gap-2", className)}
    >
      <span
        aria-hidden
        className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground motion-reduce:animate-none"
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function PageLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex flex-col gap-4 py-8" role="status" aria-label={label}>
      <Skeleton className="h-9 w-1/3" />
      <Skeleton className="h-4 w-2/3" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-36 w-full" />
        <Skeleton className="hidden h-36 w-full lg:block" />
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function CardSkeleton({ className }: { className?: string }) {
  return (
    <Card aria-hidden className={className}>
      <CardContent className="flex flex-col gap-3 pt-6">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-1/2" />
      </CardContent>
    </Card>
  );
}

export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3" role="status" aria-label="Loading list">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-14 w-full" />
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

/**
 * Indeterminate progress bar for pipeline work of unknown duration
 * (uploads, extraction, indexing). A sliding indicator — never a faked
 * percentage — paired with a stage label announced via aria-live.
 */
export function LoadingBar({ label, className }: { label: string; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)} role="status" aria-label={label}>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-secondary">
        <div className="absolute inset-y-0 left-0 w-1/3 animate-indeterminate rounded-full bg-primary motion-reduce:animate-none" />
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}

/**
 * "Thinking" indicator for the tutor answering state: three bouncing
 * dots plus a visible label (aria-live announces it once).
 */
export function ThinkingDots({ label = "Tutor is thinking…" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2" role="status" aria-label={label}>
      <span className="inline-flex items-center gap-1" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 animate-bounce rounded-full bg-foreground/60 motion-reduce:animate-none"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </span>
      <span className="text-sm text-muted-foreground">{label}</span>
    </span>
  );
}

/* ----------------------------------- empty ----------------------------------- */

const EMPTY_PRESETS = {
  spaces: {
    icon: Layers,
    title: "No learning spaces yet",
    message: "Create a space to organize subjects like Machine Learning or Mathematics.",
  },
  projects: {
    icon: FolderKanban,
    title: "No projects in this space yet",
    message: "Start a focused learning journey — for example, Operating Systems.",
  },
  materials: {
    icon: FileText,
    title: "No learning materials yet",
    message: "Upload a PDF to give the tutor something to ground answers in.",
  },
  tutor: {
    icon: Sparkles,
    title: "Nothing to discuss yet",
    message: "Upload and process a learning material to start grounded learning.",
  },
  quiz: {
    icon: Brain,
    title: "No assessments yet",
    message: "Complete some learning activity before starting an adaptive assessment.",
  },
  growth: {
    icon: TrendingUp,
    title: "No growth data yet",
    message: "Complete learning activities to build your growth profile.",
  },
  analytics: {
    icon: BarChart3,
    title: "No activity yet",
    message: "Learning activity will appear here as you use the workspace.",
  },
} as const;

export type EmptyPreset = keyof typeof EMPTY_PRESETS;

export function EmptyState({
  preset,
  title,
  message,
  action,
  className,
}: {
  preset?: EmptyPreset;
  title?: ReactNode;
  message?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const resolved = preset ? EMPTY_PRESETS[preset] : undefined;
  const Icon = resolved?.icon ?? Inbox;
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-muted/30 px-6 py-12 text-center dark:border-slate-700",
        className
      )}
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-muted">
        <Icon className="h-5 w-5 text-muted-foreground" aria-hidden />
      </span>
      <p className="text-base font-medium">{title ?? resolved?.title ?? "Nothing here yet"}</p>
      <p className="max-w-md text-sm text-muted-foreground">{message ?? resolved?.message}</p>
      {action}
    </div>
  );
}

/* ----------------------------------- error ----------------------------------- */

const ERROR_ICONS = {
  401: KeyRound,
  403: Ban,
  404: SearchX,
  429: Timer,
  fallback: AlertTriangle,
} as const;

export function ErrorState({
  status,
  title,
  message,
  requestId,
  onRetry,
  retryLabel = "Try again",
  className,
}: {
  status?: number;
  title?: ReactNode;
  message?: ReactNode;
  requestId?: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}) {
  const fallback = errorStateForStatus(status);
  const Icon =
    status === 401
      ? ERROR_ICONS[401]
      : status === 403
        ? ERROR_ICONS[403]
        : status === 404
          ? ERROR_ICONS[404]
          : status === 429
            ? ERROR_ICONS[429]
            : ERROR_ICONS.fallback;
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center gap-3 rounded-xl border bg-card px-6 py-12 text-center",
        className
      )}
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-destructive/10">
        <Icon className="h-5 w-5 text-destructive" aria-hidden />
      </span>
      <p className="text-base font-medium">{title ?? fallback.title}</p>
      <p className="max-w-md text-sm text-muted-foreground">{message ?? fallback.message}</p>
      {requestId ? (
        <p className="font-mono text-xs text-muted-foreground">Request ID: {requestId}</p>
      ) : null}
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}

export function NotFoundState({ onRetry }: { onRetry?: () => void }) {
  return <ErrorState status={404} onRetry={onRetry} retryLabel="Go back" />;
}

export function UnauthorizedState({ onLogin }: { onLogin?: () => void }) {
  return <ErrorState status={401} onRetry={onLogin} retryLabel="Log in" />;
}
