"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { isTauriHost } from "@/lib/storage-adapter";
import { setLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { TOUCH_TARGET_MIN } from "@/lib/responsive";
import { syncPlugins, updatePluginNetworkAllowlist } from "@/lib/plugins/runtime";
import { resolveAppRoute } from "@/lib/app-route";
import { getCollapsedSidebarPercent, getCollapsedSidebarPixelWidth } from "@/lib/layout-sidebar";
import { Settings, HelpCircle, Menu, PanelLeftClose, PanelLeft, Command, Bot } from "lucide-react";
import { AiContextDialog } from "@/components/ui/ai-context-dialog";
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

const DESKTOP_SIDEBAR_DEFAULT = 20;
const DESKTOP_PANEL_DEFAULT = 22;
const DESKTOP_PANEL_MIN = 16;
const DESKTOP_PANEL_MAX = 45;
const TABLET_SIDEBAR_DEFAULT = 28;

const clampPanelSize = (value: number) =>
  Math.min(DESKTOP_PANEL_MAX, Math.max(DESKTOP_PANEL_MIN, value));

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
  onClick: () => void;
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
  const [showAiContext, setShowAiContext] = useState(false);
  const [showPluginPanels, setShowPluginPanels] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [desktopSidebarSize, setDesktopSidebarSize] = useState(DESKTOP_SIDEBAR_DEFAULT);
  const [desktopCollapsedSidebarSize, setDesktopCollapsedSidebarSize] = useState(() =>
    typeof window === "undefined" ? getCollapsedSidebarPercent(1280) : getCollapsedSidebarPercent(window.innerWidth)
  );
  const [desktopPanelSize, setDesktopPanelSize] = useState(DESKTOP_PANEL_DEFAULT);
  const [panelOpenInitialized, setPanelOpenInitialized] = useState(false);
  const [tabletSizes, setTabletSizes] = useState(() => [
    TABLET_SIDEBAR_DEFAULT,
    100 - TABLET_SIDEBAR_DEFAULT,
  ]);
  const [panelSizeInitialized, setPanelSizeInitialized] = useState(false);
  const panelSizePendingRef = useRef<number | null>(null);
  const panelSizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadSettings = useSettingsStore((state) => state.loadSettings);
  const updateSetting = useSettingsStore((state) => state.updateSetting);
  const settings = useSettingsStore((state) => state.settings);
  const isInitialized = useSettingsStore((state) => state.isInitialized);
  const loadPlugins = usePluginStore((state) => state.loadPlugins);
  const aiChatOpen = useAiChatStore((state) => state.isOpen);
  const { toggleTheme } = useTheme();
  const { t } = useI18n();
  const router = useRouter();
  const isDesktopLayout = !isMobile && !isTablet;
  const openGuide = useCallback(() => {
    router.push(resolveAppRoute("/guide"));
  }, [router]);

  useAutoOpenFolder();

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
    setDesktopPanelSize(clampPanelSize(initialSize));
    setPanelSizeInitialized(true);
  }, [isInitialized, panelSizeInitialized, settings.pluginPanelDockSize]);

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
    if (isDesktopLayout) return;
    setShowPluginPanels(false);
  }, [isDesktopLayout]);

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

  useEffect(() => {
    if (typeof window === "undefined") return;

    const updateCollapsedSidebarSize = () => {
      setDesktopCollapsedSidebarSize(getCollapsedSidebarPercent(window.innerWidth));
    };

    updateCollapsedSidebarSize();
    window.addEventListener("resize", updateCollapsedSidebarSize);
    return () => window.removeEventListener("resize", updateCollapsedSidebarSize);
  }, []);

  useUnsavedWarning();
  usePluginShortcuts();

  const persistPanelSize = useCallback(
    (size: number) => {
      if (!isInitialized) return;
      panelSizePendingRef.current = clampPanelSize(size);
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

  useEffect(() => {
    return () => {
      if (panelSizeTimerRef.current) {
        clearTimeout(panelSizeTimerRef.current);
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

  const desktopGroupSizes = useMemo(() => {
    if (sidebarCollapsed) {
      return showPluginPanels
        ? [desktopCollapsedSidebarSize, Math.max(20, 100 - desktopCollapsedSidebarSize - desktopPanelSize), desktopPanelSize]
        : [desktopCollapsedSidebarSize, 100 - desktopCollapsedSidebarSize];
    }
    if (showPluginPanels) {
      const main = Math.max(20, 100 - desktopSidebarSize - desktopPanelSize);
      return [desktopSidebarSize, main, desktopPanelSize];
    }
    return [desktopSidebarSize, 100 - desktopSidebarSize];
  }, [sidebarCollapsed, showPluginPanels, desktopSidebarSize, desktopCollapsedSidebarSize, desktopPanelSize]);

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
          onClick={() => setShowAiContext(true)}
          className={cn(
            "p-1.5 rounded-md",
            "text-muted-foreground",
            "hover:bg-muted hover:text-foreground transition-colors"
          )}
          style={(isMobile || isTablet) ? { minWidth: TOUCH_TARGET_MIN, minHeight: TOUCH_TARGET_MIN } : undefined}
          title={t("ai.context.open")}
        >
          <Bot className={cn("h-4 w-4", isMobile && "h-5 w-5")} />
        </button>
        <button
          onClick={openGuide}
          className={cn(
            "p-1.5 rounded-md",
            "text-muted-foreground",
            "hover:bg-muted hover:text-foreground transition-colors"
          )}
          style={(isMobile || isTablet) ? { minWidth: TOUCH_TARGET_MIN, minHeight: TOUCH_TARGET_MIN } : undefined}
          title="实时预览指南 (Ctrl+Shift+/)" aria-label="打开实时预览指南" data-guide-entry="sidebar"
        >
          <HelpCircle className={cn("h-4 w-4", isMobile && "h-5 w-5")} />
        </button>
        <PluginToolbarSlot />
      </div>
    </>
  );

  // Prevent hydration mismatch - wait for client-side mount
  if (!mounted) {
    return (
      <div className="h-screen w-screen overflow-hidden bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
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
          <h1 className="text-sm font-medium">Lattice 格致</h1>
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
              title="实时预览指南" aria-label="打开实时预览指南" data-guide-entry="mobile-header"
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
          showAiContext={showAiContext}
          setShowAiContext={setShowAiContext}
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
                    title="Collapse sidebar"
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
                  title="Open sidebar"
                >
                  {isLandscape ? <PanelLeft className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
                </button>
                <h1 className="text-sm font-medium flex-1">Lattice 格致</h1>
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
          showAiContext={showAiContext}
          setShowAiContext={setShowAiContext}
          showPluginPanels={showPluginPanels}
          setShowPluginPanels={setShowPluginPanels}
        />
      </div>
    );
  }

  // Desktop Layout
  return (
    <div className="h-screen w-screen overflow-hidden bg-background flex flex-col">
      <ResizablePanelGroup
        direction="horizontal"
        className="flex-1"
        sizes={desktopGroupSizes}
        onSizesChange={(sizes) => {
            if (sidebarCollapsed) {
              if (showPluginPanels && sizes[2]) {
                const next = clampPanelSize(sizes[2]);
                setDesktopPanelSize(next);
                persistPanelSize(next);
              }
              return;
            }
            if (showPluginPanels && sizes.length >= 3) {
              setDesktopSidebarSize(sizes[0]);
              const next = clampPanelSize(sizes[2]);
              setDesktopPanelSize(next);
              persistPanelSize(next);
              return;
            }
          if (sizes.length >= 2) {
            setDesktopSidebarSize(sizes[0]);
          }
        }}
      >
        {sidebarCollapsed ? (
          <ResizablePanel
            index={0}
            defaultSize={desktopCollapsedSidebarSize}
            minSize={desktopCollapsedSidebarSize}
            maxSize={desktopCollapsedSidebarSize}
            className="bg-card/90 backdrop-blur-sm border-r border-border"
            style={{ width: `${getCollapsedSidebarPixelWidth()}px` }}
          >
            <div className="flex h-full w-full flex-col items-center justify-between px-2 py-3">
              <div className="flex w-full flex-col items-center gap-3">
                <button
                  onClick={toggleSidebar}
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-xl border border-border/70 bg-background/70",
                    "text-muted-foreground hover:bg-accent hover:text-foreground transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                  )}
                  title={`${t("explorer.title")} (Ctrl+B)`}
                  aria-label={t("explorer.title")}
                >
                  <PanelLeft className="h-4 w-4" />
                </button>
                <div className="flex min-h-[160px] flex-1 items-center justify-center rounded-xl border border-dashed border-border/70 bg-background/40 px-1">
                  <span className="rotate-90 text-[11px] font-semibold tracking-[0.24em] text-muted-foreground/85">
                    EXPLORER
                  </span>
                </div>
              </div>

              <div className="flex w-full flex-col items-center gap-2 border-t border-border pt-3">
                <CollapsedRailButton
                  icon={Command}
                  label={t("commands.open")}
                  title={t("commands.open")}
                  active={showCommands}
                  onClick={() => setShowCommands(true)}
                />
                <CollapsedRailButton
                  icon={PanelLeft}
                  label={t("panels.open")}
                  title={t("panels.open")}
                  active={showPluginPanels}
                  onClick={() => setShowPluginPanels(true)}
                />
                <CollapsedRailButton
                  icon={Bot}
                  label="AI Chat"
                  title="AI Chat"
                  active={aiChatOpen}
                  onClick={() => useAiChatStore.getState().toggleOpen()}
                />
                <CollapsedRailButton
                  icon={HelpCircle}
                  label="实时预览指南"
                  title="实时预览指南 (Ctrl+Shift+/)"
                  onClick={openGuide}
                />
                <CollapsedRailButton
                  icon={Settings}
                  label={t("settings.title")}
                  title={`${t("settings.title")} (Ctrl+,)`}
                  active={showSettings}
                  onClick={() => setShowSettings(true)}
                />
              </div>
            </div>
          </ResizablePanel>
        ) : (
          <>
            <ResizablePanel
              index={0}
              defaultSize={DESKTOP_SIDEBAR_DEFAULT}
              minSize={8}
              maxSize={80}
              className="bg-card flex flex-col"
            >
              {SidebarContent}
            </ResizablePanel>
            <ResizableHandle withHandle index={0} />
          </>
        )}
        <ResizablePanel
          index={1}
          defaultSize={sidebarCollapsed ? 100 - desktopCollapsedSidebarSize : 100 - DESKTOP_SIDEBAR_DEFAULT}
          minSize={40}
        >
          <MainArea />
        </ResizablePanel>
        {showPluginPanels && (
          <>
            <ResizableHandle withHandle index={1} />
            <ResizablePanel
              index={2}
              defaultSize={desktopPanelSize}
              minSize={DESKTOP_PANEL_MIN}
              maxSize={DESKTOP_PANEL_MAX}
            >
              <PluginPanelDock onClose={() => setShowPluginPanels(false)} />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
      {aiChatOpen && <AiChatPanel />}
      <PluginStatusBarSlot />
      <Dialogs
        showSettings={showSettings}
        setShowSettings={setShowSettings}
        showCommands={showCommands}
        setShowCommands={setShowCommands}
        showAiContext={showAiContext}
        setShowAiContext={setShowAiContext}
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
  showAiContext,
  setShowAiContext,
  showPluginPanels,
  setShowPluginPanels,
}: {
  showSettings: boolean;
  setShowSettings: (show: boolean) => void;
  showCommands: boolean;
  setShowCommands: (show: boolean) => void;
  showAiContext: boolean;
  setShowAiContext: (show: boolean) => void;
  showPluginPanels: boolean;
  setShowPluginPanels: (show: boolean) => void;
}) {
  return (
    <>
      {!isTauriHost() && <DownloadAppDialog />}
      <ErrorBoundary onReset={() => setShowCommands(false)}>
        <PluginCommandDialog isOpen={showCommands} onClose={() => setShowCommands(false)} />
      </ErrorBoundary>
      <ErrorBoundary onReset={() => setShowPluginPanels(false)}>
        <PluginPanelDialog isOpen={showPluginPanels} onClose={() => setShowPluginPanels(false)} />
      </ErrorBoundary>
      <ErrorBoundary onReset={() => setShowAiContext(false)}>
        <AiContextDialog isOpen={showAiContext} onClose={() => setShowAiContext(false)} />
      </ErrorBoundary>
      <ErrorBoundary onReset={() => setShowSettings(false)}>
        <SettingsDialog isOpen={showSettings} onClose={() => setShowSettings(false)} />
      </ErrorBoundary>
      <OnboardingWizard />
      <ExportToastContainer />
    </>
  );
}






