"use client";

import { useState } from "react";
import { Activity, Brain, FileText, MessagesSquare } from "lucide-react";
import { SectionCard } from "@/components/shared/cards";
import { EmptyState, ErrorState, PageLoading } from "@/components/shared/states";
import { AdminTableSkeleton } from "@/components/shared/skeletons";
import { statusOf } from "@/lib/api/http-status";
import { useAdminActivity } from "../hooks";
import { ALL_OPTION, Pager, SelectFilter } from "./filters";
import { ACTIVITY_EVENT_TYPES } from "@ai-study-companion/shared";

/** Filterable, sortable, paginated system activity stream. */

function ActivityEventIcon({ eventType }: { eventType: string }) {
  const Icon =
    eventType.startsWith("QUIZ") || eventType.startsWith("ASSESSMENT")
      ? Brain
      : eventType.startsWith("TUTOR")
        ? MessagesSquare
        : eventType.startsWith("MATERIAL") || eventType.startsWith("DOCUMENT")
          ? FileText
          : Activity;
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
      <Icon className="h-4 w-4" aria-hidden />
    </span>
  );
}
export function ActivitySection() {
  const [page, setPage] = useState(1);
  const [eventType, setEventType] = useState("");
  const [sort, setSort] = useState<"asc" | "desc">("desc");
  const activity = useAdminActivity({
    page,
    pageSize: 15,
    eventType: eventType || undefined,
    sort,
  });

  return (
    <SectionCard
      title="Activity"
      description="Server-filtered event stream, newest first by default."
      icon={Activity}
    >
      <div className="mb-4 flex flex-wrap gap-3">
        <SelectFilter
          id="admin-activity-type"
          label="Event type"
          value={eventType}
          options={[
            ALL_OPTION,
            ...ACTIVITY_EVENT_TYPES.map((type) => ({
              value: type,
              label: type.toLowerCase().replaceAll("_", " "),
            })),
          ]}
          onChange={(value) => {
            setEventType(value);
            setPage(1);
          }}
        />
        <SelectFilter
          id="admin-activity-sort"
          label="Order"
          value={sort}
          options={[
            { value: "desc", label: "Newest first" },
            { value: "asc", label: "Oldest first" },
          ]}
          onChange={(value) => setSort(value as "asc" | "desc")}
        />
      </div>
      {activity.isPending ? (
        <PageLoading label="Loading activity…" />
      ) : activity.isError ? (
        <ErrorState status={statusOf(activity.error)} onRetry={() => activity.refetch()} />
      ) : activity.data.items.length === 0 ? (
        <EmptyState title="No events found" message="Adjust the filters or date range." />
      ) : (
        <div className="flex flex-col gap-3">
          <ul className="flex flex-col gap-2">
            {activity.data.items.map((event) => (
              <li
                key={event.id}
                className="flex items-center gap-3 rounded-xl border px-4 py-2.5 text-sm"
              >
                <ActivityEventIcon eventType={event.eventType} />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate font-medium">
                    {event.eventType.replaceAll("_", " ").toLowerCase()}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {event.userEmail ?? "system"}
                    {event.projectId ? ` · project ${event.projectId.slice(0, 8)}` : ""}
                    {" · "}
                    {new Date(event.createdAt).toLocaleString()}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          <Pager
            page={activity.data.page}
            pageSize={activity.data.pageSize}
            total={activity.data.total}
            onPage={setPage}
          />
        </div>
      )}
    </SectionCard>
  );
}
