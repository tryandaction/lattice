"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEventHandler } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { DndProvider } from "@/components/dnd/dnd-provider";
import { ResponsiveProvider, useResponsive } from "@/contexts/responsive-context";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useUnsavedWarning } from "@/hooks/use-unsaved-warning";
import { useTheme } from "@/hooks/use-theme";
import { useI18n } from "@/hooks/use-i18n";
import { useAutoOpenFolder } from "@/hooks/use-auto-open-folder";
import { useWorkbenchSession } from "@/hooks/use-workbench-session";
import { isTauriHost } from "@/lib/storage-adapter";
import { setLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { TOUCH_TARGET_MIN } from "@/lib/responsive";
import { syncPlugins, updatePluginNetworkAllowlist } from "@/lib/plugins/runtime";
import { resolveAppRoute } from "@/lib/app-route";
import { Settings, HelpCircle, Menu, PanelLeftClose, PanelLeft, Command, Bot, Search as SearchIcon, MessageSquareText, FolderTree, LayoutGrid } from "lucide-react";
import { useFileSystem } from "@/hooks/use-file-system";
import { PluginCommandDialog } from "@/components/ui/plugin-command-dialog";
import { PluginPanelDialog } from "@/components/ui/plugin-panel-dialog";
import { SettingsDialog } from "@/components/settings/settings-dialog";
import { DownloadAppDialog } from "@/components/ui/download-app-dialog";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { ExportToastContainer } from "@/components/ui/export-toast";
import { usePluginStore } from "@/stores/plugin-store";
import { useAnnotationStore } from "@/stores/annotation-store";
import { PluginStatusBarSlot } from "@/components/ui/plugin-statusbar-slot";
import { PluginToolbarSlot } from "@/components/ui/plugin-toolbar-slot";
import { useAiChatStore } from "@/stores/ai-chat-store";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { usePluginShortcuts } from "@/hooks/use-plugin-shortcuts";
import { initKeyStorage } from "@/lib/ai/key-storage";
import { DesktopWindowFrame } from "@/components/layout/desktop-window-frame";
import {
  buildDesktopWorkbenchLayout,
  clampDesktopAiPanelSize,
  clampDesktopPluginPanelSize,
  DESKTOP_AI_PANEL_DEFAULT,
  DESKTOP_AI_PANEL_MAX,
  DESKTOP_AI_PANEL_MIN,
  DESKTOP_MAIN_PANEL_MIN,
  DESKTOP_PANEL_MAX,
  DESKTOP_PANEL_MIN,
  getDesktopSidebarMaxSize,
} from "@/components/layout/desktop-workbench-layout";

const DESKTOP_SIDEBAR_DEFAULT = 20;
const DESKTOP_PANEL_DEFAULT = 22;
const TABLET_SIDEBAR_DEFAULT = 28;


const ExplorerSidebar = dynamic(
  () => import("@/components/explorer/explorer-sidebar").then((mod) => mod.ExplorerSidebar),
  { ssr: false }
);

const MainArea = dynamic(
  () => import("@/components/main-area/main-area").then((mod) => mod.MainArea),
  { ssr: false }
);

const MobileSidebar = dynamic(
  () => import("@/components/layout/mobile-sidebar").then((mod) => mod.MobileSidebar),
  { ssr: false }
);

const MobileSidebarTrigger = dynamic(
  () => import("@/components/layout/mobile-sidebar").then((mod) => mod.MobileSidebarTrigger),
  { ssr: false }
);

const PluginPanelDock = dynamic(
  () => import("@/components/ui/plugin-panel-dock").then((mod) => mod.PluginPanelDock),
  { ssr: false }
);

const WorkspaceSearchPanel = dynamic(
  () => import("@/components/layout/workspace-search-panel").then((mod) => mod.WorkspaceSearchPanel),
  { ssr: false }
);

const AnnotationsActivityPanel = dynamic(
  () => import("@/components/layout/annotations-activity-panel").then((mod) => mod.AnnotationsActivityPanel),
  { ssr: false }
);

const CommandBar = dynamic(
  () => import("@/components/layout/command-bar").then((mod) => mod.CommandBar),
  { ssr: false }
);

const AiChatPanel = dynamic(
  () => import("@/components/ai/ai-chat-panel").then((mod) => mod.AiChatPanel),
  { ssr: false }
);

// Dialogs are kept as static imports to avoid runtime chunk-loading failures

function scheduleIdleTask(task: () => void, timeout = 2000): () => void {
  if (typeof window === "undefined") return () => {};
  const win = window as Window & {
    requestIdleCallback?: (cb: (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void, options?: { timeout: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  if (win.requestIdleCallback && win.cancelIdleCallback) {
    const handle = win.requestIdleCallback(() => task(), { timeout });
    return () => win.cancelIdleCallback?.(handle);
  }
  const handle = window.setTimeout(task, 0);
  return () => window.clearTimeout(handle);
}

function CollapsedRailButton({
  icon: Icon,
  label,
  title,
  active = false,
  onClick,
}: {
  icon: typeof Settings;
  label: string;
  title: string;
  active?: boolean;
  onClick: MouseEventHandler<HTMLButtonElement>;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group relative flex h-10 w-10 items-center justify-center rounded-xl transition-all",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
        active
          ? "bg-primary/10 text-primary shadow-sm"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
      title={title}
      aria-label={label}
      aria-pressed={active}
    >
      <Icon className="h-4 w-4" />
      <span className="pointer-events-none absolute left-full ml-2 hidden whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-[11px] text-foreground shadow-md group-hover:block">
        {label}
      </span>
    </button>
  );
}

/**
 * Main application layout with responsive support
 */
export function AppLayout() {
  return (
    <ResponsiveProvider>
      <DndProvider>
        <AppLayoutContent />
      </DndProvider>
    </ResponsiveProvider>
  );
}

function AppLayoutContent() {
  const { isMobile, isTablet, isLandscape } = useResponsive();
  const sidebarCollapsed = useWorkspaceStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useWorkspaceStore((state) => state.toggleSidebar);
  const setSidebarCollapsed = useWorkspaceStore((state) => state.setSidebarCollapsed);
  const [showSettings, setShowSettings] = useState(false);
  const [showCommands, setShowCommands] = useState(false);
  const [showPluginPanels, setShowPluginPanels] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [desktopSidebarSize, setDesktopSidebarSize] = useState(DESKTOP_SIDEBAR_DEFAULT);
  const [desktopPanelSize, setDesktopPanelSize] = useState(DESKTOP_PANEL_DEFAULT);
  const [desktopAiPanelSize, setDesktopAiPanelSize] = useState(DESKTOP_AI_PANEL_DEFAULT);
  const [panelOpenInitialized, setPanelOpenInitialized] = useState(false);
  const [aiPanelOpenInitialized, setAiPanelOpenInitialized] = useState(false);
  const [activityView, setActivityView] = useState<"files" | "annotations" | "search">("files");
  const [activityViewInitialized, setActivityViewInitialized] = useState(false);
  const [sidePanelStateInitialized, setSidePanelStateInitialized] = useState(false);
  const [tabletSizes, setTabletSizes] = useState(() => [
    TABLET_SIDEBAR_DEFAULT,
    100 - TABLET_SIDEBAR_DEFAULT,
  ]);
  const [panelSizeInitialized, setPanelSizeInitialized] = useState(false);
  const [aiPanelSizeInitialized, setAiPanelSizeInitialized] = useState(false);
  const panelSizePendingRef = useRef<number | null>(null);
  const panelSizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aiPanelSizePendingRef = useRef<number | null>(null);
  const aiPanelSizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aiPanelFocusReturnRef = useRef<HTMLElement | null>(null);

  const loadSettings = useSettingsStore((state) => state.loadSettings);
  const updateSetting = useSettingsStore((state) => state.updateSetting);
  const settings = useSettingsStore((state) => state.settings);
  const isInitialized = useSettingsStore((state) => state.isInitialized);
  const loadPlugins = usePluginStore((state) => state.loadPlugins);
  const aiChatOpen = useAiChatStore((state) => state.isOpen);
  const setAiChatOpen = useAiChatStore((state) => state.setOpen);
  const { openDirectory, openWorkspacePath } = useFileSystem();
  const { toggleTheme } = useTheme();
  const { t } = useI18n();
  const router = useRouter();
  const isDesktopLayout = !isMobile && !isTablet;
  const recentWorkspaces = settings.recentWorkspacePaths ?? [];
  const openGuide = useCallback(() => {
    router.push(resolveAppRoute("/guide"));
  }, [router]);

  useAutoOpenFolder();
  useWorkbenchSession();

  // Flush pending annotation saves before page unload
  useEffect(() => {
    const handleBeforeUnload = () => {
      useAnnotationStore.getState().flushPendingSaves();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // Fix hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // Initialize AI key storage and load chat history
  useEffect(() => {
    const cancel = scheduleIdleTask(() => {
      initKeyStorage().catch(() => {});
      useAiChatStore.getState().loadConversations?.().catch(() => {});
      void import("@/components/ai/ai-chat-panel");
    });
    return cancel;
  }, []);

  useEffect(() => {
    const cancel = scheduleIdleTask(() => {
      loadPlugins();
    });
    return cancel;
  }, [loadPlugins]);

  useEffect(() => {
    if (isInitialized) {
      setLocale(settings.language);
    }
  }, [isInitialized, settings.language]);

  useEffect(() => {
    if (!isInitialized || panelSizeInitialized) return;
    const initialSize =
      typeof settings.pluginPanelDockSize === "number"
        ? settings.pluginPanelDockSize
        : DESKTOP_PANEL_DEFAULT;
    setDesktopPanelSize(clampDesktopPluginPanelSize(initialSize));
    setPanelSizeInitialized(true);
  }, [isInitialized, panelSizeInitialized, settings.pluginPanelDockSize]);

  useEffect(() => {
    if (!isInitialized || aiPanelSizeInitialized) return;
    const initialSize =
      typeof settings.aiPanelWidth === "number"
        ? settings.aiPanelWidth
        : DESKTOP_AI_PANEL_DEFAULT;
    setDesktopAiPanelSize(clampDesktopAiPanelSize(initialSize));
    setAiPanelSizeInitialized(true);
  }, [aiPanelSizeInitialized, isInitialized, settings.aiPanelWidth]);

  useEffect(() => {
    if (!isInitialized || panelOpenInitialized) return;
    if (!isDesktopLayout) {
      setShowPluginPanels(false);
      setPanelOpenInitialized(true);
      return;
    }
    setShowPluginPanels(Boolean(settings.pluginPanelDockOpen));
    setPanelOpenInitialized(true);
  }, [isInitialized, panelOpenInitialized, settings.pluginPanelDockOpen, isDesktopLayout]);

  useEffect(() => {
    if (!isInitialized || aiPanelOpenInitialized) return;
    if (!isDesktopLayout) {
      setAiChatOpen(false);
      setAiPanelOpenInitialized(true);
      return;
    }
    setAiChatOpen(Boolean(settings.aiPanelOpen));
    setAiPanelOpenInitialized(true);
  }, [aiPanelOpenInitialized, isDesktopLayout, isInitialized, setAiChatOpen, settings.aiPanelOpen]);

  useEffect(() => {
    if (!isInitialized || activityViewInitialized) return;
    const nextView =
      settings.activityView === "annotations" || settings.activityView === "search"
        ? settings.activityView
        : "files";
    setActivityView(nextView);
    setActivityViewInitialized(true);
  }, [activityViewInitialized, isInitialized, settings.activityView]);

  useEffect(() => {
    if (!isInitialized || sidePanelStateInitialized) return;
    if (typeof settings.sidePanelWidth === "number") {
      setDesktopSidebarSize(Math.min(42, Math.max(14, settings.sidePanelWidth)));
    }
    setSidebarCollapsed(Boolean(settings.sidePanelCollapsed));
    setSidePanelStateInitialized(true);
  }, [isInitialized, setSidebarCollapsed, settings.sidePanelCollapsed, settings.sidePanelWidth, sidePanelStateInitialized]);

  useEffect(() => {
    if (isDesktopLayout) return;
    setShowPluginPanels(false);
    setAiChatOpen(false);
  }, [isDesktopLayout, setAiChatOpen]);

  useEffect(() => {
    if (!isInitialized) return;
    const trustedList = Array.isArray(settings.trustedPlugins) ? settings.trustedPlugins : [];
    const enabledList = Array.isArray(settings.enabledPlugins) ? settings.enabledPlugins : [];
    const trusted = new Set(trustedList);
    const enabled = enabledList.filter((id) => trusted.has(id));
    const cancel = scheduleIdleTask(() => {
      void syncPlugins({
        pluginsEnabled: settings.pluginsEnabled,
        enabledPluginIds: enabled,
      });
    }, 3000);
    return cancel;
  }, [isInitialized, settings.pluginsEnabled, settings.enabledPlugins, settings.trustedPlugins]);

  useEffect(() => {
    if (!isInitialized) return;
    const allowlist = Array.isArray(settings.pluginNetworkAllowlist)
      ? settings.pluginNetworkAllowlist
      : [];
    const cancel = scheduleIdleTask(() => {
      updatePluginNetworkAllowlist(allowlist);
    }, 3000);
    return cancel;
  }, [isInitialized, settings.pluginNetworkAllowlist]);

  useEffect(() => {
    if (isMobile) {
      setSidebarCollapsed(true);
    }
  }, [isMobile, setSidebarCollapsed]);

  useUnsavedWarning();
  usePluginShortcuts();

  const persistPanelSize = useCallback(
    (size: number) => {
      if (!isInitialized) return;
      panelSizePendingRef.current = clampDesktopPluginPanelSize(size);
      if (panelSizeTimerRef.current) {
        clearTimeout(panelSizeTimerRef.current);
      }
      panelSizeTimerRef.current = setTimeout(() => {
        const next = panelSizePendingRef.current;
        if (typeof next === "number") {
          void updateSetting("pluginPanelDockSize", next);
        }
      }, 200);
    },
    [isInitialized, updateSetting]
  );

  const persistAiPanelSize = useCallback(
    (size: number) => {
      if (!isInitialized) return;
      aiPanelSizePendingRef.current = clampDesktopAiPanelSize(size);
      if (aiPanelSizeTimerRef.current) {
        clearTimeout(aiPanelSizeTimerRef.current);
      }
      aiPanelSizeTimerRef.current = setTimeout(() => {
        const next = aiPanelSizePendingRef.current;
        if (typeof next === "number") {
          void updateSetting("aiPanelWidth", next);
        }
      }, 200);
    },
    [isInitialized, updateSetting]
  );

  useEffect(() => {
    return () => {
      if (panelSizeTimerRef.current) {
        clearTimeout(panelSizeTimerRef.current);
      }
      if (aiPanelSizeTimerRef.current) {
        clearTimeout(aiPanelSizeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isInitialized || !panelOpenInitialized || !isDesktopLayout) return;
    if (settings.pluginPanelDockOpen === showPluginPanels) return;
    void updateSetting("pluginPanelDockOpen", showPluginPanels);
  }, [
    isInitialized,
    panelOpenInitialized,
    isDesktopLayout,
    settings.pluginPanelDockOpen,
    showPluginPanels,
    updateSetting,
  ]);

  useEffect(() => {
    if (!isInitialized || !aiPanelOpenInitialized || !isDesktopLayout) return;
    if (settings.aiPanelOpen === aiChatOpen) return;
    void updateSetting("aiPanelOpen", aiChatOpen);
  }, [aiChatOpen, aiPanelOpenInitialized, isDesktopLayout, isInitialized, settings.aiPanelOpen, updateSetting]);

  useEffect(() => {
    if (!isInitialized || !activityViewInitialized) return;
    if (settings.activityView === activityView) return;
    void updateSetting("activityView", activityView);
  }, [activityView, activityViewInitialized, isInitialized, settings.activityView, updateSetting]);

  useEffect(() => {
    if (!isInitialized || !sidePanelStateInitialized || !isDesktopLayout) return;
    if (settings.sidePanelCollapsed !== sidebarCollapsed) {
      void updateSetting("sidePanelCollapsed", sidebarCollapsed);
    }
  }, [isDesktopLayout, isInitialized, settings.sidePanelCollapsed, sidePanelStateInitialized, sidebarCollapsed, updateSetting]);

  useEffect(() => {
    if (!isInitialized || !sidePanelStateInitialized || !isDesktopLayout || sidebarCollapsed) return;
    if (Math.abs(settings.sidePanelWidth - desktopSidebarSize) < 0.1) return;
    void updateSetting("sidePanelWidth", desktopSidebarSize);
  }, [desktopSidebarSize, isDesktopLayout, isInitialized, settings.sidePanelWidth, sidePanelStateInitialized, sidebarCollapsed, updateSetting]);

  useEffect(() => {
    if (isMobile) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "b") {
        e.preventDefault();
        toggleSidebar();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShowCommands(true);
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setShowPluginPanels((prev) => !prev);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === ",") {
        e.preventDefault();
        setShowSettings(true);
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "T") {
        e.preventDefault();
        toggleTheme();
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "?") {
        e.preventDefault();
        openGuide();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isMobile, openGuide, toggleSidebar, toggleTheme]);

  const SidebarContent = (
    <>
      <div className="flex-1 overflow-hidden">
        <ExplorerSidebar />
      </div>
      <div className="border-t border-border p-2 flex items-center justify-between">
        <button
          onClick={() => setShowSettings(true)}
          className={cn(
            "flex items-center gap-2 px-2 py-1.5 rounded-md",
            "text-sm text-muted-foreground",
            "hover:bg-muted hover:text-foreground transition-colors",
            "flex-1"
          )}
          style={(isMobile || isTablet) ? { minHeight: TOUCH_TARGET_MIN } : undefined}
          title={`${t("settings.title")} (Ctrl+,)`}
        >
          <Settings className={cn("h-4 w-4", isMobile && "h-5 w-5")} />
          <span>{t("settings.title")}</span>
        </button>
        <button
          onClick={() => setShowCommands(true)}
          className={cn(
            "p-1.5 rounded-md",
            "text-muted-foreground",
            "hover:bg-muted hover:text-foreground transition-colors"
          )}
          style={(isMobile || isTablet) ? { minWidth: TOUCH_TARGET_MIN, minHeight: TOUCH_TARGET_MIN } : undefined}
          title={t("commands.open")}
        >
          <Command className={cn("h-4 w-4", isMobile && "h-5 w-5")} />
        </button>
        <button
          onClick={() => setShowPluginPanels(true)}
          className={cn(
            "p-1.5 rounded-md",
            "text-muted-foreground",
            "hover:bg-muted hover:text-foreground transition-colors"
          )}
          style={(isMobile || isTablet) ? { minWidth: TOUCH_TARGET_MIN, minHeight: TOUCH_TARGET_MIN } : undefined}
          title={t("panels.open")}
        >
          <PanelLeft className={cn("h-4 w-4", isMobile && "h-5 w-5")} />
        </button>
        <button
          onClick={openGuide}
          className={cn(
            "p-1.5 rounded-md",
            "text-muted-foreground",
            "hover:bg-muted hover:text-foreground transition-colors"
          )}
          style={(isMobile || isTablet) ? { minWidth: TOUCH_TARGET_MIN, minHeight: TOUCH_TARGET_MIN } : undefined}
          title={t("settings.shortcuts.openGuide")} aria-label={t("settings.shortcuts.openGuide")} data-guide-entry="sidebar"
        >
          <HelpCircle className={cn("h-4 w-4", isMobile && "h-5 w-5")} />
        </button>
        <PluginToolbarSlot />
      </div>
    </>
  );

  const openAiPanel = useCallback((returnFocusElement?: HTMLElement | null) => {
    if (returnFocusElement) {
      aiPanelFocusReturnRef.current = returnFocusElement;
    } else if (document.activeElement instanceof HTMLElement) {
      aiPanelFocusReturnRef.current = document.activeElement;
    }
    setAiChatOpen(true);
  }, [setAiChatOpen]);

  const closeAiPanel = useCallback((options?: { restoreFocus?: boolean }) => {
    setAiChatOpen(false);
    if (options?.restoreFocus === false) {
      return;
    }
    window.requestAnimationFrame(() => {
      aiPanelFocusReturnRef.current?.focus();
    });
  }, [setAiChatOpen]);

  const toggleAiPanel = useCallback((returnFocusElement?: HTMLElement | null) => {
    if (useAiChatStore.getState().isOpen) {
      closeAiPanel();
      return;
    }
    openAiPanel(returnFocusElement);
  }, [closeAiPanel, openAiPanel]);

  const desktopWorkbenchLayout = useMemo(() => buildDesktopWorkbenchLayout({
    sidebarCollapsed,
    requestedSidebarSize: desktopSidebarSize,
    showPluginPanels,
    requestedPluginPanelSize: desktopPanelSize,
    showAiPanel: aiChatOpen,
    requestedAiPanelSize: desktopAiPanelSize,
  }), [aiChatOpen, desktopAiPanelSize, desktopPanelSize, desktopSidebarSize, showPluginPanels, sidebarCollapsed]);

  const renderDesktopSidePanel = () => {
    if (activityView === "annotations") {
      return <AnnotationsActivityPanel />;
    }
    if (activityView === "search") {
      return <WorkspaceSearchPanel />;
    }
    return <ExplorerSidebar />;
  };

  // Prevent hydration mismatch - wait for client-side mount
  if (!mounted) {
    return (
      <div className="h-screen w-screen overflow-hidden bg-background flex items-center justify-center">
        <div className="text-muted-foreground">{t("common.loading")}</div>
      </div>
    );
  }

  // Mobile Layout
  if (isMobile) {
    return (
      <div className="h-screen w-screen overflow-hidden bg-background flex flex-col">
        <header className="flex items-center justify-between px-2 py-2 border-b border-border bg-card shrink-0">
          <MobileSidebarTrigger onClick={() => setMobileSidebarOpen(true)}>
            <Menu className="h-5 w-5" />
          </MobileSidebarTrigger>
          <h1 className="text-sm font-medium">{t("app.name")}</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowPluginPanels(true)}
              className={cn(
                "flex items-center justify-center rounded-md",
                "text-muted-foreground hover:text-foreground",
                "hover:bg-muted transition-colors"
              )}
              style={{ minWidth: TOUCH_TARGET_MIN, minHeight: TOUCH_TARGET_MIN }}
              title={t("panels.open")}
            >
              <PanelLeft className="h-5 w-5" />
            </button>
            <button
              onClick={openGuide}
              className={cn(
                "flex items-center justify-center rounded-md",
                "text-muted-foreground hover:text-foreground",
                "hover:bg-muted transition-colors"
              )}
              style={{ minWidth: TOUCH_TARGET_MIN, minHeight: TOUCH_TARGET_MIN }}
              title={t("settings.shortcuts.openGuide")} aria-label={t("settings.shortcuts.openGuide")} data-guide-entry="mobile-header"
            >
              <HelpCircle className="h-5 w-5" />
            </button>
            <button
              onClick={() => setShowSettings(true)}
              className={cn(
                "flex items-center justify-center rounded-md",
                "text-muted-foreground hover:text-foreground",
                "hover:bg-muted transition-colors"
              )}
              style={{ minWidth: TOUCH_TARGET_MIN, minHeight: TOUCH_TARGET_MIN }}
              title={t("settings.title")}
            >
              <Settings className="h-5 w-5" />
            </button>
          </div>
        </header>
        <main className="flex-1 overflow-hidden">
          <MainArea />
        </main>
        <PluginStatusBarSlot />
        <MobileSidebar isOpen={mobileSidebarOpen} onClose={() => setMobileSidebarOpen(false)}>
          {SidebarContent}
        </MobileSidebar>
        <Dialogs
          showSettings={showSettings}
          setShowSettings={setShowSettings}
          showCommands={showCommands}
          setShowCommands={setShowCommands}
          showPluginPanels={showPluginPanels}
          setShowPluginPanels={setShowPluginPanels}
        />
      </div>
    );
  }

  // Tablet Layout
  if (isTablet) {
    const showSidebar = isLandscape && !sidebarCollapsed;
    const tabletMainDefault = 100 - TABLET_SIDEBAR_DEFAULT;
    const tabletGroupSizes = showSidebar ? tabletSizes : [100];

    return (
      <div className="h-screen w-screen overflow-hidden bg-background">
        <ResizablePanelGroup
          direction="horizontal"
          className="h-full"
          sizes={tabletGroupSizes}
          onSizesChange={showSidebar ? setTabletSizes : undefined}
        >
          {showSidebar && (
            <>
              <ResizablePanel
                index={0}
                defaultSize={TABLET_SIDEBAR_DEFAULT}
                minSize={12}
                maxSize={80}
                className="bg-card flex flex-col"
              >
                <div className="flex items-center justify-end p-2 border-b border-border">
                  <button
                    onClick={toggleSidebar}
                    className={cn(
                      "flex items-center justify-center rounded-md",
                      "text-muted-foreground hover:text-foreground",
                      "hover:bg-muted transition-colors"
                    )}
                    style={{ minWidth: TOUCH_TARGET_MIN, minHeight: TOUCH_TARGET_MIN }}
                    title={t("workbench.sidebar.collapse")}
                  >
                    <PanelLeftClose className="h-5 w-5" />
                  </button>
                </div>
                {SidebarContent}
              </ResizablePanel>
              <ResizableHandle withHandle className="w-2 touch-none" index={0} />
            </>
          )}
          <ResizablePanel
            index={showSidebar ? 1 : 0}
            defaultSize={showSidebar ? tabletMainDefault : 100}
            minSize={40}
            className="flex flex-col"
          >
            {!showSidebar && (
              <header className="flex items-center gap-2 px-2 py-2 border-b border-border bg-card shrink-0">
                <button
                  onClick={() => (isLandscape ? toggleSidebar() : setMobileSidebarOpen(true))}
                  className={cn(
                    "flex items-center justify-center rounded-md",
                    "text-muted-foreground hover:text-foreground",
                    "hover:bg-muted transition-colors"
                  )}
                  style={{ minWidth: TOUCH_TARGET_MIN, minHeight: TOUCH_TARGET_MIN }}
                  title={t("workbench.sidebar.open")}
                >
                  {isLandscape ? <PanelLeft className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
                </button>
                <h1 className="text-sm font-medium flex-1">{t("app.name")}</h1>
                <button
                  onClick={() => setShowPluginPanels(true)}
                  className={cn(
                    "flex items-center justify-center rounded-md",
                    "text-muted-foreground hover:text-foreground",
                    "hover:bg-muted transition-colors"
                  )}
                  style={{ minWidth: TOUCH_TARGET_MIN, minHeight: TOUCH_TARGET_MIN }}
                  title={t("panels.open")}
                >
                  <PanelLeft className="h-5 w-5" />
                </button>
                <button
                  onClick={() => setShowSettings(true)}
                  className={cn(
                    "flex items-center justify-center rounded-md",
                    "text-muted-foreground hover:text-foreground",
                    "hover:bg-muted transition-colors"
                  )}
                  style={{ minWidth: TOUCH_TARGET_MIN, minHeight: TOUCH_TARGET_MIN }}
                >
                  <Settings className="h-5 w-5" />
                </button>
              </header>
            )}
            <div className="flex-1 overflow-hidden">
              <MainArea />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
        {!isLandscape && (
          <MobileSidebar isOpen={mobileSidebarOpen} onClose={() => setMobileSidebarOpen(false)}>
            {SidebarContent}
          </MobileSidebar>
        )}
        <Dialogs
          showSettings={showSettings}
          setShowSettings={setShowSettings}
          showCommands={showCommands}
          setShowCommands={setShowCommands}
          showPluginPanels={showPluginPanels}
          setShowPluginPanels={setShowPluginPanels}
        />
      </div>
    );
  }

  // Desktop Layout
  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-background">
      <DesktopWindowFrame />
      <CommandBar
        onOpenWorkspace={() => void openDirectory()}
        recentWorkspaces={recentWorkspaces}
        onOpenRecentWorkspace={(path) => void openWorkspacePath(path)}
      />
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className="flex w-14 shrink-0 flex-col items-center border-r border-border bg-card/90 px-1 py-2">
          <div className="flex w-full flex-col items-center gap-2">
            <CollapsedRailButton
              icon={FolderTree}
              label={t("explorer.title")}
              title={t("explorer.title")}
              active={activityView === "files" && !sidebarCollapsed}
              onClick={() => {
                setActivityView("files");
                setSidebarCollapsed(activityView === "files" ? !sidebarCollapsed : false);
              }}
            />
            <CollapsedRailButton
              icon={SearchIcon}
              label={t("workbench.activity.search")}
              title={t("workbench.activity.search")}
              active={activityView === "search" && !sidebarCollapsed}
              onClick={() => {
                setActivityView("search");
                setSidebarCollapsed(activityView === "search" ? !sidebarCollapsed : false);
              }}
            />
            <CollapsedRailButton
              icon={MessageSquareText}
              label={t("annotations.title")}
              title={t("annotations.title")}
              active={activityView === "annotations" && !sidebarCollapsed}
              onClick={() => {
                setActivityView("annotations");
                setSidebarCollapsed(activityView === "annotations" ? !sidebarCollapsed : false);
              }}
            />
            <div className="my-1 h-px w-8 bg-border" />
            <CollapsedRailButton
              icon={Bot}
              label={t("chat.title")}
              title={t("chat.title")}
              active={aiChatOpen}
              onClick={(event) => toggleAiPanel(event.currentTarget)}
            />
          </div>

          <div className="mt-auto flex w-full flex-col items-center gap-2 border-t border-border pt-2">
            <CollapsedRailButton
              icon={Command}
              label={t("commands.open")}
              title={t("commands.open")}
              onClick={() => setShowCommands(true)}
            />
            <CollapsedRailButton
              icon={LayoutGrid}
              label={t("panels.open")}
              title={t("panels.open")}
              active={showPluginPanels}
              onClick={() => setShowPluginPanels((prev) => !prev)}
            />
            <CollapsedRailButton
              icon={HelpCircle}
              label={t("settings.shortcuts.openGuide")}
              title={t("settings.shortcuts.openGuide")}
              onClick={openGuide}
            />
            <CollapsedRailButton
              icon={Settings}
              label={t("settings.title")}
              title={t("settings.title")}
              onClick={() => setShowSettings(true)}
            />
          </div>
        </div>

        <ResizablePanelGroup
          direction="horizontal"
          className="flex-1 min-h-0"
          sizes={desktopWorkbenchLayout.sizes}
          onSizesChange={(sizes) => {
            if (!sidebarCollapsed && sizes.length >= 1) {
              setDesktopSidebarSize(
                Math.min(
                  getDesktopSidebarMaxSize(desktopWorkbenchLayout.rightPanels),
                  Math.max(14, sizes[0]),
                ),
              );
            }

            const rightPanelStartIndex = sidebarCollapsed ? 1 : 2;
            desktopWorkbenchLayout.rightPanels.forEach((panel, index) => {
              const nextSize = sizes[rightPanelStartIndex + index];
              if (typeof nextSize !== "number") {
                return;
              }

              if (panel.kind === "plugin") {
                const next = clampDesktopPluginPanelSize(nextSize);
                setDesktopPanelSize(next);
                persistPanelSize(next);
                return;
              }

              const next = clampDesktopAiPanelSize(nextSize);
              setDesktopAiPanelSize(next);
              persistAiPanelSize(next);
            });
          }}
        >
          {!sidebarCollapsed && (
            <>
              <ResizablePanel
                index={0}
                defaultSize={DESKTOP_SIDEBAR_DEFAULT}
                minSize={14}
                maxSize={getDesktopSidebarMaxSize(desktopWorkbenchLayout.rightPanels)}
                className="bg-card flex flex-col"
              >
                {renderDesktopSidePanel()}
              </ResizablePanel>
              <ResizableHandle withHandle index={0} />
            </>
          )}

          <ResizablePanel
            index={sidebarCollapsed ? 0 : 1}
            defaultSize={sidebarCollapsed ? 100 : 100 - DESKTOP_SIDEBAR_DEFAULT}
            minSize={DESKTOP_MAIN_PANEL_MIN}
          >
            <MainArea />
          </ResizablePanel>

          {showPluginPanels && (
            <>
              <ResizableHandle withHandle index={sidebarCollapsed ? 0 : 1} />
              <ResizablePanel
                index={sidebarCollapsed ? 1 : 2}
                defaultSize={desktopPanelSize}
                minSize={DESKTOP_PANEL_MIN}
                maxSize={DESKTOP_PANEL_MAX}
              >
                <PluginPanelDock onClose={() => setShowPluginPanels(false)} />
              </ResizablePanel>
            </>
          )}

          {aiChatOpen && (
            <>
              <ResizableHandle withHandle index={sidebarCollapsed ? (showPluginPanels ? 1 : 0) : (showPluginPanels ? 2 : 1)} />
              <ResizablePanel
                index={sidebarCollapsed ? (showPluginPanels ? 2 : 1) : (showPluginPanels ? 3 : 2)}
                defaultSize={desktopAiPanelSize}
                minSize={DESKTOP_AI_PANEL_MIN}
                maxSize={DESKTOP_AI_PANEL_MAX}
                className="min-h-0 border-l border-border bg-background"
              >
                <AiChatPanel onClose={() => closeAiPanel()} />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </div>
      <PluginStatusBarSlot />
      <Dialogs
        showSettings={showSettings}
        setShowSettings={setShowSettings}
        showCommands={showCommands}
        setShowCommands={setShowCommands}
        showPluginPanels={isMobile ? showPluginPanels : false}
        setShowPluginPanels={setShowPluginPanels}
      />
    </div>
  );
}

function Dialogs({
  showSettings,
  setShowSettings,
  showCommands,
  setShowCommands,
  showPluginPanels,
  setShowPluginPanels,
}: {
  showSettings: boolean;
  setShowSettings: (show: boolean) => void;
  showCommands: boolean;
  setShowCommands: (show: boolean) => void;
  showPluginPanels: boolean;
  setShowPluginPanels: (show: boolean) => void;
}) {
  return (
    <>
      {!isTauriHost() && <DownloadAppDialog />}
      <ErrorBoundary onReset={() => setShowCommands(false)}>
        <PluginCommandDialog
          isOpen={showCommands}
          onClose={() => setShowCommands(false)}
          onOpenSettings={() => setShowSettings(true)}
          onOpenPluginPanels={() => setShowPluginPanels(true)}
        />
      </ErrorBoundary>
      <ErrorBoundary onReset={() => setShowPluginPanels(false)}>
        <PluginPanelDialog isOpen={showPluginPanels} onClose={() => setShowPluginPanels(false)} />
      </ErrorBoundary>
      <ErrorBoundary onReset={() => setShowSettings(false)}>
        <SettingsDialog isOpen={showSettings} onClose={() => setShowSettings(false)} />
      </ErrorBoundary>
      <OnboardingWizard />
      <ExportToastContainer />
    </>
  );
}






