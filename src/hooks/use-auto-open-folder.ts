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
const DESKTOP_WINDOW_SESSIONS_KEY = 'lattice-desktop-window-sessions';
const DESKTOP_WINDOW_SESSION_ID_KEY = 'lattice-desktop-window-session-id';
const DESKTOP_WINDOW_STALE_MS = 15_000;
const DESKTOP_WINDOW_HEARTBEAT_MS = 4_000;

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

function createDesktopWindowSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `desktop-window-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getDesktopWindowSessionId(): string {
  if (typeof window === 'undefined') {
    return 'desktop-window-ssr';
  }

  const existing = sessionStorage.getItem(DESKTOP_WINDOW_SESSION_ID_KEY);
  if (existing) {
    return existing;
  }

  const next = createDesktopWindowSessionId();
  sessionStorage.setItem(DESKTOP_WINDOW_SESSION_ID_KEY, next);
  return next;
}

function readDesktopWindowSessions(): Record<string, number> {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = localStorage.getItem(DESKTOP_WINDOW_SESSIONS_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([, value]) => typeof value === 'number' && Number.isFinite(value))
        .map(([key, value]) => [key, value as number]),
    );
  } catch {
    return {};
  }
}

function writeDesktopWindowSessions(sessions: Record<string, number>): void {
  if (typeof window === 'undefined') {
    return;
  }

  if (Object.keys(sessions).length === 0) {
    localStorage.removeItem(DESKTOP_WINDOW_SESSIONS_KEY);
    return;
  }

  localStorage.setItem(DESKTOP_WINDOW_SESSIONS_KEY, JSON.stringify(sessions));
}

function pruneDesktopWindowSessions(now = Date.now()): Record<string, number> {
  return Object.fromEntries(
    Object.entries(readDesktopWindowSessions())
      .filter(([, timestamp]) => now - timestamp <= DESKTOP_WINDOW_STALE_MS),
  );
}

function touchDesktopWindowSession(sessionId: string, now = Date.now()): Record<string, number> {
  const nextSessions = pruneDesktopWindowSessions(now);
  nextSessions[sessionId] = now;
  writeDesktopWindowSessions(nextSessions);
  return nextSessions;
}

function removeDesktopWindowSession(sessionId: string): void {
  const nextSessions = pruneDesktopWindowSessions();
  delete nextSessions[sessionId];
  writeDesktopWindowSessions(nextSessions);
}

function hasOtherActiveDesktopWindowSessions(sessionId: string, now = Date.now()): boolean {
  const activeSessions = touchDesktopWindowSession(sessionId, now);
  return Object.keys(activeSessions).some((candidate) => candidate !== sessionId);
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
  const desktopWindowSessionIdRef = useRef<string>(getDesktopWindowSessionId());

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
        if (hasOtherActiveDesktopWindowSessions(desktopWindowSessionIdRef.current)) {
          logger.info('[AutoOpen] Skipping startup workspace restore because another desktop window is already active');
          return;
        }

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
    if (!isTauri()) {
      return;
    }

    const sessionId = desktopWindowSessionIdRef.current;
    touchDesktopWindowSession(sessionId);
    const heartbeatId = window.setInterval(() => {
      touchDesktopWindowSession(sessionId);
    }, DESKTOP_WINDOW_HEARTBEAT_MS);

    return () => {
      window.clearInterval(heartbeatId);
      removeDesktopWindowSession(sessionId);
    };
  }, []);

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
