/**
 * Auto Open Default Folder Hook
 *
 * Automatically restores the last opened folder when the app starts.
 * In web mode, persists the FileSystemDirectoryHandle in IndexedDB
 * and re-requests permission on next launch.
 * In Tauri mode, uses Tauri's filesystem APIs.
 */

'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useSettingsStore } from '@/stores/settings-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useContentCacheStore } from '@/stores/content-cache-store';
import { readDirectoryRecursive } from '@/hooks/use-file-system';
import { createDesktopDirectoryHandle, getDesktopHandlePath } from '@/lib/desktop-file-system';
import { logger } from '@/lib/logger';
import { getTauriInvoke, isTauri } from '@/lib/storage-adapter';
import type { DirectoryNode } from '@/types/file-system';
import type { AppSettings } from '@/types/settings';

interface StartupWorkspaceResolution {
  path: string | null;
  source: 'last_workspace_path' | 'recent_workspace_paths' | 'default_folder' | null;
}

const DB_NAME = 'lattice-handles';
const STORE_NAME = 'directory-handles';
const HANDLE_KEY = 'last-opened-folder';

// ============================================================================
// IndexedDB helpers for persisting FileSystemDirectoryHandle
// ============================================================================

function openHandleDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveHandleToDB(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openHandleDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(handle, HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadHandleFromDB(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openHandleDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(HANDLE_KEY);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

// ============================================================================
// Hook
// ============================================================================

export function resolveAutoOpenWorkspacePath(
  settings: Pick<AppSettings, 'lastOpenedFolder' | 'defaultFolder'> & Partial<Pick<AppSettings, 'lastWorkspacePath'>>
): string | null {
  return settings.lastWorkspacePath ?? settings.lastOpenedFolder ?? settings.defaultFolder ?? null;
}

export function useAutoOpenFolder() {
  const isInitialized = useSettingsStore((state) => state.isInitialized);
  const settings = useSettingsStore((state) => state.settings);
  const rememberWorkspacePath = useSettingsStore((state) => state.rememberWorkspacePath);

  const rootHandle = useWorkspaceStore((state) => state.rootHandle);
  const setRootHandle = useWorkspaceStore((state) => state.setRootHandle);
  const setFileTree = useWorkspaceStore((state) => state.setFileTree);
  const setLoading = useWorkspaceStore((state) => state.setLoading);
  const setError = useWorkspaceStore((state) => state.setError);
  const setWorkspaceRootPath = useWorkspaceStore((state) => state.setWorkspaceRootPath);
  const resetWorkbenchState = useWorkspaceStore((state) => state.resetWorkbenchState);

  const hasAttemptedAutoOpen = useRef(false);

  // Persist handle whenever rootHandle changes
  useEffect(() => {
    if (rootHandle && !isTauri() && !getDesktopHandlePath(rootHandle)) {
      saveHandleToDB(rootHandle).catch((err) =>
        logger.warn('[AutoOpen] Failed to persist folder handle:', err)
      );
    }
  }, [rootHandle]);

  const restoreWorkspaceFromHandle = useCallback(async (
    handle: FileSystemDirectoryHandle,
    workspaceRootPath: string | null,
  ) => {
    setLoading(true);
    setError(null);
    try {
      useContentCacheStore.getState().clearCache();
      resetWorkbenchState();
      const children = await readDirectoryRecursive(handle);
      const rootNode: DirectoryNode = {
        name: handle.name,
        kind: "directory",
        handle,
        children,
        path: handle.name,
        isExpanded: true,
      };
      setRootHandle(handle);
      setWorkspaceRootPath(workspaceRootPath ?? handle.name);
      setFileTree({ root: rootNode });
      await rememberWorkspacePath(workspaceRootPath ?? handle.name);
      logger.info('[AutoOpen] Restored workspace tree:', handle.name);
    } catch (err) {
      logger.warn('[AutoOpen] Failed to rebuild workspace tree:', err);
      setError(err instanceof Error ? err.message : 'Failed to restore workspace');
    } finally {
      setLoading(false);
    }
  }, [rememberWorkspacePath, resetWorkbenchState, setError, setFileTree, setLoading, setRootHandle, setWorkspaceRootPath]);

  const openDefaultFolder = useCallback(async () => {
    if (hasAttemptedAutoOpen.current) return;
    hasAttemptedAutoOpen.current = true;

    if (!settings.onboardingCompleted) return;
    if (rootHandle) return;

    try {
      if (isTauri()) {
        try {
          const invoke = getTauriInvoke();
          if (!invoke) {
            logger.warn('[AutoOpen] Tauri host detected but invoke bridge is unavailable');
            return;
          }

          const startupWorkspace = await invoke<StartupWorkspaceResolution>('resolve_startup_workspace');
          if (!startupWorkspace?.path) {
            return;
          }

          const desktopHandle = createDesktopDirectoryHandle(startupWorkspace.path);
          await restoreWorkspaceFromHandle(desktopHandle, startupWorkspace.path);
        } catch (err) {
          logger.warn('[AutoOpen] Failed to resolve startup workspace via Tauri:', err);
        }
        return;
      }

      const savedHandle = await loadHandleFromDB();
      if (!savedHandle) {
        logger.debug('[AutoOpen] No saved folder handle found');
        return;
      }

      // Request permission to access the saved handle
      const permission = await savedHandle.queryPermission({ mode: 'readwrite' });
      if (permission === 'granted') {
        await restoreWorkspaceFromHandle(savedHandle, resolveAutoOpenWorkspacePath(settings) ?? savedHandle.name);
        return;
      }

      // Need to request permission (requires user gesture)
      // We can't auto-request without user interaction, but we can try
      const requested = await savedHandle.requestPermission({ mode: 'readwrite' });
      if (requested === 'granted') {
        await restoreWorkspaceFromHandle(savedHandle, resolveAutoOpenWorkspacePath(settings) ?? savedHandle.name);
      } else {
        logger.debug('[AutoOpen] Permission denied for saved folder');
      }
    } catch (err) {
      logger.warn('[AutoOpen] Failed to restore folder handle:', err);
    }
  }, [
    restoreWorkspaceFromHandle,
    rootHandle,
    settings,
  ]);

  useEffect(() => {
    if (isInitialized) {
      openDefaultFolder();
    }
  }, [isInitialized, openDefaultFolder]);

  return {
    defaultFolder: settings.defaultFolder,
    hasDefaultFolder: !!settings.defaultFolder,
  };
}
