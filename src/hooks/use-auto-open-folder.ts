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
import type { TreeNode, DirectoryNode } from '@/types/file-system';
import { isAllowedExtension, isIgnoredDirectory, getExtension } from '@/lib/constants';

/**
 * Build file tree from directory handle
 */
async function buildFileTree(handle: FileSystemDirectoryHandle): Promise<{ root: DirectoryNode }> {
  async function readDirectoryRecursive(
    dirHandle: FileSystemDirectoryHandle,
    parentPath: string = ""
  ): Promise<TreeNode[]> {
    const children: TreeNode[] = [];
    const currentPath = parentPath ? `${parentPath}/${dirHandle.name}` : dirHandle.name;

    for await (const entry of dirHandle.values()) {
      if (entry.kind === "directory") {
        if (isIgnoredDirectory(entry.name)) continue;

        const childHandle = entry as FileSystemDirectoryHandle;
        const dirChildren = await readDirectoryRecursive(childHandle, currentPath);

        if (dirChildren.length > 0) {
          children.push({
            name: entry.name,
            kind: "directory",
            handle: childHandle,
            children: dirChildren,
            path: `${currentPath}/${entry.name}`,
            isExpanded: false,
          });
        }
      } else {
        const extension = getExtension(entry.name);
        if (isAllowedExtension(extension)) {
          children.push({
            name: entry.name,
            kind: "file",
            handle: entry as FileSystemFileHandle,
            extension,
            path: `${currentPath}/${entry.name}`,
          });
        }
      }
    }

    return children.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  const children = await readDirectoryRecursive(handle);
  return {
    root: {
      name: handle.name,
      kind: "directory",
      handle,
      children,
      path: handle.name,
      isExpanded: true,
    },
  };
}

export function useAutoOpenFolder() {
  const isInitialized = useSettingsStore((state) => state.isInitialized);
  const settings = useSettingsStore((state) => state.settings);
  const setDefaultFolder = useSettingsStore((state) => state.setDefaultFolder);
  
  const rootHandle = useWorkspaceStore((state) => state.rootHandle);
  const setRootHandle = useWorkspaceStore((state) => state.setRootHandle);
  const setFileTree = useWorkspaceStore((state) => state.setFileTree);
  const setLoading = useWorkspaceStore((state) => state.setLoading);
  const setError = useWorkspaceStore((state) => state.setError);
  
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
