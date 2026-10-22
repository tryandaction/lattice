"use client";

import { useI18n } from "@/hooks/use-i18n";
import { useMemo } from "react";
import { History } from "lucide-react";
import {
  buildActivityFeed,
  type ActivityEvent,
} from "@/lib/shared-library/activity";

export interface ActivityPanelProps {
  events: readonly ActivityEvent[];
}

/**
 * Activity stream panel. Shows library events newest-first; purely presentational
 * over the shared `activity.ts` projection.
 */
export function ActivityPanel({ events }: ActivityPanelProps) {
  const { t } = useI18n();
  const feed = useMemo(() => buildActivityFeed(events), [events]);

  if (feed.length === 0) {
    return (
      <div
        data-testid="activity-panel"
        className="flex items-center gap-2 p-3 text-xs text-muted-foreground"
      >
        <History className="h-4 w-4" />
        {t("cloud.activity.empty")}
      </div>
    );
  }

  return (
    <div data-testid="activity-panel" className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-border bg-background/95 px-3 py-2 text-sm font-semibold">
        <History className="h-4 w-4 text-muted-foreground" />
        {t("cloud.activity.title")}
      </header>
      <ul className="min-h-0 flex-1 overflow-y-auto p-3">
        {feed.map((event) => (
          <li
            key={event.id}
            data-testid="activity-item"
            className="flex items-center gap-2 border-b border-border/60 py-1.5 text-xs last:border-b-0"
          >
            <span className="shrink-0 rounded border border-border bg-muted/35 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              {t(`cloud.activity.${event.verb}`)}
            </span>
            <span className="min-w-0 flex-1 truncate text-foreground">
              {event.actorId} {t(`cloud.activity.${event.verb}`)} {event.targetLabel}
            </span>
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {event.createdAt}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default ActivityPanel;
