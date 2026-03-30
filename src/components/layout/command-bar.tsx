"use client";

import {
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
  HelpCircle,
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
  Settings,
  ShieldCheck,
  Square,
  StickyNote,
  Type,
  Underline,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { cn } from "@/lib/utils";
import { useI18n } from "@/hooks/use-i18n";
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
  zoomIn: ZoomIn,
  zoomOut: ZoomOut,
  fileCode2: FileCode2,
  highlighter: Highlighter,
  underline: Underline,
  stickyNote: StickyNote,
  type: Type,
  pencil: Pencil,
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
    default:
      break;
  }

  const actionId = action.id.toLowerCase();
  if (actionId === "save") return "save";
  if (actionId === "run" || actionId === "run-all") return "play";
  if (actionId === "rerun") return "rotateCcw";
  if (actionId === "stop") return "square";
  if (actionId === "verify") return "shieldCheck";
  if (actionId === "toggle-sidebar") return "panelLeft";
  if (actionId === "outline" || actionId.includes("outline")) return "listTree";
  if (actionId === "export") return "fileOutput";
  if (actionId === "mode-live") return "eye";
  if (actionId === "mode-source") return "code2";
  if (actionId === "mode-reading") return "bookOpen";
  if (actionId === "fit-width" || actionId === "fit-page") return "scanSearch";
  if (actionId === "zoom-in") return "zoomIn";
  if (actionId === "zoom-out") return "zoomOut";
  if (actionId === "add-code-cell" || actionId === "add-raw-cell") return "fileCode2";
  if (actionId === "add-markdown-cell") return "filePenLine";
  if (actionId === "tool-highlight") return "highlighter";
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
      data-tauri-drag-region="false"
      style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors disabled:opacity-40",
        action.group === "primary"
          ? "border-border bg-accent/60 text-foreground hover:bg-accent"
          : "border-transparent text-muted-foreground hover:border-border hover:bg-accent hover:text-foreground"
      )}
    >
      <IconComponent className="h-4 w-4" />
    </button>
  );
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
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement | null>(null);
  const isWindowsDesktop = isWindowsDesktopHost();
  const workspaceLabel = rootHandle?.name ?? t("shell.workspace.none");
  const workspaceDescription = workspaceRootPath ?? t("shell.workspace.none");
  const breadcrumbs = (() => {
    if (registeredState?.breadcrumbs?.length) {
      return normalizeBreadcrumbs(registeredState.breadcrumbs, rootHandle?.name, workspaceRootPath);
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
      [...(registeredState?.actions ?? [])].sort((left, right) => {
        const leftPriority = left.priority ?? 50;
        const rightPriority = right.priority ?? 50;
        return leftPriority - rightPriority || left.label.localeCompare(right.label);
      }),
    [registeredState?.actions],
  );
  const visibleActions = sortedActions.slice(0, 8);
  const overflowActions = sortedActions.slice(8);

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

      <div
        className="ml-2 flex shrink-0 items-center gap-1 px-1"
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
        <button
          type="button"
          onClick={onOpenCommands}
          onMouseDown={(event) => event.stopPropagation()}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title={t("commands.open")}
          data-tauri-drag-region="false"
          style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
        >
          <Command className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onTogglePluginPanels}
          onMouseDown={(event) => event.stopPropagation()}
          className={cn(
            "rounded-md p-1.5 transition-colors",
            pluginPanelsOpen
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          )}
          title={t("panels.open")}
          aria-pressed={pluginPanelsOpen}
          data-tauri-drag-region="false"
          style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
        >
          <PanelLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onOpenGuide}
          onMouseDown={(event) => event.stopPropagation()}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title={t("settings.shortcuts.openGuide")}
          aria-label={t("settings.shortcuts.openGuide")}
          data-tauri-drag-region="false"
          style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
        >
          <HelpCircle className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onOpenSettings}
          onMouseDown={(event) => event.stopPropagation()}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title={t("settings.title")}
          aria-label={t("settings.title")}
          data-tauri-drag-region="false"
          style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
        >
          <Settings className="h-4 w-4" />
        </button>
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
            onClick={() => { void minimizeDesktopWindow(); }}
            onMouseDown={(event) => event.stopPropagation()}
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
            onClick={handleToggleMaximize}
            onMouseDown={(event) => event.stopPropagation()}
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
            onClick={() => { void closeDesktopWindow(); }}
            onMouseDown={(event) => event.stopPropagation()}
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
