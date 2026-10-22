"use client";

import { useEffect } from "react";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { collectExpandedDirectoryPaths, useFileSystem } from "@/hooks/use-file-system";
import { getDesktopHandlePath, invalidateDesktopDirCache, invalidateDesktopDirectoryTreeCache, readDesktopFileMetadata } from "@/lib/desktop-file-system";
import { invokeTauriCommand, isTauriHost } from "@/lib/storage-adapter";
import { createWorkspaceChangePump, resolveWorkspaceRenamedPath, shouldRefreshWorkspaceSnapshot, type WorkspaceFileChange } from "@/lib/workspace-live-sync";
import { getFileExtension, isBinaryFile } from '@/lib/file-utils';
import { getOpenWorkspaceFiles, refreshCleanWorkspaceFile, relocateCleanWorkspaceFilesForRenames } from "@/lib/workspace-live-content";
import { emitVaultChange, subscribeVaultChange, subscribeVaultDelete, subscribeVaultRename } from "@/lib/plugins/runtime";

/** One live synchronizer per mounted local workspace; no full-tree polling. */
export function useWorkspaceLiveSync(): void {
  const rootHandle = useWorkspaceStore(state => state.rootHandle);
  const { refreshDirectory, ensureDirectoryExpanded } = useFileSystem({ subscribeToTree: false });
  useEffect(() => {
    if (!rootHandle) return;
    const watchId = crypto.randomUUID();
    const nativeRoot = getDesktopHandlePath(rootHandle);
    let cancelled = false, notifying = false;
    let unlisten: (() => void) | undefined;
    let nativeWatching = false;
    let openFileOffset = 0;
    const versions = new Map<string, string>();
    const current = () => !cancelled && useWorkspaceStore.getState().rootHandle === rootHandle;
    const scoped = (path: string) => path === rootHandle.name || path.startsWith(rootHandle.name + "/");
    const checkOpenFiles = async (eventPaths?: readonly string[]) => {
      const files = getOpenWorkspaceFiles(useWorkspaceStore.getState().layout.root).filter(tab => scoped(tab.filePath));
      const selected = eventPaths
        ? files.filter(tab => eventPaths.some(path => tab.filePath === path || tab.filePath.startsWith(path + "/")))
        : [...files.slice(openFileOffset), ...files.slice(0, openFileOffset)].slice(0, 40);
      if (!eventPaths && files.length) openFileOffset = (openFileOffset + 40) % files.length;
      for (const tab of selected) {
        if (!current()) return;
        try {
          const fullPath = getDesktopHandlePath(tab.fileHandle);
          const file = fullPath ? await readDesktopFileMetadata(fullPath) : await tab.fileHandle.getFile();
          const version = 'modifiedMs' in file ? file.size + ':' + file.modifiedMs : file.size + ':' + file.lastModified;
          const previous = versions.get(tab.filePath);
          versions.set(tab.filePath, version);
          // A concrete event proves a change even before the initial baseline.
          // On browser fallback, compare clean text once to establish that baseline.
          if (shouldRefreshWorkspaceSnapshot(previous, version, Boolean(eventPaths), isBinaryFile(getFileExtension(tab.fileName)))) {
            await refreshCleanWorkspaceFile(tab, current);
          }
        } catch { /* A removed file's open editor remains available. */ }
      }
    };
    const pump = createWorkspaceChangePump(async (paths, renames) => {
      if (!current()) return;
      const expanded = collectExpandedDirectoryPaths(useWorkspaceStore.getState().fileTree.root);
      const movedExpanded = [...expanded].map(path => ({ original: path, final: resolveWorkspaceRenamedPath(path, renames) }))
        .filter(path => path.original !== path.final).map(path => path.final).sort((left, right) => left.length - right.length);
      if (nativeRoot) {
        if (paths) paths.forEach(path => invalidateDesktopDirCache(nativeRoot + path.slice(rootHandle.name.length)));
        else invalidateDesktopDirectoryTreeCache(nativeRoot);
      }
      await refreshDirectory({ silent: true, visibleOnly: true, changedPaths: paths });
      if (!current()) return;
      for (const path of movedExpanded) {
        if (!current()) return;
        await ensureDirectoryExpanded(path);
      }
      await relocateCleanWorkspaceFilesForRenames(rootHandle, renames, current);
      await checkOpenFiles(paths);
      if (paths && current()) {
        notifying = true;
        try { paths.forEach(emitVaultChange); } finally { notifying = false; }
      }
    });
    const internalChange = (path: string) => {
      if (!notifying && current() && scoped(path)) pump.request([path]);
    };
    const stopChange = subscribeVaultChange(internalChange);
    const stopDelete = subscribeVaultDelete(internalChange);
    const stopRename = subscribeVaultRename((from, to) => { internalChange(from); internalChange(to); });
    const resume = () => { if (current() && document.visibilityState === 'visible') pump.request(); };
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', resume);
    // Browser handles have no standard change stream. Only visible branches and
    // bounded open-file metadata are checked, and never while the page is hidden.
    const timer = setInterval(() => {
      if (!nativeWatching && current() && document.visibilityState === 'visible') pump.request();
    }, 5000);
    pump.request();
    if (nativeRoot && isTauriHost()) {
      void (async () => {
        const { listen } = await import('@tauri-apps/api/event');
        const stop = await listen<WorkspaceFileChange>('workspace://changed', event => {
          if (!current() || event.payload.watchId !== watchId) return;
          const prefix = (path: string) => path ? rootHandle.name + '/' + path : rootHandle.name;
          const paths = event.payload.rescan ? undefined : event.payload.paths.map(prefix);
          pump.request(paths, (event.payload.renames ?? []).map(move => ({ from: prefix(move.from), to: prefix(move.to) })));
        });
        if (!current()) { stop(); return; }
        unlisten = stop;
        await invokeTauriCommand('desktop_watch_workspace', { path: nativeRoot, watchId });
        if (!current()) await invokeTauriCommand('desktop_unwatch_workspace', { watchId });
        else nativeWatching = true;
      })().catch(error => { if (current()) console.warn('[WorkspaceSync] Native watch unavailable; using visible-folder checks', error); });
    }
    return () => {
      cancelled = true; pump.dispose(); clearInterval(timer);
      window.removeEventListener('focus', resume); document.removeEventListener('visibilitychange', resume);
      stopChange(); stopDelete(); stopRename(); unlisten?.();
      if (nativeRoot) void invokeTauriCommand('desktop_unwatch_workspace', { watchId }).catch(() => {});
    };
  }, [rootHandle, refreshDirectory, ensureDirectoryExpanded]);
}
