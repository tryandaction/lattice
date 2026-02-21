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
import { isTauri } from '@/lib/storage-adapter';
import { logger } from '@/lib/logger';

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

export function useAutoOpenFolder() {
  const isInitialized = useSettingsStore((state) => state.isInitialized);
  const settings = useSettingsStore((state) => state.settings);

  const rootHandle = useWorkspaceStore((state) => state.rootHandle);
  const setRootHandle = useWorkspaceStore((state) => state.setRootHandle);

  const hasAttemptedAutoOpen = useRef(false);

  // Persist handle whenever rootHandle changes (web mode only)
  useEffect(() => {
    if (!isTauri() && rootHandle) {
      saveHandleToDB(rootHandle).catch((err) =>
        logger.warn('[AutoOpen] Failed to persist folder handle:', err)
      );
    }
  }, [rootHandle]);

  const openDefaultFolder = useCallback(async () => {
    if (hasAttemptedAutoOpen.current) return;
    hasAttemptedAutoOpen.current = true;

    if (!settings.onboardingCompleted) return;
    if (rootHandle) return;

    if (isTauri()) {
      // Tauri mode: use Tauri dialog to open saved path
      try {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const path = settings.defaultFolder;
        if (!path) return;
        // In Tauri, we can programmatically access the filesystem
        // but still need to set the root handle through the workspace store
        logger.info('[AutoOpen] Tauri mode - attempting to open:', path);
        const selected = await open({ directory: true, defaultPath: path });
        if (selected) {
          logger.info('[AutoOpen] Tauri folder opened:', selected);
        }
      } catch (err) {
        logger.warn('[AutoOpen] Tauri auto-open failed:', err);
      }
      return;
    }

    // Web mode: try to restore handle from IndexedDB
    try {
      const savedHandle = await loadHandleFromDB();
      if (!savedHandle) {
        logger.debug('[AutoOpen] No saved folder handle found');
        return;
      }

      // Request permission to access the saved handle
      const permission = await savedHandle.queryPermission({ mode: 'readwrite' });
      if (permission === 'granted') {
        setRootHandle(savedHandle);
        logger.info('[AutoOpen] Restored folder:', savedHandle.name);
        return;
      }

      // Need to request permission (requires user gesture)
      // We can't auto-request without user interaction, but we can try
      const requested = await savedHandle.requestPermission({ mode: 'readwrite' });
      if (requested === 'granted') {
        setRootHandle(savedHandle);
        logger.info('[AutoOpen] Permission granted, restored folder:', savedHandle.name);
      } else {
        logger.debug('[AutoOpen] Permission denied for saved folder');
      }
    } catch (err) {
      logger.warn('[AutoOpen] Failed to restore folder handle:', err);
    }
  }, [settings.defaultFolder, settings.onboardingCompleted, rootHandle, setRootHandle]);

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
