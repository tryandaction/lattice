"use client";

import { invokeTauriCommand, isTauriHost } from "@/lib/storage-adapter";

export interface VSCodeSourceControlChange {
  path: string;
  originalPath: string | null;
  index: string;
  worktree: string;
  status: string;
  staged: boolean;
  unstaged: boolean;
  conflict: boolean;
  untracked: boolean;
}

export interface VSCodeSourceControlSnapshot {
  available: boolean;
  repositoryRoot: string | null;
  branch: string | null;
  ahead: number;
  behind: number;
  changes: VSCodeSourceControlChange[];
  error: string | null;
}

export interface VSCodeSourceControlDiff {
  path: string;
  staged: boolean;
  content: string;
  binary: boolean;
  truncated: boolean;
  error: string | null;
}

export const EMPTY_VSCODE_SOURCE_CONTROL_SNAPSHOT: VSCodeSourceControlSnapshot = {
  available: false,
  repositoryRoot: null,
  branch: null,
  ahead: 0,
  behind: 0,
  changes: [],
  error: null,
};

const SOURCE_CONTROL_MUTATION_TIMEOUT_MS = 10_000;
const SOURCE_CONTROL_DIFF_COMMIT_TIMEOUT_MS = 30_000;

function requireDesktopWorkspace(workspaceRootPath?: string | null): string {
  if (!isTauriHost()) {
    throw new Error("Source control is available in the desktop build after opening a workspace.");
  }
  const path = workspaceRootPath?.trim();
  if (!path) {
    throw new Error("Source control requires an opened workspace.");
  }
  return path;
}

async function invokeSourceControlMutation(
  command: string,
  workspaceRootPath: string | null | undefined,
  payload: Record<string, unknown> = {},
  timeoutMs = SOURCE_CONTROL_MUTATION_TIMEOUT_MS,
): Promise<VSCodeSourceControlSnapshot> {
  const path = requireDesktopWorkspace(workspaceRootPath);
  return invokeTauriCommand<VSCodeSourceControlSnapshot>(
    command,
    { path, ...payload },
    { timeoutMs },
  );
}

export async function getVSCodeSourceControlStatus(
  workspaceRootPath?: string | null,
): Promise<VSCodeSourceControlSnapshot> {
  if (!isTauriHost() || !workspaceRootPath?.trim()) {
    return {
      ...EMPTY_VSCODE_SOURCE_CONTROL_SNAPSHOT,
      error: "Source control is available in the desktop build after opening a workspace.",
    };
  }

  return invokeTauriCommand<VSCodeSourceControlSnapshot>(
    "desktop_get_source_control_status",
    { path: workspaceRootPath },
    { timeoutMs: 5000 },
  );
}

export async function getVSCodeSourceControlDiff(
  workspaceRootPath: string | null | undefined,
  filePath: string,
  staged: boolean,
): Promise<VSCodeSourceControlDiff> {
  const path = requireDesktopWorkspace(workspaceRootPath);
  return invokeTauriCommand<VSCodeSourceControlDiff>(
    "desktop_get_source_control_diff",
    { path, filePath, staged },
    { timeoutMs: SOURCE_CONTROL_DIFF_COMMIT_TIMEOUT_MS },
  );
}

export function stageVSCodeSourceControlPaths(
  workspaceRootPath: string | null | undefined,
  paths: string[],
): Promise<VSCodeSourceControlSnapshot> {
  return invokeSourceControlMutation(
    "desktop_stage_source_control_paths",
    workspaceRootPath,
    { paths },
  );
}

export function unstageVSCodeSourceControlPaths(
  workspaceRootPath: string | null | undefined,
  paths: string[],
): Promise<VSCodeSourceControlSnapshot> {
  return invokeSourceControlMutation(
    "desktop_unstage_source_control_paths",
    workspaceRootPath,
    { paths },
  );
}

export function stageAllVSCodeSourceControlChanges(
  workspaceRootPath: string | null | undefined,
): Promise<VSCodeSourceControlSnapshot> {
  return invokeSourceControlMutation(
    "desktop_stage_all_source_control_changes",
    workspaceRootPath,
  );
}

export function unstageAllVSCodeSourceControlChanges(
  workspaceRootPath: string | null | undefined,
): Promise<VSCodeSourceControlSnapshot> {
  return invokeSourceControlMutation(
    "desktop_unstage_all_source_control_changes",
    workspaceRootPath,
  );
}

export function commitVSCodeSourceControlChanges(
  workspaceRootPath: string | null | undefined,
  message: string,
): Promise<VSCodeSourceControlSnapshot> {
  return invokeSourceControlMutation(
    "desktop_commit_source_control_changes",
    workspaceRootPath,
    { message },
    SOURCE_CONTROL_DIFF_COMMIT_TIMEOUT_MS,
  );
}
