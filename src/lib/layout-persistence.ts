/**
 * Workbench session persistence.
 *
 * Persists pane/tab layout per workspace root. Viewer-level state is persisted
 * separately through file-view-state and content-cache editorState.
 */

import { getStorageAdapter } from "@/lib/storage-adapter";
import { resolveEntry } from "@/lib/file-operations";
import type { CloudFileTabState, LayoutNode, LayoutState, PaneNode, SplitDirection } from "@/types/layout";
import { isPaneNode, isVSCodeWorkbenchTabState } from "@/types/layout";
import { createEmptyPane, createTab, createWebTab, generateTabId } from "@/lib/layout-utils";

const WORKBENCH_SESSION_VERSION = 1;
const WORKBENCH_SESSION_STORAGE_KEY_PREFIX = "lattice-workbench-session";

interface PersistedWorkbenchTab {
  kind: "file" | "web" | "cloud-file";
  filePath: string;
  fileName?: string;
  url?: string;
  pageTitle?: string | null;
  cloud?: CloudFileTabState["cloud"];
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

export interface StagedWorkbenchSession {
  initial: { layout: LayoutState; sidebarCollapsed: boolean } | null;
  complete: Promise<{ layout: LayoutState; sidebarCollapsed: boolean } | null>;
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
    const activeTab = node.tabs[node.activeTabIndex];
    const persistedTabs = node.tabs.filter((tab) => !isVSCodeWorkbenchTabState(tab));
    const activeTabIndex = persistedTabs.length === 0
      ? -1
      : activeTab && !isVSCodeWorkbenchTabState(activeTab)
        ? persistedTabs.findIndex((tab) => tab.id === activeTab.id)
        : Math.min(Math.max(node.activeTabIndex, 0), persistedTabs.length - 1);

    return {
      type: "pane",
      id: node.id,
      tabs: persistedTabs.map((tab) => ({
        kind: tab.kind === "web" ? "web" : tab.kind === "cloud-file" ? "cloud-file" : "file",
        filePath: tab.filePath,
        fileName: tab.fileName,
        ...(tab.kind === "web" ? { url: tab.url, pageTitle: tab.pageTitle } : {}),
        ...(tab.kind === "cloud-file" ? { cloud: tab.cloud } : {}),
      })),
      activeTabIndex: Math.max(0, activeTabIndex),
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
  rootHandle: FileSystemDirectoryHandle | null,
  persistedTab: PersistedWorkbenchTab,
) {
  if (persistedTab.kind === "cloud-file") {
    const source = persistedTab.cloud;
    if (!source || !source.scope || !source.resourceId || !source.libraryId || !source.itemId || !persistedTab.filePath.startsWith("cloud://")) return null;
    // Restored locators do not authorize access. The provider revalidates every
    // displayed document after the matching account has connected.
    return { id: generateTabId(), kind: "cloud-file", fileName: persistedTab.fileName ?? "Cloud file",
      filePath: persistedTab.filePath, isDirty: false, scrollPosition: 0, cloud: { ...source, role: "viewer" } } as CloudFileTabState;
  }
  if (persistedTab.kind === "web") {
    if (!persistedTab.url) {
      return null;
    }
    return createWebTab(persistedTab.url, {
      fileName: persistedTab.fileName,
      pageTitle: persistedTab.pageTitle ?? null,
    });
  }

  if (!rootHandle) return null;
  const entry = await resolveEntry(rootHandle, persistedTab.filePath);
  if (!entry || entry.kind !== "file") {
    return null;
  }

  return createTab(entry.handle as FileSystemFileHandle, persistedTab.filePath);
}

async function deserializeNode(
  rootHandle: FileSystemDirectoryHandle | null,
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

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("Workbench session hydration was aborted.", "AbortError");
  }
}

function yieldToMainThread(): Promise<void> {
  if (typeof window !== "undefined") {
    const win = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    };
    if (win.requestIdleCallback) {
      return new Promise((resolve) => {
        win.requestIdleCallback(() => resolve(), { timeout: 250 });
      });
    }
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function deserializeNodeActiveOnly(
  rootHandle: FileSystemDirectoryHandle | null,
  node: PersistedWorkbenchLayoutNode,
  signal?: AbortSignal,
): Promise<LayoutNode> {
  throwIfAborted(signal);
  if (node.type === "pane") {
    const activeIndex = Math.max(0, Math.min(node.activeTabIndex, node.tabs.length - 1));
    const activeTab = node.tabs[activeIndex];
    const tabs = activeTab
      ? [await deserializeTab(rootHandle, activeTab)]
      : [];
    const resolvedTabs = tabs.filter((tab): tab is PaneNode["tabs"][number] => tab !== null);
    return {
      type: "pane",
      id: node.id,
      tabs: resolvedTabs,
      activeTabIndex: resolvedTabs.length > 0 ? 0 : -1,
    };
  }

  const children = await Promise.all(node.children.map((child) => deserializeNodeActiveOnly(rootHandle, child, signal)));
  throwIfAborted(signal);
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

async function deserializeNodeBatched(
  rootHandle: FileSystemDirectoryHandle | null,
  node: PersistedWorkbenchLayoutNode,
  signal: AbortSignal | undefined,
  batchState: { count: number },
): Promise<LayoutNode> {
  throwIfAborted(signal);
  if (node.type === "pane") {
    const tabs: PaneNode["tabs"] = [];
    for (const persistedTab of node.tabs) {
      throwIfAborted(signal);
      if (batchState.count >= 2) {
        batchState.count = 0;
        await yieldToMainThread();
        throwIfAborted(signal);
      }
      const tab = await deserializeTab(rootHandle, persistedTab);
      batchState.count += 1;
      if (tab) tabs.push(tab);
    }
    return {
      type: "pane",
      id: node.id,
      tabs,
      activeTabIndex: tabs.length === 0
        ? -1
        : Math.max(0, Math.min(node.activeTabIndex, tabs.length - 1)),
    };
  }

  const children: LayoutNode[] = [];
  for (const child of node.children) {
    children.push(await deserializeNodeBatched(rootHandle, child, signal, batchState));
  }
  throwIfAborted(signal);
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
  rootHandle: FileSystemDirectoryHandle | null,
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

export async function loadWorkbenchSessionStaged(
  workspaceKey: string | null | undefined,
  workspaceRootPath: string | null | undefined,
  rootHandle: FileSystemDirectoryHandle | null,
  options: { signal?: AbortSignal } = {},
): Promise<StagedWorkbenchSession> {
  const storageKey = getWorkbenchSessionStorageKey(workspaceKey, workspaceRootPath);
  if (!storageKey) {
    return { initial: null, complete: Promise.resolve(null) };
  }

  const storage = getStorageAdapter();
  const persisted = await storage.get<PersistedWorkbenchSession>(storageKey);
  if (!persisted || !isPersistedWorkbenchSession(persisted)) {
    return { initial: null, complete: Promise.resolve(null) };
  }

  const initialRoot = await deserializeNodeActiveOnly(rootHandle, persisted.root, options.signal);
  const initial = {
    layout: {
      root: initialRoot,
      activePaneId: persisted.activePaneId || findFirstPaneId(initialRoot),
    },
    sidebarCollapsed: persisted.sidebarCollapsed,
  };
  const complete = (async () => {
    try {
      const root = await deserializeNodeBatched(rootHandle, persisted.root, options.signal, { count: 0 });
      return {
        layout: {
          root,
          activePaneId: persisted.activePaneId || findFirstPaneId(root),
        },
        sidebarCollapsed: persisted.sidebarCollapsed,
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return null;
      }
      throw error;
    }
  })();

  return { initial, complete };
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
