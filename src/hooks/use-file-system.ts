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
  createDirectory as createDirectoryUtil,
  findParentDirectory,
  getFileName,
  type FileType,
  type FileOperationResult,
  type DirectoryOperationResult,
} from "@/lib/file-operations";
import { emitVaultChange, emitVaultDelete, emitVaultRename } from "@/lib/plugins/runtime";

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
  openQaWorkspace?: () => Promise<void>;
  createFile: (name: string, type: FileType, parentHandle?: FileSystemDirectoryHandle) => Promise<FileOperationResult>;
  createDirectory: (name: string, parentHandle?: FileSystemDirectoryHandle) => Promise<DirectoryOperationResult>;
  deleteFile: (path: string) => Promise<FileOperationResult>;
  renameFile: (path: string, newName: string) => Promise<FileOperationResult>;
  refreshDirectory: () => Promise<void>;

  // Derived
  fileTree: FileTree;
  rootHandle: FileSystemDirectoryHandle | null;
}

const QA_WORKSPACE_NAME = "lattice-qa-workspace";
const QA_PDF_BASE64 =
  "JVBERi0xLjcKJYGBgYEKCjYgMCBvYmoKPDwKL0ZpbHRlciAvRmxhdGVEZWNvZGUKL0xlbmd0aCAxMDgKPj4Kc3RyZWFtCnicNYexCsJAEAX79xVbC8bd82XvDsRCEVKkEfYHRKIoSaGI3+81MszAvHAIaJfk7/uOzTDN3+nzuF7WWWth0VyqWJG4IVFihIk2TNoZVWLBjke3zEyvvvU+aW+0ViXpe4knYoVT4Iwfv3QYpgplbmRzdHJlYW0KZW5kb2JqCgo3IDAgb2JqCjw8Ci9GaWx0ZXIgL0ZsYXRlRGVjb2RlCi9UeXBlIC9PYmpTdG0KL04gNQovRmlyc3QgMjYKL0xlbmd0aCAzNjEKPj4Kc3RyZWFtCnic1VJNS8NAEL3vr5ijHmQ/8rGplELbJApSlFZQFA9pspRI2ZVkI/XfO5Oklh7Es4TH7sy82X2beRIEKAhDCEAnEEIUKIhASwnTKeOPXx8G+EOxMy3jd3XVwityBKzhjfGl66wHyWYzduIuC1/s3Y4NTSCJfGQ8NK7qStPANM/yXAgthIhDRCyESnFdIiYIhTHWVIJ7hA5HYE4HQgRzrOUDYj30UL3nRmN/hityY+KkAzdMhvjnXrorG85Qf+mZzBhfuSotvIGL9FoJFQulpIyDONIvl/g7GlN4938f1+uvnf31hWdzpvHSkBtDHuinzNemdV1T4tiJlzus0ObW7D+Nr8viSotJgjp1MkGPjcbgz/fbd1P2VAqzg7/ZeNIwJCi3MlVdLNwB3Sfww5cDqiYPzq11nlzZ+9F6VENRPHr0TDIJYnzTbX0fUlIyviha00s96UQRtnRVbXfAn2o7t219TNCJ3yQQxeAKZW5kc3RyZWFtCmVuZG9iagoKOCAwIG9iago8PAovU2l6ZSA5Ci9Sb290IDIgMCBSCi9JbmZvIDMgMCBSCi9GaWx0ZXIgL0ZsYXRlRGVjb2RlCi9UeXBlIC9YUmVmCi9MZW5ndGggNDAKL1cgWyAxIDIgMiBdCi9JbmRleCBbIDAgOSBdCj4+CnN0cmVhbQp4nBXEsREAIAwDsbfDHS3DsxJzJViFgG6zISk5VVrigHg/XxhhhgOkCmVuZHN0cmVhbQplbmRvYmoKCnN0YXJ0eHJlZgo2NjAKJSVFT0Y=";

const QA_TEXT_FIXTURES = [
  { name: "test-nested-formatting.md", url: "/test-nested-formatting.md" },
  { name: "test-formula-rendering.md", url: "/test-formula-rendering.md" },
  { name: "test-syntax-hiding.md", url: "/test-syntax-hiding.md" },
  { name: "test-headings.md", url: "/test-headings.md" },
  { name: "test-1000-lines.md", url: "/test-1000-lines.md" },
  { name: "test-notebook.ipynb", url: "/test-notebook.ipynb" },
];

const QA_BINARY_FIXTURES = [
  { name: "qa-image.png", url: "/icons/icon-192x192.png" },
];

async function getOpfsRoot(): Promise<FileSystemDirectoryHandle | null> {
  if (typeof window === "undefined") return null;
  const storage = (navigator as { storage?: { getDirectory?: () => Promise<FileSystemDirectoryHandle> } }).storage;
  if (!storage?.getDirectory) return null;
  return storage.getDirectory();
}

async function fileExists(dir: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

async function writeTextFile(
  dir: FileSystemDirectoryHandle,
  name: string,
  content: string
): Promise<void> {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
}

async function writeBinaryFile(
  dir: FileSystemDirectoryHandle,
  name: string,
  bytes: Uint8Array
): Promise<void> {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  const safeBytes = new Uint8Array(bytes);
  await writable.write(safeBytes);
  await writable.close();
}

async function ensureQaFixtures(dir: FileSystemDirectoryHandle): Promise<void> {
  for (const fixture of QA_TEXT_FIXTURES) {
    if (await fileExists(dir, fixture.name)) continue;
    const response = await fetch(fixture.url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${fixture.url}`);
    }
    const content = await response.text();
    await writeTextFile(dir, fixture.name, content);
  }

  for (const fixture of QA_BINARY_FIXTURES) {
    if (await fileExists(dir, fixture.name)) continue;
    const response = await fetch(fixture.url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${fixture.url}`);
    }
    const buffer = await response.arrayBuffer();
    await writeBinaryFile(dir, fixture.name, new Uint8Array(buffer));
  }

  if (!(await fileExists(dir, "qa-sample.pdf"))) {
    const bytes = Uint8Array.from(atob(QA_PDF_BASE64), (char) => char.charCodeAt(0));
    await writeBinaryFile(dir, "qa-sample.pdf", bytes);
  }
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
   * Open a QA workspace in OPFS (dev-only helper)
   */
  const openQaWorkspace = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const opfsRoot = await getOpfsRoot();
      if (!opfsRoot) {
        setError("OPFS is not supported in this browser. Please use Chrome or Edge.");
        return;
      }

      const workspaceHandle = await opfsRoot.getDirectoryHandle(QA_WORKSPACE_NAME, { create: true });
      await ensureQaFixtures(workspaceHandle);

      setRootHandle(workspaceHandle);

      const children = await readDirectoryRecursive(workspaceHandle);
      const rootNode: DirectoryNode = {
        name: workspaceHandle.name,
        kind: "directory",
        handle: workspaceHandle,
        children,
        path: workspaceHandle.name,
        isExpanded: true,
      };

      setFileTree({ root: rootNode });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to open QA workspace";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [setRootHandle, setFileTree, setLoading, setError]);

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
      if (result.path) {
        emitVaultChange(result.path);
      }
    }

    return result;
  }, [rootHandle, refreshDirectory]);

  /**
   * Create a new directory in the workspace
   * 
   * @param name - Desired directory name
   * @param parentHandle - Optional parent directory handle (defaults to root)
   * @returns DirectoryOperationResult with the created directory handle
   */
  const createDirectory = useCallback(async (
    name: string,
    parentHandle?: FileSystemDirectoryHandle
  ): Promise<DirectoryOperationResult> => {
    const targetDir = parentHandle ?? rootHandle;
    
    if (!targetDir) {
      return {
        success: false,
        error: "No directory is open. Please open a folder first.",
      };
    }

    const result = await createDirectoryUtil(targetDir, name);
    
    if (result.success) {
      // Refresh the file tree to show the new directory
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
      emitVaultDelete(path);
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
      if (result.path) {
        emitVaultRename(path, result.path);
      }
    }

    return result;
  }, [rootHandle, refreshDirectory]);

  return {
    isSupported,
    isCheckingSupport,
    isLoading,
    error,
    openDirectory,
    openQaWorkspace,
    createFile,
    createDirectory,
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
export type { FileType, FileOperationResult, DirectoryOperationResult };
