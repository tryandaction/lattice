"use client";

import { isTauriHost, waitForTauriInvokeReady } from "@/lib/storage-adapter";

export interface DesktopWorkspacePathSettings {
  lastWorkspacePath?: string | null;
  lastOpenedFolder?: string | null;
  recentWorkspacePaths?: string[];
  defaultFolder?: string | null;
}

export interface DesktopStartupWorkspaceResolution {
  path: string | null;
  source: "last_workspace_path" | "recent_workspace_paths" | "default_folder" | null;
}

type DialogSelectionPayload =
  | string
  | string[]
  | null
  | undefined
  | {
      path?: string | null;
      paths?: string[];
      name?: string;
    };

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function normalizeOptionalPath(path: string | null | undefined): string | null {
  if (typeof path !== "string") {
    return null;
  }

  const trimmed = path.trim();
  if (!trimmed) {
    return null;
  }

  return normalizePath(trimmed);
}

export function normalizeDesktopDirectorySelection(selection: DialogSelectionPayload): string | null {
  if (typeof selection === "string") {
    return normalizeOptionalPath(selection);
  }

  if (Array.isArray(selection)) {
    return selection.map((item) => normalizeOptionalPath(item)).find((item): item is string => Boolean(item)) ?? null;
  }

  if (!selection || typeof selection !== "object") {
    return null;
  }

  if ("path" in selection) {
    return normalizeOptionalPath(selection.path);
  }

  if ("paths" in selection && Array.isArray(selection.paths)) {
    return selection.paths
      .map((item) => normalizeOptionalPath(item))
      .find((item): item is string => Boolean(item)) ?? null;
  }

  return null;
}

export async function openDesktopDirectoryDialog(options?: {
  title?: string;
  defaultPath?: string | null;
}): Promise<string | null> {
  const invoke = await waitForTauriInvokeReady();
  if (!isTauriHost() || !invoke) {
    return null;
  }

  const selected = await invoke<DialogSelectionPayload>("plugin:dialog|open", {
    options: {
      directory: true,
      multiple: false,
      title: options?.title,
      ...(options?.defaultPath ? { defaultPath: normalizePath(options.defaultPath) } : {}),
    },
  });

  return normalizeDesktopDirectorySelection(selected);
}

export async function isExistingDesktopDirectory(path: string | null | undefined): Promise<boolean> {
  const normalized = normalizeOptionalPath(path);
  const invoke = await waitForTauriInvokeReady();
  if (!normalized || !isTauriHost() || !invoke) {
    return false;
  }

  return invoke<boolean>("desktop_is_directory", { path: normalized });
}

export async function resolveDesktopStartupWorkspace(): Promise<DesktopStartupWorkspaceResolution | null> {
  const invoke = await waitForTauriInvokeReady();
  if (!isTauriHost() || !invoke) {
    return null;
  }

  const resolution = await invoke<DesktopStartupWorkspaceResolution>("resolve_startup_workspace");
  if (!resolution) {
    return null;
  }

  return {
    path: normalizeOptionalPath(resolution.path),
    source: resolution.source ?? null,
  };
}

export function collectDesktopWorkspacePathCandidates(
  settings: DesktopWorkspacePathSettings,
): string[] {
  const candidates = [
    settings.lastWorkspacePath,
    settings.lastOpenedFolder,
    ...(settings.recentWorkspacePaths ?? []),
    settings.defaultFolder,
  ]
    .map((item) => normalizeOptionalPath(item))
    .filter((item): item is string => Boolean(item));

  return Array.from(new Set(candidates));
}
