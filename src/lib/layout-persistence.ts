/**
 * Layout Persistence
 * 
 * Functions for serializing and deserializing layout state to/from localStorage.
 */

import type {
  LayoutState,
  LayoutNode,
  PaneNode,
  SplitNode,
  TabState,
  SerializedLayout,
  SerializedLayoutNode,
  SerializedPaneNode,
  SerializedSplitNode,
  SerializedTab,
} from "@/types/layout";
import { isPaneNode } from "@/types/layout";
import { createEmptyPane } from "./layout-utils";

const LAYOUT_STORAGE_KEY = "lattice-layout-v1";

/**
 * Serialize a tab to a JSON-safe format
 */
function serializeTab(tab: TabState): SerializedTab {
  return {
    id: tab.id,
    filePath: tab.filePath,
    fileName: tab.fileName,
    isDirty: tab.isDirty,
    scrollPosition: tab.scrollPosition,
  };
}

/**
 * Serialize a layout node recursively
 */
function serializeNode(node: LayoutNode): SerializedLayoutNode {
  if (isPaneNode(node)) {
    const serializedPane: SerializedPaneNode = {
      type: "pane",
      id: node.id,
      tabs: node.tabs.map(serializeTab),
      activeTabIndex: node.activeTabIndex,
    };
    return serializedPane;
  }

  const serializedSplit: SerializedSplitNode = {
    type: "split",
    id: node.id,
    direction: node.direction,
    children: node.children.map(serializeNode),
    sizes: node.sizes,
  };
  return serializedSplit;
}

/**
 * Serialize the complete layout state
 */
export function serializeLayout(
  layout: LayoutState,
  sidebarCollapsed: boolean
): SerializedLayout {
  return {
    version: 1,
    root: serializeNode(layout.root),
    activePaneId: layout.activePaneId,
    sidebarCollapsed,
  };
}

/**
 * Deserialize a tab, restoring the file handle from the workspace
 */
async function deserializeTab(
  serializedTab: SerializedTab,
  rootHandle: FileSystemDirectoryHandle
): Promise<TabState | null> {
  try {
    // Navigate to the file using the path
    const pathParts = serializedTab.filePath.split("/").filter(Boolean);
    let currentHandle: FileSystemDirectoryHandle | FileSystemFileHandle = rootHandle;

    for (let i = 0; i < pathParts.length; i++) {
      const part = pathParts[i];
      const isLast = i === pathParts.length - 1;

      if (isLast) {
        // Get file handle
        currentHandle = await (currentHandle as FileSystemDirectoryHandle).getFileHandle(part);
      } else {
        // Get directory handle
        currentHandle = await (currentHandle as FileSystemDirectoryHandle).getDirectoryHandle(part);
      }
    }

    return {
      id: serializedTab.id,
      fileHandle: currentHandle as FileSystemFileHandle,
      fileName: serializedTab.fileName,
      filePath: serializedTab.filePath,
      isDirty: false, // Reset dirty state on load
      scrollPosition: serializedTab.scrollPosition,
    };
  } catch {
    // File not found or access denied
    return null;
  }
}

/**
 * Deserialize a layout node recursively
 */
async function deserializeNode(
  serializedNode: SerializedLayoutNode,
  rootHandle: FileSystemDirectoryHandle
): Promise<LayoutNode> {
  if (serializedNode.type === "pane") {
    // Deserialize tabs, filtering out any that couldn't be restored
    const tabPromises = serializedNode.tabs.map((tab) =>
      deserializeTab(tab, rootHandle)
    );
    const tabs = (await Promise.all(tabPromises)).filter(
      (tab): tab is TabState => tab !== null
    );

    const pane: PaneNode = {
      type: "pane",
      id: serializedNode.id,
      tabs,
      activeTabIndex:
        tabs.length > 0
          ? Math.min(serializedNode.activeTabIndex, tabs.length - 1)
          : -1,
    };
    return pane;
  }

  // Deserialize children
  const childPromises = serializedNode.children.map((child) =>
    deserializeNode(child, rootHandle)
  );
  const children = await Promise.all(childPromises);

  const split: SplitNode = {
    type: "split",
    id: serializedNode.id,
    direction: serializedNode.direction,
    children,
    sizes: serializedNode.sizes,
  };
  return split;
}

/**
 * Save layout to localStorage
 */
export function saveLayoutToStorage(
  layout: LayoutState,
  sidebarCollapsed: boolean
): void {
  try {
    const serialized = serializeLayout(layout, sidebarCollapsed);
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(serialized));
  } catch (error) {
    console.error("Failed to save layout:", error);
  }
}

/**
 * Load layout from localStorage
 */
export async function loadLayoutFromStorage(
  rootHandle: FileSystemDirectoryHandle
): Promise<{ layout: LayoutState; sidebarCollapsed: boolean } | null> {
  try {
    const stored = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!stored) return null;

    const serialized: SerializedLayout = JSON.parse(stored);

    // Validate version
    if (serialized.version !== 1) {
      console.warn("Unknown layout version, using default");
      return null;
    }

    const root = await deserializeNode(serialized.root, rootHandle);

    return {
      layout: {
        root,
        activePaneId: serialized.activePaneId,
      },
      sidebarCollapsed: serialized.sidebarCollapsed,
    };
  } catch (error) {
    console.error("Failed to load layout:", error);
    return null;
  }
}

/**
 * Clear saved layout from localStorage
 */
export function clearLayoutStorage(): void {
  localStorage.removeItem(LAYOUT_STORAGE_KEY);
}

/**
 * Create default layout state
 */
export function createDefaultLayout(): LayoutState {
  const initialPaneId = "pane-initial";
  return {
    root: createEmptyPane(initialPaneId),
    activePaneId: initialPaneId,
  };
}
