"use client";

import type { ReactNode } from "react";
import { ArrowLeft, CalendarClock, Database, FolderPen, ListTodo, ShieldCheck } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import { cn } from "@/lib/utils";
import type { TranslationKey } from "@/lib/i18n";

export type AgentInspectorTab = "memory" | "trace" | "evidence" | "workbench" | "scheduled";

const INSPECTOR_TABS: Array<{
  id: AgentInspectorTab;
  labelKey: TranslationKey;
  icon: typeof Database;
}> = [
  { id: "memory", labelKey: "chat.agentMemory.title", icon: Database },
  { id: "trace", labelKey: "chat.agentTrace.title", icon: ListTodo },
  { id: "evidence", labelKey: "ai.evidence.panel.title", icon: ShieldCheck },
  { id: "workbench", labelKey: "chat.workbench.title", icon: FolderPen },
  { id: "scheduled", labelKey: "chat.scheduledTasks.title", icon: CalendarClock },
];

export function AgentInspector({
  open,
  activeTab,
  pendingApprovalCount,
  evidenceCount,
  draftCount,
  proposalCount,
  workbenchActionCount,
  scheduledTaskCount,
  onOpenChange,
  onTabChange,
  panels,
}: {
  open: boolean;
  activeTab: AgentInspectorTab;
  pendingApprovalCount: number;
  evidenceCount: number;
  draftCount: number;
  proposalCount: number;
  workbenchActionCount: number;
  scheduledTaskCount: number;
  onOpenChange: (open: boolean) => void;
  onTabChange: (tab: AgentInspectorTab) => void;
  panels: Record<AgentInspectorTab, ReactNode>;
}) {
  const { t } = useI18n();
  const counts: Partial<Record<AgentInspectorTab, number>> = {
    trace: pendingApprovalCount,
    evidence: evidenceCount,
    workbench: draftCount + proposalCount + workbenchActionCount,
    scheduled: scheduledTaskCount,
  };
  const reviewCount = pendingApprovalCount + draftCount + proposalCount + workbenchActionCount + scheduledTaskCount;

  if (!open) {
    return null;
  }

  const activeTabConfig = INSPECTOR_TABS.find((tab) => tab.id === activeTab) ?? INSPECTOR_TABS[0];

  return (
    <section
      className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background"
      data-testid="agent-review-workspace"
      data-review-count={reviewCount}
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/70 px-2">
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={t("chat.workspace.collapseInspector")}
          title={t("chat.workspace.collapseInspector")}
          data-testid="agent-review-back"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
        <span className="min-w-0 truncate text-xs font-medium" data-testid="agent-review-title">
          {t(activeTabConfig.labelKey)}
        </span>
      </div>
      <div
        className="grid min-w-0 shrink-0 grid-cols-5 gap-0.5 border-b border-border/60 px-1 py-1"
        role="tablist"
        data-testid="agent-inspector-tabs"
      >
          {INSPECTOR_TABS.map(({ id, labelKey, icon: Icon }) => {
            const selected = activeTab === id;
            const count = counts[id] ?? 0;
            const label = t(labelKey);
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-label={label}
                aria-selected={selected}
                title={id === "evidence" && count > 0 ? `${label} · ${t("ai.evidence.panel.replyCount", { count })}` : label}
                data-testid={`agent-inspector-tab-${id}`}
                onClick={() => onTabChange(id)}
                className={cn(
                  "inline-flex h-7 min-w-0 items-center justify-center gap-1 overflow-hidden rounded px-1 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground sm:px-2",
                  selected && "bg-muted text-foreground",
                )}
              >
                <Icon className="h-3 w-3 shrink-0" />
                <span
                  className="hidden min-w-0 truncate sm:inline"
                  data-testid={`agent-inspector-tab-${id}-label`}
                >
                  {label}
                </span>
                {count > 0 ? (
                  <span aria-label={id === "evidence" ? t("ai.evidence.panel.replyCount", { count }) : undefined} className={cn(
                    "min-w-4 shrink-0 rounded-full border border-border/70 px-1 text-center text-[9px]",
                    id === "trace" && pendingApprovalCount > 0 && "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
                  )}>
                    {count}
                  </span>
                ) : null}
              </button>
            );
          })}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="agent-inspector-body">
        {panels[activeTab]}
      </div>
    </section>
  );
}
