"use client";

import { useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { useFileSystem } from "@/hooks/use-file-system";
import { useI18n } from "@/hooks/use-i18n";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useExplorerStore } from "@/stores/explorer-store";
import { getParentPath } from "@/lib/file-operations";
import { EmptyState } from "./empty-state";
import { TreeView } from "./tree-view";
import { NewFileButtons } from "./new-file-buttons";
import { Loader2, AlertCircle } from "lucide-react";
import { PluginSidebarSlot } from "@/components/ui/plugin-sidebar-slot";

/**
 * Explorer Sidebar component
 * Shows empty state when no folder is opened, tree view when folder is opened
 */
export function ExplorerSidebar() {
  const { t } = useI18n();
  const { fileTree, isLoading, error, openDirectory, openQaWorkspace, isSupported, isCheckingSupport, createFile, createDirectory } = useFileSystem();
  const searchParams = useSearchParams();
  const isQaMode = process.env.NODE_ENV === "development" && searchParams?.get("qa") === "1";
  const openFileInActivePane = useWorkspaceStore((state) => state.openFileInActivePane);
  const setSelectedDirectoryPath = useWorkspaceStore((state) => state.setSelectedDirectoryPath);
  const selectedPath = useExplorerStore((state) => state.selectedPath);
  const selectedKind = useExplorerStore((state) => state.selectedKind);
  const setSelection = useExplorerStore((state) => state.setSelection);
  const startRenaming = useExplorerStore((state) => state.startRenaming);

  const hasDirectory = !!fileTree.root;
  const rootPath = fileTree.root?.path;

  const getCreationTargetPath = useCallback(() => {
    if (!rootPath) {
      return undefined;
    }

    if (selectedPath && selectedKind === "directory") {
      return selectedPath;
    }

    if (selectedPath && selectedKind === "file") {
      return getParentPath(selectedPath);
    }

    return rootPath;
  }, [rootPath, selectedKind, selectedPath]);

  /**
   * Create a new note and open it in the active pane
   */
  const handleCreateNote = useCallback(async () => {
    const result = await createFile("Untitled", "note", getCreationTargetPath());
    if (result.success && result.handle && result.path) {
      setSelection(result.path, "file");
      openFileInActivePane(result.handle, result.path);
    }
  }, [createFile, getCreationTargetPath, openFileInActivePane, setSelection]);

  /**
   * Create a new notebook and open it in the active pane
   */
  const handleCreateNotebook = useCallback(async () => {
    const result = await createFile("Untitled", "notebook", getCreationTargetPath());
    if (result.success && result.handle && result.path) {
      setSelection(result.path, "file");
      openFileInActivePane(result.handle, result.path);
    }
  }, [createFile, getCreationTargetPath, openFileInActivePane, setSelection]);

  /**
   * Create a new folder in the root directory or selected directory
   */
  const handleCreateFolder = useCallback(async () => {
    const result = await createDirectory("New Folder", getCreationTargetPath());
    if (!result.success && result.error) {
      console.error("Failed to create folder:", result.error);
      return;
    }

    if (result.path) {
      setSelection(result.path, "directory");
      setSelectedDirectoryPath(result.path);
      startRenaming(result.path);
    }
  }, [createDirectory, getCreationTargetPath, setSelectedDirectoryPath, setSelection, startRenaming]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-scientific text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              {t("explorer.title")}
            </div>
            <div className="mt-1 truncate text-sm font-semibold text-foreground">
              {hasDirectory ? (fileTree.root?.name ?? t("explorer.title")) : t("shell.workspace.none")}
            </div>
          </div>
          {hasDirectory && (
            <div className="flex items-center gap-1">
              <NewFileButtons
                onCreateNote={handleCreateNote}
                onCreateNotebook={handleCreateNotebook}
                onCreateFolder={handleCreateFolder}
                disabled={isLoading}
              />
            </div>
          )}
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
              {t("explorer.refresh")}
            </button>
          </div>
        )}

        {/* Empty State */}
        {!isLoading && !error && !fileTree.root && (
          <EmptyState 
            onOpenQaWorkspace={openQaWorkspace}
            showQaWorkspace={isQaMode}
            isSupported={isSupported} 
            isCheckingSupport={isCheckingSupport}
          />
        )}

        {/* Tree View */}
        {!isLoading && !error && fileTree.root && <TreeView root={fileTree.root} />}
      </div>
      <PluginSidebarSlot />
    </div>
  );
}
