"use client";

import { useEffect } from "react";
import { FileText, Code, Sparkles, Image } from "lucide-react";
import { toast } from "sonner";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { LayoutRenderer } from "./layout-renderer";
import { findPane } from "@/lib/layout-utils";
import { getFileExtension, isEditableFile } from "@/lib/file-utils";
import { saveFileContent } from "@/lib/save-utils";

/**
 * Welcome placeholder component - shown when no workspace is open
 */
function WelcomePlaceholder() {
  return (
    <div className="flex h-full flex-col items-center justify-center bg-background p-8">
      <div className="max-w-md text-center">
        <h1 className="mb-2 text-3xl font-light tracking-tight text-foreground">
          Lattice <span className="text-muted-foreground">格致</span>
        </h1>
        <p className="mb-8 text-sm text-muted-foreground">
          The Local-First, AI-Native Scientific Workbench
        </p>

        <div className="grid grid-cols-4 gap-4 text-center">
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border p-4">
            <FileText className="h-6 w-6 text-muted-foreground" />
            <span className="font-scientific text-muted-foreground">PDF Viewer</span>
            <span className="text-xs text-muted-foreground/60">Ready</span>
          </div>

          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border p-4">
            <Code className="h-6 w-6 text-muted-foreground" />
            <span className="font-scientific text-muted-foreground">Code Reader</span>
            <span className="text-xs text-muted-foreground/60">Ready</span>
          </div>

          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border p-4">
            <Image className="h-6 w-6 text-muted-foreground" />
            <span className="font-scientific text-muted-foreground">Image Viewer</span>
            <span className="text-xs text-muted-foreground/60">Ready</span>
          </div>

          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border p-4">
            <Sparkles className="h-6 w-6 text-muted-foreground" />
            <span className="font-scientific text-muted-foreground">AI Assistant</span>
            <span className="text-xs text-muted-foreground/60">Coming Soon</span>
          </div>
        </div>

        <p className="mt-8 text-xs text-muted-foreground">
          Open a local folder from the sidebar and click a file to view it.
        </p>
      </div>
    </div>
  );
}

/**
 * Main Area component with advanced layout system
 */
export function MainArea() {
  const rootHandle = useWorkspaceStore((state) => state.rootHandle);
  const layout = useWorkspaceStore((state) => state.layout);
  const setTabDirty = useWorkspaceStore((state) => state.setTabDirty);

  // Keyboard shortcut handler for Ctrl+S
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      // Check for Ctrl+S or Cmd+S
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        
        const { layout } = useWorkspaceStore.getState();
        const activePane = findPane(layout.root, layout.activePaneId);
        
        if (!activePane || activePane.activeTabIndex < 0) {
          return;
        }
        
        const activeTab = activePane.tabs[activePane.activeTabIndex];
        if (!activeTab) {
          return;
        }
        
        const extension = getFileExtension(activeTab.fileName);
        
        // Check if file is editable
        if (!isEditableFile(extension)) {
          toast.info('Read Only', {
            description: 'This file type cannot be edited.',
          });
          return;
        }
        
        // Get content from the DOM (we need to access the editor content)
        // For now, we'll show a message that save is triggered
        // The actual save will be handled by the editor component
        
        // Try to get content from the active pane's editor
        // This is a simplified approach - in production, we'd use a ref or context
        try {
          const file = await activeTab.fileHandle.getFile();
          const currentContent = await file.text();
          
          // Save the file
          const result = await saveFileContent(
            activeTab.fileHandle,
            currentContent
          );
          
          if (result.success) {
            setTabDirty(layout.activePaneId, activePane.activeTabIndex, false);
            toast.success('Saved', {
              description: `${activeTab.fileName} saved successfully.`,
            });
          } else {
            toast.error('Save Failed', {
              description: result.error || 'Failed to save file.',
            });
          }
        } catch (err) {
          toast.error('Save Failed', {
            description: err instanceof Error ? err.message : 'Failed to save file.',
          });
        }
      }
      
      // Ctrl+W to close active tab
      if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
        e.preventDefault();
        
        const { layout, closeTab } = useWorkspaceStore.getState();
        const activePane = findPane(layout.root, layout.activePaneId);
        
        if (activePane && activePane.activeTabIndex >= 0) {
          closeTab(layout.activePaneId, activePane.activeTabIndex);
        }
      }

      // Ctrl+\ to split right
      if ((e.ctrlKey || e.metaKey) && e.key === '\\' && !e.shiftKey) {
        e.preventDefault();
        const { layout, splitPane } = useWorkspaceStore.getState();
        splitPane(layout.activePaneId, 'horizontal');
      }

      // Ctrl+Shift+\ to split down
      if ((e.ctrlKey || e.metaKey) && e.key === '\\' && e.shiftKey) {
        e.preventDefault();
        const { layout, splitPane } = useWorkspaceStore.getState();
        splitPane(layout.activePaneId, 'vertical');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setTabDirty]);

  // Show welcome placeholder if no workspace is open
  if (!rootHandle) {
    return <WelcomePlaceholder />;
  }

  // Render the layout tree
  return (
    <div className="h-full w-full overflow-hidden">
      <LayoutRenderer
        node={layout.root}
        activePaneId={layout.activePaneId}
      />
    </div>
  );
}
