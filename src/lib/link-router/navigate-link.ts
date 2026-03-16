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
import type { LinkTarget, WorkspaceNavigationTarget } from "./types";

export interface NavigateLinkOptions {
  paneId?: PaneId;
  rootHandle?: FileSystemDirectoryHandle | null;
  currentFilePath?: string;
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
  target: LinkTarget
): Promise<{ path: string; handle: FileSystemFileHandle } | null> {
  const targetPath = "path" in target ? target.path : "";
  for (const candidate of buildWorkspaceCandidatePaths(targetPath)) {
    try {
      const handle = await resolveWorkspaceFileHandle(rootHandle, candidate);
      return { path: candidate, handle };
    } catch {
      continue;
    }
  }
  return null;
}

function setPendingNavigation(paneId: PaneId, filePath: string, target: WorkspaceNavigationTarget): void {
  useLinkNavigationStore.getState().setPendingNavigation(paneId, { filePath, target });
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

export async function navigateLink(rawTarget: string, options: NavigateLinkOptions = {}): Promise<boolean> {
  const parsed = parseLinkTarget(rawTarget, { currentFilePath: options.currentFilePath });
  const target = parsed.target;
  if (!target) {
    return false;
  }

  if (target.type === "external_url") {
    await openExternalUrl(target.url);
    return true;
  }

  if (target.type === "system_path") {
    return openSystemPath(target.path);
  }

  if (!options.paneId) {
    return false;
  }

  if (currentFileMatchesTarget(options.currentFilePath, target)) {
    if (isTargetWithFollowUp(target)) {
      setPendingNavigation(options.paneId, options.currentFilePath ?? target.path, {
        ...target,
        path: options.currentFilePath ?? target.path,
      });
    }
    return true;
  }

  if (!options.rootHandle) {
    return false;
  }

  const resolved = await resolveWorkspaceTarget(options.rootHandle, target);
  if (!resolved) {
    return false;
  }

  if (isTargetWithFollowUp(target)) {
    setPendingNavigation(options.paneId, resolved.path, {
      ...target,
      path: resolved.path,
    });
  } else {
    clearPendingNavigation(options.paneId);
  }

  useWorkspaceStore.getState().openFileInPane(options.paneId, resolved.handle, resolved.path);
  return true;
}
