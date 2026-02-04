"use client";

import { useEffect, useState } from "react";
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
import { isTauri } from "@/lib/storage-adapter";
import { setLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { TOUCH_TARGET_MIN } from "@/lib/responsive";
import { Settings, HelpCircle, Menu, PanelLeftClose, PanelLeft } from "lucide-react";

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

const DownloadAppDialog = dynamic(
  () => import("@/components/ui/download-app-dialog").then((mod) => mod.DownloadAppDialog),
  { ssr: false }
);

const SettingsDialog = dynamic(
  () => import("@/components/settings/settings-dialog").then((mod) => mod.SettingsDialog),
  { ssr: false }
);

const OnboardingWizard = dynamic(
  () => import("@/components/onboarding/onboarding-wizard").then((mod) => mod.OnboardingWizard),
  { ssr: false }
);

const ExportToastContainer = dynamic(
  () => import("@/components/ui/export-toast").then((mod) => mod.ExportToastContainer),
  { ssr: false }
);

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
  const { isMobile, isTablet, isDesktop, isLandscape } = useResponsive();
  const sidebarCollapsed = useWorkspaceStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useWorkspaceStore((state) => state.toggleSidebar);
  const setSidebarCollapsed = useWorkspaceStore((state) => state.setSidebarCollapsed);
  const [showSettings, setShowSettings] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  const loadSettings = useSettingsStore((state) => state.loadSettings);
  const settings = useSettingsStore((state) => state.settings);
  const isInitialized = useSettingsStore((state) => state.isInitialized);
  const { toggleTheme } = useTheme();
  const { t } = useI18n();

  useAutoOpenFolder();

  // Fix hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (isInitialized) {
      setLocale(settings.language);
    }
  }, [isInitialized, settings.language]);

  useEffect(() => {
    if (isMobile) {
      setSidebarCollapsed(true);
    }
  }, [isMobile, setSidebarCollapsed]);

  useUnsavedWarning();

  useEffect(() => {
    if (isMobile) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "b") {
        e.preventDefault();
        toggleSidebar();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === ",") {
        e.preventDefault();
        setShowSettings(true);
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "T") {
        e.preventDefault();
        toggleTheme();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isMobile, toggleSidebar, toggleTheme]);

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
          onClick={() => window.open("https://github.com/your-repo/lattice", "_blank")}
          className={cn(
            "p-1.5 rounded-md",
            "text-muted-foreground",
            "hover:bg-muted hover:text-foreground transition-colors"
          )}
          style={(isMobile || isTablet) ? { minWidth: TOUCH_TARGET_MIN, minHeight: TOUCH_TARGET_MIN } : undefined}
          title="Help"
        >
          <HelpCircle className={cn("h-4 w-4", isMobile && "h-5 w-5")} />
        </button>
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
        <main className="flex-1 overflow-hidden">
          <MainArea />
        </main>
        <MobileSidebar isOpen={mobileSidebarOpen} onClose={() => setMobileSidebarOpen(false)}>
          {SidebarContent}
        </MobileSidebar>
        <Dialogs showSettings={showSettings} setShowSettings={setShowSettings} />
      </div>
    );
  }

  // Tablet Layout
  if (isTablet) {
    const showSidebar = isLandscape && !sidebarCollapsed;

    return (
      <div className="h-screen w-screen overflow-hidden bg-background">
        <ResizablePanelGroup direction="horizontal" className="h-full">
          {showSidebar && (
            <>
              <ResizablePanel defaultSize={30} minSize={20} maxSize={45} className="bg-card flex flex-col">
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
              <ResizableHandle withHandle className="w-2 touch-none" />
            </>
          )}
          <ResizablePanel defaultSize={showSidebar ? 70 : 100} minSize={40} className="flex flex-col">
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
        <Dialogs showSettings={showSettings} setShowSettings={setShowSettings} />
      </div>
    );
  }

  // Desktop Layout
  return (
    <div className="h-screen w-screen overflow-hidden bg-background">
      <ResizablePanelGroup direction="horizontal" className="h-full">
        {!sidebarCollapsed && (
          <>
            <ResizablePanel defaultSize={20} minSize={15} maxSize={40} className="bg-card flex flex-col">
              {SidebarContent}
            </ResizablePanel>
            <ResizableHandle withHandle />
          </>
        )}
        <ResizablePanel defaultSize={sidebarCollapsed ? 100 : 80} minSize={40}>
          <MainArea />
        </ResizablePanel>
      </ResizablePanelGroup>
      {sidebarCollapsed && (
        <div className={cn(
          "fixed left-0 top-0 z-50 h-full w-12",
          "flex flex-col items-center",
          "bg-card/80 backdrop-blur-sm border-r border-border"
        )}>
          <button
            onClick={toggleSidebar}
            className={cn(
              "flex-1 w-full flex items-center justify-center",
              "hover:bg-accent transition-colors",
              "text-muted-foreground hover:text-foreground"
            )}
            title={`${t("explorer.title")} (Ctrl+B)`}
          >
            <span className="rotate-90 text-xs font-medium tracking-wider">EXPLORER</span>
          </button>
          <div className="border-t border-border p-2 w-full flex flex-col items-center gap-1">
            <button
              onClick={() => setShowSettings(true)}
              className={cn(
                "p-2 rounded-md",
                "text-muted-foreground",
                "hover:bg-muted hover:text-foreground transition-colors"
              )}
              title={`${t("settings.title")} (Ctrl+,)`}
            >
              <Settings className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
      <Dialogs showSettings={showSettings} setShowSettings={setShowSettings} />
    </div>
  );
}

function Dialogs({ showSettings, setShowSettings }: { showSettings: boolean; setShowSettings: (show: boolean) => void }) {
  return (
    <>
      {!isTauri() && <DownloadAppDialog />}
      <SettingsDialog isOpen={showSettings} onClose={() => setShowSettings(false)} />
      <OnboardingWizard />
      <ExportToastContainer />
    </>
  );
}
