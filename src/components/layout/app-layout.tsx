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
import { Settings, HelpCircle } from "lucide-react";

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
                className="bg-card flex flex-col"
              >
                {/* Main sidebar content */}
                <div className="flex-1 overflow-hidden">
                  <ExplorerSidebar />
                </div>
                
                {/* Sidebar Footer - Settings (Obsidian style) */}
                <div className="border-t border-border p-2 flex items-center justify-between">
                  <button
                    onClick={() => setShowSettings(true)}
                    className={cn(
                      "flex items-center gap-2 px-2 py-1.5 rounded-md",
                      "text-sm text-muted-foreground",
                      "hover:bg-muted hover:text-foreground transition-colors",
                      "flex-1"
                    )}
                    title={`${t('settings.title')} (Ctrl+,)`}
                  >
                    <Settings className="h-4 w-4" />
                    <span>{t('settings.title')}</span>
                  </button>
                  <button
                    onClick={() => window.open('https://github.com/your-repo/lattice', '_blank')}
                    className={cn(
                      "p-1.5 rounded-md",
                      "text-muted-foreground",
                      "hover:bg-muted hover:text-foreground transition-colors"
                    )}
                    title="Help"
                  >
                    <HelpCircle className="h-4 w-4" />
                  </button>
                </div>
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
        
        {/* Collapsed sidebar indicator with settings */}
        {sidebarCollapsed && (
          <div
            className={cn(
              "fixed left-0 top-0 z-50 h-full w-12",
              "flex flex-col items-center",
              "bg-card/80 backdrop-blur-sm border-r border-border"
            )}
          >
            {/* Expand button */}
            <button
              onClick={toggleSidebar}
              className={cn(
                "flex-1 w-full flex items-center justify-center",
                "hover:bg-accent transition-colors",
                "text-muted-foreground hover:text-foreground"
              )}
              title={`${t('explorer.title')} (Ctrl+B)`}
            >
              <span className="rotate-90 text-xs font-medium tracking-wider">EXPLORER</span>
            </button>
            
            {/* Settings button at bottom */}
            <div className="border-t border-border p-2 w-full flex flex-col items-center gap-1">
              <button
                onClick={() => setShowSettings(true)}
                className={cn(
                  "p-2 rounded-md",
                  "text-muted-foreground",
                  "hover:bg-muted hover:text-foreground transition-colors"
                )}
                title={`${t('settings.title')} (Ctrl+,)`}
              >
                <Settings className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
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
