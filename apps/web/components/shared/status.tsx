import { cn } from "@/lib/utils";

/**
 * Strictly monochrome status language: black / gray dots + explicit text.
 * Meaning always travels in words — dots only mark liveness (pulse) and
 * rough group (filled vs hollow). No color anywhere.
 */

type Tone = "neutral" | "info" | "ai" | "success" | "warning" | "danger";

const DOT_CLASSES: Record<Tone, string> = {
  neutral: "bg-muted-foreground/40",
  info: "bg-slate-950 dark:bg-slate-100",
  ai: "bg-slate-950 dark:bg-slate-100",
  success: "bg-slate-950 dark:bg-slate-100",
  warning: "bg-slate-400 dark:bg-slate-500",
  danger: "bg-slate-950 dark:bg-slate-100",
};

export function StatusBadge({
  tone,
  children,
  className,
  pulse = false,
  invert = false,
}: {
  tone: Tone;
  children: React.ReactNode;
  className?: string;
  /** Animated ping for live/in-progress states. */
  pulse?: boolean;
  /** Solid black badge for the strongest positive state. */
  invert?: boolean;
}) {
  if (invert) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full bg-slate-950 px-2.5 py-0.5 text-xs font-medium text-white dark:bg-white dark:text-slate-950",
          className
        )}
      >
        {children}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-0.5 text-xs font-medium text-muted-foreground",
        className
      )}
    >
      <span className="relative flex h-1.5 w-1.5 shrink-0" aria-hidden>
        {pulse ? (
          <span
            className={cn(
              "absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 motion-reduce:animate-none",
              DOT_CLASSES[tone]
            )}
          />
        ) : null}
        <span className={cn("relative inline-flex h-1.5 w-1.5 rounded-full", DOT_CLASSES[tone])} />
      </span>
      {children}
    </span>
  );
}

/** Document pipeline status → tone + label. */
export function docStatusTone(status: string): { tone: Tone; label: string; live: boolean } {
  switch (status) {
    case "READY":
      return { tone: "success", label: "Ready", live: false };
    case "PROCESSING":
      return { tone: "info", label: "Processing", live: true };
    case "QUEUED":
      return { tone: "warning", label: "Queued", live: true };
    case "FAILED":
      return { tone: "danger", label: "Failed", live: false };
    default:
      return { tone: "neutral", label: status.toLowerCase(), live: false };
  }
}

/** Knowledge indexing status → tone + label. */
export function knowledgeStatusTone(status: string): { tone: Tone; label: string; live: boolean } {
  switch (status) {
    case "READY":
      return { tone: "success", label: "Indexed", live: false };
    case "PROCESSING":
      return { tone: "ai", label: "Indexing", live: true };
    case "QUEUED":
      return { tone: "warning", label: "Queued", live: true };
    case "FAILED":
      return { tone: "danger", label: "Index failed", live: false };
    default:
      return { tone: "neutral", label: status.toLowerCase().replace("_", " "), live: false };
  }
}

/** Project lifecycle status → tone. */
export function projectStatusTone(status: string): Tone {
  switch (status) {
    case "ACTIVE":
      return "success";
    case "COMPLETED":
      return "info";
    case "ARCHIVED":
      return "neutral";
    default:
      return "neutral";
  }
}

/** Quiz attempt status → tone + label. */
export function attemptStatusTone(status: string): { tone: Tone; label: string } {
  switch (status) {
    case "COMPLETED":
      return { tone: "success", label: "Completed" };
    case "ACTIVE":
      return { tone: "info", label: "In progress" };
    default:
      return { tone: "neutral", label: status.toLowerCase() };
  }
}

/** Background job / health status → tone. Matches real API vocabularies. */
export function jobStatusTone(status: string): Tone {
  const normalized = status.toLowerCase();
  if (["completed", "healthy", "up", "configured", "ok"].includes(normalized)) return "success";
  if (["processing", "queued", "degraded"].includes(normalized)) return "warning";
  if (["failed", "down"].includes(normalized)) return "danger";
  return "neutral";
}

export function HealthDot({ tone, label }: { tone: Tone; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs" role="status" aria-label={label}>
      <span className="relative flex h-2 w-2" aria-hidden>
        {tone === "success" || tone === "warning" ? (
          <span
            className={cn(
              "absolute inline-flex h-full w-full animate-ping rounded-full opacity-50 motion-reduce:animate-none",
              DOT_CLASSES[tone]
            )}
          />
        ) : null}
        <span className={cn("relative inline-flex h-2 w-2 rounded-full", DOT_CLASSES[tone])} />
      </span>
      {label}
    </span>
  );
}
