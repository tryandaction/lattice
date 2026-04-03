/**
 * Workbench session persistence.
 *
 * Persists pane/tab layout per workspace root. Viewer-level state is persisted
 * separately through file-view-state and content-cache editorState.
 */

import { getStorageAdapter } from "@/lib/storage-adapter";
import { resolveEntry } from "@/lib/file-operations";
import type { LayoutNode, LayoutState, PaneNode, SplitDirection } from "@/types/layout";
import { isPaneNode } from "@/types/layout";
import { createEmptyPane, createTab } from "@/lib/layout-utils";

const WORKBENCH_SESSION_VERSION = 1;
const WORKBENCH_SESSION_STORAGE_KEY_PREFIX = "lattice-workbench-session";

interface PersistedWorkbenchTab {
  filePath: string;
}

interface PersistedWorkbenchPaneNode {
  type: "pane";
  id: string;
  tabs: PersistedWorkbenchTab[];
  activeTabIndex: number;
}

interface PersistedWorkbenchSplitNode {
  type: "split";
  id: string;
  direction: SplitDirection;
  children: PersistedWorkbenchLayoutNode[];
  sizes: number[];
}

type PersistedWorkbenchLayoutNode = PersistedWorkbenchPaneNode | PersistedWorkbenchSplitNode;

export interface PersistedWorkbenchSession {
  version: 1;
  root: PersistedWorkbenchLayoutNode;
  activePaneId: string;
  sidebarCollapsed: boolean;
}

function normalizeWorkspaceSessionKey(workspaceKey: string | null | undefined, workspaceRootPath: string | null | undefined): string | null {
  if (workspaceKey?.trim()) {
    return workspaceKey.trim();
  }

  if (!workspaceRootPath) {
    return null;
  }

  const trimmed = workspaceRootPath.trim();
  return trimmed ? trimmed : null;
}

export function getWorkbenchSessionStorageKey(
  workspaceKey: string | null | undefined,
  workspaceRootPath: string | null | undefined,
): string | null {
  const normalized = normalizeWorkspaceSessionKey(workspaceKey, workspaceRootPath);
  if (!normalized) {
    return null;
  }

  return `${WORKBENCH_SESSION_STORAGE_KEY_PREFIX}:${normalized}`;
}

function serializeNode(node: LayoutNode): PersistedWorkbenchLayoutNode {
  if (isPaneNode(node)) {
    return {
      type: "pane",
      id: node.id,
      tabs: node.tabs.map((tab) => ({ filePath: tab.filePath })),
      activeTabIndex: node.activeTabIndex,
    };
  }

  return {
    type: "split",
    id: node.id,
    direction: node.direction,
    children: node.children.map(serializeNode),
    sizes: node.sizes,
  };
}

function serializeWorkbenchSession(
  layout: LayoutState,
  sidebarCollapsed: boolean,
): PersistedWorkbenchSession {
  return {
    version: WORKBENCH_SESSION_VERSION,
    root: serializeNode(layout.root),
    activePaneId: layout.activePaneId,
    sidebarCollapsed,
  };
}

function isPersistedPaneNode(value: unknown): value is PersistedWorkbenchPaneNode {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    candidate.type === "pane" &&
    typeof candidate.id === "string" &&
    Array.isArray(candidate.tabs) &&
    typeof candidate.activeTabIndex === "number"
  );
}

function isPersistedSplitNode(value: unknown): value is PersistedWorkbenchSplitNode {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    candidate.type === "split" &&
    typeof candidate.id === "string" &&
    (candidate.direction === "horizontal" || candidate.direction === "vertical") &&
    Array.isArray(candidate.children) &&
    Array.isArray(candidate.sizes)
  );
}

function isPersistedWorkbenchSession(value: unknown): value is PersistedWorkbenchSession {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    candidate.version === WORKBENCH_SESSION_VERSION &&
    typeof candidate.activePaneId === "string" &&
    typeof candidate.sidebarCollapsed === "boolean" &&
    (isPersistedPaneNode(candidate.root) || isPersistedSplitNode(candidate.root))
  );
}

async function deserializeTab(
  rootHandle: FileSystemDirectoryHandle,
  persistedTab: PersistedWorkbenchTab,
) {
  const entry = await resolveEntry(rootHandle, persistedTab.filePath);
  if (!entry || entry.kind !== "file") {
    return null;
  }

  return createTab(entry.handle as FileSystemFileHandle, persistedTab.filePath);
}

async function deserializeNode(
  rootHandle: FileSystemDirectoryHandle,
  node: PersistedWorkbenchLayoutNode,
): Promise<LayoutNode> {
  if (node.type === "pane") {
    const tabs = (
      await Promise.all(
        node.tabs.map((tab) => deserializeTab(rootHandle, tab)),
      )
    ).filter((tab): tab is PaneNode["tabs"][number] => tab !== null);

    return {
      type: "pane",
      id: node.id,
      tabs,
      activeTabIndex: tabs.length === 0
        ? -1
        : Math.max(0, Math.min(node.activeTabIndex, tabs.length - 1)),
    };
  }

  const children = await Promise.all(node.children.map((child) => deserializeNode(rootHandle, child)));
  const normalizedChildren = children.length >= 2 ? children : [children[0] ?? createEmptyPane(), createEmptyPane()];
  const normalizedSizes = node.sizes.length === normalizedChildren.length
    ? node.sizes
    : Array.from({ length: normalizedChildren.length }, () => 100 / normalizedChildren.length);

  return {
    type: "split",
    id: node.id,
    direction: node.direction,
    children: normalizedChildren,
    sizes: normalizedSizes,
  };
}

function findFirstPaneId(node: LayoutNode): string {
  if (node.type === "pane") {
    return node.id;
  }

  return findFirstPaneId(node.children[0]);
}

export async function saveWorkbenchSession(
  workspaceKey: string | null | undefined,
  workspaceRootPath: string | null | undefined,
  layout: LayoutState,
  sidebarCollapsed: boolean,
): Promise<void> {
  const storageKey = getWorkbenchSessionStorageKey(workspaceKey, workspaceRootPath);
  if (!storageKey) {
    return;
  }

  const storage = getStorageAdapter();
  await storage.set(storageKey, serializeWorkbenchSession(layout, sidebarCollapsed));
}

export async function loadWorkbenchSession(
  workspaceKey: string | null | undefined,
  workspaceRootPath: string | null | undefined,
  rootHandle: FileSystemDirectoryHandle,
): Promise<{ layout: LayoutState; sidebarCollapsed: boolean } | null> {
  const storageKey = getWorkbenchSessionStorageKey(workspaceKey, workspaceRootPath);
  if (!storageKey) {
    return null;
  }

  const storage = getStorageAdapter();
  const persisted = await storage.get<PersistedWorkbenchSession>(storageKey);
  if (!persisted || !isPersistedWorkbenchSession(persisted)) {
    return null;
  }

  const root = await deserializeNode(rootHandle, persisted.root);
  const activePaneId = persisted.activePaneId || findFirstPaneId(root);

  return {
    layout: {
      root,
      activePaneId,
    },
    sidebarCollapsed: persisted.sidebarCollapsed,
  };
}

export async function clearWorkbenchSession(
  workspaceKey: string | null | undefined,
  workspaceRootPath: string | null | undefined,
): Promise<void> {
  const storageKey = getWorkbenchSessionStorageKey(workspaceKey, workspaceRootPath);
  if (!storageKey) {
    return;
  }

  const storage = getStorageAdapter();
  await storage.remove(storageKey);
}

export function createDefaultLayout(): LayoutState {
  const initialPaneId = "pane-initial";
  return {
    root: createEmptyPane(initialPaneId),
    activePaneId: initialPaneId,
  };
}

// Legacy aliases kept for compatibility with older imports.
export const saveLayoutToStorage = saveWorkbenchSession;
export const loadLayoutFromStorage = loadWorkbenchSession;
export const clearLayoutStorage = clearWorkbenchSession;
