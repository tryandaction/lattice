"use client";

import { useEffect } from "react";
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
import { cn } from "@/lib/utils";

/**
 * Main application layout with collapsible sidebar and resizable panels
 */
export function AppLayout() {
  const sidebarCollapsed = useWorkspaceStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useWorkspaceStore((state) => state.toggleSidebar);

  // Warn user before closing browser with unsaved changes
  useUnsavedWarning();

  // Keyboard shortcut: Ctrl+B to toggle sidebar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        toggleSidebar();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleSidebar]);

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
      </div>
    </DndProvider>
  );
}
