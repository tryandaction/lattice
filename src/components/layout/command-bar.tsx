"use client";

import { Box, ChevronRight, Command, Copy, FolderOpen, HelpCircle, Minus, PanelLeft, Settings, Square, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { cn } from "@/lib/utils";
import { useI18n } from "@/hooks/use-i18n";
import { HorizontalScrollStrip } from "@/components/ui/horizontal-scroll-strip";
import {
  closeDesktopWindow,
  isDesktopWindowMaximized,
  isWindowsDesktopHost,
  minimizeDesktopWindow,
  subscribeDesktopWindowState,
  toggleDesktopWindowMaximize,
} from "@/lib/desktop-window";
import {
  DESKTOP_COMMAND_BAR_HEIGHT,
  DESKTOP_WINDOW_CONTROLS_SAFE_WIDTH,
} from "@/components/layout/desktop-window-metrics";

interface CommandBarProps {
  onOpenWorkspace: () => void;
  onOpenCommands: () => void;
  onTogglePluginPanels: () => void;
  onOpenSettings: () => void;
  onOpenGuide: () => void;
  pluginPanelsOpen: boolean;
}

export function CommandBar({
  onOpenWorkspace,
  onOpenCommands,
  onTogglePluginPanels,
  onOpenSettings,
  onOpenGuide,
  pluginPanelsOpen,
}: CommandBarProps) {
  const { t } = useI18n();
  const activePaneId = useWorkspaceStore((state) => state.layout.activePaneId);
  const activeTab = useWorkspaceStore((state) => state.getActiveTab());
  const rootHandle = useWorkspaceStore((state) => state.rootHandle);
  const workspaceRootPath = useWorkspaceStore((state) => state.workspaceRootPath);
  const registeredState = useWorkspaceStore((state) => state.commandBarByPane[state.layout.activePaneId]);
  const [isMaximized, setIsMaximized] = useState(false);
  const isWindowsDesktop = isWindowsDesktopHost();
  const workspaceLabel = rootHandle?.name ?? t("shell.workspace.none");
  const workspaceDescription = workspaceRootPath ?? t("shell.workspace.none");
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

    let disposeWindowState = () => {};
    const handleResize = () => {
      syncMaximizedState();
    };

    void subscribeDesktopWindowState((payload) => {
      setIsMaximized(payload.isMaximized);
    }).then((dispose) => {
      disposeWindowState = dispose;
    });

    window.addEventListener("resize", handleResize);
    return () => {
      disposeWindowState();
      window.removeEventListener("resize", handleResize);
    };
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
    <div
      className="relative z-[70] flex items-center border-b border-border bg-background/95 pl-2 pr-0 backdrop-blur"
      style={{ height: DESKTOP_COMMAND_BAR_HEIGHT }}
    >
      <div
        className="flex shrink-0 select-none items-center gap-2 px-2"
        data-tauri-drag-region={isWindowsDesktop ? "true" : undefined}
        onDoubleClick={handleToggleMaximize}
        data-testid="desktop-commandbar-title"
      >
        <Box className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">{t("app.name")}</span>
      </div>

      <button
        type="button"
        onClick={onOpenWorkspace}
        className="ml-2 inline-flex max-w-56 shrink-0 items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-left transition-colors hover:bg-accent"
        title={workspaceDescription}
        data-tauri-drag-region="false"
        data-testid="desktop-commandbar-workspace"
      >
        <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-medium text-foreground">{workspaceLabel}</span>
      </button>

      <div
        className="ml-3 flex min-w-0 flex-1 select-none items-center gap-1 overflow-hidden text-xs text-muted-foreground"
        data-tauri-drag-region={isWindowsDesktop ? "true" : undefined}
        onDoubleClick={handleToggleMaximize}
        data-testid="desktop-commandbar-breadcrumbs"
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
        className="ml-2 min-w-0 max-w-[40%] flex-1"
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
        <button
          type="button"
          onClick={onOpenCommands}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title={t("commands.open")}
          data-tauri-drag-region="false"
        >
          <Command className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onTogglePluginPanels}
          className={cn(
            "rounded-md p-1.5 transition-colors",
            pluginPanelsOpen
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          )}
          title={t("panels.open")}
          aria-pressed={pluginPanelsOpen}
          data-tauri-drag-region="false"
        >
          <PanelLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onOpenGuide}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title={t("settings.shortcuts.openGuide")}
          aria-label={t("settings.shortcuts.openGuide")}
          data-tauri-drag-region="false"
        >
          <HelpCircle className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onOpenSettings}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title={t("settings.title")}
          aria-label={t("settings.title")}
          data-tauri-drag-region="false"
        >
          <Settings className="h-4 w-4" />
        </button>
      </HorizontalScrollStrip>

      {isWindowsDesktop ? (
        <div
          className="relative z-[120] ml-2 flex shrink-0 items-center justify-end gap-1 border-l border-border pl-2 pr-1 pointer-events-auto"
          style={{ width: DESKTOP_WINDOW_CONTROLS_SAFE_WIDTH }}
          data-tauri-drag-region="false"
          data-testid="desktop-window-controls"
        >
          <button
            type="button"
            onClick={() => { void minimizeDesktopWindow(); }}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title={t("workbench.window.minimize")}
            aria-label={t("workbench.window.minimize")}
            data-tauri-drag-region="false"
            data-testid="desktop-window-control-minimize"
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleToggleMaximize}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title={isMaximized ? t("workbench.window.restore") : t("workbench.window.maximize")}
            aria-label={isMaximized ? t("workbench.window.restore") : t("workbench.window.maximize")}
            data-tauri-drag-region="false"
            data-testid="desktop-window-control-maximize"
          >
            {isMaximized ? <Copy className="h-4 w-4" /> : <Square className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={() => { void closeDesktopWindow(); }}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
            title={t("workbench.window.close")}
            aria-label={t("workbench.window.close")}
            data-tauri-drag-region="false"
            data-testid="desktop-window-control-close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default CommandBar;
