import { getStorageAdapter } from "@/lib/storage-adapter";
import type { EntryKind } from "@/lib/file-operations";

const WORKSPACE_UI_STATE_VERSION = 1;
const WORKSPACE_UI_STATE_STORAGE_KEY_PREFIX = "lattice-workspace-ui-state";
const MAX_EXPANDED_PATHS = 500;

export interface PersistedWorkspaceUiState {
  version: 1;
  explorer: {
    expandedPaths: string[];
    selectedPath: string | null;
    selectedKind: EntryKind | null;
  };
}

function normalizeWorkspaceUiStateKey(
  workspaceKey: string | null | undefined,
  workspaceRootPath: string | null | undefined,
): string | null {
  const normalized = workspaceKey?.trim() || workspaceRootPath?.trim();
  return normalized ? `${WORKSPACE_UI_STATE_STORAGE_KEY_PREFIX}:${normalized}` : null;
}

function normalizeExpandedPaths(paths: Iterable<string>): string[] {
  const unique = new Set<string>();
  for (const path of paths) {
    const normalized = path.trim();
    if (normalized) {
      unique.add(normalized);
    }
    if (unique.size >= MAX_EXPANDED_PATHS) {
      break;
    }
  }
  return Array.from(unique);
}

function isEntryKind(value: unknown): value is EntryKind {
  return value === "file" || value === "directory";
}

function isPersistedWorkspaceUiState(value: unknown): value is PersistedWorkspaceUiState {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  const explorer = candidate.explorer as Record<string, unknown> | undefined;
  return (
    candidate.version === WORKSPACE_UI_STATE_VERSION &&
    Boolean(explorer) &&
    Array.isArray(explorer?.expandedPaths) &&
    (explorer?.selectedPath === null || typeof explorer?.selectedPath === "string") &&
    (explorer?.selectedKind === null || isEntryKind(explorer?.selectedKind))
  );
}

export async function loadWorkspaceUiState(
  workspaceKey: string | null | undefined,
  workspaceRootPath: string | null | undefined,
): Promise<PersistedWorkspaceUiState | null> {
  const storageKey = normalizeWorkspaceUiStateKey(workspaceKey, workspaceRootPath);
  if (!storageKey) {
    return null;
  }

  const persisted = await getStorageAdapter().get<PersistedWorkspaceUiState>(storageKey);
  if (!isPersistedWorkspaceUiState(persisted)) {
    return null;
  }

  return {
    version: WORKSPACE_UI_STATE_VERSION,
    explorer: {
      expandedPaths: normalizeExpandedPaths(persisted.explorer.expandedPaths),
      selectedPath: persisted.explorer.selectedPath,
      selectedKind: persisted.explorer.selectedKind,
    },
  };
}

export async function saveWorkspaceUiState(
  workspaceKey: string | null | undefined,
  workspaceRootPath: string | null | undefined,
  state: PersistedWorkspaceUiState,
): Promise<void> {
  const storageKey = normalizeWorkspaceUiStateKey(workspaceKey, workspaceRootPath);
  if (!storageKey) {
    return;
  }

  await getStorageAdapter().set<PersistedWorkspaceUiState>(storageKey, {
    version: WORKSPACE_UI_STATE_VERSION,
    explorer: {
      expandedPaths: normalizeExpandedPaths(state.explorer.expandedPaths),
      selectedPath: state.explorer.selectedPath,
      selectedKind: state.explorer.selectedKind,
    },
  });
}
