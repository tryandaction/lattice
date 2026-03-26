"use client";

import { Box, ChevronRight, Command, Copy, Minus, PanelLeft, Settings, Square, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSettingsStore } from "@/stores/settings-store";
import { cn } from "@/lib/utils";
import { useI18n } from "@/hooks/use-i18n";
import { HorizontalScrollStrip } from "@/components/ui/horizontal-scroll-strip";
import {
  closeDesktopWindow,
  isDesktopWindowMaximized,
  isWindowsDesktopHost,
  minimizeDesktopWindow,
  toggleDesktopWindowMaximize,
} from "@/lib/desktop-window";

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
  const pluginsEnabled = useSettingsStore((state) => state.settings.pluginsEnabled);
  const [isMaximized, setIsMaximized] = useState(false);
  const isWindowsDesktop = isWindowsDesktopHost();
  const breadcrumbs = (() => {
    if (registeredState?.breadcrumbs?.length) {
      return registeredState.breadcrumbs;
    }
    if (!activeTab?.filePath) {
      return [];
    }
    return activeTab.filePath.split("/").filter(Boolean).map((segment) => ({ label: segment }));
  })();

  const sortedActions = useMemo(
    () =>
      [...(registeredState?.actions ?? [])].sort((left, right) => {
        const leftPriority = left.priority ?? 50;
        const rightPriority = right.priority ?? 50;
        return leftPriority - rightPriority || left.label.localeCompare(right.label);
      }),
    [registeredState?.actions],
  );

  const syncMaximizedState = useCallback(() => {
    if (!isWindowsDesktop) {
      return;
    }

    void isDesktopWindowMaximized().then((value) => setIsMaximized(value));
  }, [isWindowsDesktop]);

  useEffect(() => {
    syncMaximizedState();

    if (!isWindowsDesktop) {
      return;
    }

    const handleResize = () => {
      syncMaximizedState();
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [isWindowsDesktop, syncMaximizedState]);

  const handleToggleMaximize = useCallback(() => {
    if (!isWindowsDesktop) {
      return;
    }

    void toggleDesktopWindowMaximize().then((value) => {
      if (typeof value === "boolean") {
        setIsMaximized(value);
      } else {
        syncMaximizedState();
      }
    });
  }, [isWindowsDesktop, syncMaximizedState]);

  return (
    <div className="flex h-10 items-center border-b border-border bg-background/95 pl-2 pr-1 backdrop-blur">
      <div
        className="flex shrink-0 items-center gap-2 px-2"
        data-tauri-drag-region={isWindowsDesktop ? "true" : undefined}
        onDoubleClick={handleToggleMaximize}
      >
        <Box className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">{t("app.name")}</span>
      </div>

      <div
        className="ml-1 flex min-w-0 flex-1 items-center gap-1 overflow-hidden text-xs text-muted-foreground"
        data-tauri-drag-region={isWindowsDesktop ? "true" : undefined}
        onDoubleClick={handleToggleMaximize}
      >
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
        className="ml-2 min-w-0 flex-1"
        viewportClassName="px-0"
        contentClassName="gap-1 justify-end"
        ariaLabel="command bar actions"
      >
        {sortedActions.map((action) => (
          <button
            key={`${activePaneId}:${action.id}`}
            type="button"
            onClick={action.onTrigger}
            disabled={action.disabled}
            className={cn(
              "rounded-md px-2 py-1 text-xs transition-colors disabled:opacity-50",
              action.group === "primary"
                ? "bg-accent/70 text-foreground hover:bg-accent"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
            title={action.label}
          >
            {action.label}
          </button>
        ))}
        {pluginsEnabled ? (
          <>
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
          </>
        ) : null}
        <button
          type="button"
          onClick={onOpenSettings}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title={t("settings.title")}
        >
          <Settings className="h-4 w-4" />
        </button>
      </HorizontalScrollStrip>

      {isWindowsDesktop ? (
        <div className="ml-2 flex shrink-0 items-center gap-1 border-l border-border pl-2">
          <button
            type="button"
            onClick={() => { void minimizeDesktopWindow(); }}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title={t("workbench.window.minimize")}
            aria-label={t("workbench.window.minimize")}
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleToggleMaximize}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title={isMaximized ? t("workbench.window.restore") : t("workbench.window.maximize")}
            aria-label={isMaximized ? t("workbench.window.restore") : t("workbench.window.maximize")}
          >
            {isMaximized ? <Copy className="h-4 w-4" /> : <Square className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={() => { void closeDesktopWindow(); }}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
            title={t("workbench.window.close")}
            aria-label={t("workbench.window.close")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default CommandBar;
