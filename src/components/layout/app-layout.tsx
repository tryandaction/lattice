"use client";

import { useEffect, useState } from "react";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { ExplorerSidebar } from "@/components/explorer/explorer-sidebar";
import { MainArea } from "@/components/main-area/main-area";
import { DndProvider } from "@/components/dnd/dnd-provider";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useUnsavedWarning } from "@/hooks/use-unsaved-warning";
import { useTheme } from "@/hooks/use-theme";
import { useI18n } from "@/hooks/use-i18n";
import { useAutoOpenFolder } from "@/hooks/use-auto-open-folder";
import { DownloadAppDialog } from "@/components/ui/download-app-dialog";
import { SettingsDialog } from "@/components/settings/settings-dialog";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { ExportToastContainer } from "@/components/ui/export-toast";
import { isTauri } from "@/lib/storage-adapter";
import { setLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Main application layout with collapsible sidebar and resizable panels
 */
export function AppLayout() {
  const sidebarCollapsed = useWorkspaceStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useWorkspaceStore((state) => state.toggleSidebar);
  const [showSettings, setShowSettings] = useState(false);
  
  // Settings and theme
  const loadSettings = useSettingsStore((state) => state.loadSettings);
  const settings = useSettingsStore((state) => state.settings);
  const isInitialized = useSettingsStore((state) => state.isInitialized);
  const { toggleTheme } = useTheme();
  const { t } = useI18n();
  
  // Auto-open default folder on startup
  useAutoOpenFolder();

  // Load settings on mount
  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // Sync locale with settings
  useEffect(() => {
    if (isInitialized) {
      setLocale(settings.language);
    }
  }, [isInitialized, settings.language]);

  // Warn user before closing browser with unsaved changes
  useUnsavedWarning();

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+B: Toggle sidebar
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        toggleSidebar();
      }
      // Ctrl+,: Open settings
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        setShowSettings(true);
      }
      // Ctrl+Shift+T: Toggle theme
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'T') {
        e.preventDefault();
        toggleTheme();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleSidebar, toggleTheme]);

  return (
    <DndProvider>
      <div className="h-screen w-screen overflow-hidden bg-background">
        <ResizablePanelGroup direction="horizontal" className="h-full">
          {/* Explorer Sidebar - Collapsible */}
          {!sidebarCollapsed && (
            <>
              <ResizablePanel
                defaultSize={20}
                minSize={15}
                maxSize={40}
                className="bg-card"
              >
                <ExplorerSidebar />
              </ResizablePanel>
              <ResizableHandle withHandle />
            </>
          )}

          {/* Main Content Area */}
          <ResizablePanel 
            defaultSize={sidebarCollapsed ? 100 : 80} 
            minSize={40}
          >
            <MainArea />
          </ResizablePanel>
        </ResizablePanelGroup>
        
        {/* Collapsed sidebar indicator */}
        {sidebarCollapsed && (
          <button
            onClick={toggleSidebar}
            className={cn(
              "fixed left-0 top-0 z-50 h-full w-8",
              "flex items-center justify-center",
              "bg-card/80 backdrop-blur-sm border-r border-border",
              "hover:bg-accent transition-colors",
              "text-muted-foreground hover:text-foreground"
            )}
            title={`${t('explorer.title')} (Ctrl+B)`}
          >
            <span className="rotate-90 text-xs font-medium tracking-wider">EXPLORER</span>
          </button>
        )}

        {/* Settings button */}
        <button
          onClick={() => setShowSettings(true)}
          className={cn(
            "fixed bottom-4 right-4 z-40",
            "p-3 rounded-full",
            "bg-primary hover:bg-primary/90 text-primary-foreground",
            "shadow-lg hover:shadow-xl transition-all",
            "flex items-center gap-2"
          )}
          title={`${t('settings.title')} (Ctrl+,)`}
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        </button>
      </div>

      {/* Download app dialog (web only) */}
      {!isTauri() && <DownloadAppDialog />}

      {/* Settings dialog */}
      <SettingsDialog
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
      />

      {/* Onboarding wizard */}
      <OnboardingWizard />

      {/* Export toast notifications */}
      <ExportToastContainer />
    </DndProvider>
  );
}
