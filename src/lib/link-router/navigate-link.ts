import { useWorkspaceStore } from "@/stores/workspace-store";
import { useLinkNavigationStore } from "@/stores/link-navigation-store";
import type { PaneId } from "@/types/layout";
import {
  buildWorkspaceCandidatePaths,
  isSameWorkspacePath,
  normalizeWorkspacePath,
} from "./path-utils";
import { openExternalUrl, openSystemPath } from "./open-external";
import { parseLinkTarget } from "./parse-link-target";
import { attachEvidenceAnchor } from "./evidence-target";
import type {
  LinkTarget,
  NavigationResult,
  WorkspaceEvidenceAnchor,
  WorkspaceNavigationTarget,
} from "./types";
import { canOpenUrlInternally, deriveWebDocumentName } from "@/lib/web-document";

export interface NavigateLinkOptions {
  paneId?: PaneId;
  /** Handle for the currently open tab, used when the citation path is an equivalent alias. */
  currentFileHandle?: FileSystemFileHandle | null;
  rootHandle?: FileSystemDirectoryHandle | null;
  /** Additional workspace roots to try when the active root is a nested folder. */
  rootHandles?: Array<FileSystemDirectoryHandle | null>;
  /** Workspace roots paired with their canonical registered path. */
  rootCandidates?: WorkspaceRootCandidate[];
  currentFilePath?: string;
  /** Interpret citation paths from the workspace root instead of the current file directory. */
  pathMode?: "relative" | "workspace";
  externalUrlMode?: "internal" | "external";
  /** Optional AI evidence geometry retained until the PDF renderer is ready. */
  evidenceAnchor?: WorkspaceEvidenceAnchor;
}

export interface WorkspaceRootCandidate {
  handle: FileSystemDirectoryHandle;
  pathPrefix?: string;
}

async function resolveWorkspaceFileHandle(
  root: FileSystemDirectoryHandle,
  filePath: string
): Promise<FileSystemFileHandle> {
  const parts = normalizeWorkspacePath(filePath).split("/").filter(Boolean);
  const startIndex = parts[0] === root.name ? 1 : 0;
  let current: FileSystemDirectoryHandle | FileSystemFileHandle = root;

  for (let index = startIndex; index < parts.length; index += 1) {
    const part = parts[index];
    const isLast = index === parts.length - 1;
    current = isLast
      ? await (current as FileSystemDirectoryHandle).getFileHandle(part)
      : await (current as FileSystemDirectoryHandle).getDirectoryHandle(part);
  }

  return current as FileSystemFileHandle;
}

async function resolveWorkspaceTarget(
  rootHandle: FileSystemDirectoryHandle,
  target: LinkTarget,
  pathPrefix?: string,
): Promise<{ path: string; handle: FileSystemFileHandle } | null> {
  const targetPath = "path" in target ? target.path : "";
  for (const candidate of buildWorkspaceCandidatePaths(targetPath)) {
    const normalizedPrefix = normalizeWorkspacePath(pathPrefix ?? "");
    const relativeCandidate = normalizedPrefix && (
      candidate === normalizedPrefix || candidate.startsWith(`${normalizedPrefix}/`)
    )
      ? candidate.slice(normalizedPrefix.length).replace(/^\//, "")
      : candidate;
    if (!relativeCandidate) {
      continue;
    }
    try {
      const handle = await resolveWorkspaceFileHandle(rootHandle, relativeCandidate);
      return { path: candidate, handle };
    } catch {
      continue;
    }
  }
  return null;
}

function setPendingNavigation(
  paneId: PaneId,
  filePath: string,
  target: WorkspaceNavigationTarget,
  requestId: string,
): string {
  return useLinkNavigationStore.getState().setPendingNavigation(paneId, { requestId, filePath, target });
}

function clearPendingNavigation(paneId: PaneId): void {
  useLinkNavigationStore.getState().clearPendingNavigation(paneId);
}

function isTargetWithFollowUp(target: LinkTarget): target is WorkspaceNavigationTarget {
  return target.type !== "external_url" && target.type !== "system_path" && target.type !== "workspace_file";
}

function currentFileMatchesTarget(currentFilePath: string | undefined, target: LinkTarget): boolean {
  if (!currentFilePath || !("path" in target)) return false;

  const candidatePaths = buildWorkspaceCandidatePaths(target.path);
  return candidatePaths.some((candidate) => isSameWorkspacePath(candidate, currentFilePath));
}

function equivalentOpenFilePath(currentPath: string, targetPath: string): boolean {
  // Both values are decoded file paths, not locator URLs. A # is a filename
  // character here; stripping it can silently navigate a different document.
  const current = normalizeWorkspacePath(currentPath).toLocaleLowerCase();
  const target = normalizeWorkspacePath(targetPath).toLocaleLowerCase();
  return current === target || current.endsWith(`/${target}`);
}

function resolvePaneId(preferredPaneId: PaneId | undefined): PaneId | null {
  if (preferredPaneId) {
    return preferredPaneId;
  }

  return useWorkspaceStore.getState().layout.activePaneId ?? null;
}

function createRequestId(): string {
  return `nav-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const resolvingRequestByPane = new Map<PaneId, string>();

async function navigateLinkDetailedInternal(rawTarget: string, options: NavigateLinkOptions, requestId: string): Promise<Omit<NavigationResult, "success">> {
  const parsed = parseLinkTarget(rawTarget, { currentFilePath: options.currentFilePath, pathMode: options.pathMode });
  const parsedTarget = parsed.target;
  if (!parsedTarget) {
    return { ok: false, requestId, status: "unsupported_target" };
  }
  const target = attachEvidenceAnchor(parsedTarget, options.evidenceAnchor);

  const effectivePaneId = resolvePaneId(options.paneId);

  if (target.type === "external_url") {
    if (
      options.externalUrlMode === "external" ||
      !canOpenUrlInternally(target.url)
    ) {
      await openExternalUrl(target.url);
      return { ok: true, requestId, status: "success", target };
    }

    if (!effectivePaneId) {
      return { ok: false, requestId, status: "pane_not_found", target };
    }

    useWorkspaceStore.getState().openWebUrlInPane(effectivePaneId, target.url, {
      fileName: deriveWebDocumentName(target.url),
    });
    return { ok: true, requestId, status: "success", target };
  }

  if (target.type === "system_path") {
    const opened = await openSystemPath(target.path);
    return { ok: opened, requestId, status: opened ? "success" : "unsupported_target", target };
  }

  if (!effectivePaneId) {
    return { ok: false, requestId, status: "pane_not_found", target };
  }

  if (currentFileMatchesTarget(options.currentFilePath, target)) {
    let effectiveRequestId = requestId;
    if (isTargetWithFollowUp(target)) {
      effectiveRequestId = setPendingNavigation(effectivePaneId, options.currentFilePath ?? target.path, {
        ...target,
        path: options.currentFilePath ?? target.path,
      }, requestId);
    }
    return { ok: true, requestId: effectiveRequestId, status: isTargetWithFollowUp(target) ? "pending" : "success", target, filePath: options.currentFilePath ?? target.path };
  }

  if (
    options.currentFileHandle &&
    options.currentFilePath &&
    "path" in target &&
    equivalentOpenFilePath(options.currentFilePath, target.path)
  ) {
    let effectiveRequestId = requestId;
    if (isTargetWithFollowUp(target)) {
      effectiveRequestId = setPendingNavigation(effectivePaneId, options.currentFilePath, {
        ...target,
        path: options.currentFilePath,
      }, requestId);
    }
    return {
      ok: true,
      requestId: effectiveRequestId,
      status: isTargetWithFollowUp(target) ? "pending" : "success",
      target,
      filePath: options.currentFilePath,
    };
  }

  if (!options.rootHandle && !(options.rootCandidates?.length)) {
    return { ok: false, requestId, status: "root_not_found", target };
  }

  const legacyRoots: WorkspaceRootCandidate[] = [options.rootHandle, ...(options.rootHandles ?? [])]
    .filter((root): root is FileSystemDirectoryHandle => Boolean(root))
    .map((handle) => ({ handle }));
  const candidateRoots: WorkspaceRootCandidate[] = [...legacyRoots, ...(options.rootCandidates ?? [])]
    .filter((candidate, index, candidates) => candidates.findIndex((other) => (
      other.handle === candidate.handle
      && normalizeWorkspacePath(other.pathPrefix ?? "") === normalizeWorkspacePath(candidate.pathPrefix ?? "")
    )) === index);
  let resolved: { path: string; handle: FileSystemFileHandle } | null = null;
  for (const candidateRoot of candidateRoots) {
    resolved = await resolveWorkspaceTarget(candidateRoot.handle, target, candidateRoot.pathPrefix);
    if (resolvingRequestByPane.get(effectivePaneId) !== requestId) {
      return { ok: true, requestId, status: "superseded", target };
    }
    if (resolved) {
      break;
    }
  }
  if (!resolved) {
    return { ok: false, requestId, status: "file_not_found", target };
  }

  let effectiveRequestId = requestId;
  if (isTargetWithFollowUp(target)) {
    effectiveRequestId = setPendingNavigation(effectivePaneId, resolved.path, {
      ...target,
      path: resolved.path,
    }, requestId);
  } else {
    clearPendingNavigation(effectivePaneId);
  }

  useWorkspaceStore.getState().openFileInPane(effectivePaneId, resolved.handle, resolved.path);
  return {
    ok: true,
    requestId: effectiveRequestId,
    status: isTargetWithFollowUp(target) ? "pending" : "success",
    target,
    filePath: resolved.path,
  };
}

export async function navigateLinkDetailed(rawTarget: string, options: NavigateLinkOptions = {}): Promise<NavigationResult> {
  const requestId = createRequestId();
  const paneId = resolvePaneId(options.paneId);
  if (paneId) resolvingRequestByPane.set(paneId, requestId);
  try {
    const result = await navigateLinkDetailedInternal(rawTarget, { ...options, ...(paneId ? { paneId } : {}) }, requestId);
    return { ...result, success: result.ok };
  } finally {
    // Only retain active lookups; an older request cannot clear its successor.
    if (paneId && resolvingRequestByPane.get(paneId) === requestId) resolvingRequestByPane.delete(paneId);
  }
}

export async function navigateLink(rawTarget: string, options: NavigateLinkOptions = {}): Promise<boolean> {
  const result = await navigateLinkDetailed(rawTarget, options);
  return result.ok;
}
