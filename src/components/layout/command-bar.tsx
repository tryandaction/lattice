"use client";

import {
  ArrowLeftRight,
  BookOpen,
  Box,
  ChevronRight,
  Code2,
  Command,
  Copy,
  Eye,
  FileCode2,
  FileOutput,
  FilePenLine,
  FolderOpen,
  Highlighter,
  ListTree,
  Minus,
  MoreHorizontal,
  PanelLeft,
  Pencil,
  Play,
  RotateCcw,
  Save,
  ScanSearch,
  ShieldCheck,
  Square,
  StickyNote,
  Type,
  Underline,
  X,
  Maximize2,
  ZoomIn,
  ZoomOut,
  MousePointer2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { cn } from "@/lib/utils";
import { useI18n } from "@/hooks/use-i18n";
import { buildExecutionScopeId } from "@/lib/runner/execution-scope";
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
}

function extractWorkspaceRootName(rootHandleName: string | null | undefined, workspaceRootPath: string | null | undefined): string | null {
  if (typeof rootHandleName === "string" && rootHandleName.trim()) {
    return rootHandleName.trim();
  }

  if (typeof workspaceRootPath !== "string" || !workspaceRootPath.trim()) {
    return null;
  }

  const normalized = workspaceRootPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const segments = normalized.split("/").filter(Boolean);
  return segments.at(-1) ?? null;
}

function normalizeBreadcrumbs(
  breadcrumbs: Array<{ label: string }>,
  rootHandleName: string | null | undefined,
  workspaceRootPath: string | null | undefined,
) {
  const rootName = extractWorkspaceRootName(rootHandleName, workspaceRootPath);
  if (!rootName || breadcrumbs.length === 0) {
    return breadcrumbs;
  }

  if (breadcrumbs[0]?.label === rootName) {
    return breadcrumbs.slice(1);
  }

  return breadcrumbs;
}

const ACTION_ICON_MAP = {
  bookOpen: BookOpen,
  shieldCheck: ShieldCheck,
  listTree: ListTree,
  filePenLine: FilePenLine,
  save: Save,
  play: Play,
  rotateCcw: RotateCcw,
  square: Square,
  panelLeft: PanelLeft,
  fileOutput: FileOutput,
  eye: Eye,
  code2: Code2,
  scanSearch: ScanSearch,
  arrowLeftRight: ArrowLeftRight,
  maximize2: Maximize2,
  zoomIn: ZoomIn,
  zoomOut: ZoomOut,
  fileCode2: FileCode2,
  highlighter: Highlighter,
  underline: Underline,
  stickyNote: StickyNote,
  type: Type,
  pencil: Pencil,
  mousePointer2: MousePointer2,
  command: Command,
} as const;

type ActionIconKey = keyof typeof ACTION_ICON_MAP;

function resolveActionIcon(action: { id: string; icon?: string; label: string }) {
  const iconName = action.icon?.toLowerCase();
  switch (iconName) {
    case "book-open":
      return "bookOpen";
    case "check-circle":
      return "shieldCheck";
    case "list-tree":
      return "listTree";
    case "file-text":
      return "filePenLine";
    case "arrow-left-right":
      return "arrowLeftRight";
    case "maximize-2":
      return "maximize2";
    case "zoom-in":
      return "zoomIn";
    case "zoom-out":
      return "zoomOut";
    case "panel-left":
      return "panelLeft";
    case "highlighter":
      return "highlighter";
    case "underline":
      return "underline";
    case "sticky-note":
      return "stickyNote";
    case "type":
      return "type";
    case "square":
      return "square";
    case "pencil":
      return "pencil";
    case "mouse-pointer-2":
      return "mousePointer2";
    case "file-output":
      return "fileOutput";
    default:
      break;
  }

  const actionId = action.id.toLowerCase();
  if (actionId === "save") return "save";
  if (actionId === "run" || actionId === "run-all") return "play";
  if (actionId === "rerun") return "rotateCcw";
  if (actionId === "restart-kernel") return "rotateCcw";
  if (actionId === "stop") return "square";
  if (actionId === "verify") return "shieldCheck";
  if (actionId === "toggle-sidebar") return "panelLeft";
  if (actionId === "outline" || actionId.includes("outline")) return "listTree";
  if (actionId === "export") return "fileOutput";
  if (actionId === "mode-live") return "eye";
  if (actionId === "mode-source") return "code2";
  if (actionId === "mode-reading") return "bookOpen";
  if (actionId === "fit-width") return "arrowLeftRight";
  if (actionId === "fit-page") return "maximize2";
  if (actionId === "zoom-in") return "zoomIn";
  if (actionId === "zoom-out") return "zoomOut";
  if (actionId === "add-code-cell" || actionId === "add-raw-cell") return "fileCode2";
  if (actionId === "add-markdown-cell") return "filePenLine";
  if (actionId === "tool-highlight") return "highlighter";
  if (actionId === "tool-select") return "mousePointer2";
  if (actionId === "tool-underline") return "underline";
  if (actionId === "tool-note") return "stickyNote";
  if (actionId === "tool-text") return "type";
  if (actionId === "tool-area") return "square";
  if (actionId === "tool-draw") return "pencil";
  return "command";
}

function CommandBarActionButton({
  action,
}: {
  action: {
    id: string;
    icon?: string;
    label: string;
    active?: boolean;
    disabled?: boolean;
    group?: "primary" | "secondary" | "utility";
    onTrigger?: () => void;
  };
}) {
  const iconKey = resolveActionIcon(action) as ActionIconKey;
  const IconComponent = ACTION_ICON_MAP[iconKey];

  return (
    <button
      type="button"
      onClick={action.onTrigger}
      onMouseDown={(event) => event.stopPropagation()}
      disabled={action.disabled}
      title={action.label}
      aria-label={action.label}
      aria-pressed={action.active ? true : undefined}
      data-tauri-drag-region="false"
      style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors disabled:opacity-40",
        action.active
          ? "border-border bg-accent text-foreground shadow-sm"
          : action.group === "primary"
          ? "border-border/70 bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
          : "border-transparent text-muted-foreground hover:border-border hover:bg-accent hover:text-foreground"
      )}
    >
      <IconComponent className="h-4 w-4" />
    </button>
  );
}

function BreadcrumbScroller({
  breadcrumbs,
}: {
  breadcrumbs: Array<{ label: string }>;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    const element = scrollRef.current;
    if (!element || element.scrollWidth <= element.clientWidth + 1) {
      return;
    }

    if (Math.abs(event.deltaY) >= Math.abs(event.deltaX)) {
      element.scrollLeft += event.deltaY;
      event.preventDefault();
    }
  }, []);

  return (
    <div
      ref={scrollRef}
      onWheel={handleWheel}
      className="min-w-0 max-w-[28rem] overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      data-tauri-drag-region="false"
      style={{ WebkitAppRegion: "no-drag", touchAction: "pan-x" } as CSSProperties}
      data-testid="desktop-commandbar-breadcrumbs"
    >
      <div className="flex min-w-max items-center gap-1 text-xs text-muted-foreground">
        {breadcrumbs.length > 0 ? breadcrumbs.map((segment, index) => (
          <div key={`${segment.label}:${index}`} className="flex items-center gap-1">
            {index > 0 ? <ChevronRight className="h-3.5 w-3.5 shrink-0" /> : null}
            <span className={cn("truncate", index === breadcrumbs.length - 1 && "text-foreground")}>
              {segment.label}
            </span>
          </div>
        )) : null}
      </div>
    </div>
  );
}

export function CommandBar({
  onOpenWorkspace,
}: CommandBarProps) {
  const { t } = useI18n();
  const activePaneId = useWorkspaceStore((state) => state.layout.activePaneId);
  const activeTab = useWorkspaceStore((state) => state.getActiveTab());
  const rootHandle = useWorkspaceStore((state) => state.rootHandle);
  const workspaceRootPath = useWorkspaceStore((state) => state.workspaceRootPath);
  const registeredState = useWorkspaceStore((state) => state.commandBarByPane[state.layout.activePaneId]);
  const activeScopeId = activePaneId && activeTab
    ? buildExecutionScopeId({
        paneId: activePaneId,
        tabId: activeTab.id,
      })
    : null;
  const scopedRegisteredState = registeredState && (!registeredState.scopeId || !activeScopeId || registeredState.scopeId === activeScopeId)
    ? registeredState
    : null;
  const [isMaximized, setIsMaximized] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement | null>(null);
  const isWindowsDesktop = isWindowsDesktopHost();
  const workspaceLabel = rootHandle?.name ?? t("shell.workspace.none");
  const workspaceDescription = workspaceRootPath ?? t("shell.workspace.none");
  const breadcrumbs = (() => {
    if (scopedRegisteredState?.breadcrumbs?.length) {
      return normalizeBreadcrumbs(scopedRegisteredState.breadcrumbs, rootHandle?.name, workspaceRootPath);
    }
    if (!activeTab?.filePath) {
      return [];
    }
    return normalizeBreadcrumbs(
      activeTab.filePath.split("/").filter(Boolean).map((segment) => ({ label: segment })),
      rootHandle?.name,
      workspaceRootPath,
    );
  })();

  const sortedActions = useMemo(
    () =>
      [...(scopedRegisteredState?.actions ?? [])].sort((left, right) => {
        const leftPriority = left.priority ?? 50;
        const rightPriority = right.priority ?? 50;
        return leftPriority - rightPriority || left.label.localeCompare(right.label);
      }),
    [scopedRegisteredState?.actions],
  );
  const { visibleActions, overflowActions } = useMemo(() => {
    const primary = sortedActions.filter((action) => action.group === "primary");
    const secondary = sortedActions.filter((action) => action.group === "secondary");
    const utility = sortedActions.filter((action) => action.group === "utility");
    const visible = [
      ...primary,
      ...secondary.slice(0, 6),
      ...utility.slice(0, 2),
    ].slice(0, 12);
    const visibleIds = new Set(visible.map((action) => action.id));
    return {
      visibleActions: visible,
      overflowActions: sortedActions.filter((action) => !visibleIds.has(action.id)),
    };
  }, [sortedActions]);

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

  useEffect(() => {
    if (!overflowOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!overflowRef.current?.contains(event.target as Node)) {
        setOverflowOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [overflowOpen]);

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

  const stopDesktopControlPropagation = useCallback((event: React.SyntheticEvent<HTMLElement>) => {
    event.stopPropagation();
  }, []);

  const handleMinimizeClick = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    stopDesktopControlPropagation(event);
    void minimizeDesktopWindow();
  }, [stopDesktopControlPropagation]);

  const handleMaximizeClick = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    stopDesktopControlPropagation(event);
    handleToggleMaximize();
  }, [handleToggleMaximize, stopDesktopControlPropagation]);

  const handleCloseClick = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    stopDesktopControlPropagation(event);
    void closeDesktopWindow();
  }, [stopDesktopControlPropagation]);

  return (
    <div
      className="relative z-[70] grid grid-cols-[auto_minmax(0,1fr)_auto] items-center border-b border-border bg-background/95 pl-2 pr-0 backdrop-blur"
      style={{ height: DESKTOP_COMMAND_BAR_HEIGHT, WebkitAppRegion: "drag" } as CSSProperties}
      data-tauri-drag-region={isWindowsDesktop ? "true" : undefined}
    >
      <div
        className="flex min-w-0 items-center gap-2 pr-3"
        data-testid="desktop-commandbar-left"
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
        <div className="h-6 w-px shrink-0 bg-border/80" />
      </div>

      <div
        className="flex min-w-0 items-center justify-center gap-4 px-2"
        data-testid="desktop-commandbar-center"
      >
        <div
          className="flex min-w-0 shrink items-center gap-2"
          data-testid="desktop-commandbar-file-context"
          data-tauri-drag-region="false"
          style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
        >
          <button
            type="button"
            onClick={onOpenWorkspace}
            onMouseDown={(event) => event.stopPropagation()}
            className="inline-flex max-w-40 shrink-0 items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-2 text-left transition-colors hover:bg-accent"
            title={workspaceDescription}
            data-tauri-drag-region="false"
            data-testid="desktop-commandbar-workspace"
            style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
          >
            <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate text-sm font-medium text-foreground">{workspaceLabel}</span>
          </button>
          {breadcrumbs.length > 0 ? (
            <BreadcrumbScroller breadcrumbs={breadcrumbs} />
          ) : (
            <span className="truncate text-xs text-muted-foreground" data-testid="desktop-commandbar-breadcrumbs">
              {t("workbench.commandBar.empty")}
            </span>
          )}
        </div>

        <div
          className="flex shrink-0 items-center gap-1 px-1"
          data-testid="desktop-commandbar-actions"
          data-tauri-drag-region="false"
          style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
        >
        {visibleActions.map((action) => (
          <CommandBarActionButton key={`${activePaneId}:${action.id}`} action={action} />
        ))}
        {overflowActions.length > 0 ? (
          <div className="relative" ref={overflowRef}>
            <button
              type="button"
              onClick={() => setOverflowOpen((value) => !value)}
              onMouseDown={(event) => event.stopPropagation()}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-muted-foreground transition-colors hover:border-border hover:bg-accent hover:text-foreground"
              title={t("workbench.commandBar.more")}
              aria-label={t("workbench.commandBar.more")}
              data-tauri-drag-region="false"
              style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {overflowOpen ? (
              <div className="absolute right-0 top-[calc(100%+0.5rem)] z-[140] min-w-44 rounded-lg border border-border bg-popover p-1 shadow-xl">
                {overflowActions.map((action) => {
                  const iconKey = resolveActionIcon(action) as ActionIconKey;
                  const IconComponent = ACTION_ICON_MAP[iconKey];
                  return (
                    <button
                      key={`${activePaneId}:${action.id}:overflow`}
                      type="button"
                      onClick={() => {
                        action.onTrigger?.();
                        setOverflowOpen(false);
                      }}
                      disabled={action.disabled}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent disabled:opacity-40"
                      data-tauri-drag-region="false"
                      style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
                    >
                      <IconComponent className="h-4 w-4 text-muted-foreground" />
                      <span className="truncate">{action.label}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}
        </div>
      </div>

      {isWindowsDesktop ? (
        <div
          className="relative z-[120] ml-2 flex shrink-0 items-center justify-end gap-1 border-l border-border pl-2 pr-1 pointer-events-auto"
          data-tauri-drag-region="false"
          data-testid="desktop-window-controls"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          style={{ width: DESKTOP_WINDOW_CONTROLS_SAFE_WIDTH, WebkitAppRegion: "no-drag" } as CSSProperties}
        >
          <button
            type="button"
            onClick={handleMinimizeClick}
            onMouseDown={stopDesktopControlPropagation}
            onPointerDown={stopDesktopControlPropagation}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title={t("workbench.window.minimize")}
            aria-label={t("workbench.window.minimize")}
            data-tauri-drag-region="false"
            data-testid="desktop-window-control-minimize"
            style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleMaximizeClick}
            onMouseDown={stopDesktopControlPropagation}
            onPointerDown={stopDesktopControlPropagation}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title={isMaximized ? t("workbench.window.restore") : t("workbench.window.maximize")}
            aria-label={isMaximized ? t("workbench.window.restore") : t("workbench.window.maximize")}
            data-tauri-drag-region="false"
            data-testid="desktop-window-control-maximize"
            style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
          >
            {isMaximized ? <Copy className="h-4 w-4" /> : <Square className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={handleCloseClick}
            onMouseDown={stopDesktopControlPropagation}
            onPointerDown={stopDesktopControlPropagation}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
            title={t("workbench.window.close")}
            aria-label={t("workbench.window.close")}
            data-tauri-drag-region="false"
            data-testid="desktop-window-control-close"
            style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default CommandBar;
