"use client";

import { useCallback, useState, useEffect } from "react";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { FileTree, DirectoryNode, FileNode, TreeNode } from "@/types/file-system";
import {
  isAllowedExtension,
  isIgnoredDirectory,
  getExtension,
} from "@/lib/constants";
import {
  createFile as createFileUtil,
  deleteFile as deleteFileUtil,
  renameFile as renameFileUtil,
  findParentDirectory,
  getFileName,
  type FileType,
  type FileOperationResult,
} from "@/lib/file-operations";

/**
 * Return type for the useFileSystem hook
 */
interface UseFileSystemReturn {
  // State
  isSupported: boolean;
  isCheckingSupport: boolean;
  isLoading: boolean;
  error: string | null;

  // Actions
  openDirectory: () => Promise<void>;
  createFile: (name: string, type: FileType, parentHandle?: FileSystemDirectoryHandle) => Promise<FileOperationResult>;
  deleteFile: (path: string) => Promise<FileOperationResult>;
  renameFile: (path: string, newName: string) => Promise<FileOperationResult>;
  refreshDirectory: () => Promise<void>;

  // Derived
  fileTree: FileTree;
  rootHandle: FileSystemDirectoryHandle | null;
}

/**
 * Recursively read a directory and build a tree structure
 * Filters files by allowed extensions and excludes ignored directories
 */
async function readDirectoryRecursive(
  handle: FileSystemDirectoryHandle,
  parentPath: string = ""
): Promise<TreeNode[]> {
  const children: TreeNode[] = [];
  const currentPath = parentPath ? `${parentPath}/${handle.name}` : handle.name;

  for await (const entry of handle.values()) {
    if (entry.kind === "directory") {
      // Skip ignored directories
      if (isIgnoredDirectory(entry.name)) {
        continue;
      }

      const dirHandle = entry as FileSystemDirectoryHandle;
      const dirChildren = await readDirectoryRecursive(dirHandle, currentPath);

      // Only include directories that have allowed files
      if (dirChildren.length > 0) {
        const dirNode: DirectoryNode = {
          name: entry.name,
          kind: "directory",
          handle: dirHandle,
          children: dirChildren,
          path: `${currentPath}/${entry.name}`,
          isExpanded: false,
        };
        children.push(dirNode);
      }
    } else {
      // File
      const extension = getExtension(entry.name);
      
      // Only include files with allowed extensions
      if (isAllowedExtension(extension)) {
        const fileNode: FileNode = {
          name: entry.name,
          kind: "file",
          handle: entry as FileSystemFileHandle,
          extension,
          path: `${currentPath}/${entry.name}`,
        };
        children.push(fileNode);
      }
    }
  }

  // Sort: directories first, then files, alphabetically
  return children.sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === "directory" ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}

/**
 * Custom hook for File System Access API operations
 * Provides functionality to open directories, create/delete files, and build file trees
 */
export function useFileSystem(): UseFileSystemReturn {
  const {
    rootHandle,
    fileTree,
    isLoading,
    error,
    setRootHandle,
    setFileTree,
    setLoading,
    setError,
  } = useWorkspaceStore();

  // Use state with useEffect to avoid hydration mismatch
  // Server always renders false, client updates after mount
  const [isSupported, setIsSupported] = useState(false);
  const [isCheckingSupport, setIsCheckingSupport] = useState(true);

  useEffect(() => {
    setIsSupported("showDirectoryPicker" in window);
    setIsCheckingSupport(false);
  }, []);

  /**
   * Refresh the file tree from the current root handle
   */
  const refreshDirectory = useCallback(async () => {
    if (!rootHandle) return;

    try {
      setLoading(true);
      
      // Rebuild the file tree
      const children = await readDirectoryRecursive(rootHandle);

      const rootNode: DirectoryNode = {
        name: rootHandle.name,
        kind: "directory",
        handle: rootHandle,
        children,
        path: rootHandle.name,
        isExpanded: true,
      };

      setFileTree({ root: rootNode });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to refresh directory";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [rootHandle, setFileTree, setLoading, setError]);

  /**
   * Open a directory using the File System Access API
   */
  const openDirectory = useCallback(async () => {
    if (!isSupported) {
      setError("File System Access API is not supported in this browser. Please use Chrome or Edge.");
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Request directory access from user with readwrite mode for file operations
      const handle = await window.showDirectoryPicker({
        mode: "readwrite",
      });

      setRootHandle(handle);

      // Build the file tree
      const children = await readDirectoryRecursive(handle);

      const rootNode: DirectoryNode = {
        name: handle.name,
        kind: "directory",
        handle,
        children,
        path: handle.name,
        isExpanded: true, // Root is expanded by default
      };

      setFileTree({ root: rootNode });
    } catch (err) {
      // User cancelled the picker - not an error
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }

      // Handle other errors
      const message = err instanceof Error ? err.message : "Failed to open directory";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [isSupported, setRootHandle, setFileTree, setLoading, setError]);

  /**
   * Create a new file in the workspace
   * 
   * @param name - Desired filename (without extension)
   * @param type - Type of file ('note' for .md, 'notebook' for .ipynb)
   * @param parentHandle - Optional parent directory handle (defaults to root)
   * @returns FileOperationResult with the created file handle
   */
  const createFile = useCallback(async (
    name: string,
    type: FileType,
    parentHandle?: FileSystemDirectoryHandle
  ): Promise<FileOperationResult> => {
    const targetDir = parentHandle ?? rootHandle;
    
    if (!targetDir) {
      return {
        success: false,
        error: "No directory is open. Please open a folder first.",
      };
    }

    const result = await createFileUtil(targetDir, name, type);
    
    if (result.success) {
      // Refresh the file tree to show the new file
      await refreshDirectory();
    }

    return result;
  }, [rootHandle, refreshDirectory]);

  /**
   * Delete a file from the workspace
   * 
   * @param path - Full path to the file to delete
   * @returns FileOperationResult indicating success or failure
   */
  const deleteFile = useCallback(async (path: string): Promise<FileOperationResult> => {
    if (!rootHandle) {
      return {
        success: false,
        error: "No directory is open.",
      };
    }

    // Find the parent directory
    const parentDir = await findParentDirectory(rootHandle, path);
    if (!parentDir) {
      return {
        success: false,
        error: "Could not find parent directory.",
      };
    }

    // Get the filename from the path
    const fileName = getFileName(path);
    if (!fileName) {
      return {
        success: false,
        error: "Invalid file path.",
      };
    }

    const result = await deleteFileUtil(parentDir, fileName);
    
    if (result.success) {
      // Refresh the file tree to reflect the deletion
      await refreshDirectory();
    }

    return result;
  }, [rootHandle, refreshDirectory]);

  /**
   * Rename a file in the workspace
   * 
   * @param path - Full path to the file to rename
   * @param newName - New name for the file (with extension)
   * @returns FileOperationResult indicating success or failure
   */
  const renameFile = useCallback(async (path: string, newName: string): Promise<FileOperationResult> => {
    if (!rootHandle) {
      return {
        success: false,
        error: "No directory is open.",
      };
    }

    // Find the parent directory
    const parentDir = await findParentDirectory(rootHandle, path);
    if (!parentDir) {
      return {
        success: false,
        error: "Could not find parent directory.",
      };
    }

    // Get the filename from the path
    const fileName = getFileName(path);
    if (!fileName) {
      return {
        success: false,
        error: "Invalid file path.",
      };
    }

    const result = await renameFileUtil(parentDir, fileName, newName);
    
    if (result.success) {
      // Refresh the file tree to reflect the rename
      await refreshDirectory();
    }

    return result;
  }, [rootHandle, refreshDirectory]);

  return {
    isSupported,
    isCheckingSupport,
    isLoading,
    error,
    openDirectory,
    createFile,
    deleteFile,
    renameFile,
    refreshDirectory,
    fileTree,
    rootHandle,
  };
}

// Export the recursive reader for testing
export { readDirectoryRecursive };

// Re-export types
export type { FileType, FileOperationResult };
