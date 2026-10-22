"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEventHandler,
} from "react";
import dynamic from "next/dynamic";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { DndProvider } from "@/components/dnd/dnd-provider";
import {
  ResponsiveProvider,
  useResponsive,
} from "@/contexts/responsive-context";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useVSCodeCompatStore } from "@/stores/vscode-compat-store";
import {
  readVSCodeConfigFromDetectedProfiles,
  shouldAutoImportVSCodeProfile,
} from "@/lib/vscode-compat/auto-discovery";
import {
  normalizeVSCodeExtensionInventory,
  shouldRepairVSCodeExtensionImport,
} from "@/lib/vscode-compat/extensions";
import { useUnsavedWarning } from "@/hooks/use-unsaved-warning";
import { useTheme } from "@/hooks/use-theme";
import { useI18n } from "@/hooks/use-i18n";
import { useAutoOpenFolder } from "@/hooks/use-auto-open-folder";
import { useWorkbenchSession } from "@/hooks/use-workbench-session";
import { registerDesktopWindowCloseHandler, subscribeDesktopWindowCloseRequests } from "@/lib/desktop-window";
import { toast } from "sonner";
import { isTauriHost } from "@/lib/storage-adapter";
import { setLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  UI_MODAL_OVERLAY_CLASS,
  UI_MODAL_OVERLAY_STYLE,
  UI_MODAL_PANEL_CLASS,
} from "@/lib/ui-layers";
import { TOUCH_TARGET_MIN } from "@/lib/responsive";
import {
  syncPlugins,
  updatePluginNetworkAllowlist,
} from "@/lib/plugins/runtime";
import {
  Settings,
  HelpCircle,
  Menu,
  PanelLeftClose,
  PanelLeft,
  Bot,
  Search as SearchIcon,
  MessageSquareText,
  FolderTree,
  Cable,
  SquareTerminal,
  Code2,
  Library,
} from "lucide-react";
import { useFileSystem } from "@/hooks/use-file-system";
import { useWorkspaceLiveSync } from '@/hooks/use-workspace-live-sync';
import { PluginCommandDialog } from "@/components/ui/plugin-command-dialog";
import { PluginPanelDialog } from "@/components/ui/plugin-panel-dialog";
import { SettingsDialog } from "@/components/settings/settings-dialog";
import { DownloadAppDialog } from "@/components/ui/download-app-dialog";
import { VSCodeHostInteractionDialog } from "@/components/vscode-compat/vscode-host-interaction-dialog";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { ExportToastContainer } from "@/components/ui/export-toast";
import { usePluginStore } from "@/stores/plugin-store";
import { useAnnotationStore } from "@/stores/annotation-store";
import { useCodeIntelligenceStore } from "@/stores/code-intelligence-store";
import { PluginStatusBarSlot } from "@/components/ui/plugin-statusbar-slot";
import { PluginToolbarSlot } from "@/components/ui/plugin-toolbar-slot";
import { useAiChatStore } from "@/stores/ai-chat-store";
import { useAiProviderProfileStore } from "@/stores/ai-provider-profile-store";
import { useAiHarnessStore } from "@/stores/ai-harness-store";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { usePluginShortcuts } from "@/hooks/use-plugin-shortcuts";
import { initKeyStorage } from "@/lib/ai/key-storage";
import { isEditableElement } from "@/lib/unified-input-handler";
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
  DESKTOP_SIDEBAR_MIN,
  getDesktopAiPanelIndex,
  getDesktopAiResizeHandleIndex,
  getDesktopPluginPanelIndex,
  getDesktopPluginResizeHandleIndex,
  getDesktopSidebarMaxSize,
  normalizePersistedDesktopAiPanelSize,
  resolveDesktopWorkbenchResize,
} from "@/components/layout/desktop-workbench-layout";
import { resolveActivityViewSelection } from "@/lib/layout-sidebar";
import { useCloudWorkbenchStore } from "@/stores/cloud-workbench-store";
import { CloudExplorerControls } from "@/components/shared-library/cloud-explorer-controls";
import { useCloudExplorerSource } from "@/components/explorer/use-cloud-explorer-source";

const DESKTOP_SIDEBAR_DEFAULT = 20;
const DESKTOP_PANEL_DEFAULT = 22;
const TABLET_SIDEBAR_DEFAULT = 28;

const ExplorerSidebar = dynamic(
  () =>
    import("@/components/explorer/explorer-sidebar").then(
      (mod) => mod.ExplorerSidebar,
    ),
  { ssr: false },
);

const VSCodeActivityPanel = dynamic(
  () =>
    import("@/components/vscode-compat/vscode-activity-panel").then(
      (mod) => mod.VSCodeActivityPanel,
    ),
  { ssr: false },
);

const MainArea = memo(
  dynamic(
    () => import("@/components/main-area/main-area").then((mod) => mod.MainArea),
    { ssr: false },
  ),
);
const CloudLibraryControllerHost = dynamic(
  () => import("@/components/shared-library/cloud-library-workspace").then((mod) => mod.CloudLibraryControllerHost),
  { ssr: false },
);

const MobileSidebar = dynamic(
  () =>
    import("@/components/layout/mobile-sidebar").then(
      (mod) => mod.MobileSidebar,
    ),
  { ssr: false },
);

const MobileSidebarTrigger = dynamic(
  () =>
    import("@/components/layout/mobile-sidebar").then(
      (mod) => mod.MobileSidebarTrigger,
    ),
  { ssr: false },
);

const PluginPanelDock = dynamic(
  () =>
    import("@/components/ui/plugin-panel-dock").then(
      (mod) => mod.PluginPanelDock,
    ),
  { ssr: false },
);

const WorkspaceSearchPanel = dynamic(
  () =>
    import("@/components/layout/workspace-search-panel").then(
      (mod) => mod.WorkspaceSearchPanel,
    ),
  { ssr: false },
);

const AnnotationsActivityPanel = dynamic(
  () =>
    import("@/components/layout/annotations-activity-panel").then(
      (mod) => mod.AnnotationsActivityPanel,
    ),
  { ssr: false },
);

const CommandBar = dynamic(
  () => import("@/components/layout/command-bar").then((mod) => mod.CommandBar),
  { ssr: false },
);

const AiChatPanel = memo(
  dynamic(
    () => import("@/components/ai/ai-chat-panel").then((mod) => mod.AiChatPanel),
    { ssr: false },
  ),
);

const LivePreviewGuide = dynamic(
  () =>
    import("@/components/diagnostics/live-preview-guide").then(
      (mod) => mod.LivePreviewGuide,
    ),
  { ssr: false },
);

// Dialogs are kept as static imports to avoid runtime chunk-loading failures

function scheduleIdleTask(task: () => void, timeout = 2000): () => void {
  if (typeof window === "undefined") return () => {};
  const win = window as Window & {
    requestIdleCallback?: (
      cb: (deadline: {
        didTimeout: boolean;
        timeRemaining: () => number;
      }) => void,
      options?: { timeout: number },
    ) => number;
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
  count,
  onClick,
}: {
  icon: typeof Settings;
  label: string;
  title: string;
  active?: boolean;
  count?: number;
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
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
      title={title}
      aria-label={label}
      aria-pressed={active}
    >
      <Icon className="h-4 w-4" />
      {typeof count === "number" && count > 0 ? (
        <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-primary px-1 text-[9px] leading-4 text-primary-foreground">
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
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
        <CloudLibraryControllerHost />
        <AppLayoutContent />
      </DndProvider>
    </ResponsiveProvider>
  );
}

function AppLayoutContent() {
  const { isMobile, isTablet, isLandscape } = useResponsive();
  const sidebarCollapsed = useWorkspaceStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useWorkspaceStore((state) => state.toggleSidebar);
  const setSidebarCollapsed = useWorkspaceStore(
    (state) => state.setSidebarCollapsed,
  );
  const [showSettings, setShowSettings] = useState(false);
  const [showCommands, setShowCommands] = useState(false);
  const [showPluginPanels, setShowPluginPanels] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const cloudLibraryActive = useCloudWorkbenchStore(state => state.active);
  const cloudSource = useCloudExplorerSource();
  const setCloudActive = useCloudWorkbenchStore(state => state.setActive);
  const workbenchSurface = cloudLibraryActive ? "cloud" : "local";
  const [surfaceInitialized, setSurfaceInitialized] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [desktopSidebarSize, setDesktopSidebarSize] = useState(
    DESKTOP_SIDEBAR_DEFAULT,
  );
  const [desktopPanelSize, setDesktopPanelSize] = useState(
    DESKTOP_PANEL_DEFAULT,
  );
  const [desktopAiPanelSize, setDesktopAiPanelSize] = useState(
    DESKTOP_AI_PANEL_DEFAULT,
  );
  const [panelOpenInitialized, setPanelOpenInitialized] = useState(false);
  const [aiPanelOpenInitialized, setAiPanelOpenInitialized] = useState(false);
  const [activityView, setActivityView] = useState<
    "files" | "annotations" | "search" | "vscode"
  >("files");
  const [activityViewInitialized, setActivityViewInitialized] = useState(false);
  const [sidePanelStateInitialized, setSidePanelStateInitialized] =
    useState(false);
  const [tabletSizes, setTabletSizes] = useState(() => [
    TABLET_SIDEBAR_DEFAULT,
    100 - TABLET_SIDEBAR_DEFAULT,
  ]);
  const [panelSizeInitialized, setPanelSizeInitialized] = useState(false);
  const [aiPanelSizeInitialized, setAiPanelSizeInitialized] = useState(false);
  const [vscodeCompatStateLoaded, setVSCodeCompatStateLoaded] = useState(false);
  const panelSizePendingRef = useRef<number | null>(null);
  const panelSizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aiPanelSizePendingRef = useRef<number | null>(null);
  const aiPanelSizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const aiPanelFocusReturnRef = useRef<HTMLElement | null>(null);

  const loadSettings = useSettingsStore((state) => state.loadSettings);
  const updateSetting = useSettingsStore((state) => state.updateSetting);
  const settings = useSettingsStore((state) => state.settings);
  const isInitialized = useSettingsStore((state) => state.isInitialized);
  const workspaceRootPath = useWorkspaceStore(
    (state) => state.workspaceRootPath,
  );
  const vscodeCompatExtensions = useVSCodeCompatStore(
    (state) => state.extensions,
  );
  const vscodeCompatImportedAt = useVSCodeCompatStore(
    (state) => state.importedAt,
  );
  const replaceVSCodeCompatState = useVSCodeCompatStore(
    (state) => state.replaceState,
  );
  const { openDirectory, openWorkspacePath } = useFileSystem({ subscribeToTree: false });
  useWorkspaceLiveSync();
  const loadPlugins = usePluginStore((state) => state.loadPlugins);
  const aiChatOpen = useAiChatStore((state) => state.isOpen);
  const setAiChatOpen = useAiChatStore((state) => state.setOpen);
  const { toggleTheme } = useTheme();
  const { t } = useI18n();
  const isDesktopLayout = !isMobile && !isTablet;
  const recentWorkspaces = settings.recentWorkspacePaths ?? [];
  const openGuide = useCallback(() => {
    setShowGuide(true);
  }, []);

  useEffect(() => {
    const handleOpenGuide = () => setShowGuide(true);
    window.addEventListener("lattice:open-guide", handleOpenGuide);
    return () =>
      window.removeEventListener("lattice:open-guide", handleOpenGuide);
  }, []);
  useEffect(() => {
    const handleOpenPluginPanel = () => setShowPluginPanels(true);
    window.addEventListener("lattice:open-plugin-panel", handleOpenPluginPanel);
    return () => window.removeEventListener("lattice:open-plugin-panel", handleOpenPluginPanel);
  }, []);
  useAutoOpenFolder();
  useWorkbenchSession();
  useEffect(() => {
    if (!isTauriHost()) return;
    return registerDesktopWindowCloseHandler(async () => {
      await useAiChatStore.getState().flushConversations();
      await useAiHarnessStore.getState().flush();
    });
  }, []);
  useEffect(() => {
    if (!isTauriHost()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const reportFailure = () => toast.error(t("shell.window.closeSaveFailed"));
    void subscribeDesktopWindowCloseRequests(reportFailure).then(remove => {
      if (disposed) remove(); else unlisten = remove;
    }).catch(reportFailure);
    return () => { disposed = true; unlisten?.(); };
  }, [t]);

  // Flush pending annotation saves before page unload
  useEffect(() => {
    const handleBeforeUnload = () => {
      useAnnotationStore.getState().flushPendingSaves();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  // Fix hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    let cancelled = false;
    void useVSCodeCompatStore
      .getState()
      .load()
      .catch(() => {})
      .finally(() => {
        if (!cancelled) {
          setVSCodeCompatStateLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!vscodeCompatStateLoaded || !settings.vscodeCompatEnabled || !isTauriHost()) {
      return;
    }

    const normalizedExtensions = normalizeVSCodeExtensionInventory(vscodeCompatExtensions);
    const shouldImportProfile = shouldAutoImportVSCodeProfile(
      settings.vscodeCompatEnabled,
      vscodeCompatImportedAt,
      vscodeCompatStateLoaded,
    );
    const shouldRepairExtensions = shouldRepairVSCodeExtensionImport(normalizedExtensions);
    if (!shouldImportProfile && !shouldRepairExtensions) {
      return;
    }

    const cancel = scheduleIdleTask(() => {
      readVSCodeConfigFromDetectedProfiles()
        .then(async (result) => {
          if (Object.keys(result.config).length === 0) {
            return;
          }
          const { importVSCodeSettingsFile } =
            await import("@/lib/vscode-compat/mapper");
          const imported = importVSCodeSettingsFile(result.config);
          await replaceVSCodeCompatState({
            settings: imported.settings,
            keybindings: imported.keybindings,
            snippets: imported.snippets,
            tasks: imported.tasks,
            launches: imported.launches,
            extensions: normalizeVSCodeExtensionInventory(imported.extensions),
            importedAt: Date.now(),
            sourceLabel: result.sourceLabel,
            warnings: imported.warnings,
          });
        })
        .catch(() => {});
    });

    return cancel;
  }, [
    replaceVSCodeCompatState,
    settings.vscodeCompatEnabled,
    vscodeCompatExtensions,
    vscodeCompatImportedAt,
    vscodeCompatStateLoaded,
  ]);

  useEffect(() => {
    useCodeIntelligenceStore
      .getState()
      .refresh(workspaceRootPath)
      .catch(() => {});
  }, [workspaceRootPath]);

  // Initialize AI key storage and load chat history
  useEffect(() => {
    const cancel = scheduleIdleTask(() => {
      void initKeyStorage().catch(() => {}).then(() =>
        useAiProviderProfileStore.getState().hydrate().catch(() => {}),
      );
      useAiChatStore
        .getState()
        .loadConversations?.()
        .catch(() => {});
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
    const initialSize = normalizePersistedDesktopAiPanelSize(
      settings.aiPanelWidth,
    );
    setDesktopAiPanelSize(initialSize);
    if (
      typeof settings.aiPanelWidth === "number" &&
      settings.aiPanelWidth !== initialSize
    ) {
      void updateSetting("aiPanelWidth", initialSize);
    }
    setAiPanelSizeInitialized(true);
  }, [
    aiPanelSizeInitialized,
    isInitialized,
    settings.aiPanelWidth,
    updateSetting,
  ]);

  useEffect(() => {
    if (!isInitialized || panelOpenInitialized) return;
    if (!isDesktopLayout) {
      setShowPluginPanels(false);
      setPanelOpenInitialized(true);
      return;
    }
    setShowPluginPanels(Boolean(settings.pluginPanelDockOpen));
    setPanelOpenInitialized(true);
  }, [
    isInitialized,
    panelOpenInitialized,
    settings.pluginPanelDockOpen,
    isDesktopLayout,
  ]);

  useEffect(() => {
    if (!isInitialized || aiPanelOpenInitialized) return;
    if (!isDesktopLayout) {
      setAiChatOpen(false);
      setAiPanelOpenInitialized(true);
      return;
    }
    setAiChatOpen(Boolean(settings.aiPanelOpen));
    setAiPanelOpenInitialized(true);
  }, [
    aiPanelOpenInitialized,
    isDesktopLayout,
    isInitialized,
    setAiChatOpen,
    settings.aiPanelOpen,
  ]);

  useEffect(() => {
    if (!isInitialized || activityViewInitialized) return;
    const nextView = settings.activityView;
    setActivityView(nextView);
    setActivityViewInitialized(true);
  }, [activityViewInitialized, isInitialized, settings.activityView]);

  useEffect(() => {
    if (!isInitialized || sidePanelStateInitialized) return;
    if (typeof settings.sidePanelWidth === "number") {
      setDesktopSidebarSize(
        Math.min(42, Math.max(DESKTOP_SIDEBAR_MIN, settings.sidePanelWidth)),
      );
    }
    setSidebarCollapsed(Boolean(settings.sidePanelCollapsed));
    setSidePanelStateInitialized(true);
  }, [
    isInitialized,
    setSidebarCollapsed,
    settings.sidePanelCollapsed,
    settings.sidePanelWidth,
    sidePanelStateInitialized,
  ]);

  useEffect(() => {
    if (!isInitialized) return;
    const trustedList = Array.isArray(settings.trustedPlugins)
      ? settings.trustedPlugins
      : [];
    const enabledList = Array.isArray(settings.enabledPlugins)
      ? settings.enabledPlugins
      : [];
    const trusted = new Set(trustedList);
    const enabled = enabledList.filter((id) => trusted.has(id));
    const cancel = scheduleIdleTask(() => {
      void syncPlugins({
        pluginsEnabled: settings.pluginsEnabled,
        enabledPluginIds: enabled,
      });
    }, 3000);
    return cancel;
  }, [
    isInitialized,
    settings.pluginsEnabled,
    settings.enabledPlugins,
    settings.trustedPlugins,
  ]);

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
    [isInitialized, updateSetting],
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
    [isInitialized, updateSetting],
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
    if (useSettingsStore.getState().settings.pluginPanelDockOpen === showPluginPanels) return;
    void updateSetting("pluginPanelDockOpen", showPluginPanels);
  }, [
    isInitialized,
    panelOpenInitialized,
    isDesktopLayout,
    showPluginPanels,
    updateSetting,
  ]);

  useEffect(() => {
    if (!isInitialized || !aiPanelOpenInitialized || !isDesktopLayout) return;
    if (settings.aiPanelOpen === aiChatOpen) return;
    void updateSetting("aiPanelOpen", aiChatOpen);
  }, [
    aiChatOpen,
    aiPanelOpenInitialized,
    isDesktopLayout,
    isInitialized,
    settings.aiPanelOpen,
    updateSetting,
  ]);

  useEffect(() => {
    if (!isInitialized || !activityViewInitialized) return;
    if (settings.activityView === activityView) return;
    void updateSetting("activityView", activityView);
  }, [
    activityView,
    activityViewInitialized,
    isInitialized,
    settings.activityView,
    updateSetting,
  ]);

  useEffect(() => {
    if (!isInitialized || !sidePanelStateInitialized || !isDesktopLayout)
      return;
    if (settings.sidePanelCollapsed !== sidebarCollapsed) {
      void updateSetting("sidePanelCollapsed", sidebarCollapsed);
    }
  }, [
    isDesktopLayout,
    isInitialized,
    settings.sidePanelCollapsed,
    sidePanelStateInitialized,
    sidebarCollapsed,
    updateSetting,
  ]);

  useEffect(() => {
    if (
      !isInitialized ||
      !sidePanelStateInitialized ||
      !isDesktopLayout ||
      sidebarCollapsed
    )
      return;
    if (Math.abs(settings.sidePanelWidth - desktopSidebarSize) < 0.1) return;
    void updateSetting("sidePanelWidth", desktopSidebarSize);
  }, [
    desktopSidebarSize,
    isDesktopLayout,
    isInitialized,
    settings.sidePanelWidth,
    sidePanelStateInitialized,
    sidebarCollapsed,
    updateSetting,
  ]);

  useEffect(() => {
    if (isMobile) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isEditableElement(e.target)) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === "b") {
        e.preventDefault();
        toggleSidebar();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShowCommands(true);
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "p"
      ) {
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
        <ExplorerSidebar source={cloudSource ?? undefined} header={<CloudExplorerControls />} />
      </div>
      <div className="border-t border-border p-2 flex items-center justify-between">
        <button
          onClick={() => setShowSettings(true)}
          className={cn(
            "flex items-center gap-2 px-2 py-1.5 rounded-md",
            "text-sm text-muted-foreground",
            "hover:bg-muted hover:text-foreground transition-colors",
            "flex-1",
          )}
          style={
            isMobile || isTablet ? { minHeight: TOUCH_TARGET_MIN } : undefined
          }
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
            "hover:bg-muted hover:text-foreground transition-colors",
          )}
          style={
            isMobile || isTablet
              ? { minWidth: TOUCH_TARGET_MIN, minHeight: TOUCH_TARGET_MIN }
              : undefined
          }
          title={t("commands.open")}
        >
          <SquareTerminal className={cn("h-4 w-4", isMobile && "h-5 w-5")} />
        </button>
        <button
          onClick={() => setShowPluginPanels(true)}
          className={cn(
            "p-1.5 rounded-md",
            "text-muted-foreground",
            "hover:bg-muted hover:text-foreground transition-colors",
          )}
          style={
            isMobile || isTablet
              ? { minWidth: TOUCH_TARGET_MIN, minHeight: TOUCH_TARGET_MIN }
              : undefined
          }
          title={t("panels.open")}
        >
          <PanelLeft className={cn("h-4 w-4", isMobile && "h-5 w-5")} />
        </button>
        <button
          onClick={openGuide}
          className={cn(
            "p-1.5 rounded-md",
            "text-muted-foreground",
            "hover:bg-muted hover:text-foreground transition-colors",
          )}
          style={
            isMobile || isTablet
              ? { minWidth: TOUCH_TARGET_MIN, minHeight: TOUCH_TARGET_MIN }
              : undefined
          }
          title={t("settings.shortcuts.openGuide")}
          aria-label={t("settings.shortcuts.openGuide")}
          data-guide-entry="sidebar"
        >
          <HelpCircle className={cn("h-4 w-4", isMobile && "h-5 w-5")} />
        </button>
        <PluginToolbarSlot />
      </div>
    </>
  );

  const openAiPanel = useCallback(
    (returnFocusElement?: HTMLElement | null) => {
      if (returnFocusElement) {
        aiPanelFocusReturnRef.current = returnFocusElement;
      } else if (document.activeElement instanceof HTMLElement) {
        aiPanelFocusReturnRef.current = document.activeElement;
      }
      setAiChatOpen(true);
    },
    [setAiChatOpen],
  );

  const closeAiPanel = useCallback(
    (options?: { restoreFocus?: boolean }) => {
      setAiChatOpen(false);
      if (options?.restoreFocus === false) {
        return;
      }
      window.requestAnimationFrame(() => {
        aiPanelFocusReturnRef.current?.focus();
      });
    },
    [setAiChatOpen],
  );

  const toggleAiPanel = useCallback(
    (returnFocusElement?: HTMLElement | null) => {
      if (useAiChatStore.getState().isOpen) {
        closeAiPanel();
        return;
      }
      openAiPanel(returnFocusElement);
    },
    [closeAiPanel, openAiPanel],
  );

  useEffect(() => {
    if (!isInitialized || surfaceInitialized) return;
    const surface = settings.workbenchSurface === "cloud" ? "cloud" : "local";
    setCloudActive(surface === "cloud" || new URL(window.location.href).searchParams.get("source") === "cloud");
    setSurfaceInitialized(true);
  }, [isInitialized, surfaceInitialized, settings.workbenchSurface, setCloudActive]);
  useEffect(() => {
    if (!isInitialized || !surfaceInitialized) return;
    if (useSettingsStore.getState().settings.workbenchSurface === workbenchSurface) return;
    void updateSetting("workbenchSurface", workbenchSurface);
  }, [isInitialized, surfaceInitialized, workbenchSurface, updateSetting]);
  const openCloudLibrary = () => { const cloud = useCloudWorkbenchStore.getState(); cloud.setActive(true); if (!cloud.controller) cloud.setManagementOpen(true); setActivityView("files"); setSidebarCollapsed(false); if (isMobile) setMobileSidebarOpen(true); };
  const returnToLocalWorkspace = () => { setCloudActive(false); setActivityView("files"); setSidebarCollapsed(false); };
  const workspaceSurface = <MainArea hasCloudWorkspace={cloudLibraryActive} />;
  const cloudSurfaceToggle = <button type="button" onClick={cloudLibraryActive ? returnToLocalWorkspace : openCloudLibrary}
    className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-muted"
    aria-label={cloudLibraryActive ? t("workbench.workspace.local") : t("workbench.activity.library")} title={t("workbench.activity.library")}
    aria-pressed={cloudLibraryActive}><Library className="h-4 w-4" /></button>;

  const desktopSidebarCollapsed = sidebarCollapsed;
  const desktopPluginPanelsVisible = showPluginPanels;
  const desktopAiPanelVisible = aiChatOpen;

  const desktopWorkbenchLayout = useMemo(
    () =>
      buildDesktopWorkbenchLayout({
        sidebarCollapsed: desktopSidebarCollapsed,
        requestedSidebarSize: desktopSidebarSize,
        showPluginPanels: desktopPluginPanelsVisible,
        requestedPluginPanelSize: desktopPanelSize,
        showAiPanel: desktopAiPanelVisible,
        requestedAiPanelSize: desktopAiPanelSize,
      }),
    [
      desktopAiPanelSize,
      desktopAiPanelVisible,
      desktopPanelSize,
      desktopPluginPanelsVisible,
      desktopSidebarCollapsed,
      desktopSidebarSize,
    ],
  );

  const renderDesktopSidePanel = () => {
    if (activityView === "vscode") {
      return <VSCodeActivityPanel />;
    }
    if (activityView === "annotations") {
      return <AnnotationsActivityPanel />;
    }
    if (activityView === "search") {
      return <WorkspaceSearchPanel />;
    }
    return <ExplorerSidebar source={cloudSource ?? undefined} header={<CloudExplorerControls />} />;
  };

  const compactAiTrigger = (
    <button
      type="button"
      onClick={(event) => openAiPanel(event.currentTarget)}
      className="flex shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      style={{ minWidth: TOUCH_TARGET_MIN, minHeight: TOUCH_TARGET_MIN }}
      title={t("chat.title")}
      aria-label={t("chat.title")}
      aria-pressed={aiChatOpen}
    ><Bot className="h-5 w-5" /></button>
  );
  const compactAiOverlay = aiChatOpen ? (
    <div
      className={cn(UI_MODAL_OVERLAY_CLASS, "h-full w-full overflow-hidden bg-background")}
      style={UI_MODAL_OVERLAY_STYLE}
      role="dialog"
      aria-modal="true"
      aria-label={t("chat.title")}
      data-testid="mobile-ai-workspace-overlay"
    ><AiChatPanel onClose={closeAiPanel} /></div>
  ) : null;

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
            {cloudSurfaceToggle}
            {compactAiTrigger}
            <button
              onClick={() => setShowPluginPanels(true)}
              className={cn(
                "flex items-center justify-center rounded-md",
                "text-muted-foreground hover:text-foreground",
                "hover:bg-muted transition-colors",
              )}
              style={{
                minWidth: TOUCH_TARGET_MIN,
                minHeight: TOUCH_TARGET_MIN,
              }}
              title={t("panels.open")}
            >
              <PanelLeft className="h-5 w-5" />
            </button>
            <button
              onClick={openGuide}
              className={cn(
                "flex items-center justify-center rounded-md",
                "text-muted-foreground hover:text-foreground",
                "hover:bg-muted transition-colors",
              )}
              style={{
                minWidth: TOUCH_TARGET_MIN,
                minHeight: TOUCH_TARGET_MIN,
              }}
              title={t("settings.shortcuts.openGuide")}
              aria-label={t("settings.shortcuts.openGuide")}
              data-guide-entry="mobile-header"
            >
              <HelpCircle className="h-5 w-5" />
            </button>
            <button
              onClick={() => setShowSettings(true)}
              className={cn(
                "flex items-center justify-center rounded-md",
                "text-muted-foreground hover:text-foreground",
                "hover:bg-muted transition-colors",
              )}
              style={{
                minWidth: TOUCH_TARGET_MIN,
                minHeight: TOUCH_TARGET_MIN,
              }}
              title={t("settings.title")}
            >
              <Settings className="h-5 w-5" />
            </button>
          </div>
        </header>
        <main className="flex-1 overflow-hidden">
          {workspaceSurface}
        </main>
        {compactAiOverlay}
        <PluginStatusBarSlot />
        <MobileSidebar
          isOpen={mobileSidebarOpen}
          onClose={() => setMobileSidebarOpen(false)}
        >
          {SidebarContent}
        </MobileSidebar>
        <Dialogs
          showSettings={showSettings}
          setShowSettings={setShowSettings}
          showCommands={showCommands}
          setShowCommands={setShowCommands}
          showPluginPanels={showPluginPanels}
          setShowPluginPanels={setShowPluginPanels}
          showGuide={showGuide}
          setShowGuide={setShowGuide}
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
                  {compactAiTrigger}
                  <button
                    onClick={toggleSidebar}
                    className={cn(
                      "flex items-center justify-center rounded-md",
                      "text-muted-foreground hover:text-foreground",
                      "hover:bg-muted transition-colors",
                    )}
                    style={{
                      minWidth: TOUCH_TARGET_MIN,
                      minHeight: TOUCH_TARGET_MIN,
                    }}
                    title={t("workbench.sidebar.collapse")}
                  >
                    <PanelLeftClose className="h-5 w-5" />
                  </button>
                </div>
                {SidebarContent}
              </ResizablePanel>
              <ResizableHandle withHandle className="touch-none" index={0} />
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
                  onClick={() =>
                    isLandscape ? toggleSidebar() : setMobileSidebarOpen(true)
                  }
                  className={cn(
                    "flex items-center justify-center rounded-md",
                    "text-muted-foreground hover:text-foreground",
                    "hover:bg-muted transition-colors",
                  )}
                  style={{
                    minWidth: TOUCH_TARGET_MIN,
                    minHeight: TOUCH_TARGET_MIN,
                  }}
                  title={t("workbench.sidebar.open")}
                >
                  {isLandscape ? (
                    <PanelLeft className="h-5 w-5" />
                  ) : (
                    <Menu className="h-5 w-5" />
                  )}
                </button>
                <h1 className="text-sm font-medium flex-1">{t("app.name")}</h1>
                {cloudSurfaceToggle}
                {compactAiTrigger}
                <button
                  onClick={() => setShowPluginPanels(true)}
                  className={cn(
                    "flex items-center justify-center rounded-md",
                    "text-muted-foreground hover:text-foreground",
                    "hover:bg-muted transition-colors",
                  )}
                  style={{
                    minWidth: TOUCH_TARGET_MIN,
                    minHeight: TOUCH_TARGET_MIN,
                  }}
                  title={t("panels.open")}
                >
                  <PanelLeft className="h-5 w-5" />
                </button>
                <button
                  onClick={() => setShowSettings(true)}
                  className={cn(
                    "flex items-center justify-center rounded-md",
                    "text-muted-foreground hover:text-foreground",
                    "hover:bg-muted transition-colors",
                  )}
                  style={{
                    minWidth: TOUCH_TARGET_MIN,
                    minHeight: TOUCH_TARGET_MIN,
                  }}
                >
                  <Settings className="h-5 w-5" />
                </button>
              </header>
            )}
            <div className="flex-1 overflow-hidden">
              {workspaceSurface}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
        {compactAiOverlay}
        {!isLandscape && (
          <MobileSidebar
            isOpen={mobileSidebarOpen}
            onClose={() => setMobileSidebarOpen(false)}
          >
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
          showGuide={showGuide}
          setShowGuide={setShowGuide}
        />
      </div>
    );
  }

  // Desktop Layout
  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-background">
      <DesktopWindowFrame />
      <CommandBar
        onOpenWorkspace={() => { returnToLocalWorkspace(); void openDirectory(); }}
        recentWorkspaces={recentWorkspaces}
        onOpenRecentWorkspace={(path) => { returnToLocalWorkspace(); void openWorkspacePath(path); }}
        onOpenSharedLibrary={openCloudLibrary}
        onReturnLocalWorkspace={returnToLocalWorkspace}
        sharedLibraryActive={cloudLibraryActive}
      />
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div
          className="flex w-12 shrink-0 flex-col items-center border-r border-border bg-card/90 py-2"
          data-testid="desktop-activity-rail"
        >
            <div className="flex w-full flex-col items-center gap-2">
              <CollapsedRailButton
                icon={FolderTree}
                label={t("explorer.title")}
                title={t("explorer.title")}
                active={activityView === "files" && !sidebarCollapsed}
                onClick={() => {
                  returnToLocalWorkspace();
                  setActivityView("files");
                  setSidebarCollapsed(
                    activityView === "files" ? !sidebarCollapsed : false,
                  );
                }}
              />
              <CollapsedRailButton icon={Library} label={t("workbench.activity.library")} title={t("workbench.activity.library")}
                active={cloudLibraryActive} onClick={cloudLibraryActive ? returnToLocalWorkspace : openCloudLibrary} />
              <CollapsedRailButton
                icon={SearchIcon}
                label={t("workbench.activity.search")}
                title={t("workbench.activity.search")}
                active={activityView === "search" && !sidebarCollapsed}
                onClick={() => {
                  returnToLocalWorkspace();
                  setActivityView("search");
                  setSidebarCollapsed(
                    activityView === "search" ? !sidebarCollapsed : false,
                  );
                }}
              />
              <CollapsedRailButton
                icon={MessageSquareText}
                label={t("annotations.title")}
                title={t("annotations.title")}
                active={activityView === "annotations" && !sidebarCollapsed}
                onClick={() => {
                  returnToLocalWorkspace();
                  setActivityView("annotations");
                  setSidebarCollapsed(
                    activityView === "annotations" ? !sidebarCollapsed : false,
                  );
                }}
              />
              <CollapsedRailButton
                icon={Code2}
                label="VS Code"
                title="VS Code"
                active={activityView === "vscode" && !sidebarCollapsed}
                onClick={() => {
                  returnToLocalWorkspace();
                  const next = resolveActivityViewSelection({
                    currentView: activityView,
                    targetView: "vscode",
                    collapsed: sidebarCollapsed,
                  });
                  setActivityView(next.activityView);
                  setSidebarCollapsed(next.collapsed);
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
                icon={SquareTerminal}
                label={t("commands.open")}
                title={t("commands.open")}
                onClick={() => setShowCommands(true)}
              />
              <CollapsedRailButton
                icon={Cable}
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
            const next = resolveDesktopWorkbenchResize({
              sidebarCollapsed: desktopSidebarCollapsed,
              sizes,
              rightPanels: desktopWorkbenchLayout.rightPanels,
            });

            if (typeof next.sidebarSize === "number") {
              if (next.sidebarSize <= DESKTOP_SIDEBAR_MIN) setSidebarCollapsed(true);
              else setDesktopSidebarSize(next.sidebarSize);
            }

            if (typeof next.pluginPanelSize === "number") {
              setDesktopPanelSize(next.pluginPanelSize);
              persistPanelSize(next.pluginPanelSize);
            }

            if (typeof next.aiPanelSize === "number") {
              setDesktopAiPanelSize(next.aiPanelSize);
              persistAiPanelSize(next.aiPanelSize);
            }
          }}
        >
          {!desktopSidebarCollapsed && (
            <>
              <ResizablePanel
                index={0}
                defaultSize={DESKTOP_SIDEBAR_DEFAULT}
                minSize={DESKTOP_SIDEBAR_MIN}
                maxSize={getDesktopSidebarMaxSize(
                  desktopWorkbenchLayout.rightPanels,
                )}
                className="bg-card flex flex-col"
              >
                {renderDesktopSidePanel()}
              </ResizablePanel>
              <ResizableHandle withHandle index={0} />
            </>
          )}

          <ResizablePanel
            index={desktopSidebarCollapsed ? 0 : 1}
            defaultSize={
              desktopSidebarCollapsed ? 100 : 100 - DESKTOP_SIDEBAR_DEFAULT
            }
            minSize={DESKTOP_MAIN_PANEL_MIN}
          >
            {workspaceSurface}
          </ResizablePanel>

          {desktopPluginPanelsVisible && (
            <>
              <ResizableHandle
                withHandle
                index={getDesktopPluginResizeHandleIndex(
                  desktopSidebarCollapsed,
                )}
              />
              <ResizablePanel
                index={getDesktopPluginPanelIndex(desktopSidebarCollapsed)}
                defaultSize={desktopPanelSize}
                minSize={DESKTOP_PANEL_MIN}
                maxSize={DESKTOP_PANEL_MAX}
              >
                <PluginPanelDock onClose={() => setShowPluginPanels(false)} />
              </ResizablePanel>
            </>
          )}

          {desktopAiPanelVisible && (
            <>
              <ResizableHandle
                withHandle
                index={getDesktopAiResizeHandleIndex(
                  desktopSidebarCollapsed,
                  desktopPluginPanelsVisible,
                )}
                ariaLabel={t("chat.workspace.resize")}
                testId="ai-workspace-resize-handle"
              />
              <ResizablePanel
                index={getDesktopAiPanelIndex(
                  desktopSidebarCollapsed,
                  desktopPluginPanelsVisible,
                )}
                defaultSize={desktopAiPanelSize}
                minSize={DESKTOP_AI_PANEL_MIN}
                maxSize={DESKTOP_AI_PANEL_MAX}
                className="min-h-0 bg-background"
              >
                <AiChatPanel onClose={closeAiPanel} />
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
        showGuide={showGuide}
        setShowGuide={setShowGuide}
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
  showGuide,
  setShowGuide,
}: {
  showSettings: boolean;
  setShowSettings: (show: boolean) => void;
  showCommands: boolean;
  setShowCommands: (show: boolean) => void;
  showPluginPanels: boolean;
  setShowPluginPanels: (show: boolean) => void;
  showGuide: boolean;
  setShowGuide: (show: boolean) => void;
}) {
  const onboardingReady = useSettingsStore((state) => state.isInitialized && state.settings.onboardingCompleted);
  const cloudManagementOpen = useCloudWorkbenchStore((state) => state.managementOpen);
  const downloadBlocked = !onboardingReady || cloudManagementOpen || showSettings || showCommands || showPluginPanels || showGuide;
  return (
    <>
      {!isTauriHost() && <DownloadAppDialog blocked={downloadBlocked} />}
      <ErrorBoundary onReset={() => setShowCommands(false)}>
        <PluginCommandDialog
          isOpen={showCommands}
          onClose={() => setShowCommands(false)}
          onOpenSettings={() => setShowSettings(true)}
          onOpenPluginPanels={() => setShowPluginPanels(true)}
          onOpenGuide={() => setShowGuide(true)}
        />
      </ErrorBoundary>
      <ErrorBoundary onReset={() => setShowPluginPanels(false)}>
        <PluginPanelDialog
          isOpen={showPluginPanels}
          onClose={() => setShowPluginPanels(false)}
        />
      </ErrorBoundary>
      <ErrorBoundary onReset={() => setShowSettings(false)}>
        <SettingsDialog
          isOpen={showSettings}
          onClose={() => setShowSettings(false)}
        />
      </ErrorBoundary>
      <ErrorBoundary onReset={() => setShowGuide(false)}>
        {showGuide && (
          <div
            className={cn(
              UI_MODAL_OVERLAY_CLASS,
              "flex items-center justify-center p-3",
            )}
            style={UI_MODAL_OVERLAY_STYLE}
            role="dialog"
            aria-modal="true"
            aria-label="User guide"
          >
            <div
              className={cn(
                "h-[min(900px,92vh)] w-[min(1280px,96vw)] overflow-hidden rounded-lg",
                UI_MODAL_PANEL_CLASS,
              )}
            >
              <LivePreviewGuide
                surface="dialog"
                onClose={() => setShowGuide(false)}
              />
            </div>
          </div>
        )}
      </ErrorBoundary>
      <OnboardingWizard blocked={cloudManagementOpen} />
      <ErrorBoundary>
        <VSCodeHostInteractionDialog />
      </ErrorBoundary>
      <ExportToastContainer />
    </>
  );
}
