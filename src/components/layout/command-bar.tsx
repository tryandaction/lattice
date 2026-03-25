"use client";

import { ChevronRight, Command, PanelLeft, Settings } from "lucide-react";
import { useMemo } from "react";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { cn } from "@/lib/utils";
import { useI18n } from "@/hooks/use-i18n";
import { HorizontalScrollStrip } from "@/components/ui/horizontal-scroll-strip";

interface CommandBarProps {
  onOpenCommands: () => void;
  onOpenPanels: () => void;
  onOpenSettings: () => void;
}

export function CommandBar({
  onOpenCommands,
  onOpenPanels,
  onOpenSettings,
}: CommandBarProps) {
  const { t } = useI18n();
  const activePaneId = useWorkspaceStore((state) => state.layout.activePaneId);
  const activeTab = useWorkspaceStore((state) => state.getActiveTab());
  const registeredState = useWorkspaceStore((state) => state.commandBarByPane[state.layout.activePaneId]);
  const breadcrumbs = useMemo(() => {
    if (registeredState?.breadcrumbs?.length) {
      return registeredState.breadcrumbs;
    }
    if (!activeTab?.filePath) {
      return [];
    }
    return activeTab.filePath.split("/").filter(Boolean).map((segment) => ({ label: segment }));
  }, [activeTab?.filePath, registeredState?.breadcrumbs]);

  return (
    <div className="flex h-9 items-center justify-between border-b border-border bg-background/95 px-3 backdrop-blur">
      <div className="flex min-w-0 items-center gap-1 overflow-hidden text-xs text-muted-foreground">
        {breadcrumbs.length > 0 ? breadcrumbs.map((segment, index) => (
          <div key={`${segment.label}:${index}`} className="flex min-w-0 items-center gap-1">
            {index > 0 ? <ChevronRight className="h-3.5 w-3.5 shrink-0" /> : null}
            <span className={cn("truncate", index === breadcrumbs.length - 1 && "text-foreground")}>
              {segment.label}
            </span>
          </div>
        )) : (
          <span>{t("workbench.commandBar.empty")}</span>
        )}
      </div>

      <HorizontalScrollStrip
        className="ml-3 max-w-[48rem] shrink-0"
        viewportClassName="px-0"
        contentClassName="gap-1 justify-end"
        ariaLabel="command bar actions"
      >
        {registeredState?.actions?.map((action) => (
          <button
            key={`${activePaneId}:${action.id}`}
            type="button"
            onClick={action.onTrigger}
            disabled={action.disabled}
            className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            title={action.label}
          >
            {action.label}
          </button>
        ))}
        <button
          type="button"
          onClick={onOpenCommands}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title={t("commands.open")}
        >
          <Command className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onOpenPanels}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title={t("panels.open")}
        >
          <PanelLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onOpenSettings}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title={t("settings.title")}
        >
          <Settings className="h-4 w-4" />
        </button>
      </HorizontalScrollStrip>
    </div>
  );
}

export default CommandBar;
