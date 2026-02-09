/**
 * Auto Open Default Folder Hook
 * 
 * Automatically opens the default folder when the app starts,
 * if one is configured and the onboarding is completed.
 */

'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useSettingsStore } from '@/stores/settings-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { isTauri } from '@/lib/storage-adapter';

export function useAutoOpenFolder() {
  const isInitialized = useSettingsStore((state) => state.isInitialized);
  const settings = useSettingsStore((state) => state.settings);
  
  const rootHandle = useWorkspaceStore((state) => state.rootHandle);
  
  const hasAttemptedAutoOpen = useRef(false);

  const openDefaultFolder = useCallback(async () => {
    // Only run once
    if (hasAttemptedAutoOpen.current) return;
    hasAttemptedAutoOpen.current = true;

    // Skip if no default folder configured
    if (!settings.defaultFolder) return;

    // Skip if onboarding not completed
    if (!settings.onboardingCompleted) return;

    // Skip if already have a folder open
    if (rootHandle) return;

    // Skip in Tauri - folder path handling is different
    // In Tauri, we'd need to use Tauri's file system APIs
    if (isTauri()) {
      // TODO: Implement Tauri-specific folder opening
      console.log('[AutoOpen] Tauri mode - skipping auto-open (not yet implemented)');
      return;
    }

    // In web mode, we can't auto-open a folder by path
    // The File System Access API requires user interaction
    // We can only show a prompt to the user
    console.log('[AutoOpen] Web mode - cannot auto-open folder without user interaction');
    console.log('[AutoOpen] Default folder configured:', settings.defaultFolder);
    
    // We could show a toast/notification here prompting the user to open the folder
    // For now, just log it
  }, [settings.defaultFolder, settings.onboardingCompleted, rootHandle]);

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
