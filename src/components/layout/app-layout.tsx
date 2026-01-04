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
import { useUnsavedWarning } from "@/hooks/use-unsaved-warning";
import { DownloadAppDialog } from "@/components/ui/download-app-dialog";
import { DesktopSettingsDialog } from "@/components/ui/desktop-settings-dialog";
import { useTauriSettings } from "@/hooks/use-tauri-settings";
import { cn } from "@/lib/utils";

/**
 * Main application layout with collapsible sidebar and resizable panels
 */
export function AppLayout() {
  const sidebarCollapsed = useWorkspaceStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useWorkspaceStore((state) => state.toggleSidebar);
  const [showSettings, setShowSettings] = useState(false);
  const { isTauri } = useTauriSettings();

  // Warn user before closing browser with unsaved changes
  useUnsavedWarning();

  // Keyboard shortcut: Ctrl+B to toggle sidebar, Ctrl+, to open settings (desktop only)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        toggleSidebar();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === ',' && isTauri) {
        e.preventDefault();
        setShowSettings(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleSidebar, isTauri]);

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
            title="Expand sidebar (Ctrl+B)"
          >
            <span className="rotate-90 text-xs font-medium tracking-wider">EXPLORER</span>
          </button>
        )}

        {/* Desktop settings button (only in Tauri) */}
        {isTauri && (
          <button
            onClick={() => setShowSettings(true)}
            className={cn(
              "fixed bottom-4 right-4 z-40",
              "p-3 rounded-full",
              "bg-blue-600 hover:bg-blue-700 text-white",
              "shadow-lg hover:shadow-xl transition-all",
              "flex items-center gap-2"
            )}
            title="设置 (Ctrl+,)"
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
        )}
      </div>

      {/* Download app dialog (web only) */}
      <DownloadAppDialog />

      {/* Desktop settings dialog (Tauri only) */}
      <DesktopSettingsDialog
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
      />
    </DndProvider>
  );
}
