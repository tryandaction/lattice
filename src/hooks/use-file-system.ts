"use client";

import { useCallback, useState, useEffect } from "react";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useContentCacheStore } from "@/stores/content-cache-store";
import { useSettingsStore } from "@/stores/settings-store";
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
  deleteEntry as deleteEntryUtil,
  renameEntry as renameEntryUtil,
  createDirectory as createDirectoryUtil,
  getParentPath,
  joinPath,
  moveEntryToDirectory,
  copyEntryToDirectory,
  resolveDirectoryHandle,
  resolveEntry,
  generateUniqueName,
  sanitizeFileName,
  type FileType,
  type FileOperationResult,
  type DirectoryOperationResult,
  type EntryOperationResult,
} from "@/lib/file-operations";
import {
  copyAnnotationSidecar,
  deleteAnnotationSidecarsForPath,
  detectFileType,
  generateFileId,
  moveAnnotationSidecar,
} from "@/lib/universal-annotation-storage";
import {
  copyPdfItemWorkspace,
  deletePdfItemWorkspace,
  listPdfItemNotes,
  loadPdfItemManifest,
  migrateLegacyPdfItemWorkspaces,
  movePdfItemWorkspace,
} from "@/lib/pdf-item";
import { createDesktopDirectoryHandle } from "@/lib/desktop-file-system";
import { isTauri, isTauriHost } from "@/lib/storage-adapter";
import { isExistingDesktopDirectory, openDesktopDirectoryDialog } from "@/lib/desktop-folder";
import { emitVaultChange, emitVaultDelete, emitVaultRename } from "@/lib/plugins/runtime";
import { resolveWorkspaceIdentity } from "@/lib/workspace-identity";

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
  openWorkspacePath: (path: string) => Promise<void>;
  openDirectoryAsWorkspace: (path: string) => Promise<void>;
  openQaWorkspace?: () => Promise<void>;
  createFile: (name: string, type: FileType | 'file', parentPath?: string) => Promise<FileOperationResult>;
  createDirectory: (name: string, parentPath?: string) => Promise<DirectoryOperationResult>;
  deleteFile: (path: string) => Promise<EntryOperationResult>;
  renameFile: (path: string, newName: string) => Promise<EntryOperationResult>;
  copyEntry: (sourcePath: string, targetDirectoryPath: string) => Promise<EntryOperationResult>;
  moveEntry: (sourcePath: string, targetDirectoryPath: string) => Promise<EntryOperationResult>;
  refreshDirectory: (options?: { silent?: boolean }) => Promise<void>;

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

function isPdfCompanionDirectoryName(name: string): boolean {
  const normalized = name.toLowerCase();
  return normalized.endsWith(".item") || (normalized.startsWith(".") && normalized.endsWith(".lattice"));
}

function isPdfPath(path: string): boolean {
  return getExtension(path) === "pdf";
}

function buildPdfVirtualChildNode(summary: Awaited<ReturnType<typeof listPdfItemNotes>>[number], parentPdfPath: string): FileNode | null {
  if (!summary.handle) {
    return null;
  }

  const extension = getExtension(summary.fileName);
  const displayName = summary.type === "annotation-note"
    ? "_annotations.md"
    : summary.fileName;
  return {
    name: summary.fileName,
    displayName,
    kind: "file",
    handle: summary.handle,
    extension,
    path: summary.path,
    isVirtual: true,
    parentPdfPath,
    entryRole: summary.type === "annotation-note"
      ? "pdf-annotations"
      : summary.type === "notebook"
        ? "pdf-notebook"
        : "pdf-note",
    badgeLabel: summary.type === "annotation-note"
      ? "批注"
      : summary.type === "notebook"
        ? "Notebook"
        : "Markdown",
  };
}

async function attachPdfItemChildren(
  rootHandle: FileSystemDirectoryHandle,
  node: FileNode,
): Promise<FileNode> {
  if (node.extension !== "pdf" || node.isVirtual) {
    return node;
  }

  try {
    const manifest = await loadPdfItemManifest(rootHandle, generateFileId(node.path), node.path);
    const notes = await listPdfItemNotes(rootHandle, manifest);
    const children = notes
      .map((summary) => buildPdfVirtualChildNode(summary, node.path))
      .filter((child): child is FileNode => child !== null);

    if (children.length === 0) {
      return {
        ...node,
        children: [],
        isExpanded: false,
      };
    }

    return {
      ...node,
      children,
      isExpanded: node.isExpanded ?? false,
    };
  } catch {
    return {
      ...node,
      children: [],
      isExpanded: false,
    };
  }
}

/**
 * Recursively read a directory and build a tree structure
 * Filters files by allowed extensions and excludes ignored directories
 * Depth-limited to prevent freezing on deeply nested directory trees
 */
const MAX_TREE_DEPTH = 12;

async function readDirectoryRecursive(
  handle: FileSystemDirectoryHandle,
  parentPath: string = "",
  rootHandle: FileSystemDirectoryHandle = handle,
  depth: number = 0,
): Promise<TreeNode[]> {
  if (depth > MAX_TREE_DEPTH) {
    return [];
  }

  const children: TreeNode[] = [];
  const currentPath = parentPath ? `${parentPath}/${handle.name}` : handle.name;

  for await (const entry of handle.values()) {
    if (entry.kind === "directory") {
      // Skip ignored directories
      if (isIgnoredDirectory(entry.name) || isPdfCompanionDirectoryName(entry.name)) {
        continue;
      }

      const dirHandle = entry as FileSystemDirectoryHandle;
      const dirChildren = await readDirectoryRecursive(dirHandle, currentPath, rootHandle, depth + 1);

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
          children: [],
          isExpanded: false,
        };
        children.push(fileNode);
      }
    }
  }

  const projectedChildren = await Promise.all(children.map(async (child) => {
    if (child.kind === "file") {
      return attachPdfItemChildren(rootHandle, child);
    }
    return child;
  }));

  // Sort: directories first, then files, alphabetically
  return projectedChildren.sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === "directory" ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}

function collectExpandedDirectoryPaths(node: DirectoryNode | null): Set<string> {
  const expandedPaths = new Set<string>();

  const visit = (current: TreeNode) => {
    if (current.kind === "file") {
      if (current.children?.length && current.isExpanded) {
        expandedPaths.add(current.path);
      }
      return;
    }

    if (current.isExpanded) {
      expandedPaths.add(current.path);
    }

    current.children.forEach(visit);
  };

  if (node) {
    visit(node);
  }

  return expandedPaths;
}

function applyExpandedState(children: TreeNode[], expandedPaths: Set<string>): TreeNode[] {
  return children.map((child) => {
    if (child.kind === "file") {
      return child.children?.length
        ? {
            ...child,
            isExpanded: expandedPaths.has(child.path),
          }
        : child;
    }

    return {
      ...child,
      isExpanded: expandedPaths.has(child.path),
      children: applyExpandedState(child.children, expandedPaths),
    };
  });
}

function normalizeWorkspacePathInput(path: string | null | undefined): string | null {
  if (typeof path !== "string") {
    return null;
  }

  const trimmed = path.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.replace(/\\/g, "/").replace(/\/+$/, "");
}

export async function applyWorkspaceHandleToStores(
  handle: FileSystemDirectoryHandle,
  workspaceRootPath: string | null,
  preferredWorkspaceKey?: string | null,
): Promise<void> {
  useContentCacheStore.getState().clearCache();

  const workspaceStore = useWorkspaceStore.getState();
  workspaceStore.resetWorkbenchState();
  const resolvedWorkspaceIdentity = await resolveWorkspaceIdentity(handle, {
    hostKind: isTauri() ? "desktop" : "web",
    displayPath: workspaceRootPath ?? handle.name,
    workspaceKey: preferredWorkspaceKey ?? null,
  });

  try {
    await migrateLegacyPdfItemWorkspaces(handle);
  } catch (error) {
    console.warn("Failed to migrate legacy PDF item workspaces:", error);
  }

  const children = await readDirectoryRecursive(handle);
  const rootNode: DirectoryNode = {
    name: handle.name,
    kind: "directory",
    handle,
    children,
    path: handle.name,
    isExpanded: true,
  };

  workspaceStore.setRootHandle(handle);
  workspaceStore.setWorkspaceIdentity(resolvedWorkspaceIdentity);
  workspaceStore.setWorkspaceRootPath(resolvedWorkspaceIdentity.displayPath ?? workspaceRootPath ?? handle.name);
  workspaceStore.setFileTree({ root: rootNode });

  await useSettingsStore.getState().rememberWorkspace({
    workspaceKey: resolvedWorkspaceIdentity.workspaceKey,
    displayPath: resolvedWorkspaceIdentity.displayPath ?? workspaceRootPath ?? handle.name,
  });
}

/**
 * Custom hook for File System Access API operations
 * Provides functionality to open directories, create/delete files, and build file trees
 */
export function useFileSystem(): UseFileSystemReturn {
  const {
    rootHandle,
    workspaceRootPath,
    fileTree,
    isLoading,
    error,
    setFileTree,
    setLoading,
    setError,
  } = useWorkspaceStore();
  const removeRecentWorkspacePath = useSettingsStore((state) => state.removeRecentWorkspacePath);
  const lastWorkspacePath = useSettingsStore((state) => state.settings.lastWorkspacePath);
  const defaultFolder = useSettingsStore((state) => state.settings.defaultFolder);

  // Use state with useEffect to avoid hydration mismatch
  // Server always renders false, client updates after mount
  const [isSupported, setIsSupported] = useState(false);
  const [isCheckingSupport, setIsCheckingSupport] = useState(true);

  useEffect(() => {
    setIsSupported("showDirectoryPicker" in window || isTauriHost());
    setIsCheckingSupport(false);
  }, []);

  const applyWorkspaceHandle = useCallback(async (
    handle: FileSystemDirectoryHandle,
    nextWorkspaceRootPath: string | null,
  ) => {
    await applyWorkspaceHandleToStores(handle, nextWorkspaceRootPath);
  }, []);

  const openWorkspaceFromDesktopPath = useCallback(async (
    path: string,
    options: { validateExists?: boolean } = {},
  ) => {
    const normalizedPath = normalizeWorkspacePathInput(path);
    if (!normalizedPath) {
      setError("Workspace path is empty.");
      return false;
    }

    if (!isTauri()) {
      setError("Recent workspace reopening is only available in the desktop app.");
      return false;
    }

    try {
      setLoading(true);
      setError(null);

      if (options.validateExists !== false) {
        const exists = await isExistingDesktopDirectory(normalizedPath);
        if (!exists) {
          await removeRecentWorkspacePath(normalizedPath);
          setError(`Workspace path no longer exists: ${normalizedPath}`);
          return false;
        }
      }

      const handle = createDesktopDirectoryHandle(normalizedPath);
      await applyWorkspaceHandle(handle, normalizedPath);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to open workspace";
      setError(message);
      return false;
    } finally {
      setLoading(false);
    }
  }, [applyWorkspaceHandle, removeRecentWorkspacePath, setError, setLoading]);

  /**
   * Refresh the file tree from the current root handle
   */
  const refreshDirectory = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!rootHandle) return;

    try {
      if (!options.silent) {
        setLoading(true);
      }
      
      // Rebuild the file tree
      const children = await readDirectoryRecursive(rootHandle);
      const expandedPaths = collectExpandedDirectoryPaths(fileTree.root);
      const preservedChildren = applyExpandedState(children, expandedPaths);

      const rootNode: DirectoryNode = {
        name: rootHandle.name,
        kind: "directory",
        handle: rootHandle,
        children: preservedChildren,
        path: rootHandle.name,
        isExpanded: true,
      };

      setFileTree({ root: rootNode });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to refresh directory";
      setError(message);
    } finally {
      if (!options.silent) {
        setLoading(false);
      }
    }
  }, [rootHandle, fileTree.root, setFileTree, setLoading, setError]);

  /**
   * Open a directory using the File System Access API
   */
  const openDirectory = useCallback(async () => {
    if (!isSupported) {
      setError("This environment does not support opening local folders.");
      return;
    }

    try {
      setLoading(true);
      setError(null);

      if (isTauri()) {
        const selected = await openDesktopDirectoryDialog({
          title: "Open Folder",
          defaultPath: workspaceRootPath ?? lastWorkspacePath ?? defaultFolder,
        });
        if (!selected) {
          return;
        }

        await openWorkspaceFromDesktopPath(selected, { validateExists: false });
        return;
      }

      const handle = await window.showDirectoryPicker({
        mode: "readwrite",
      });

      await applyWorkspaceHandle(handle, handle.name);
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
  }, [applyWorkspaceHandle, defaultFolder, isSupported, lastWorkspacePath, openWorkspaceFromDesktopPath, setLoading, setError, workspaceRootPath]);

  const openWorkspacePath = useCallback(async (path: string) => {
    await openWorkspaceFromDesktopPath(path);
  }, [openWorkspaceFromDesktopPath]);

  const openDirectoryAsWorkspace = useCallback(async (path: string) => {
    if (!rootHandle) {
      return;
    }

    const directoryHandle = await resolveDirectoryHandle(rootHandle, path);
    if (!directoryHandle) {
      setError(`Could not find directory: ${path}`);
      return;
    }

    const normalizedPath = normalizeWorkspacePathInput(path);
    const normalizedRootPath = normalizeWorkspacePathInput(workspaceRootPath ?? rootHandle.name);
    const rootName = normalizeWorkspacePathInput(rootHandle.name);
    const displayPath = (
      normalizedPath &&
      normalizedRootPath &&
      rootName &&
      (normalizedPath === rootName || normalizedPath.startsWith(`${rootName}/`))
    )
      ? `${normalizedRootPath}${normalizedPath === rootName ? "" : `/${normalizedPath.slice(rootName.length + 1)}`}`
      : normalizedPath ?? directoryHandle.name;

    try {
      setLoading(true);
      setError(null);
      await applyWorkspaceHandle(directoryHandle, displayPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open nested workspace");
    } finally {
      setLoading(false);
    }
  }, [applyWorkspaceHandle, rootHandle, setError, setLoading, workspaceRootPath]);

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

      await applyWorkspaceHandle(workspaceHandle, workspaceHandle.name);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to open QA workspace";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [applyWorkspaceHandle, setLoading, setError]);

  /**
   * Create a new file in the workspace
   *
   * @param name - Desired filename (without extension)
   * @param type - Type of file ('note' for .md, 'notebook' for .ipynb, 'file' for any extension)
   * @param parentPath - Optional parent directory path (defaults to root)
   * @returns FileOperationResult with the created file handle
   */
  const createFile = useCallback(async (
    name: string,
    type: FileType | 'file',
    parentPath?: string
  ): Promise<FileOperationResult> => {
    if (!rootHandle) {
      return {
        success: false,
        error: "No directory is open. Please open a folder first.",
      };
    }

    let targetDir = rootHandle;

    // If parentPath is provided, navigate to that directory
    if (parentPath) {
      const parts = parentPath.split('/');
      // Skip the root name (first part)
      for (let i = 1; i < parts.length; i++) {
        try {
          targetDir = await targetDir.getDirectoryHandle(parts[i]);
        } catch {
          return {
            success: false,
            error: `Could not find directory: ${parentPath}`,
          };
        }
      }
    }

    // Handle generic file type
    if (type === 'file') {
      try {
        const sanitizedName = sanitizeFileName(name);
        if (!sanitizedName) {
          return {
            success: false,
            error: "Invalid file name",
          };
        }

        const dotIndex = sanitizedName.lastIndexOf(".");
        const baseName = dotIndex > 0 ? sanitizedName.slice(0, dotIndex) : sanitizedName;
        const extension = dotIndex > 0 ? sanitizedName.slice(dotIndex) : "";
        const uniqueName = await generateUniqueName(targetDir, baseName || "untitled", extension);
        const fileHandle = await targetDir.getFileHandle(uniqueName, { create: true });

        // Write empty content
        const writable = await fileHandle.createWritable();
        await writable.write('');
        await writable.close();

        // Build the path
        const pathParts = parentPath ? parentPath.split('/') : [rootHandle.name];
        const fullPath = [...pathParts, uniqueName].join('/');

        const result = {
          success: true,
          handle: fileHandle,
          path: fullPath,
        };

        // Refresh the file tree to show the new file
        await refreshDirectory({ silent: true });
        if (result.path) {
          emitVaultChange(result.path);
        }

        return result;
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Failed to create file',
        };
      }
    }

    const result = await createFileUtil(targetDir, name, type);

    if (result.success) {
      const createdName = result.handle?.name || result.path?.split("/").pop() || "";
      const fullPath = joinPath(parentPath || rootHandle.name, createdName);
      // Refresh the file tree to show the new file
      await refreshDirectory({ silent: true });
      if (fullPath) {
        emitVaultChange(fullPath);
      }
      result.path = fullPath;
    }

    return result;
  }, [rootHandle, refreshDirectory]);

  /**
   * Create a new directory in the workspace
   *
   * @param name - Desired directory name
   * @param parentPath - Optional parent directory path (defaults to root)
   * @returns DirectoryOperationResult with the created directory handle
   */
  const createDirectory = useCallback(async (
    name: string,
    parentPath?: string
  ): Promise<DirectoryOperationResult> => {
    if (!rootHandle) {
      return {
        success: false,
        error: "No directory is open. Please open a folder first.",
      };
    }

    let targetDir = rootHandle;

    // If parentPath is provided, navigate to that directory
    if (parentPath) {
      const parts = parentPath.split('/');
      // Skip the root name (first part)
      for (let i = 1; i < parts.length; i++) {
        try {
          targetDir = await targetDir.getDirectoryHandle(parts[i]);
        } catch {
          return {
            success: false,
            error: `Could not find directory: ${parentPath}`,
          };
        }
      }
    }

    const result = await createDirectoryUtil(targetDir, name);

    if (result.success) {
      // Refresh the file tree to show the new directory
      await refreshDirectory({ silent: true });
      const createdName = result.handle?.name || result.path?.split("/").pop() || "";
      result.path = joinPath(parentPath || rootHandle.name, createdName);
    }

    return result;
  }, [rootHandle, refreshDirectory]);

  /**
   * Delete a file from the workspace
   * 
   * @param path - Full path to the file to delete
   * @returns FileOperationResult indicating success or failure
   */
  const deleteFile = useCallback(async (path: string): Promise<EntryOperationResult> => {
    if (!rootHandle) {
      return {
        success: false,
        error: "No directory is open.",
      };
    }

    const resolvedEntry = await resolveEntry(rootHandle, path);
    if (!resolvedEntry) {
      return {
        success: false,
        error: "Could not find entry.",
      };
    }

    const result =
      resolvedEntry.kind === "file"
        ? await deleteFileUtil(resolvedEntry.parentHandle, resolvedEntry.name)
        : await deleteEntryUtil(resolvedEntry.parentHandle, resolvedEntry.name, resolvedEntry.kind);
    
    if (result.success) {
      if (resolvedEntry.kind === "file") {
        try {
          await deleteAnnotationSidecarsForPath(rootHandle, path);
        } catch (annotationCleanupError) {
          console.error("Failed to delete annotation sidecar:", annotationCleanupError);
        }
      }
      if (resolvedEntry.kind === "file" && isPdfPath(path)) {
        try {
          await deletePdfItemWorkspace(rootHandle, path);
        } catch (cleanupError) {
          console.error("Failed to delete PDF companion workspace:", cleanupError);
        }
      }
      // Refresh the file tree to reflect the deletion
      await refreshDirectory({ silent: true });
      emitVaultDelete(path);
    }

    return { ...result, kind: resolvedEntry.kind, path };
  }, [rootHandle, refreshDirectory]);

  /**
   * Rename a file in the workspace
   * 
   * @param path - Full path to the file to rename
   * @param newName - New name for the file (with extension)
   * @returns FileOperationResult indicating success or failure
   */
  const renameFile = useCallback(async (path: string, newName: string): Promise<EntryOperationResult> => {
    if (!rootHandle) {
      return {
        success: false,
        error: "No directory is open.",
      };
    }

    const resolvedEntry = await resolveEntry(rootHandle, path);
    if (!resolvedEntry) {
      return {
        success: false,
        error: "Could not find entry.",
      };
    }

    const result =
      resolvedEntry.kind === "file"
        ? await renameFileUtil(resolvedEntry.parentHandle, resolvedEntry.name, newName)
        : await renameEntryUtil(resolvedEntry.parentHandle, resolvedEntry.name, newName, resolvedEntry.kind);
    
    if (result.success) {
      const renamedName = result.handle?.name || result.path?.split("/").pop() || newName;
      const fullPath = joinPath(getParentPath(path), renamedName);
      if (resolvedEntry.kind === "file" && fullPath) {
        try {
          await moveAnnotationSidecar(rootHandle, path, fullPath, detectFileType(fullPath));
        } catch (annotationMoveError) {
          console.error("Failed to rename annotation sidecar:", annotationMoveError);
        }
      }
      if (resolvedEntry.kind === "file" && isPdfPath(path) && fullPath) {
        try {
          await movePdfItemWorkspace(rootHandle, path, fullPath);
        } catch (companionError) {
          console.error("Failed to rename PDF companion workspace:", companionError);
        }
      }
      // Refresh the file tree to reflect the rename
      await refreshDirectory({ silent: true });
      if (fullPath) {
        emitVaultRename(path, fullPath);
      }
      result.path = fullPath;
    }

    return { ...result, kind: resolvedEntry.kind };
  }, [rootHandle, refreshDirectory]);

  const copyEntry = useCallback(async (
    sourcePath: string,
    targetDirectoryPath: string
  ): Promise<EntryOperationResult> => {
    if (!rootHandle) {
      return {
        success: false,
        error: "No directory is open.",
      };
    }

    const resolvedEntry = await resolveEntry(rootHandle, sourcePath);
    const targetDirectory = await resolveDirectoryHandle(rootHandle, targetDirectoryPath);
    if (!resolvedEntry || !targetDirectory) {
      return {
        success: false,
        error: "Could not resolve source or target path.",
      };
    }

    if (
      resolvedEntry.kind === "directory" &&
      (targetDirectoryPath === sourcePath || targetDirectoryPath.startsWith(`${sourcePath}/`))
    ) {
      return {
        success: false,
        error: "Cannot copy a folder into itself.",
      };
    }

    const result = await copyEntryToDirectory(resolvedEntry.handle, targetDirectory);
    if (result.success) {
      const copiedName = result.handle?.name || result.path?.split("/").pop() || resolvedEntry.name;
      const fullPath = joinPath(targetDirectoryPath, copiedName);
      if (resolvedEntry.kind === "file") {
        try {
          await copyAnnotationSidecar(rootHandle, sourcePath, fullPath, detectFileType(fullPath));
        } catch (annotationCopyError) {
          console.error("Failed to copy annotation sidecar:", annotationCopyError);
        }
      }
      if (resolvedEntry.kind === "file" && isPdfPath(sourcePath)) {
        try {
          await copyPdfItemWorkspace(rootHandle, sourcePath, fullPath);
        } catch (companionError) {
          console.error("Failed to copy PDF companion workspace:", companionError);
        }
      }
      await refreshDirectory({ silent: true });
      emitVaultChange(fullPath);
      result.path = fullPath;
      result.kind = resolvedEntry.kind;
    }

    return result;
  }, [rootHandle, refreshDirectory]);

  const moveEntry = useCallback(async (
    sourcePath: string,
    targetDirectoryPath: string
  ): Promise<EntryOperationResult> => {
    if (!rootHandle) {
      return {
        success: false,
        error: "No directory is open.",
      };
    }

    const resolvedEntry = await resolveEntry(rootHandle, sourcePath);
    const targetDirectory = await resolveDirectoryHandle(rootHandle, targetDirectoryPath);
    if (!resolvedEntry || !targetDirectory) {
      return {
        success: false,
        error: "Could not resolve source or target path.",
      };
    }

    if (getParentPath(sourcePath) === targetDirectoryPath) {
      return {
        success: true,
        handle: resolvedEntry.handle,
        path: sourcePath,
        kind: resolvedEntry.kind,
      };
    }

    if (
      resolvedEntry.kind === "directory" &&
      (targetDirectoryPath === sourcePath || targetDirectoryPath.startsWith(`${sourcePath}/`))
    ) {
      return {
        success: false,
        error: "Cannot move a folder into itself.",
      };
    }

    const result = await moveEntryToDirectory(
      resolvedEntry.parentHandle,
      resolvedEntry.handle,
      targetDirectory
    );

    if (result.success) {
      const movedName = result.handle?.name || result.path?.split("/").pop() || resolvedEntry.name;
      const fullPath = joinPath(targetDirectoryPath, movedName);
      if (resolvedEntry.kind === "file") {
        try {
          await moveAnnotationSidecar(rootHandle, sourcePath, fullPath, detectFileType(fullPath));
        } catch (annotationMoveError) {
          console.error("Failed to move annotation sidecar:", annotationMoveError);
        }
      }
      if (resolvedEntry.kind === "file" && isPdfPath(sourcePath)) {
        try {
          await movePdfItemWorkspace(rootHandle, sourcePath, fullPath);
        } catch (companionError) {
          console.error("Failed to move PDF companion workspace:", companionError);
        }
      }
      await refreshDirectory({ silent: true });
      emitVaultRename(sourcePath, fullPath);
      result.path = fullPath;
      result.kind = resolvedEntry.kind;
    }

    return result;
  }, [rootHandle, refreshDirectory]);

  return {
    isSupported,
    isCheckingSupport,
    isLoading,
    error,
    openDirectory,
    openWorkspacePath,
    openDirectoryAsWorkspace,
    openQaWorkspace,
    createFile,
    createDirectory,
    deleteFile,
    renameFile,
    copyEntry,
    moveEntry,
    refreshDirectory,
    fileTree,
    rootHandle,
  };
}

// Export the recursive reader for testing
export { readDirectoryRecursive };

// Re-export types
export type { FileType, FileOperationResult, DirectoryOperationResult };
