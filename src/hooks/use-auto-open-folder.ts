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
import { applyWorkspaceHandleToStores } from '@/hooks/use-file-system';
import { createDesktopDirectoryHandle } from '@/lib/desktop-file-system';
import { resolveDesktopStartupWorkspace } from '@/lib/desktop-folder';
import { logger } from '@/lib/logger';
import { isTauri } from '@/lib/storage-adapter';
import type { AppSettings } from '@/types/settings';
import { loadWorkspaceHandleRegistration } from '@/lib/workspace-identity';

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
  settings: Pick<AppSettings, 'lastOpenedFolder' | 'defaultFolder'> & Partial<Pick<AppSettings, 'lastWorkspacePath' | 'lastWorkspaceKey' | 'workspaceDisplayPaths'>>
): string | null {
  if (settings.lastWorkspaceKey && settings.workspaceDisplayPaths?.[settings.lastWorkspaceKey]) {
    return settings.workspaceDisplayPaths[settings.lastWorkspaceKey];
  }
  return settings.lastWorkspacePath ?? settings.lastOpenedFolder ?? settings.defaultFolder ?? null;
}

export function useAutoOpenFolder() {
  const isInitialized = useSettingsStore((state) => state.isInitialized);
  const settings = useSettingsStore((state) => state.settings);
  const loadSettings = useSettingsStore((state) => state.loadSettings);

  const rootHandle = useWorkspaceStore((state) => state.rootHandle);
  const setLoading = useWorkspaceStore((state) => state.setLoading);
  const setError = useWorkspaceStore((state) => state.setError);

  const hasAttemptedAutoOpen = useRef(false);

  const restoreWorkspaceFromHandle = useCallback(async (
    handle: FileSystemDirectoryHandle,
    workspaceRootPath: string | null,
    preferredWorkspaceKey?: string | null,
  ): Promise<boolean> => {
    setLoading(true);
    setError(null);
    try {
      await applyWorkspaceHandleToStores(handle, workspaceRootPath, preferredWorkspaceKey);
      logger.info('[AutoOpen] Restored workspace tree:', handle.name);
      return true;
    } catch (err) {
      logger.warn('[AutoOpen] Failed to rebuild workspace tree:', err);
      setError(err instanceof Error ? err.message : 'Failed to restore workspace');
      return false;
    } finally {
      setLoading(false);
    }
  }, [setError, setLoading]);

  const openDefaultFolder = useCallback(async () => {
    if (hasAttemptedAutoOpen.current) return;
    hasAttemptedAutoOpen.current = true;

    if (!settings.onboardingCompleted) return;
    if (rootHandle) return;

    try {
      if (isTauri()) {
        const startupWorkspace = await resolveDesktopStartupWorkspace();
        await loadSettings();
        if (!startupWorkspace?.path) {
          return;
        }

        await restoreWorkspaceFromHandle(
          createDesktopDirectoryHandle(startupWorkspace.path),
          startupWorkspace.path,
          useSettingsStore.getState().settings.lastWorkspaceKey,
        );
        return;
      }

      const registeredWorkspace = settings.lastWorkspaceKey
        ? await loadWorkspaceHandleRegistration(settings.lastWorkspaceKey)
        : null;
      const savedHandle = registeredWorkspace?.handle ?? await loadHandleFromDB();
      if (!savedHandle) {
        logger.debug('[AutoOpen] No saved folder handle found');
        return;
      }

      // Request permission to access the saved handle
      const permission = await savedHandle.queryPermission({ mode: 'readwrite' });
      if (permission === 'granted') {
        await restoreWorkspaceFromHandle(
          savedHandle,
          resolveAutoOpenWorkspacePath(settings) ?? registeredWorkspace?.displayPath ?? savedHandle.name,
          registeredWorkspace?.workspaceKey ?? settings.lastWorkspaceKey ?? null,
        );
        return;
      }

      // Need to request permission (requires user gesture)
      // We can't auto-request without user interaction, but we can try
      const requested = await savedHandle.requestPermission({ mode: 'readwrite' });
      if (requested === 'granted') {
        await restoreWorkspaceFromHandle(
          savedHandle,
          resolveAutoOpenWorkspacePath(settings) ?? registeredWorkspace?.displayPath ?? savedHandle.name,
          registeredWorkspace?.workspaceKey ?? settings.lastWorkspaceKey ?? null,
        );
      } else {
        logger.debug('[AutoOpen] Permission denied for saved folder');
      }
    } catch (err) {
      logger.warn('[AutoOpen] Failed to restore folder handle:', err);
    }
  }, [
    loadSettings,
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
