"use client";

import { useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { useFileSystem } from "@/hooks/use-file-system";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { EmptyState } from "./empty-state";
import { TreeView } from "./tree-view";
import { NewFileButtons } from "./new-file-buttons";
import { Loader2, AlertCircle, PanelLeftClose, PanelLeft } from "lucide-react";
import { PluginSidebarSlot } from "@/components/ui/plugin-sidebar-slot";

/**
 * Explorer Sidebar component
 * Shows empty state when no folder is opened, tree view when folder is opened
 */
export function ExplorerSidebar() {
  const { fileTree, isLoading, error, openDirectory, openQaWorkspace, isSupported, isCheckingSupport, createFile, createDirectory } = useFileSystem();
  const searchParams = useSearchParams();
  const isQaMode = process.env.NODE_ENV === "development" && searchParams?.get("qa") === "1";
  const sidebarCollapsed = useWorkspaceStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useWorkspaceStore((state) => state.toggleSidebar);
  const openFileInActivePane = useWorkspaceStore((state) => state.openFileInActivePane);
  const selectedDirectoryPath = useWorkspaceStore((state) => state.selectedDirectoryPath);

  const hasDirectory = !!fileTree.root;

  /**
   * Create a new note and open it in the active pane
   */
  const handleCreateNote = useCallback(async () => {
    // 如果有选中的文件夹，在该文件夹内创建，否则在根目录创建
    const result = await createFile("Untitled", "note", selectedDirectoryPath || undefined);
    if (result.success && result.handle && result.path) {
      openFileInActivePane(result.handle, result.path);
    }
  }, [createFile, openFileInActivePane, selectedDirectoryPath]);

  /**
   * Create a new notebook and open it in the active pane
   */
  const handleCreateNotebook = useCallback(async () => {
    // 如果有选中的文件夹，在该文件夹内创建，否则在根目录创建
    const result = await createFile("Untitled", "notebook", selectedDirectoryPath || undefined);
    if (result.success && result.handle && result.path) {
      openFileInActivePane(result.handle, result.path);
    }
  }, [createFile, openFileInActivePane, selectedDirectoryPath]);

  /**
   * Create a new folder in the root directory or selected directory
   */
  const handleCreateFolder = useCallback(async () => {
    // 如果有选中的文件夹，在该文件夹内创建，否则在根目录创建
    const result = await createDirectory("New Folder", selectedDirectoryPath || undefined);
    if (!result.success && result.error) {
      console.error("Failed to create folder:", result.error);
    }
  }, [createDirectory, selectedDirectoryPath]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="font-scientific text-muted-foreground uppercase tracking-wider text-xs">
          Explorer
        </span>
        <div className="flex items-center gap-1">
          {/* New File Buttons - only show when directory is open */}
          {hasDirectory && (
            <NewFileButtons
              onCreateNote={handleCreateNote}
              onCreateNotebook={handleCreateNotebook}
              onCreateFolder={handleCreateFolder}
              disabled={isLoading}
            />
          )}
          <button
            onClick={toggleSidebar}
            className="p-1 rounded hover:bg-accent transition-colors"
            title={sidebarCollapsed ? "Expand sidebar (Ctrl+B)" : "Collapse sidebar (Ctrl+B)"}
          >
            {sidebarCollapsed ? (
              <PanelLeft className="h-4 w-4 text-muted-foreground" />
            ) : (
              <PanelLeftClose className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {/* Loading State */}
        {isLoading && (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Error State - only show if there's an actual error and we're not loading */}
        {error && !isLoading && isSupported && (
          <div className="flex flex-col items-center justify-center gap-2 p-4 text-center">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <p className="text-sm text-destructive">{error}</p>
            <button
              onClick={openDirectory}
              className="text-sm text-primary underline hover:no-underline"
            >
              Try again
            </button>
          </div>
        )}

        {/* Empty State */}
        {!isLoading && !error && !fileTree.root && (
          <EmptyState 
            onOpenFolder={openDirectory} 
            onOpenQaWorkspace={openQaWorkspace}
            showQaWorkspace={isQaMode}
            isSupported={isSupported} 
            isCheckingSupport={isCheckingSupport}
          />
        )}

        {/* Tree View */}
        {!isLoading && !error && fileTree.root && (
          <TreeView root={fileTree.root} />
        )}
      </div>
      <PluginSidebarSlot />
    </div>
  );
}
