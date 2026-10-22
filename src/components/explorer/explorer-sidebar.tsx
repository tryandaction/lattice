"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { useFileSystem } from "@/hooks/use-file-system";
import { useExplorerFileDrop } from '@/hooks/use-explorer-file-drop';
import { useI18n } from "@/hooks/use-i18n";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useExplorerStore } from "@/stores/explorer-store";
import { getParentPath } from "@/lib/file-operations";
import { EmptyState } from "./empty-state";
import { TreeView } from "./tree-view";
import { NewFileButtons } from "./new-file-buttons";
import { ClipboardPaste, FilePlus, FolderPlus, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { PluginSidebarSlot } from "@/components/ui/plugin-sidebar-slot";
import { WorkbenchContextMenu, type WorkbenchMenuAction } from "@/components/ui/workbench-context-menu";
import { collectExpandedDirectoryPaths } from "@/hooks/use-file-system";
import { saveWorkspaceUiState } from "@/lib/workspace-ui-state";
import { sourceCreationTarget, type ExplorerSourceAdapter, type ExplorerCreateKind } from "./explorer-source";

/**
 * Explorer Sidebar component
 * Shows empty state when no folder is opened, tree view when folder is opened
 */
export function ExplorerSidebar({ source, header }: { source?: ExplorerSourceAdapter; header?: ReactNode } = {}) {
  return source ? <SourceExplorerSidebar source={source} header={header} /> : <LocalExplorerSidebar header={header} />;
}

function LocalExplorerSidebar({ header }: { header?: ReactNode }) {
  const fileDrop = useExplorerFileDrop();
  const { t } = useI18n();
  const { fileTree, isLoading, error, openDirectory, openQaWorkspace, isSupported, isCheckingSupport, createFile, createDirectory, copyEntry, moveEntry, refreshDirectory } = useFileSystem();
  const searchParams = useSearchParams();
  const isQaMode = process.env.NODE_ENV === "development" && searchParams?.get("qa") === "1";
  const openFileInActivePane = useWorkspaceStore((state) => state.openFileInActivePane);
  const setSelectedDirectoryPath = useWorkspaceStore((state) => state.setSelectedDirectoryPath);
  const workspaceKey = useWorkspaceStore((state) => state.workspaceIdentity?.workspaceKey ?? null);
  const workspaceRootPath = useWorkspaceStore((state) => state.workspaceRootPath);
  const selectedPath = useExplorerStore((state) => state.selectedPath);
  const selectedKind = useExplorerStore((state) => state.selectedKind);
  const setSelection = useExplorerStore((state) => state.setSelection);
  const startRenaming = useExplorerStore((state) => state.startRenaming);
  const clipboard = useExplorerStore((state) => state.clipboard);
  const clearClipboard = useExplorerStore((state) => state.clearClipboard);
  const [blankMenu, setBlankMenu] = useState<{ x: number; y: number } | null>(null);
  const persistUiStateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasDirectory = !!fileTree.root;
  const rootPath = fileTree.root?.path;

  useEffect(() => {
    if (!fileTree.root || (!workspaceKey && !workspaceRootPath)) {
      return;
    }

    if (persistUiStateTimerRef.current) {
      clearTimeout(persistUiStateTimerRef.current);
    }

    persistUiStateTimerRef.current = setTimeout(() => {
      const expandedPaths = Array.from(collectExpandedDirectoryPaths(fileTree.root));
      void saveWorkspaceUiState(workspaceKey, workspaceRootPath, {
        version: 1,
        explorer: {
          expandedPaths,
          selectedPath,
          selectedKind,
        },
      });
    }, 250);

    return () => {
      if (persistUiStateTimerRef.current) {
        clearTimeout(persistUiStateTimerRef.current);
        persistUiStateTimerRef.current = null;
      }
    };
  }, [fileTree.root, selectedKind, selectedPath, workspaceKey, workspaceRootPath]);

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

  const handleCreateGenericFile = useCallback(async () => {
    const result = await createFile("untitled.txt", "file", getCreationTargetPath());
    if (result.success && result.handle && result.path) {
      setSelection(result.path, "file");
      startRenaming(result.path);
      openFileInActivePane(result.handle, result.path);
    }
  }, [createFile, getCreationTargetPath, openFileInActivePane, setSelection, startRenaming]);

  const handlePasteIntoTarget = useCallback(async () => {
    if (!clipboard || !rootPath) return;
    const targetPath = getCreationTargetPath() ?? rootPath;
    const result =
      clipboard.mode === "copy"
        ? await copyEntry(clipboard.path, targetPath)
        : await moveEntry(clipboard.path, targetPath);
    if (!result.success || !result.path) {
      console.error("Failed to paste entry:", result.error);
      return;
    }
    if (clipboard.mode === "cut") {
      clearClipboard();
    }
    setSelection(result.path, clipboard.kind);
    if (clipboard.kind === "directory") {
      setSelectedDirectoryPath(result.path);
    }
  }, [clearClipboard, clipboard, copyEntry, getCreationTargetPath, moveEntry, rootPath, setSelectedDirectoryPath, setSelection]);

  const blankMenuActions = useMemo<WorkbenchMenuAction[]>(() => [
    {
      id: "new-file",
      label: t("explorer.context.newFile"),
      icon: <FilePlus className="h-4 w-4" />,
      disabled: !hasDirectory,
      onSelect: () => void handleCreateGenericFile(),
    },
    {
      id: "new-folder",
      label: t("explorer.context.newFolder"),
      icon: <FolderPlus className="h-4 w-4" />,
      disabled: !hasDirectory,
      onSelect: () => void handleCreateFolder(),
    },
    {
      id: "paste",
      label: t("explorer.context.paste"),
      icon: <ClipboardPaste className="h-4 w-4" />,
      disabled: !hasDirectory || !clipboard,
      separatorBefore: true,
      onSelect: () => void handlePasteIntoTarget(),
    },
    {
      id: "refresh",
      label: t("explorer.refresh"),
      icon: <RefreshCw className="h-4 w-4" />,
      separatorBefore: true,
      disabled: !hasDirectory || isLoading,
      onSelect: () => void refreshDirectory(),
    },
  ], [clipboard, handleCreateFolder, handleCreateGenericFile, handlePasteIntoTarget, hasDirectory, isLoading, refreshDirectory, t]);

  return (
    <div
      className="relative flex h-full flex-col"
      onDragOverCapture={fileDrop.onDragOverCapture}
      onDropCapture={fileDrop.onDropCapture}
      onDragOver={fileDrop.onDragOver}
      onDrop={fileDrop.onDrop}
      onDragLeave={fileDrop.onDragLeave}
      aria-busy={fileDrop.busy}
      data-explorer-local-drop="true"
      onContextMenu={(event) => {
        if (!hasDirectory) return;
        const target = event.target as HTMLElement | null;
        if (target?.closest("[data-explorer-node='true']")) return;
        event.preventDefault();
        setBlankMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      {header}
      {(fileDrop.hovered || fileDrop.busy) && <div role="status" className="pointer-events-none absolute inset-x-2 bottom-2 z-30 rounded-md border border-primary bg-background/95 px-3 py-2 text-xs text-foreground shadow-sm">{fileDrop.busy ? t('explorer.drop.importing') : t('explorer.drop.hint', { path: fileDrop.hovered ?? '' })}</div>}
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
          <div className={fileTree.root ? "flex items-center justify-center py-2" : "flex h-full items-center justify-center"}
            role="status" aria-label={t("common.loading")}>
            <Loader2 className={fileTree.root ? "h-4 w-4 animate-spin text-muted-foreground" : "h-6 w-6 animate-spin text-muted-foreground"} />
          </div>
        )}

        {/* Error State - only show if there's an actual error and we're not loading */}
        {error && !isLoading && isSupported && (
          <div role="alert" className="flex flex-col items-center justify-center gap-2 p-4 text-center">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <p className="text-sm text-destructive">{error}</p>
            <button
              onClick={fileTree.root ? () => void refreshDirectory() : openDirectory}
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
        {fileTree.root && <TreeView root={fileTree.root} />}
      </div>
      {blankMenu && (
        <WorkbenchContextMenu
          x={blankMenu.x}
          y={blankMenu.y}
          actions={blankMenuActions}
          onClose={() => setBlankMenu(null)}
        />
      )}
      <PluginSidebarSlot />
    </div>
  );
}

function SourceExplorerSidebar({ source, header }: { source: ExplorerSourceAdapter; header?: ReactNode }) {
  const { t } = useI18n();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const uploadInput = useRef<HTMLInputElement>(null);
  const target = sourceCreationTarget(source.root, source.selectedId);
  const writable = !source.readOnly && !source.loading && !busy && Boolean(target);
  const run = async (operation: () => void | Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await operation(); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  const create = (kind: ExplorerCreateKind) => {
    if (writable && target && source.create) void run(() => source.create!(kind, target));
  };
  const actions: WorkbenchMenuAction[] = [
    { id: "new-file", label: t("explorer.context.newFile"), icon: <FilePlus className="h-4 w-4" />, disabled: !writable || !source.create, onSelect: () => create("file") },
    { id: "new-folder", label: t("explorer.context.newFolder"), icon: <FolderPlus className="h-4 w-4" />, disabled: !writable || !source.create, onSelect: () => create("directory") },
    { id: "refresh", label: t("explorer.refresh"), icon: <RefreshCw className="h-4 w-4" />, disabled: source.loading || busy, onSelect: () => void run(() => source.refresh()) },
  ];
  return <div className="flex h-full flex-col" data-explorer-source={source.id}
    onContextMenu={event => { if ((event.target as HTMLElement).closest("[data-explorer-node='true']")) return; event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY }); }}>
    {header}
    <div className="border-b border-border px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-scientific text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{t("explorer.title")}</div>
          {!header && <div className="mt-1 truncate text-sm font-semibold text-foreground">{source.root?.name ?? source.label}</div>}
        </div>
        {source.root && <NewFileButtons onCreateNote={() => create("note")} onCreateNotebook={() => create("notebook")}
          onCreateFolder={() => create("directory")} onUpload={source.upload ? () => uploadInput.current?.click() : undefined}
          disabled={!writable || !source.create} />}
      </div>
    </div>
    <input ref={uploadInput} type="file" multiple hidden aria-label={t("explorer.action.uploadSelect")}
      onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ""; if (writable && target && files.length && source.upload) void run(() => source.upload!(files, target)); }} />
    <div className="flex-1 overflow-auto">
      {(source.error || error) && <div role="alert" className="flex flex-col items-center gap-2 p-4 text-center text-sm text-destructive"><AlertCircle className="h-6 w-6" /><p>{error ?? source.error}</p><button className="text-primary underline" onClick={() => void run(() => source.refresh())}>{t("explorer.refresh")}</button></div>}
      {source.loading && !source.root ? <div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        : source.root ? <TreeView source={source} /> : <div className="p-4 text-sm text-muted-foreground">{source.label}</div>}
    </div>
    {menu && <WorkbenchContextMenu {...menu} actions={actions} onClose={() => setMenu(null)} />}
    <PluginSidebarSlot />
  </div>;
}
