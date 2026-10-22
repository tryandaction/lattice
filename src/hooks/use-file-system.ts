"use client";

import { startTransition, useCallback, useState, useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useContentCacheStore } from "@/stores/content-cache-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useExplorerStore } from "@/stores/explorer-store";
import { useI18n } from "@/hooks/use-i18n";
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
  loadAnnotationsFromDisk,
  moveAnnotationSidecar,
} from "@/lib/universal-annotation-storage";
import {
  copyPdfItemWorkspace,
  deletePdfItemWorkspace,
  ensurePdfItemWorkspace,
  getDefaultPdfItemFolderPath,
  getPdfItemManifestIndex,
  invalidatePdfItemManifestIndex,
  listPdfItemNotes,
  syncPdfAnnotationsMarkdown,
  loadPdfItemManifest,
  migrateLegacyPdfItemWorkspaces,
  movePdfItemWorkspace,
  getPdfFileName,
} from "@/lib/pdf-item";
import { createDesktopDirectoryHandle, createDesktopFileHandle, getDesktopHandlePath } from "@/lib/desktop-file-system";
import { setDesktopPreviewRoot } from "@/lib/desktop-preview";
import { isTauri, isTauriHost } from "@/lib/storage-adapter";
import { isExistingDesktopDirectory, openDesktopDirectoryDialog } from "@/lib/desktop-folder";
import { emitVaultChange, emitVaultDelete, emitVaultRename } from "@/lib/plugins/runtime";
import {
  getWorkspaceMarkdownRenameLinkUpdates,
  removeWorkspaceMarkdownFile,
  renameWorkspaceMarkdownFile,
  upsertWorkspaceMarkdownFile,
} from "@/lib/markdown/workspace-link-index";
import { loadWorkspaceHandleRegistration, resolveWorkspaceIdentity } from "@/lib/workspace-identity";
import { withTimeout } from "@/lib/async-task-guard";
import { buildFileFingerprint } from "@/lib/file-identity";
import {
  registerPdfItemLocationForRoot,
  resolvePdfItemLocation,
  resolvePdfItemLocationRoot,
} from "@/lib/pdf-item-location-registry";
import { useVSCodeCompatStore } from "@/stores/vscode-compat-store";
import { isExcludedByPatterns } from "@/lib/vscode-compat/glob";
import { isVSCodeCompatEnabled } from "@/lib/vscode-compat/enabled";
import { loadWorkspaceUiState } from "@/lib/workspace-ui-state";
import { reconcileVisibleDirectory } from "@/lib/workspace-live-sync";
import {
  copyTreeNode,
  insertTreeNode,
  relocateTreeNode,
  removeTreeNode,
} from "@/lib/file-tree-operations";
import {
  markWorkspaceStartup,
  resetWorkspaceStartupPerformance,
} from "@/lib/workspace-startup-performance";

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
  moveEntryIntoPdfItemWorkspace: (sourcePath: string, pdfPath: string) => Promise<EntryOperationResult>;
  hydratePdfVirtualChildren: (pdfPath: string, options?: { force?: boolean; expand?: boolean }) => Promise<void>;
  ensureDirectoryExpanded: (path: string) => Promise<void>;
  refreshDirectory: (options?: { silent?: boolean; visibleOnly?: boolean; changedPaths?: string[] }) => Promise<void>;

  // Derived
  fileTree: FileTree;
  rootHandle: FileSystemDirectoryHandle | null;
}

export interface UseFileSystemOptions {
  /** Action-only tree consumers should avoid subscribing to the full tree. */
  subscribeToTree?: boolean;
}

const EMPTY_FILE_TREE: FileTree = { root: null };

const QA_WORKSPACE_NAME = "lattice-qa-workspace";

function isMarkdownFilePath(path: string): boolean {
  const extension = getExtension(path);
  return extension === "md" || extension === "markdown";
}

function shouldHidePathFromExplorer(path: string): boolean {
  if (!isVSCodeCompatEnabled()) {
    return false;
  }
  const compat = useVSCodeCompatStore.getState();
  return isExcludedByPatterns(path, compat.settings.filesExclude);
}

async function upsertMarkdownIndexFromHandle(path: string, handle: FileSystemHandle | undefined): Promise<void> {
  if (!isMarkdownFilePath(path) || !handle || handle.kind !== "file") {
    return;
  }

  try {
    const content = await (await (handle as FileSystemFileHandle).getFile()).text();
    upsertWorkspaceMarkdownFile(path, content);
  } catch {
    // Index refresh is best-effort; file operation success should not be rolled back.
  }
}

async function writeMarkdownFileContent(rootHandle: FileSystemDirectoryHandle, path: string, content: string): Promise<void> {
  const resolvedEntry = await resolveEntry(rootHandle, path);
  if (!resolvedEntry || resolvedEntry.kind !== "file") {
    throw new Error(`Could not find Markdown file: ${path}`);
  }
  const writable = await (resolvedEntry.handle as FileSystemFileHandle).createWritable();
  await writable.write(content);
  await writable.close();
}

async function confirmAndWriteMarkdownRenameLinkUpdates(
  rootHandle: FileSystemDirectoryHandle,
  oldPath: string,
  newPath: string,
  confirmMessage: (count: number) => string,
): Promise<boolean> {
  if (!isMarkdownFilePath(oldPath) && !isMarkdownFilePath(newPath)) {
    return false;
  }

  const updates = getWorkspaceMarkdownRenameLinkUpdates(oldPath, newPath);
  if (updates.length === 0) {
    return false;
  }

  if (typeof window !== "undefined" && !window.confirm(confirmMessage(updates.length))) {
    return false;
  }

  let wroteAnyUpdate = false;
  for (const update of updates) {
    try {
      await writeMarkdownFileContent(rootHandle, update.sourceFile, update.content);
      upsertWorkspaceMarkdownFile(update.sourceFile, update.content);
      emitVaultChange(update.sourceFile);
      wroteAnyUpdate = true;
    } catch (error) {
      console.error("Failed to update Markdown links after rename:", update.sourceFile, error);
    }
  }
  return wroteAnyUpdate;
}

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

let refreshInFlightPromise: Promise<void> | null = null;
let refreshQueuedOptions: { silent: boolean; visibleOnly?: boolean; changedPaths?: string[]; rootHandle: FileSystemDirectoryHandle } | null = null;
let workspaceOpenGeneration = 0;
const directoryLoads = new WeakMap<FileSystemDirectoryHandle, Map<string, Promise<void>>>();
const pdfHydrationGeneration = new Map<string, number>();
const pdfAnnotationMarkdownSyncInFlight = new Map<string, Promise<void>>();

function scheduleIdleTask(task: () => void, timeout = 1500): void {
  if (typeof window !== "undefined") {
    const win = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    };
    if (win.requestIdleCallback) {
      win.requestIdleCallback(task, { timeout });
      return;
    }
    window.setTimeout(task, 0);
    return;
  }
  setTimeout(task, 0);
}

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

function buildVisibleFileNode(handle: FileSystemFileHandle, path: string): FileNode | null {
  const extension = getExtension(handle.name);
  if (!isAllowedExtension(extension) || shouldHidePathFromExplorer(path)) {
    return null;
  }

  return {
    name: handle.name,
    kind: "file",
    handle,
    extension,
    path,
    ...(extension === "pdf"
      ? {
          canExpandVirtualChildren: true,
          virtualChildrenState: "idle" as const,
          isExpanded: false,
        }
      : {}),
  };
}

function buildVisibleDirectoryNode(handle: FileSystemDirectoryHandle, path: string): DirectoryNode | null {
  if (
    isIgnoredDirectory(handle.name) ||
    isPdfCompanionDirectoryName(handle.name) ||
    shouldHidePathFromExplorer(path)
  ) {
    return null;
  }

  return {
    name: handle.name,
    kind: "directory",
    handle,
    children: [],
    path,
    isExpanded: false,
    childrenState: "idle",
  };
}

type PdfItemSummary = Awaited<ReturnType<typeof listPdfItemNotes>>[number];

function buildPdfVirtualFileNode(summary: PdfItemSummary, parentPdfPath: string): FileNode | null {
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

function buildPdfVirtualChildNodes(summaries: PdfItemSummary[], parentPdfPath: string): TreeNode[] {
  const roots: TreeNode[] = [];
  const directoriesByPath = new Map<string, DirectoryNode>();

  for (const summary of summaries) {
    const parentPath = getParentPath(summary.path);
    const targetChildren = directoriesByPath.get(parentPath)?.children ?? roots;

    if (summary.type === "directory") {
      if (!summary.directoryHandle) {
        continue;
      }

      const directoryNode: DirectoryNode = {
        name: summary.fileName,
        kind: "directory",
        handle: summary.directoryHandle,
        children: [],
        path: summary.path,
        isExpanded: false,
      };
      directoriesByPath.set(summary.path, directoryNode);
      targetChildren.push(directoryNode);
      continue;
    }

    const fileNode = buildPdfVirtualFileNode(summary, parentPdfPath);
    if (fileNode) {
      targetChildren.push(fileNode);
    }
  }

  return roots;
}

function buildFallbackPdfAnnotationChild(
  rootHandle: FileSystemDirectoryHandle,
  pdfPath: string,
  annotationPath: string,
): FileNode | null {
  const rootDesktopPath = getDesktopHandlePath(rootHandle);
  if (!rootDesktopPath) {
    return null;
  }

  const normalizedPath = annotationPath.replace(/\\/g, "/").replace(/^\/+/, "");
  const relativePath = normalizedPath.startsWith(`${rootHandle.name}/`)
    ? normalizedPath.slice(rootHandle.name.length + 1)
    : normalizedPath;
  const absolutePath = `${rootDesktopPath.replace(/\\/g, "/").replace(/\/+$/, "")}/${relativePath}`;
  return {
    name: "_annotations.md",
    displayName: "_annotations.md",
    kind: "file",
    handle: createDesktopFileHandle(absolutePath),
    extension: "md",
    path: normalizedPath,
    isVirtual: true,
    parentPdfPath: pdfPath,
    entryRole: "pdf-annotations",
    badgeLabel: "批注",
  };
}

function isHydratablePdfNode(node: FileNode): boolean {
  return node.extension === "pdf" && !node.isVirtual;
}

/**
 * Get the handle for .lattice access. When viewing a subdirectory workspace,
 * we still want to read/write .lattice from the original workspace root.
 * Uses workspaceRootHistory to find ancestor workspace roots.
 */
function getLatticeRootHandle(): FileSystemDirectoryHandle | null {
  const state = useWorkspaceStore.getState();
  // First try workspaceRootHandle
  if (state.workspaceRootHandle) {
    return state.workspaceRootHandle;
  }
  // Fall back to rootHandle
  return state.rootHandle;
}

export function resolvePathFromLatticeRoot(path: string): string {
  const state = useWorkspaceStore.getState();
  const normalizedPath = normalizeWorkspacePathInput(path) ?? path;
  const latticeRootHandle = state.workspaceRootHandle;
  const activeRootHandle = state.rootHandle;
  if (!latticeRootHandle || !activeRootHandle || latticeRootHandle === activeRootHandle) {
    return normalizedPath;
  }

  const latticeRootName = normalizeWorkspacePathInput(latticeRootHandle.name);
  const activeRootName = normalizeWorkspacePathInput(activeRootHandle.name);
  if (!latticeRootName || !activeRootName || normalizedPath.startsWith(`${latticeRootName}/`)) {
    return normalizedPath;
  }

  const latticeRootDisplayPath = Array.from(state.workspaceRootHistory.entries())
    .find(([, handle]) => handle === latticeRootHandle)?.[0] ?? latticeRootName;
  const normalizedLatticeRootPath = normalizeWorkspacePathInput(latticeRootDisplayPath);
  const normalizedActiveRootPath = normalizeWorkspacePathInput(state.workspaceRootPath);
  if (!normalizedLatticeRootPath || !normalizedActiveRootPath) {
    return normalizedPath;
  }

  const rootPrefix = `${normalizedLatticeRootPath}/`;
  if (!normalizedActiveRootPath.startsWith(rootPrefix)) {
    return normalizedPath;
  }

  const activePathWithinRoot = normalizedActiveRootPath.slice(rootPrefix.length);
  const pathWithinActiveRoot = normalizedPath === activeRootName
    ? ""
    : normalizedPath.startsWith(`${activeRootName}/`)
      ? normalizedPath.slice(activeRootName.length + 1)
      : normalizedPath;
  const activeRootPath = joinPath(latticeRootName, activePathWithinRoot);
  return pathWithinActiveRoot ? joinPath(activeRootPath, pathWithinActiveRoot) : activeRootPath;
}

function collectFileExpansionState(node: TreeNode | null, expanded: Set<string> = new Set()): Set<string> {
  if (!node) {
    return expanded;
  }

  if (node.kind === "file") {
    if (node.isExpanded && (node.children?.length || node.canExpandVirtualChildren)) {
      expanded.add(node.path);
    }
    node.children?.forEach((child) => collectFileExpansionState(child, expanded));
    return expanded;
  }

  if (node.isExpanded) {
    expanded.add(node.path);
  }
  node.children.forEach((child) => collectFileExpansionState(child, expanded));
  return expanded;
}

function updateFileNodeByPath(
  node: TreeNode,
  targetPath: string,
  updater: (file: FileNode) => FileNode,
): TreeNode {
  if (node.kind === "file") {
    if (node.path === targetPath) {
      return updater(node);
    }
    if (node.children?.length) {
      return {
        ...node,
        children: node.children.map((child) => updateFileNodeByPath(child, targetPath, updater)),
      };
    }
    return node;
  }

  return {
    ...node,
    children: node.children.map((child) => updateFileNodeByPath(child, targetPath, updater)),
  };
}

function updateDirectoryNodeByPath(
  node: TreeNode,
  targetPath: string,
  updater: (directory: DirectoryNode) => DirectoryNode,
): TreeNode {
  if (node.kind === "directory") {
    if (node.path === targetPath) {
      return updater(node);
    }
    return {
      ...node,
      children: node.children.map((child) => updateDirectoryNodeByPath(child, targetPath, updater)),
    };
  }

  if (!node.children?.length) {
    return node;
  }
  return {
    ...node,
    children: node.children.map((child) => updateDirectoryNodeByPath(child, targetPath, updater)),
  };
}

function findDirectoryNodeByPath(node: TreeNode | null, targetPath: string): DirectoryNode | null {
  if (!node) {
    return null;
  }
  if (node.kind === "directory") {
    if (node.path === targetPath) {
      return node;
    }
    for (const child of node.children) {
      const match = findDirectoryNodeByPath(child, targetPath);
      if (match) return match;
    }
    return null;
  }
  for (const child of node.children ?? []) {
    const match = findDirectoryNodeByPath(child, targetPath);
    if (match) return match;
  }
  return null;
}

function patchWorkspaceDirectory(
  targetPath: string,
  updater: (directory: DirectoryNode) => DirectoryNode,
): void {
  useWorkspaceStore.setState((state) => {
    if (!state.fileTree.root) {
      return state;
    }
    return {
      fileTree: {
        root: updateDirectoryNodeByPath(state.fileTree.root, targetPath, updater) as DirectoryNode,
      },
    };
  });
}

function patchWorkspaceFileTree(
  targetPath: string,
  updater: (file: FileNode) => FileNode,
): void {
  useWorkspaceStore.setState((state) => {
    if (!state.fileTree.root) {
      return state;
    }

    return {
      fileTree: {
        root: updateFileNodeByPath(state.fileTree.root, targetPath, updater) as DirectoryNode,
      },
    };
  });
}

function findFileNodeByPath(node: TreeNode | null, targetPath: string): FileNode | null {
  if (!node) {
    return null;
  }

  if (node.kind === "file") {
    if (node.path === targetPath) {
      return node;
    }
    for (const child of node.children ?? []) {
      const match = findFileNodeByPath(child, targetPath);
      if (match) {
        return match;
      }
    }
    return null;
  }

  for (const child of node.children) {
    const match = findFileNodeByPath(child, targetPath);
    if (match) {
      return match;
    }
  }

  return null;
}

async function loadPdfVirtualChildren(
  rootHandle: FileSystemDirectoryHandle,
  pdfPath: string,
  parentPdfPath: string = pdfPath,
  fileHandle?: FileSystemFileHandle | null,
): Promise<{
  manifest: Awaited<ReturnType<typeof loadPdfItemManifest>>;
  children: TreeNode[];
  itemRootHandle: FileSystemDirectoryHandle;
  itemLocationUnavailable: boolean;
}> {
  const fallbackManifest = {
    version: 4 as const,
    itemId: generateFileId(pdfPath),
    pdfPath,
    itemFolderPath: getDefaultPdfItemFolderPath(pdfPath),
    annotationIndexPath: `${getDefaultPdfItemFolderPath(pdfPath)}/_annotations.md`,
    fileFingerprint: null,
    versionFingerprint: null,
    knownPdfPaths: [pdfPath],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  let usedFallbackManifest = false;
  let notesListFailed = false;
  let itemRootHandle = rootHandle;
  let itemLocationUnavailable = false;
  let manifest = await withTimeout(
    loadPdfItemManifest(rootHandle, generateFileId(pdfPath), pdfPath),
    1500,
    "PDF item manifest quick load",
  ).catch(() => {
    usedFallbackManifest = true;
      return fallbackManifest;
    });
  let itemFolder = await resolveDirectoryHandle(itemRootHandle, manifest.itemFolderPath);
  if (!itemFolder && fileHandle) {
    const fingerprint = await buildFileFingerprint(fileHandle);
    const location = await resolvePdfItemLocation({
      fileFingerprint: fingerprint.fingerprint,
    });
    const locatedRoot = location
      ? await resolvePdfItemLocationRoot(location, { requestPermission: true })
      : null;
    itemLocationUnavailable = Boolean(location && !locatedRoot);
    if (location && locatedRoot) {
      const locatedManifest = await loadPdfItemManifest(
        locatedRoot,
        location.documentId,
        location.pdfPath,
        {
          documentId: location.documentId,
          fileFingerprint: fingerprint.fingerprint,
          versionFingerprint: fingerprint.versionFingerprint,
          knownPdfPaths: [location.pdfPath],
        },
      );
      const locatedFolder = await resolveDirectoryHandle(locatedRoot, locatedManifest.itemFolderPath);
      if (locatedFolder) {
        itemRootHandle = locatedRoot;
        manifest = locatedManifest;
        itemFolder = locatedFolder;
        usedFallbackManifest = false;
      }
    }
  }
  if (itemFolder) {
    void registerPdfItemLocationForRoot(itemRootHandle, manifest).catch(() => undefined);
  }
  const notes = await withTimeout(
    listPdfItemNotes(itemRootHandle, manifest),
    1500,
    "PDF item notes quick list",
  ).catch(() => {
    notesListFailed = true;
    return [];
  });
  const children = buildPdfVirtualChildNodes(notes, parentPdfPath);
  if (children.some((child) => child.kind === "file" && child.entryRole === "pdf-annotations")) {
    return { manifest, children, itemRootHandle, itemLocationUnavailable };
  }
  if (notesListFailed || usedFallbackManifest || manifest.annotationIndexPath) {
    const fallbackChild = buildFallbackPdfAnnotationChild(
      itemRootHandle,
      parentPdfPath,
      manifest.annotationIndexPath ?? `${manifest.itemFolderPath}/_annotations.md`,
    );
    if (fallbackChild) {
      children.push(fallbackChild);
    }
  }
  return { manifest, children, itemRootHandle, itemLocationUnavailable };
}

function syncPdfAnnotationMarkdownInBackground(
  rootHandle: FileSystemDirectoryHandle,
  manifest: Awaited<ReturnType<typeof loadPdfItemManifest>>,
  pdfPath: string,
): Promise<void> {
  const syncKey = `${rootHandle.name}:${manifest.itemId}:${manifest.itemFolderPath}`;
  const pending = pdfAnnotationMarkdownSyncInFlight.get(syncKey);
  if (pending) {
    return pending;
  }

  const syncPromise = (async () => {
    const annotationFile = await loadAnnotationsFromDisk(manifest.itemId, rootHandle, "pdf");
    if (!annotationFile.annotations.some((annotation) => annotation.target.type === "pdf")) {
      return;
    }
    await syncPdfAnnotationsMarkdown(
      rootHandle,
      manifest,
      getPdfFileName(pdfPath),
      annotationFile.annotations,
    );
  })().finally(() => {
    pdfAnnotationMarkdownSyncInFlight.delete(syncKey);
  });

  pdfAnnotationMarkdownSyncInFlight.set(syncKey, syncPromise);
  return syncPromise;
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
  _rootHandle: FileSystemDirectoryHandle = handle,
  expandedPaths: Set<string> = new Set(),
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
      if (
        isIgnoredDirectory(entry.name) ||
        isPdfCompanionDirectoryName(entry.name) ||
        shouldHidePathFromExplorer(joinPath(currentPath, entry.name))
      ) {
        continue;
      }

      const dirHandle = entry as FileSystemDirectoryHandle;
      const dirChildren = await readDirectoryRecursive(dirHandle, currentPath, _rootHandle, expandedPaths, depth + 1);

      const dirNode: DirectoryNode = {
        name: entry.name,
        kind: "directory",
        handle: dirHandle,
        children: dirChildren,
        path: `${currentPath}/${entry.name}`,
        isExpanded: false,
      };
      children.push(dirNode);
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
          ...(extension === "pdf"
            ? {
                canExpandVirtualChildren: true,
                virtualChildrenState: "idle" as const,
                isExpanded: expandedPaths.has(`${currentPath}/${entry.name}`),
              }
            : {}),
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
 * Read only the direct children of a directory. This is the startup and
 * on-demand expansion path; the recursive reader above remains available for
 * explicit full refreshes and compatibility tests.
 */
export async function readDirectoryChildren(
  handle: FileSystemDirectoryHandle,
  directoryPath: string = handle.name,
  _rootHandle: FileSystemDirectoryHandle = handle,
  expandedPaths: Set<string> = new Set(),
): Promise<TreeNode[]> {
  const children: TreeNode[] = [];

  for await (const entry of handle.values()) {
    const entryPath = `${directoryPath}/${entry.name}`;
    if (entry.kind === "directory") {
      const directoryNode = buildVisibleDirectoryNode(
        entry as FileSystemDirectoryHandle,
        entryPath,
      );
      if (directoryNode) {
        directoryNode.isExpanded = expandedPaths.has(entryPath);
        children.push(directoryNode);
      }
      continue;
    }

    const fileNode = buildVisibleFileNode(entry as FileSystemFileHandle, entryPath);
    if (fileNode) {
      if (fileNode.extension === "pdf") {
        fileNode.isExpanded = expandedPaths.has(entryPath);
      }
      children.push(fileNode);
    }
  }

  return children.sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === "directory" ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });
}

export function collectExpandedDirectoryPaths(node: DirectoryNode | null): Set<string> {
  return collectFileExpansionState(node);
}

async function restoreExpandedDirectoryChildren(
  children: TreeNode[],
  rootHandle: FileSystemDirectoryHandle,
  expandedPaths: Set<string>,
  depth = 0,
): Promise<TreeNode[]> {
  return Promise.all(children.map(async (child) => {
    if (!expandedPaths.has(child.path)) return child;
    if (child.kind === "file") return child.canExpandVirtualChildren ? { ...child, isExpanded: true } : child;
    if (depth >= MAX_TREE_DEPTH) return child;
    try {
      const nested = await readDirectoryChildren(child.handle, child.path, rootHandle, expandedPaths);
      return { ...child, isExpanded: true, childrenState: "ready" as const,
        children: await restoreExpandedDirectoryChildren(nested, rootHandle, expandedPaths, depth + 1) };
    } catch {
      return { ...child, isExpanded: true, childrenState: "error" as const };
    }
  }));
}

function applyExpandedState(children: TreeNode[], expandedPaths: Set<string>): TreeNode[] {
  return children.map((child) => {
    if (child.kind === "file") {
      if (child.children?.length || child.canExpandVirtualChildren) {
        return {
          ...child,
          isExpanded: expandedPaths.has(child.path),
          ...(child.canExpandVirtualChildren && expandedPaths.has(child.path)
            ? {
                virtualChildrenState: child.virtualChildrenState === "ready"
                  ? child.virtualChildrenState
                  : "idle" as const,
              }
            : {}),
        };
      }
      return child;
    }

    return {
      ...child,
      isExpanded: expandedPaths.has(child.path),
      children: applyExpandedState(child.children, expandedPaths),
    };
  });
}

async function rebuildDirectoryTreeNode(
  handle: FileSystemDirectoryHandle,
  path: string,
  rootHandle: FileSystemDirectoryHandle,
): Promise<DirectoryNode> {
  const currentRoot = useWorkspaceStore.getState().fileTree.root;
  const expandedPaths = collectExpandedDirectoryPaths(currentRoot);
  const children = await readDirectoryRecursive(
    handle,
    getParentPath(path),
    rootHandle,
    expandedPaths,
  );

  return {
    name: handle.name,
    kind: "directory",
    handle,
    children: applyExpandedState(children, expandedPaths),
    path,
    isExpanded: expandedPaths.has(path),
  };
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
  options?: { preserveWorkspaceRoot?: boolean },
): Promise<void> {
  const generation = ++workspaceOpenGeneration;
  resetWorkspaceStartupPerformance();
  markWorkspaceStartup("workspace-open-start");
  // Prepare the new folder while the old editor remains usable. Directory I/O
  // is independent of identity/UI-state storage and need not wait behind it.
  const [[resolvedWorkspaceIdentity, persistedUiState], children] = await Promise.all([
    resolveWorkspaceIdentity(handle, {
      hostKind: isTauri() ? "desktop" : "web",
      displayPath: workspaceRootPath ?? handle.name,
      workspaceKey: preferredWorkspaceKey ?? null,
    }).then(async (identity) => [identity, await loadWorkspaceUiState(
      identity.workspaceKey,
      identity.displayPath ?? workspaceRootPath ?? handle.name,
    )] as const),
    readDirectoryChildren(handle, handle.name, handle),
  ]);
  if (generation !== workspaceOpenGeneration) return;
  const restoredChildren = persistedUiState?.explorer.expandedPaths.length
    ? await restoreExpandedDirectoryChildren(children, handle, new Set(persistedUiState.explorer.expandedPaths))
    : children;
  if (generation !== workspaceOpenGeneration) return;
  const workspaceStore = useWorkspaceStore.getState();
  if (useContentCacheStore.getState().getUnsavedTabs().length > 0) {
    throw new Error("当前有尚未保存的修改，请先保存或关闭这些文件，再切换本地文件夹。");
  }
  useContentCacheStore.getState().clearCache();
  workspaceStore.resetWorkbenchState();
  const rootNode: DirectoryNode = {
    name: handle.name,
    kind: "directory",
    handle,
    children: restoredChildren,
    path: handle.name,
    isExpanded: true,
    childrenState: "ready",
  };

  workspaceStore.setRootHandle(handle);

  // Determine workspace root handle:
  // - If preserveWorkspaceRoot is true and there's an existing workspaceRootHandle,
  //   preserve it (for switching to subdirectory within same workspace)
  // - Otherwise, use the new handle
  if (options?.preserveWorkspaceRoot && workspaceStore.workspaceRootHandle) {
    // Keep the existing workspaceRootHandle
  } else {
    // This is a new workspace root
    workspaceStore.setWorkspaceRootHandle(handle);
    // Register this path for future nested workspace detection
    workspaceStore.registerWorkspaceRoot(
      resolvedWorkspaceIdentity.displayPath ?? workspaceRootPath ?? handle.name,
      handle
    );
  }

  workspaceStore.setWorkspaceIdentity(resolvedWorkspaceIdentity);
  workspaceStore.setWorkspaceRootPath(resolvedWorkspaceIdentity.displayPath ?? workspaceRootPath ?? handle.name);
  startTransition(() => {
    workspaceStore.setFileTree({ root: rootNode });
  });
  markWorkspaceStartup("root-tree-ready");
  if (rootNode.children.some((child) => child.kind === "file")) {
    markWorkspaceStartup("first-file-ready");
  }
  if (persistedUiState?.explorer.selectedPath) {
    useExplorerStore.getState().setSelection(
      persistedUiState.explorer.selectedPath,
      persistedUiState.explorer.selectedKind,
    );
    workspaceStore.setSelectedDirectoryPath(
      persistedUiState.explorer.selectedKind === "directory"
        ? persistedUiState.explorer.selectedPath
        : null,
    );
  } else {
    useExplorerStore.getState().setSelection(null, null);
    workspaceStore.setSelectedDirectoryPath(null);
  }

  await useSettingsStore.getState().rememberWorkspace({
    workspaceKey: resolvedWorkspaceIdentity.workspaceKey,
    displayPath: resolvedWorkspaceIdentity.displayPath ?? workspaceRootPath ?? handle.name,
  });

  scheduleIdleTask(() => {
    void (async () => {
      if (useWorkspaceStore.getState().rootHandle !== handle) {
        return;
      }
      try {
        await migrateLegacyPdfItemWorkspaces(handle);
      } catch (error) {
        console.warn("Failed to migrate legacy PDF item workspaces:", error);
      }

      if (useWorkspaceStore.getState().rootHandle !== handle) {
        return;
      }

      invalidatePdfItemManifestIndex(handle);
      const pdfIndexTask = getPdfItemManifestIndex(handle)
        .then(async (index) => {
          const manifests = Array.from(index.byDocumentId.values());
          await Promise.allSettled(manifests.map((manifest) => registerPdfItemLocationForRoot(
            handle,
            manifest,
            { workspaceKey: resolvedWorkspaceIdentity.workspaceKey },
          )));
        })
        .catch((error) => {
          console.warn("Failed to index PDF item locations:", error);
        });

      const aiIndexTask = import("@/lib/ai/workspace-indexer")
        .then(({ indexWorkspace }) => indexWorkspace(handle))
        .catch((error) => {
          console.warn("Failed to index workspace for AI context:", error);
        });
      const markdownIndexTask = import("@/lib/markdown/workspace-link-index")
        .then(({ scanWorkspaceMarkdownLinkIndex }) => scanWorkspaceMarkdownLinkIndex(handle))
        .catch((error) => {
          console.warn("Failed to index workspace Markdown links:", error);
        });

      await Promise.allSettled([pdfIndexTask, aiIndexTask, markdownIndexTask]);
      if (useWorkspaceStore.getState().rootHandle !== handle) {
        return;
      }

      await setDesktopPreviewRoot(getDesktopHandlePath(handle));
      markWorkspaceStartup("background-index-complete");
    })().catch((error) => {
      console.warn("Failed to complete background workspace preparation:", error);
    });
  });
}

/**
 * Custom hook for File System Access API operations
 * Provides functionality to open directories, create/delete files, and build file trees
 */
export function useFileSystem(options: UseFileSystemOptions = {}): UseFileSystemReturn {
  const subscribeToTree = options.subscribeToTree !== false;
  const {
    rootHandle,
    workspaceRootPath,
    fileTree,
    isLoading,
    error,
    setFileTree,
    updateFileTree,
    setLoading,
    setError,
  } = useWorkspaceStore(useShallow((state) => ({
    rootHandle: state.rootHandle,
    workspaceRootPath: state.workspaceRootPath,
    fileTree: subscribeToTree ? state.fileTree : EMPTY_FILE_TREE,
    isLoading: state.isLoading,
    error: state.error,
    setFileTree: state.setFileTree,
    updateFileTree: state.updateFileTree,
    setLoading: state.setLoading,
    setError: state.setError,
  })));
  const removeRecentWorkspacePath = useSettingsStore((state) => state.removeRecentWorkspacePath);
  const lastWorkspacePath = useSettingsStore((state) => state.settings.lastWorkspacePath);
  const defaultFolder = useSettingsStore((state) => state.settings.defaultFolder);
  const markdownUpdateLinksOnRename = useSettingsStore((state) => state.settings.markdownUpdateLinksOnRename);
  const { t } = useI18n();

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
    options: { preserveWorkspaceRoot?: boolean } = {},
  ) => {
    // If preserveWorkspaceRoot is set and there's an existing workspace root,
    // determine if the new path is under the existing workspace
    if (options.preserveWorkspaceRoot) {
      const existingRoot = useWorkspaceStore.getState().workspaceRootHandle;
      const existingPath = useWorkspaceStore.getState().workspaceRootPath;

      // Check if new path is under existing workspace
      if (existingRoot && existingPath) {
        const normalizedExisting = existingPath.replace(/\\/g, "/");
        const normalizedNew = (nextWorkspaceRootPath ?? handle.name).replace(/\\/g, "/");

        // If new path starts with existing path or is equal, preserve root
        if (normalizedNew === normalizedExisting ||
            normalizedNew.startsWith(`${normalizedExisting}/`)) {
          await applyWorkspaceHandleToStores(handle, nextWorkspaceRootPath, undefined, {
            preserveWorkspaceRoot: true,
          });
          return;
        }

        // If existing path starts with new path, new path is a parent
        if (normalizedExisting.startsWith(`${normalizedNew}/`)) {
          // New path is a parent of existing, update workspace root
          await applyWorkspaceHandleToStores(handle, nextWorkspaceRootPath);
          return;
        }
      }
    }

    await applyWorkspaceHandleToStores(handle, nextWorkspaceRootPath);
  }, []);

  const openWorkspaceFromDesktopPath = useCallback(async (
    path: string,
    options: { validateExists?: boolean } = {},
  ) => {
    const normalizedPath = normalizeWorkspacePathInput(path);
    const hadWorkspace = Boolean(useWorkspaceStore.getState().rootHandle);
    if (!normalizedPath) {
      if (!hadWorkspace) {
        setError("Workspace path is empty.");
      }
      return false;
    }

    if (!isTauri()) {
      if (!hadWorkspace) {
        setError("Recent workspace reopening is only available in the desktop app.");
      }
      return false;
    }

    try {
      setLoading(true);
      setError(null);

      if (options.validateExists !== false) {
        const exists = await isExistingDesktopDirectory(normalizedPath);
        if (!exists) {
          await removeRecentWorkspacePath(normalizedPath);
          if (!hadWorkspace) {
            setError(`Workspace path no longer exists: ${normalizedPath}`);
          }
          return false;
        }
      }

      // Check if new path is under existing workspace root
      const existingRootPath = useWorkspaceStore.getState().workspaceRootPath;
      const existingRootHandle = useWorkspaceStore.getState().workspaceRootHandle;
      let preserveWorkspaceRoot = false;

      if (existingRootHandle && existingRootPath) {
        const normalizedExisting = existingRootPath.replace(/\\/g, "/").replace(/\/+$/, "");
        const normalizedNew = normalizedPath.replace(/\\/g, "/").replace(/\/+$/, "");
        // If new path starts with existing path, preserve the workspace root
        if (normalizedNew === normalizedExisting || normalizedNew.startsWith(`${normalizedExisting}/`)) {
          preserveWorkspaceRoot = true;
        }
        // If existing path starts with new path, new path is a parent - update workspace root
        // Otherwise it's a completely different workspace
      }

      const handle = createDesktopDirectoryHandle(normalizedPath);
      if (preserveWorkspaceRoot) {
        await applyWorkspaceHandle(handle, normalizedPath, { preserveWorkspaceRoot: true });
      } else {
        await applyWorkspaceHandle(handle, normalizedPath);
      }
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to open workspace";
      if (!hadWorkspace) {
        setError(message);
      } else {
        console.warn("[FileSystem] Failed to switch workspace:", err);
      }
      return false;
    } finally {
      setLoading(false);
    }
  }, [applyWorkspaceHandle, removeRecentWorkspacePath, setError, setLoading]);

  /**
   * Refresh the file tree from the current root handle
   */
  const refreshDirectory = useCallback(async (options: { silent?: boolean; visibleOnly?: boolean; changedPaths?: string[] } = {}) => {
    if (!rootHandle) return;

    refreshQueuedOptions = {
      silent: Boolean(options.silent),
      visibleOnly: options.visibleOnly,
      changedPaths: options.changedPaths,
      rootHandle,
    };
    if (refreshInFlightPromise) {
      await refreshInFlightPromise;
      return;
    }
    const pump = async () => {
      while (refreshQueuedOptions) {
        const currentOptions = refreshQueuedOptions;
        refreshQueuedOptions = null;
        const requestedRoot = currentOptions.rootHandle;
        const current = () => useWorkspaceStore.getState().rootHandle === requestedRoot;
        if (!current()) continue;
        try {
          if (!currentOptions.silent) setLoading(true);
          const visibleRoot = useWorkspaceStore.getState().fileTree.root;
          if (currentOptions.visibleOnly && visibleRoot) {
            const updated = await reconcileVisibleDirectory(visibleRoot,
              directory => readDirectoryChildren(directory.handle, directory.path, requestedRoot),
              currentOptions.changedPaths, current);
            if (current() && useWorkspaceStore.getState().fileTree.root === visibleRoot && updated !== visibleRoot) {
              setFileTree({ root: updated });
            }
            continue;
          }
          invalidatePdfItemManifestIndex(requestedRoot);
          const expandedPaths = collectExpandedDirectoryPaths(useWorkspaceStore.getState().fileTree.root);
          const children = await readDirectoryRecursive(requestedRoot, "", requestedRoot, expandedPaths);
          if (!current()) continue;
          const rootNode: DirectoryNode = {
            name: requestedRoot.name,
            kind: "directory",
            handle: requestedRoot,
            children: applyExpandedState(children, expandedPaths),
            path: requestedRoot.name,
            isExpanded: true,
          };
          startTransition(() => {
            if (current()) {
              setFileTree({ root: rootNode });
              setError(null);
            }
          });
        } catch (err) {
          if (current()) setError(err instanceof Error ? err.message : "Failed to refresh directory");
        } finally {
          if (!currentOptions.silent && current()) setLoading(false);
        }
      }
    };
    refreshInFlightPromise = pump().finally(() => { refreshInFlightPromise = null; });
    await refreshInFlightPromise;
  }, [rootHandle, setFileTree, setLoading, setError]);

  const hydratePdfVirtualChildren = useCallback(async (
    pdfPath: string,
    options: { force?: boolean; expand?: boolean } = {},
  ) => {
    const latticeRootHandle = getLatticeRootHandle();
    if (!latticeRootHandle) {
      return;
    }

    const currentFileNode = findFileNodeByPath(useWorkspaceStore.getState().fileTree.root, pdfPath);
    if (!currentFileNode || !isHydratablePdfNode(currentFileNode)) {
      return;
    }

    if (!options.force && currentFileNode.virtualChildrenState === "ready") {
      if (options.expand && !currentFileNode.isExpanded) {
        useWorkspaceStore.getState().toggleDirectory(pdfPath);
      }
      return;
    }

    const storagePdfPath = resolvePathFromLatticeRoot(pdfPath);
    const hydrationKey = `${latticeRootHandle.name}:${storagePdfPath}`;
    const generation = (pdfHydrationGeneration.get(hydrationKey) ?? 0) + 1;
    pdfHydrationGeneration.set(hydrationKey, generation);

    patchWorkspaceFileTree(pdfPath, (file) => ({
      ...file,
      canExpandVirtualChildren: true,
      virtualChildrenState: "loading",
      ...(options.expand ? { isExpanded: true } : {}),
    }));

    try {
      const { manifest, children, itemRootHandle, itemLocationUnavailable } = await loadPdfVirtualChildren(
        latticeRootHandle,
        storagePdfPath,
        pdfPath,
        currentFileNode.handle,
      );
      if (pdfHydrationGeneration.get(hydrationKey) !== generation) {
        return;
      }

      patchWorkspaceFileTree(pdfPath, (file) => ({
        ...file,
        canExpandVirtualChildren: true,
        virtualChildrenState: itemLocationUnavailable ? "unavailable" : "ready",
        children,
        isExpanded: options.expand ?? file.isExpanded ?? false,
      }));

      if (itemLocationUnavailable) {
        return;
      }

      const managedFilesRefresh = itemRootHandle === latticeRootHandle
        ? syncPdfAnnotationMarkdownInBackground(itemRootHandle, manifest, storagePdfPath)
        : Promise.resolve();
      void managedFilesRefresh
        .then(async () => {
          if (pdfHydrationGeneration.get(hydrationKey) !== generation) {
            return;
          }
          const notes = await listPdfItemNotes(itemRootHandle, manifest);
          const refreshedChildren = buildPdfVirtualChildNodes(notes, pdfPath);
          patchWorkspaceFileTree(pdfPath, (file) => ({
            ...file,
            canExpandVirtualChildren: true,
            virtualChildrenState: "ready",
            children: refreshedChildren,
            isExpanded: file.isExpanded ?? options.expand ?? false,
          }));
        })
        .catch((error) => {
          console.warn("Failed to refresh PDF annotation index in background:", error);
        });
    } catch {
      if (pdfHydrationGeneration.get(hydrationKey) !== generation) {
        return;
      }

      patchWorkspaceFileTree(pdfPath, (file) => ({
        ...file,
        canExpandVirtualChildren: true,
        virtualChildrenState: "idle",
        children: [],
        isExpanded: options.expand ?? file.isExpanded ?? false,
      }));
    }
  }, []);

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
      const hadWorkspace = Boolean(useWorkspaceStore.getState().rootHandle);
      if (!hadWorkspace) {
        setError(null);
      }

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
      if (!useWorkspaceStore.getState().rootHandle) {
        setError(message);
      } else {
        console.warn("[FileSystem] Open directory failed while a workspace is already open:", err);
      }
    } finally {
      setLoading(false);
    }
  }, [applyWorkspaceHandle, defaultFolder, isSupported, lastWorkspacePath, openWorkspaceFromDesktopPath, setLoading, setError, workspaceRootPath]);

  const openWorkspacePath = useCallback(async (path: string) => {
    if (isTauri()) {
      await openWorkspaceFromDesktopPath(path);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const normalizedPath = normalizeWorkspacePathInput(path);
      const settings = useSettingsStore.getState().settings;
      const workspaceKey = settings.recentWorkspaceKeys.find((key) => (
        normalizeWorkspacePathInput(settings.workspaceDisplayPaths[key]) === normalizedPath
      ));
      const registered = workspaceKey ? await loadWorkspaceHandleRegistration(workspaceKey) : null;
      if (!registered?.handle) {
        throw new Error(t("explorer.recent.missingPermission"));
      }
      const handle = registered.handle;
      let permission = await handle.queryPermission({ mode: "readwrite" });
      if (permission !== "granted") {
        permission = await handle.requestPermission({ mode: "readwrite" });
      }
      if (permission !== "granted") {
        throw new Error(t("explorer.recent.missingPermission"));
      }
      await applyWorkspaceHandleToStores(handle, registered.displayPath, registered.workspaceKey);
    } catch (error) {
      setError(error instanceof Error ? error.message : t("explorer.recent.missingPermission"));
    } finally {
      setLoading(false);
    }
  }, [openWorkspaceFromDesktopPath, setError, setLoading, t]);

  const ensureDirectoryExpanded = useCallback(async (path: string): Promise<void> => {
    const activeRootHandle = useWorkspaceStore.getState().rootHandle;
    if (!activeRootHandle) {
      return;
    }

    const currentDirectory = findDirectoryNodeByPath(
      useWorkspaceStore.getState().fileTree.root,
      path,
    );
    if (!currentDirectory) {
      return;
    }

    const currentState = currentDirectory.childrenState
      ?? (currentDirectory.isExpanded ? "ready" : "idle");
    if (currentState === "ready") {
      if (!currentDirectory.isExpanded) {
        useWorkspaceStore.getState().toggleDirectory(path);
      }
      return;
    }

    let pendingLoads = directoryLoads.get(activeRootHandle);
    if (!pendingLoads) {
      pendingLoads = new Map();
      directoryLoads.set(activeRootHandle, pendingLoads);
    }
    const existingLoad = pendingLoads.get(path);
    if (existingLoad) {
      patchWorkspaceDirectory(path, (directory) => ({ ...directory, isExpanded: true }));
      return existingLoad;
    }

    patchWorkspaceDirectory(path, (directory) => ({
      ...directory,
      isExpanded: true,
      childrenState: "loading",
    }));

    const load = readDirectoryChildren(
      currentDirectory.handle,
      path,
      activeRootHandle,
      collectExpandedDirectoryPaths(useWorkspaceStore.getState().fileTree.root),
    ).then((children) => {
      const latestState = useWorkspaceStore.getState();
      if (latestState.rootHandle !== activeRootHandle) {
        return;
      }
      patchWorkspaceDirectory(path, (directory) => ({
        ...directory,
        children,
        childrenState: "ready",
      }));
    }).catch((error) => {
      const latestState = useWorkspaceStore.getState();
      if (latestState.rootHandle !== activeRootHandle) {
        return;
      }
      console.warn(`[FileSystem] Failed to load directory: ${path}`, error);
      patchWorkspaceDirectory(path, (directory) => ({
        ...directory,
        isExpanded: true,
        childrenState: "error",
      }));
    }).finally(() => {
      pendingLoads.delete(path);
      if (pendingLoads.size === 0) directoryLoads.delete(activeRootHandle);
    });
    pendingLoads.set(path, load);
    return load;
  }, []);

  const openDirectoryAsWorkspace = useCallback(async (path: string) => {
    if (!rootHandle) {
      return;
    }

    // Determine which handle to use for resolving the path
    const workspaceRoot = useWorkspaceStore.getState().workspaceRootHandle;
    const normalizedPath = normalizeWorkspacePathInput(path);
    const rootName = normalizeWorkspacePathInput(rootHandle.name);

    // If the path starts with the current root name, resolve from rootHandle
    // Otherwise, try to resolve from workspaceRootHandle (for sibling/ancestor directories)
    let resolveFromHandle = rootHandle;
    if (workspaceRoot && normalizedPath && rootName &&
        !normalizedPath.startsWith(`${rootName}/`) &&
        normalizedPath !== rootName) {
      // Path doesn't start with current root, try workspace root
      const workspaceRootName = normalizeWorkspacePathInput(workspaceRoot.name);
      if (workspaceRootName && normalizedPath.startsWith(`${workspaceRootName}/`)) {
        resolveFromHandle = workspaceRoot;
      }
    }

    let directoryHandle = await resolveDirectoryHandle(resolveFromHandle, path);
    if (!directoryHandle) {
      // Try from rootHandle as fallback
      const fallbackHandle = await resolveDirectoryHandle(rootHandle, path);
      if (!fallbackHandle) {
        setError(`Could not find directory: ${path}`);
        return;
      }
      directoryHandle = fallbackHandle;
    }

    const normalizedRootPath = normalizeWorkspacePathInput(workspaceRootPath ?? rootHandle.name);
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
      await applyWorkspaceHandle(directoryHandle, displayPath, { preserveWorkspaceRoot: true });
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

        const fileNode = buildVisibleFileNode(fileHandle, fullPath);
        if (fileNode) {
          updateFileTree((tree) => tree.root
            ? { root: insertTreeNode(tree.root, parentPath || rootHandle.name, fileNode) }
            : tree);
        }
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
      if (result.handle?.kind === "file") {
        const fileNode = buildVisibleFileNode(result.handle as FileSystemFileHandle, fullPath);
        if (fileNode) {
          updateFileTree((tree) => tree.root
            ? { root: insertTreeNode(tree.root, parentPath || rootHandle.name, fileNode) }
            : tree);
        }
      }
      if (fullPath) {
        emitVaultChange(fullPath);
      }
      result.path = fullPath;
    }

    return result;
  }, [rootHandle, updateFileTree]);

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
      const createdName = result.handle?.name || result.path?.split("/").pop() || "";
      result.path = joinPath(parentPath || rootHandle.name, createdName);
      if (result.handle?.kind === "directory") {
        const directoryNode = buildVisibleDirectoryNode(result.handle as FileSystemDirectoryHandle, result.path);
        if (directoryNode) {
          updateFileTree((tree) => tree.root
            ? { root: insertTreeNode(tree.root, parentPath || rootHandle.name, directoryNode) }
            : tree);
        }
      }
    }

    return result;
  }, [rootHandle, updateFileTree]);

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
      const storagePath = resolvePathFromLatticeRoot(path);
      updateFileTree((tree) => tree.root
        ? { root: removeTreeNode(tree.root, path).root }
        : tree);
      const latticeRootHandle = getLatticeRootHandle();
      if (resolvedEntry.kind === "file" && latticeRootHandle) {
        try {
          await deleteAnnotationSidecarsForPath(latticeRootHandle, storagePath);
        } catch (annotationCleanupError) {
          console.error("Failed to delete annotation sidecar:", annotationCleanupError);
        }
      }
      if (resolvedEntry.kind === "file" && isPdfPath(path) && latticeRootHandle) {
        try {
          await deletePdfItemWorkspace(latticeRootHandle, storagePath);
        } catch (cleanupError) {
          console.error("Failed to delete PDF companion workspace:", cleanupError);
        }
      }
      if (resolvedEntry.kind === "file") {
        removeWorkspaceMarkdownFile(path);
      }
      emitVaultDelete(path);
    }

    return { ...result, kind: resolvedEntry.kind, path };
  }, [rootHandle, updateFileTree]);

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
      const storageSourcePath = resolvePathFromLatticeRoot(path);
      const latticeRootHandle = getLatticeRootHandle();
      const renamedName = result.handle?.name || result.path?.split("/").pop() || newName;
      const fullPath = joinPath(getParentPath(path), renamedName);
      updateFileTree((tree) => tree.root
        ? {
            root: relocateTreeNode(tree.root, {
              sourcePath: path,
              targetDirectoryPath: getParentPath(path),
              nextPath: fullPath,
              nextHandle: result.handle,
            }),
          }
        : tree);
      if (resolvedEntry.kind === "directory" && result.handle?.kind === "directory") {
        const rebuiltDirectory = await rebuildDirectoryTreeNode(
          result.handle as FileSystemDirectoryHandle,
          fullPath,
          rootHandle,
        );
        updateFileTree((tree) => {
          if (!tree.root) {
            return tree;
          }
          const withoutStaleDirectory = removeTreeNode(tree.root, fullPath).root;
          return {
            root: insertTreeNode(withoutStaleDirectory, getParentPath(fullPath), rebuiltDirectory),
          };
        });
      }
      if (resolvedEntry.kind === "file" && fullPath && latticeRootHandle) {
        const storageTargetPath = resolvePathFromLatticeRoot(fullPath);
        try {
          await moveAnnotationSidecar(latticeRootHandle, storageSourcePath, storageTargetPath, detectFileType(fullPath));
        } catch (annotationMoveError) {
          console.error("Failed to rename annotation sidecar:", annotationMoveError);
        }
      }
      if (resolvedEntry.kind === "file" && isPdfPath(path) && fullPath && latticeRootHandle) {
        const storageTargetPath = resolvePathFromLatticeRoot(fullPath);
        try {
          await movePdfItemWorkspace(latticeRootHandle, storageSourcePath, storageTargetPath);
        } catch (companionError) {
          console.error("Failed to rename PDF companion workspace:", companionError);
        }
      }
      if (fullPath) {
        if (resolvedEntry.kind === "file") {
          let wroteReferenceUpdates = false;
          if (markdownUpdateLinksOnRename) {
            wroteReferenceUpdates = await confirmAndWriteMarkdownRenameLinkUpdates(
              rootHandle,
              path,
              fullPath,
              (count) => t("settings.markdown.updateLinksOnRename.confirm", { count }),
            );
          }
          renameWorkspaceMarkdownFile(path, fullPath, { rewriteReferences: wroteReferenceUpdates });
        }
        emitVaultRename(path, fullPath);
      }
      result.path = fullPath;
    }

    return { ...result, kind: resolvedEntry.kind };
  }, [markdownUpdateLinksOnRename, rootHandle, t, updateFileTree]);

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
      const latticeRootHandle = getLatticeRootHandle();
      const copiedName = result.handle?.name || result.path?.split("/").pop() || resolvedEntry.name;
      const fullPath = joinPath(targetDirectoryPath, copiedName);
      updateFileTree((tree) => tree.root
        ? {
            root: copyTreeNode(tree.root, {
              sourcePath,
              targetDirectoryPath,
              nextPath: fullPath,
              nextHandle: result.handle,
            }),
          }
        : tree);
      if (resolvedEntry.kind === "directory" && result.handle?.kind === "directory") {
        const rebuiltDirectory = await rebuildDirectoryTreeNode(
          result.handle as FileSystemDirectoryHandle,
          fullPath,
          rootHandle,
        );
        updateFileTree((tree) => {
          if (!tree.root) {
            return tree;
          }
          const withoutStaleDirectory = removeTreeNode(tree.root, fullPath).root;
          return {
            root: insertTreeNode(withoutStaleDirectory, targetDirectoryPath, rebuiltDirectory),
          };
        });
      }
      if (resolvedEntry.kind === "file" && latticeRootHandle) {
        const storageTargetPath = resolvePathFromLatticeRoot(fullPath);
        try {
          await copyAnnotationSidecar(latticeRootHandle, resolvePathFromLatticeRoot(sourcePath), storageTargetPath, detectFileType(fullPath));
        } catch (annotationCopyError) {
          console.error("Failed to copy annotation sidecar:", annotationCopyError);
        }
      }
      if (resolvedEntry.kind === "file" && isPdfPath(sourcePath) && latticeRootHandle) {
        const storageTargetPath = resolvePathFromLatticeRoot(fullPath);
        try {
          await copyPdfItemWorkspace(latticeRootHandle, resolvePathFromLatticeRoot(sourcePath), storageTargetPath);
        } catch (companionError) {
          console.error("Failed to copy PDF companion workspace:", companionError);
        }
      }
      await upsertMarkdownIndexFromHandle(fullPath, result.handle);
      emitVaultChange(fullPath);
      result.path = fullPath;
      result.kind = resolvedEntry.kind;
    }

    return result;
  }, [rootHandle, updateFileTree]);

  const moveEntryFromRoot = useCallback(async (
    operationRootHandle: FileSystemDirectoryHandle | null,
    sourcePath: string,
    targetDirectoryPath: string,
  ): Promise<EntryOperationResult> => {
    if (!operationRootHandle) {
      return {
        success: false,
        error: "No directory is open.",
      };
    }

    const resolvedEntry = await resolveEntry(operationRootHandle, sourcePath);
    const targetDirectory = await resolveDirectoryHandle(operationRootHandle, targetDirectoryPath);
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
      const storageSourcePath = resolvePathFromLatticeRoot(sourcePath);
      const latticeRootHandle = getLatticeRootHandle();
      const movedName = result.handle?.name || result.path?.split("/").pop() || resolvedEntry.name;
      const fullPath = joinPath(targetDirectoryPath, movedName);
      const storageTargetPath = resolvePathFromLatticeRoot(fullPath);
      const visibleTargetDirectoryPath = targetDirectoryPath.startsWith(".lattice/")
        ? null
        : targetDirectoryPath;
      updateFileTree((tree) => tree.root
        ? {
            root: relocateTreeNode(tree.root, {
              sourcePath,
              targetDirectoryPath: visibleTargetDirectoryPath,
              nextPath: fullPath,
              nextHandle: result.handle,
            }),
          }
        : tree);
      if (
        visibleTargetDirectoryPath &&
        resolvedEntry.kind === "directory" &&
        result.handle?.kind === "directory"
      ) {
        const rebuiltDirectory = await rebuildDirectoryTreeNode(
          result.handle as FileSystemDirectoryHandle,
          fullPath,
          operationRootHandle,
        );
        updateFileTree((tree) => {
          if (!tree.root) {
            return tree;
          }
          const withoutStaleDirectory = removeTreeNode(tree.root, fullPath).root;
          return {
            root: insertTreeNode(withoutStaleDirectory, visibleTargetDirectoryPath, rebuiltDirectory),
          };
        });
      }
      if (resolvedEntry.kind === "file" && latticeRootHandle) {
        try {
          await moveAnnotationSidecar(latticeRootHandle, storageSourcePath, storageTargetPath, detectFileType(fullPath));
        } catch (annotationMoveError) {
          console.error("Failed to move annotation sidecar:", annotationMoveError);
        }
      }
      if (resolvedEntry.kind === "file" && isPdfPath(sourcePath) && latticeRootHandle) {
        try {
          await movePdfItemWorkspace(latticeRootHandle, storageSourcePath, storageTargetPath);
        } catch (companionError) {
          console.error("Failed to move PDF companion workspace:", companionError);
        }
      }
      if (resolvedEntry.kind === "file") {
        let wroteReferenceUpdates = false;
        if (markdownUpdateLinksOnRename) {
          wroteReferenceUpdates = await confirmAndWriteMarkdownRenameLinkUpdates(
            operationRootHandle,
            sourcePath,
            fullPath,
            (count) => t("settings.markdown.updateLinksOnRename.confirm", { count }),
          );
        }
        renameWorkspaceMarkdownFile(sourcePath, fullPath, { rewriteReferences: wroteReferenceUpdates });
      }
      emitVaultRename(sourcePath, fullPath);
      result.path = fullPath;
      result.kind = resolvedEntry.kind;
    }

    return result;
  }, [markdownUpdateLinksOnRename, t, updateFileTree]);

  const moveEntry = useCallback(async (
    sourcePath: string,
    targetDirectoryPath: string
  ): Promise<EntryOperationResult> => {
    return moveEntryFromRoot(rootHandle, sourcePath, targetDirectoryPath);
  }, [moveEntryFromRoot, rootHandle]);

  const moveEntryIntoPdfItemWorkspace = useCallback(async (
    sourcePath: string,
    pdfPath: string,
  ): Promise<EntryOperationResult> => {
    const latticeRootHandle = getLatticeRootHandle();
    if (!latticeRootHandle) {
      return {
        success: false,
        error: "No directory is open.",
      };
    }

    if (!isPdfPath(pdfPath)) {
      return {
        success: false,
        error: "Target is not a PDF file.",
      };
    }

    if (sourcePath === pdfPath) {
      return {
        success: false,
        error: "Cannot move a PDF into its own item workspace.",
      };
    }

    const storagePdfPath = resolvePathFromLatticeRoot(pdfPath);
    const storageSourcePath = resolvePathFromLatticeRoot(sourcePath);
    const pdfEntry = await resolveEntry(latticeRootHandle, storagePdfPath);
    const fingerprint = pdfEntry?.kind === "file"
      ? await buildFileFingerprint(pdfEntry.handle as FileSystemFileHandle)
      : null;
    const manifest = await ensurePdfItemWorkspace(latticeRootHandle, generateFileId(storagePdfPath), storagePdfPath, {
      fileFingerprint: fingerprint?.fingerprint ?? null,
      versionFingerprint: fingerprint?.versionFingerprint ?? null,
    });
    if (storageSourcePath === manifest.itemFolderPath || manifest.itemFolderPath.startsWith(`${storageSourcePath}/`)) {
      return {
        success: false,
        error: "Cannot move a folder into its own PDF item workspace.",
      };
    }

    const result = await moveEntryFromRoot(latticeRootHandle, storageSourcePath, manifest.itemFolderPath);
    if (result.success) {
      await hydratePdfVirtualChildren(pdfPath, { force: true, expand: true });
    }

    return result;
  }, [hydratePdfVirtualChildren, moveEntryFromRoot]);

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
    moveEntryIntoPdfItemWorkspace,
    hydratePdfVirtualChildren,
    ensureDirectoryExpanded,
    refreshDirectory,
    fileTree,
    rootHandle,
  };
}

// Export the recursive reader for testing
export { readDirectoryRecursive };

// Re-export types
export type { FileType, FileOperationResult, DirectoryOperationResult };
