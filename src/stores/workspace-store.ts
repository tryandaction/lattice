import { create } from "zustand";
import type { FileTree, DirectoryNode, TreeNode } from "@/types/file-system";
import type {
  LayoutState,
  LayoutNode,
  PaneId,
  PaneNode,
  SplitDirection,
  TabState,
} from "@/types/layout";
import {
  createEmptyPane,
  createTab,
  splitPane as splitPaneUtil,
  removePane as removePaneUtil,
  updateSizes as updateSizesUtil,
  addTabToPane,
  removeTabFromPane,
  removeTabsByPath as removeTabsByPathUtil,
  updateTabsPath as updateTabsPathUtil,
  reorderTabsInPane,
  moveTabBetweenPanes,
  setActiveTabInPane,
  setTabDirty as setTabDirtyUtil,
  findPane,
  getAllPaneIds,
  getFirstPaneId,
  generatePaneId,
} from "@/lib/layout-utils";
import { emitFileOpen, emitFileClose, emitWorkspaceOpen, emitActiveFileChange } from "@/lib/plugins/runtime";

/**
 * Create initial layout with a single empty pane
 */
const createInitialLayout = (): LayoutState => {
  const initialPaneId = 'pane-initial';
  return {
    root: createEmptyPane(initialPaneId),
    activePaneId: initialPaneId,
  };
};

/**
 * Initial empty file tree
 */
const initialFileTree: FileTree = {
  root: null,
};

/**
 * Helper to recursively toggle directory expansion
 */
function toggleNodeExpansion(
  node: TreeNode,
  targetPath: string
): TreeNode {
  if (node.kind === "file") {
    return node;
  }

  if (node.path === targetPath) {
    return {
      ...node,
      isExpanded: !node.isExpanded,
    };
  }

  return {
    ...node,
    children: node.children.map((child) =>
      toggleNodeExpansion(child, targetPath)
    ),
  };
}

/**
 * Workspace state interface
 */
interface WorkspaceState {
  // File system state
  rootHandle: FileSystemDirectoryHandle | null;
  fileTree: FileTree;
  isLoading: boolean;
  error: string | null;

  // Layout state (new advanced layout system)
  layout: LayoutState;
  sidebarCollapsed: boolean;

  // File system actions
  setRootHandle: (handle: FileSystemDirectoryHandle | null) => void;
  setFileTree: (tree: FileTree) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearWorkspace: () => void;
  toggleDirectory: (path: string) => void;

  // Layout actions
  splitPane: (paneId: PaneId, direction: SplitDirection) => PaneId | null;
  closePane: (paneId: PaneId) => boolean;
  setActivePaneId: (paneId: PaneId) => void;
  resizePanes: (splitId: string, sizes: number[]) => void;

  // Tab actions
  openFileInPane: (paneId: PaneId, handle: FileSystemFileHandle, path: string) => void;
  openFileInActivePane: (handle: FileSystemFileHandle, path: string) => void;
  closeTab: (paneId: PaneId, tabIndex: number) => void;
  closeTabsByPath: (path: string) => void;
  updateTabPath: (oldPath: string, newPath: string) => void;
  setActiveTab: (paneId: PaneId, tabIndex: number) => void;
  reorderTabs: (paneId: PaneId, fromIndex: number, toIndex: number) => void;
  moveTabToPane: (sourcePaneId: PaneId, tabIndex: number, targetPaneId: PaneId) => void;
  moveTabToNewSplit: (sourcePaneId: PaneId, tabIndex: number, targetPaneId: PaneId, direction: SplitDirection) => void;
  setTabDirty: (paneId: PaneId, tabIndex: number, isDirty: boolean) => void;
  
  // Batch tab operations
  closeAllTabs: (paneId: PaneId) => TabState[];
  closeSavedTabs: (paneId: PaneId) => void;
  closeOtherTabs: (paneId: PaneId, keepTabIndex: number) => TabState[];
  getUnsavedTabs: (paneId: PaneId) => TabState[];

  // Sidebar actions
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;

  // Helper getters
  getActivePane: () => PaneNode | null;
  getActiveTab: () => TabState | null;
}

/**
 * Workspace store using Zustand
 * Manages the state of the opened folder, file tree, and advanced multi-pane workbench
 */
export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  // Initial file system state
  rootHandle: null,
  fileTree: initialFileTree,
  isLoading: false,
  error: null,

  // Initial layout state
  layout: createInitialLayout(),
  sidebarCollapsed: false,

  // File system actions
  setRootHandle: (handle) => {
    set({ rootHandle: handle });
    if (handle) {
      emitWorkspaceOpen(handle.name);
      // Trigger workspace indexing for AI context
      import('@/lib/ai/workspace-indexer').then(({ indexWorkspace }) => {
        indexWorkspace(handle).catch(() => {});
      }).catch(() => {});
    }
  },
  setFileTree: (tree) => set({ fileTree: tree }),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),

  clearWorkspace: () =>
    set({
      rootHandle: null,
      fileTree: initialFileTree,
      isLoading: false,
      error: null,
      layout: createInitialLayout(),
    }),

  toggleDirectory: (path) =>
    set((state) => {
      if (!state.fileTree.root) return state;
      const newRoot = toggleNodeExpansion(state.fileTree.root, path) as DirectoryNode;
      return { fileTree: { root: newRoot } };
    }),

  // Layout actions
  splitPane: (paneId, direction) => {
    const newPaneId = generatePaneId();
    set((state) => {
      const newRoot = splitPaneUtil(state.layout.root, paneId, direction, newPaneId);
      return {
        layout: {
          ...state.layout,
          root: newRoot,
          activePaneId: newPaneId, // Activate the new pane
        },
      };
    });
    return newPaneId;
  },

  closePane: (paneId) => {
    const state = get();
    const newRoot = removePaneUtil(state.layout.root, paneId);
    
    if (newRoot === null) {
      // Cannot close the last pane
      return false;
    }

    // If closing the active pane, switch to another pane
    let newActivePaneId = state.layout.activePaneId;
    if (paneId === state.layout.activePaneId) {
      const firstPaneId = getFirstPaneId(newRoot);
      newActivePaneId = firstPaneId ?? state.layout.activePaneId;
    }

    set({
      layout: {
        root: newRoot,
        activePaneId: newActivePaneId,
      },
    });
    return true;
  },

  setActivePaneId: (paneId) =>
    set((state) => {
      // Verify pane exists
      const paneIds = getAllPaneIds(state.layout.root);
      if (!paneIds.includes(paneId)) return state;
      
      return {
        layout: {
          ...state.layout,
          activePaneId: paneId,
        },
      };
    }),

  resizePanes: (splitId, sizes) =>
    set((state) => ({
      layout: {
        ...state.layout,
        root: updateSizesUtil(state.layout.root, splitId, sizes),
      },
    })),

  // Tab actions
  openFileInPane: (paneId, handle, path) => {
    set((state) => {
      const tab = createTab(handle, path);
      const newRoot = addTabToPane(state.layout.root, paneId, tab);
      return {
        layout: {
          ...state.layout,
          root: newRoot,
        },
      };
    });
    emitFileOpen(path);
  },

  openFileInActivePane: (handle, path) => {
    const { layout, openFileInPane } = get();
    openFileInPane(layout.activePaneId, handle, path);
  },

  closeTab: (paneId, tabIndex) => {
    const state = get();
    const pane = findPane(state.layout.root, paneId);
    const closedPath = pane?.tabs[tabIndex]?.filePath;
    set((state) => ({
      layout: {
        ...state.layout,
        root: removeTabFromPane(state.layout.root, paneId, tabIndex),
      },
    }));
    if (closedPath) {
      emitFileClose(closedPath);
    }
  },

  closeTabsByPath: (path) =>
    set((state) => ({
      layout: {
        ...state.layout,
        root: removeTabsByPathUtil(state.layout.root, path),
      },
    })),

  updateTabPath: (oldPath, newPath) =>
    set((state) => ({
      layout: {
        ...state.layout,
        root: updateTabsPathUtil(state.layout.root, oldPath, newPath),
      },
    })),

  setActiveTab: (paneId, tabIndex) => {
    set((state) => ({
      layout: {
        ...state.layout,
        root: setActiveTabInPane(state.layout.root, paneId, tabIndex),
      },
    }));
    const pane = findPane(get().layout.root, paneId);
    const path = pane?.tabs[tabIndex]?.filePath ?? null;
    emitActiveFileChange(path);
  },

  reorderTabs: (paneId, fromIndex, toIndex) =>
    set((state) => ({
      layout: {
        ...state.layout,
        root: reorderTabsInPane(state.layout.root, paneId, fromIndex, toIndex),
      },
    })),

  moveTabToPane: (sourcePaneId, tabIndex, targetPaneId) =>
    set((state) => ({
      layout: {
        ...state.layout,
        root: moveTabBetweenPanes(state.layout.root, sourcePaneId, tabIndex, targetPaneId),
      },
    })),

  moveTabToNewSplit: (sourcePaneId, tabIndex, targetPaneId, direction) => {
    const state = get();
    const sourcePane = findPane(state.layout.root, sourcePaneId);
    if (!sourcePane || tabIndex < 0 || tabIndex >= sourcePane.tabs.length) return;

    const tab = sourcePane.tabs[tabIndex];

    // First, split the target pane
    const newPaneId = generatePaneId();
    let newRoot = splitPaneUtil(state.layout.root, targetPaneId, direction, newPaneId);

    // Remove tab from source pane
    newRoot = removeTabFromPane(newRoot, sourcePaneId, tabIndex);

    // Add tab to new pane
    newRoot = addTabToPane(newRoot, newPaneId, tab);

    set({
      layout: {
        root: newRoot,
        activePaneId: newPaneId,
      },
    });
  },

  setTabDirty: (paneId, tabIndex, isDirty) =>
    set((state) => ({
      layout: {
        ...state.layout,
        root: setTabDirtyUtil(state.layout.root, paneId, tabIndex, isDirty),
      },
    })),

  // Batch tab operations
  closeAllTabs: (paneId) => {
    const state = get();
    const pane = findPane(state.layout.root, paneId);
    if (!pane) return [];
    
    const unsavedTabs = pane.tabs.filter(tab => tab.isDirty);
    
    // Close all tabs by removing them one by one from the end
    let newRoot = state.layout.root;
    for (let i = pane.tabs.length - 1; i >= 0; i--) {
      newRoot = removeTabFromPane(newRoot, paneId, i);
    }
    
    set({
      layout: {
        ...state.layout,
        root: newRoot,
      },
    });
    
    return unsavedTabs;
  },

  closeSavedTabs: (paneId) => {
    const state = get();
    const pane = findPane(state.layout.root, paneId);
    if (!pane) return;
    
    // Find indices of saved tabs (not dirty)
    const savedIndices = pane.tabs
      .map((tab, index) => ({ tab, index }))
      .filter(({ tab }) => !tab.isDirty)
      .map(({ index }) => index)
      .reverse(); // Reverse to remove from end first
    
    let newRoot = state.layout.root;
    for (const index of savedIndices) {
      newRoot = removeTabFromPane(newRoot, paneId, index);
    }
    
    set({
      layout: {
        ...state.layout,
        root: newRoot,
      },
    });
  },

  closeOtherTabs: (paneId, keepTabIndex) => {
    const state = get();
    const pane = findPane(state.layout.root, paneId);
    if (!pane || keepTabIndex < 0 || keepTabIndex >= pane.tabs.length) return [];
    
    const unsavedTabs = pane.tabs.filter((tab, index) => index !== keepTabIndex && tab.isDirty);
    
    // Remove all tabs except the one to keep
    let newRoot = state.layout.root;
    for (let i = pane.tabs.length - 1; i >= 0; i--) {
      if (i !== keepTabIndex) {
        newRoot = removeTabFromPane(newRoot, paneId, i);
      }
    }
    
    // Adjust active tab index
    const newPane = findPane(newRoot, paneId);
    if (newPane && newPane.tabs.length > 0) {
      newRoot = setActiveTabInPane(newRoot, paneId, 0);
    }
    
    set({
      layout: {
        ...state.layout,
        root: newRoot,
      },
    });
    
    return unsavedTabs;
  },

  getUnsavedTabs: (paneId) => {
    const state = get();
    const pane = findPane(state.layout.root, paneId);
    if (!pane) return [];
    return pane.tabs.filter(tab => tab.isDirty);
  },

  // Sidebar actions
  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

  setSidebarCollapsed: (collapsed) =>
    set({ sidebarCollapsed: collapsed }),

  // Helper getters
  getActivePane: () => {
    const state = get();
    return findPane(state.layout.root, state.layout.activePaneId);
  },

  getActiveTab: () => {
    const state = get();
    const pane = findPane(state.layout.root, state.layout.activePaneId);
    if (!pane || pane.activeTabIndex < 0 || pane.activeTabIndex >= pane.tabs.length) {
      return null;
    }
    return pane.tabs[pane.activeTabIndex];
  },
}));

// Re-export types for convenience
export type { PaneId, SplitDirection, TabState, PaneNode, LayoutNode, LayoutState };
