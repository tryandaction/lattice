import { create } from "zustand";
import type { FileTree, DirectoryNode, TreeNode } from "@/types/file-system";
import type { WorkspaceRunnerPreferences } from "@/lib/runner/types";
import type { VSCodeWorkbenchSettings, VSCodeKeybinding, VSCodeSnippetDefinition, VSCodeTask, VSCodeExtensionInventoryEntry } from "@/lib/vscode-compat/types";
import type {
  LayoutState,
  LayoutNode,
  PaneId,
  PaneNode,
  CommandBarState,
  SplitDirection,
  TabState,
} from "@/types/layout";
import {
  createEmptyPane,
  createTab,
  createWebTab,
  splitPane as splitPaneUtil,
  removePane as removePaneUtil,
  updateSizes as updateSizesUtil,
  addTabToPane,
  removeTabFromPane,
  removeTabsByPath as removeTabsByPathUtil,
  removeTabsByPrefix as removeTabsByPrefixUtil,
  removeTabsToRightInPane as removeTabsToRightInPaneUtil,
  updateTabsPath as updateTabsPathUtil,
  updateTabsFile as updateTabsFileUtil,
  updateTabsPathPrefix as updateTabsPathPrefixUtil,
  reorderTabsInPane,
  moveTabBetweenPanes,
  setActiveTabInPane,
  setTabDirty as setTabDirtyUtil,
  findPane,
  updatePaneTabs,
  getAllPaneIds,
  getFirstPaneId,
  generatePaneId,
} from "@/lib/layout-utils";
import { emitFileOpen, emitFileClose, emitWorkspaceOpen, emitActiveFileChange } from "@/lib/plugins/runtime";
import { buildExecutionScopeId } from "@/lib/runner/execution-scope";
import { destroyExecutionScope, destroyExecutionScopes } from "@/stores/execution-session-store";
import type { WorkspaceIdentity } from "@/types/workspace-identity";
import { setDesktopPreviewRoot } from "@/lib/desktop-preview";
import { isFileTabState, isWebTabState } from "@/types/layout";
import { destroyDesktopWebview, getDesktopWebviewLabelForTab } from "@/lib/desktop-webview";
import { createCloudFileTab } from "@/lib/shared-library/workbench-source";
import type { CloudLibraryResource } from "@/lib/shared-library/source-provider";
import type { CloudFileTabState } from "@/types/layout";

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

export function createInitialRunnerPreferences(): WorkspaceRunnerPreferences {
  return {
    defaultPythonPath: null,
    defaultLanguageRunners: {},
    recentRunByFile: {},
  };
}

/**
 * Helper to recursively toggle directory expansion
 */
function toggleNodeExpansion(
  node: TreeNode,
  targetPath: string
): TreeNode {
  if (node.kind === "file") {
    if (node.path === targetPath && (node.children?.length || node.canExpandVirtualChildren)) {
      return {
        ...node,
        isExpanded: !node.isExpanded,
      };
    }
  } else if (node.path === targetPath) {
    return {
      ...node,
      isExpanded: !node.isExpanded,
    };
  }

  if (!node.children?.length) return node;
  const children = node.children.map((child) => toggleNodeExpansion(child, targetPath));
  return children.every((child, index) => child === node.children![index])
    ? node
    : { ...node, children };
}

function collectExecutionScopeIds(root: LayoutNode): string[] {
  if (root.type === "pane") {
    return root.tabs.map((tab) => buildExecutionScopeId({
      paneId: root.id,
      tabId: tab.id,
    }));
  }
  return root.children.flatMap((child) => collectExecutionScopeIds(child));
}

function collectExecutionScopeIdsByPath(root: LayoutNode, predicate: (tab: TabState) => boolean): string[] {
  if (root.type === "pane") {
    return root.tabs
      .filter(predicate)
      .map((tab) => buildExecutionScopeId({
        paneId: root.id,
        tabId: tab.id,
      }));
  }
  return root.children.flatMap((child) => collectExecutionScopeIdsByPath(child, predicate));
}

function collectDesktopWebviewLabels(root: LayoutNode): string[] {
  if (root.type === "pane") {
    return root.tabs
      .filter((tab) => isWebTabState(tab))
      .map((tab) => getDesktopWebviewLabelForTab(tab.id));
  }
  return root.children.flatMap((child) => collectDesktopWebviewLabels(child));
}

async function destroyDesktopWebviewsByLabels(labels: string[]): Promise<void> {
  for (const label of labels) {
    await destroyDesktopWebview(label);
  }
}

/**
 * Workspace state interface
 */
interface WorkspaceState {
  // File system state
  rootHandle: FileSystemDirectoryHandle | null;
  workspaceRootHandle: FileSystemDirectoryHandle | null; // True workspace root for .lattice access
  workspaceRootPath: string | null;
  workspaceIdentity: WorkspaceIdentity | null;
  fileTree: FileTree;
  isLoading: boolean;
  error: string | null;
  selectedDirectoryPath: string | null; // 新增：当前选中的文件夹路径
  runnerPreferences: WorkspaceRunnerPreferences;
  vscodeCompatSettings: VSCodeWorkbenchSettings;
  vscodeCompatKeybindings: VSCodeKeybinding[];
  vscodeCompatSnippets: VSCodeSnippetDefinition[];
  vscodeCompatTasks: VSCodeTask[];
  vscodeCompatExtensions: VSCodeExtensionInventoryEntry[];
  vscodeCompatSourceLabel: string | null;
  vscodeCompatImportedAt: number | null;
  vscodeCompatWarnings: string[];
  // Workspace root history for nested workspace detection
  workspaceRootHistory: Map<string, FileSystemDirectoryHandle>; // path → rootHandle

  // Layout state (new advanced layout system)
  layout: LayoutState;
  sidebarCollapsed: boolean;
  commandBarByPane: Record<PaneId, CommandBarState>;
  paneTabFilterRequests: Record<PaneId, { filter: "web"; token: number }>;

  // File system actions
  setRootHandle: (handle: FileSystemDirectoryHandle | null) => void;
  setWorkspaceRootHandle: (handle: FileSystemDirectoryHandle | null) => void;
  setWorkspaceRootPath: (path: string | null) => void;
  registerWorkspaceRoot: (path: string, handle: FileSystemDirectoryHandle) => void;
  findWorkspaceRootForPath: (path: string) => FileSystemDirectoryHandle | null;
  clearWorkspaceRootHistory: () => void;
  setWorkspaceIdentity: (identity: WorkspaceIdentity | null) => void;
  setFileTree: (tree: FileTree) => void;
  updateFileTree: (updater: (tree: FileTree) => FileTree) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearWorkspace: () => void;
  toggleDirectory: (path: string) => void;
  setSelectedDirectoryPath: (path: string | null) => void; // 新增：设置选中的文件夹
  setRunnerPreferences: (preferences: Partial<WorkspaceRunnerPreferences>) => void;
  replaceRunnerPreferences: (preferences: WorkspaceRunnerPreferences) => void;
  setVSCodeCompatConfig: (config: {
    settings: VSCodeWorkbenchSettings;
    keybindings: VSCodeKeybinding[];
    snippets: VSCodeSnippetDefinition[];
    tasks: VSCodeTask[];
    extensions?: VSCodeExtensionInventoryEntry[];
    sourceLabel?: string | null;
    importedAt?: number | null;
    warnings?: string[];
  }) => void;
  resetVSCodeCompatConfig: () => void;
  setRecentRunConfig: (
    filePath: string,
    config: WorkspaceRunnerPreferences["recentRunByFile"][string],
  ) => void;
  clearRecentRunConfig: (filePath: string) => void;

  // Layout actions
  splitPane: (paneId: PaneId, direction: SplitDirection) => PaneId | null;
  closePane: (paneId: PaneId) => boolean;
  setActivePaneId: (paneId: PaneId) => void;
  resizePanes: (splitId: string, sizes: number[]) => void;
  setCommandBarState: (paneId: PaneId, state: CommandBarState) => void;
  clearCommandBarState: (paneId: PaneId, scopeId?: string | null) => void;
  restoreWorkbenchState: (layout: LayoutState, sidebarCollapsed?: boolean) => void;
  resetWorkbenchState: (sidebarCollapsed?: boolean) => void;
  requestPaneTabFilter: (paneId: PaneId, filter: "web") => void;

  // Tab actions
  openFileInLatticePane: (paneId: PaneId, handle: FileSystemFileHandle, path: string) => void;
  openFileInPane: (paneId: PaneId, handle: FileSystemFileHandle, path: string) => void;
  openFileInActivePane: (handle: FileSystemFileHandle, path: string) => void;
  openCloudFileInPane: (paneId: PaneId, resource: CloudLibraryResource, scope: string) => void;
  openCloudFileInActivePane: (resource: CloudLibraryResource, scope: string) => void;
  updateCloudTab: (tabId: string, update: Partial<Pick<CloudFileTabState, "fileName" | "cloud">>) => void;
  openWebUrlInPane: (paneId: PaneId, url: string, options?: { fileName?: string; pageTitle?: string | null }) => void;
  openWebUrlInActivePane: (url: string, options?: { fileName?: string; pageTitle?: string | null }) => void;
  updateWebTab: (paneId: PaneId, tabId: string, update: { url?: string; fileName?: string; pageTitle?: string | null }) => void;
  reloadWebTab: (paneId: PaneId, tabId: string) => void;
  closeTab: (paneId: PaneId, tabIndex: number) => void;
  closeTabsByPath: (path: string) => void;
  closeTabsByPrefix: (pathPrefix: string) => void;
  updateTabPath: (oldPath: string, newPath: string) => void;
  updateTabFile: (oldPath: string, newPath: string, handle: FileSystemFileHandle) => void;
  updateTabPathPrefix: (oldPathPrefix: string, newPathPrefix: string) => void;
  setActiveTab: (paneId: PaneId, tabIndex: number) => void;
  reorderTabs: (paneId: PaneId, fromIndex: number, toIndex: number) => void;
  moveTabToPane: (sourcePaneId: PaneId, tabIndex: number, targetPaneId: PaneId) => void;
  moveTabToNewSplit: (sourcePaneId: PaneId, tabIndex: number, targetPaneId: PaneId, direction: SplitDirection) => void;
  setTabDirty: (paneId: PaneId, tabIndex: number, isDirty: boolean) => void;
  
  // Batch tab operations
  closeAllTabs: (paneId: PaneId) => TabState[];
  closeSavedTabs: (paneId: PaneId) => void;
  closeOtherTabs: (paneId: PaneId, keepTabIndex: number) => TabState[];
  closeTabsToRight: (paneId: PaneId, tabIndex: number) => TabState[];
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
  workspaceRootHandle: null,
  workspaceRootPath: null,
  workspaceIdentity: null,
  fileTree: initialFileTree,
  isLoading: false,
  error: null,
  selectedDirectoryPath: null,
  runnerPreferences: createInitialRunnerPreferences(),
  vscodeCompatSettings: {
    tabSize: 2,
    insertSpaces: true,
    wordWrap: "off",
    fontFamily: null,
    fontSize: null,
    lineNumbers: "on",
    rulers: [],
    formatOnSave: false,
    formatOnType: false,
    minimapEnabled: true,
    quickSuggestions: true,
    suggestOnTriggerCharacters: true,
    autoClosingBrackets: true,
    autoClosingQuotes: true,
    autoIndent: "full",
    smoothScrolling: false,
    cursorBlinking: null,
    renderWhitespace: "none",
    snippetSuggestions: "inline",
    filesExclude: {},
    searchExclude: {},
    filesAssociations: {},
    defaultFormatter: null,
    colorTheme: null,
  },
  vscodeCompatKeybindings: [],
  vscodeCompatSnippets: [],
  vscodeCompatTasks: [],
  vscodeCompatExtensions: [],
  vscodeCompatSourceLabel: null,
  vscodeCompatImportedAt: null,
  vscodeCompatWarnings: [],
  workspaceRootHistory: new Map(),

  // Initial layout state
  layout: createInitialLayout(),
  sidebarCollapsed: false,
  commandBarByPane: {},
  paneTabFilterRequests: {},

  // File system actions
  setRootHandle: (handle) => {
    set({ rootHandle: handle });
    void import('@/lib/ai/workspace-indexer').then(({ clearWorkspaceIndex }) => {
      clearWorkspaceIndex();
    }).catch(() => {});
    void import('@/lib/markdown/workspace-link-index').then(({ clearWorkspaceMarkdownLinkIndex }) => {
      clearWorkspaceMarkdownLinkIndex();
    }).catch(() => {});
    if (!handle) return;

    emitWorkspaceOpen(handle.name);
  },
  setWorkspaceRootHandle: (handle) => set({ workspaceRootHandle: handle }),
  setWorkspaceRootPath: (path) => {
    if (get().workspaceRootPath !== path) {
      void setDesktopPreviewRoot(path);
    }
    set({ workspaceRootPath: path });
  },
  registerWorkspaceRoot: (path, handle) =>
    set((state) => {
      const next = new Map(state.workspaceRootHistory);
      next.set(path, handle);
      return { workspaceRootHistory: next };
    }),
  findWorkspaceRootForPath: (path) => {
    const state = get();
    const canonicalPath = path
      .split("#", 1)[0]
      ?.split("?", 1)[0]
      ?.replaceAll("\\", "/") ?? path;
    // First check if path is under workspaceRootHandle's name
    const rootName = state.workspaceRootHandle?.name;
    if (rootName && (canonicalPath === rootName || canonicalPath.startsWith(`${rootName}/`))) {
      return state.workspaceRootHandle;
    }
    // Check history for a matching ancestor path
    for (const [historyPath, historyHandle] of state.workspaceRootHistory) {
      const canonicalHistoryPath = historyPath
        .split("#", 1)[0]
        ?.split("?", 1)[0]
        ?.replaceAll("\\", "/") ?? historyPath;
      if (canonicalPath === canonicalHistoryPath || canonicalPath.startsWith(`${canonicalHistoryPath}/`)) {
        return historyHandle;
      }
    }
    // Fall back to workspaceRootHandle
    return state.workspaceRootHandle;
  },
  clearWorkspaceRootHistory: () => set({ workspaceRootHistory: new Map() }),
  setWorkspaceIdentity: (identity) => set({ workspaceIdentity: identity }),
  setFileTree: (tree) => set({ fileTree: tree }),
  updateFileTree: (updater) => set((state) => ({ fileTree: updater(state.fileTree) })),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),

  clearWorkspace: () => {
    const scopeIds = collectExecutionScopeIds(get().layout.root);
    const desktopWebviewLabels = collectDesktopWebviewLabels(get().layout.root);
    set({
      rootHandle: null,
      workspaceRootHandle: null,
      workspaceRootPath: null,
      workspaceIdentity: null,
      fileTree: initialFileTree,
      isLoading: false,
      error: null,
      layout: createInitialLayout(),
      runnerPreferences: createInitialRunnerPreferences(),
      commandBarByPane: {},
      paneTabFilterRequests: {},
      workspaceRootHistory: new Map(),
    });
    void import('@/lib/ai/workspace-indexer').then(({ clearWorkspaceIndex }) => {
      clearWorkspaceIndex();
    }).catch(() => {});
    void import('@/lib/markdown/workspace-link-index').then(({ clearWorkspaceMarkdownLinkIndex }) => {
      clearWorkspaceMarkdownLinkIndex();
    }).catch(() => {});
    void setDesktopPreviewRoot(null);
    void destroyExecutionScopes(scopeIds);
    void destroyDesktopWebviewsByLabels(desktopWebviewLabels);
  },

  toggleDirectory: (path) =>
    set((state) => {
      if (!state.fileTree.root) return state;
      const newRoot = toggleNodeExpansion(state.fileTree.root, path) as DirectoryNode;
      if (newRoot === state.fileTree.root) return state;
      return { fileTree: { root: newRoot } };
    }),

  setSelectedDirectoryPath: (path) => set({ selectedDirectoryPath: path }),
  setRunnerPreferences: (preferences) =>
    set((state) => ({
      runnerPreferences: {
        ...state.runnerPreferences,
        ...preferences,
        defaultLanguageRunners: {
          ...state.runnerPreferences.defaultLanguageRunners,
          ...preferences.defaultLanguageRunners,
        },
        recentRunByFile: {
          ...state.runnerPreferences.recentRunByFile,
          ...preferences.recentRunByFile,
        },
      },
    })),
  replaceRunnerPreferences: (preferences) =>
    set({
      runnerPreferences: {
        defaultPythonPath: preferences.defaultPythonPath ?? null,
        defaultLanguageRunners: { ...(preferences.defaultLanguageRunners ?? {}) },
        recentRunByFile: { ...(preferences.recentRunByFile ?? {}) },
      },
    }),
  setVSCodeCompatConfig: (config) =>
    set({
      vscodeCompatSettings: config.settings,
      vscodeCompatKeybindings: [...config.keybindings],
      vscodeCompatSnippets: [...config.snippets],
      vscodeCompatTasks: [...config.tasks],
      vscodeCompatExtensions: [...(config.extensions ?? [])],
      vscodeCompatSourceLabel: config.sourceLabel ?? null,
      vscodeCompatImportedAt: config.importedAt ?? Date.now(),
      vscodeCompatWarnings: [...(config.warnings ?? [])],
    }),
  resetVSCodeCompatConfig: () =>
    set({
      vscodeCompatSettings: {
        tabSize: 2,
        insertSpaces: true,
        wordWrap: "off",
        fontFamily: null,
        fontSize: null,
        lineNumbers: "on",
        rulers: [],
        formatOnSave: false,
        formatOnType: false,
        minimapEnabled: true,
        quickSuggestions: true,
        suggestOnTriggerCharacters: true,
        autoClosingBrackets: true,
        autoClosingQuotes: true,
        autoIndent: "full",
        smoothScrolling: false,
        cursorBlinking: null,
        renderWhitespace: "none",
        snippetSuggestions: "inline",
        filesExclude: {},
        searchExclude: {},
        filesAssociations: {},
        defaultFormatter: null,
        colorTheme: null,
      },
      vscodeCompatKeybindings: [],
      vscodeCompatSnippets: [],
      vscodeCompatTasks: [],
      vscodeCompatExtensions: [],
      vscodeCompatSourceLabel: null,
      vscodeCompatImportedAt: null,
      vscodeCompatWarnings: [],
    }),
  setRecentRunConfig: (filePath, config) =>
    set((state) => ({
      runnerPreferences: {
        ...state.runnerPreferences,
        recentRunByFile: {
          ...state.runnerPreferences.recentRunByFile,
          [filePath]: config,
        },
      },
    })),
  clearRecentRunConfig: (filePath) =>
    set((state) => {
      const nextRecentRunByFile = { ...state.runnerPreferences.recentRunByFile };
      delete nextRecentRunByFile[filePath];
      return {
        runnerPreferences: {
          ...state.runnerPreferences,
          recentRunByFile: nextRecentRunByFile,
        },
      };
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

    const pane = findPane(state.layout.root, paneId);
    const scopeIds = pane?.tabs.map((tab) => buildExecutionScopeId({
      paneId,
      tabId: tab.id,
    })) ?? [];
    const desktopWebviewLabels = pane
      ? pane.tabs
          .filter((tab) => isWebTabState(tab))
          .map((tab) => getDesktopWebviewLabelForTab(tab.id))
      : [];

    set({
      layout: {
        root: newRoot,
        activePaneId: newActivePaneId,
      },
      commandBarByPane: Object.fromEntries(
        Object.entries(state.commandBarByPane).filter(([key]) => key !== paneId)
      ),
    });
    void destroyExecutionScopes(scopeIds);
    void destroyDesktopWebviewsByLabels(desktopWebviewLabels);
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

  setCommandBarState: (paneId, commandBarState) =>
    set((state) => ({
      commandBarByPane: {
        ...state.commandBarByPane,
        [paneId]: commandBarState,
      },
    })),

  clearCommandBarState: (paneId, scopeId) =>
    set((state) => {
      if (!(paneId in state.commandBarByPane)) {
        return state;
      }
      if (scopeId && state.commandBarByPane[paneId]?.scopeId && state.commandBarByPane[paneId]?.scopeId !== scopeId) {
        return state;
      }
      const next = { ...state.commandBarByPane };
      delete next[paneId];
      return { commandBarByPane: next };
    }),

  restoreWorkbenchState: (layout, sidebarCollapsed = false) =>
    {
      const scopeIds = collectExecutionScopeIds(get().layout.root);
      const desktopWebviewLabels = collectDesktopWebviewLabels(get().layout.root);
      set({
        layout,
        sidebarCollapsed,
        commandBarByPane: {},
        paneTabFilterRequests: {},
      });
      void destroyExecutionScopes(scopeIds);
      void destroyDesktopWebviewsByLabels(desktopWebviewLabels);
    },

  resetWorkbenchState: (sidebarCollapsed = false) =>
    {
      const scopeIds = collectExecutionScopeIds(get().layout.root);
      const desktopWebviewLabels = collectDesktopWebviewLabels(get().layout.root);
      set({
        layout: createInitialLayout(),
        sidebarCollapsed,
        commandBarByPane: {},
        paneTabFilterRequests: {},
      });
      void destroyExecutionScopes(scopeIds);
      void destroyDesktopWebviewsByLabels(desktopWebviewLabels);
    },

  requestPaneTabFilter: (paneId, filter) =>
    set((state) => ({
      paneTabFilterRequests: {
        ...state.paneTabFilterRequests,
        [paneId]: {
          filter,
          token: Date.now(),
        },
      },
    })),

  // Tab actions
  openFileInLatticePane: (paneId, handle, path) => {
    set((state) => {
      const tab = createTab(handle, path);
      const newRoot = addTabToPane(state.layout.root, paneId, tab);
      return {
        layout: {
          ...state.layout,
          activePaneId: paneId,
          root: newRoot,
        },
      };
    });
    emitFileOpen(path);
  },

  openFileInPane: (paneId, handle, path) => {
    get().openFileInLatticePane(paneId, handle, path);
  },

  openFileInActivePane: (handle, path) => {
    const { layout, openFileInPane } = get();
    openFileInPane(layout.activePaneId, handle, path);
  },

  openCloudFileInPane: (paneId, resource, scope) => {
    set((state) => ({ layout: {
      ...state.layout, activePaneId: paneId,
      root: addTabToPane(state.layout.root, paneId, createCloudFileTab(resource, scope)),
    } }));
  },
  openCloudFileInActivePane: (resource, scope) => {
    get().openCloudFileInPane(get().layout.activePaneId, resource, scope);
  },
  updateCloudTab: (tabId, update) => set((state) => {
    const visit = (node: LayoutNode): LayoutNode => node.type === "split"
      ? { ...node, children: node.children.map(visit) }
      : { ...node, tabs: node.tabs.map(tab => tab.id === tabId && tab.kind === "cloud-file" ? { ...tab, ...update } : tab) };
    return { layout: { ...state.layout, root: visit(state.layout.root) } };
  }),

  openWebUrlInPane: (paneId, url, options) => {
    set((state) => {
      const tab = createWebTab(url, options);
      const newRoot = addTabToPane(state.layout.root, paneId, tab);
      return {
        layout: {
          ...state.layout,
          root: newRoot,
        },
      };
    });
  },

  openWebUrlInActivePane: (url, options) => {
    const { layout, openWebUrlInPane } = get();
    openWebUrlInPane(layout.activePaneId, url, options);
  },

  updateWebTab: (paneId, tabId, update) =>
    set((state) => {
      const pane = findPane(state.layout.root, paneId);
      if (!pane) {
        return state;
      }

      const nextTabs = pane.tabs.map((tab) => {
        if (!isWebTabState(tab) || tab.id !== tabId) {
          return tab;
        }

        const nextUrl = update.url?.trim() || tab.url;
        const nextFileName = update.fileName?.trim() || update.pageTitle?.trim() || tab.fileName;
        const nextPageTitle = update.pageTitle === undefined ? tab.pageTitle : update.pageTitle;
        if (nextUrl === tab.url && nextFileName === tab.fileName && nextPageTitle === tab.pageTitle) return tab;
        return {
          ...tab,
          url: nextUrl,
          filePath: nextUrl,
          fileName: nextFileName,
          pageTitle: nextPageTitle,
        };
      });

      const hasChanges = nextTabs.some((tab, index) => tab !== pane.tabs[index]);
      if (!hasChanges) {
        return state;
      }

      return {
        layout: {
          ...state.layout,
          root: updatePaneTabs(state.layout.root, paneId, nextTabs, pane.activeTabIndex),
        },
      };
    }),

  reloadWebTab: (paneId, tabId) => {
    const pane = findPane(get().layout.root, paneId);
    const webTab = pane?.tabs.find((tab) => isWebTabState(tab) && tab.id === tabId);
    if (!webTab || !isWebTabState(webTab)) {
      return;
    }
    void destroyDesktopWebview(getDesktopWebviewLabelForTab(tabId));
  },

  closeTab: (paneId, tabIndex) => {
    const state = get();
    const pane = findPane(state.layout.root, paneId);
    const closedTab = pane?.tabs[tabIndex];
    const closedPath = closedTab?.filePath;
    const closedTabId = pane?.tabs[tabIndex]?.id;
    set((state) => ({
      layout: {
        ...state.layout,
        root: removeTabFromPane(state.layout.root, paneId, tabIndex),
      },
    }));
    if (closedTabId) {
      void destroyExecutionScope(buildExecutionScopeId({
        paneId,
        tabId: closedTabId,
      }));
    }
    if (closedPath && closedTab && isFileTabState(closedTab)) {
      emitFileClose(closedPath);
    }
    if (closedTab && isWebTabState(closedTab)) {
      void destroyDesktopWebview(getDesktopWebviewLabelForTab(closedTab.id));
    }
  },

  closeTabsByPath: (path) => {
    const layout = get().layout.root;
    const shouldEmitClose = collectExecutionScopeIdsByPath(layout, (tab) => tab.filePath === path).length > 0
      && (() => {
        const stack = [layout];
        while (stack.length > 0) {
          const current = stack.pop();
          if (!current) continue;
          if (current.type === "pane") {
            if (current.tabs.some((tab) => tab.filePath === path && isFileTabState(tab))) {
              return true;
            }
            continue;
          }
          stack.push(...current.children);
        }
        return false;
      })();
    const scopeIds = collectExecutionScopeIdsByPath(layout, (tab) => tab.filePath === path);
    set((state) => ({
      layout: {
        ...state.layout,
        root: removeTabsByPathUtil(state.layout.root, path),
      },
    }));
    void destroyExecutionScopes(scopeIds);
    void destroyDesktopWebviewsByLabels(
      (() => {
        const labels: string[] = [];
        const stack = [layout];
        while (stack.length > 0) {
          const current = stack.pop();
          if (!current) continue;
          if (current.type === "pane") {
            current.tabs.forEach((tab) => {
              if (tab.filePath === path && isWebTabState(tab)) {
                labels.push(getDesktopWebviewLabelForTab(tab.id));
              }
            });
            continue;
          }
          stack.push(...current.children);
        }
        return labels;
      })(),
    );
    if (shouldEmitClose) {
      emitFileClose(path);
    }
  },

  closeTabsByPrefix: (pathPrefix) => {
    const layout = get().layout.root;
    const scopeIds = collectExecutionScopeIdsByPath(layout, (tab) => tab.filePath.startsWith(pathPrefix));
    set((state) => ({
      layout: {
        ...state.layout,
        root: removeTabsByPrefixUtil(state.layout.root, pathPrefix),
      },
    }));
    void destroyExecutionScopes(scopeIds);
    void destroyDesktopWebviewsByLabels(
      (() => {
        const labels: string[] = [];
        const stack = [layout];
        while (stack.length > 0) {
          const current = stack.pop();
          if (!current) continue;
          if (current.type === "pane") {
            current.tabs.forEach((tab) => {
              if (tab.filePath.startsWith(pathPrefix) && isWebTabState(tab)) {
                labels.push(getDesktopWebviewLabelForTab(tab.id));
              }
            });
            continue;
          }
          stack.push(...current.children);
        }
        return labels;
      })(),
    );
  },

  updateTabPath: (oldPath, newPath) =>
    set((state) => ({
      layout: {
        ...state.layout,
        root: updateTabsPathUtil(state.layout.root, oldPath, newPath),
      },
    })),

  updateTabFile: (oldPath, newPath, handle) =>
    set((state) => ({
      layout: {
        ...state.layout,
        root: updateTabsFileUtil(state.layout.root, oldPath, newPath, handle),
      },
    })),

  updateTabPathPrefix: (oldPathPrefix, newPathPrefix) =>
    set((state) => ({
      layout: {
        ...state.layout,
        root: updateTabsPathPrefixUtil(state.layout.root, oldPathPrefix, newPathPrefix),
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
    {
      const sourcePane = findPane(get().layout.root, sourcePaneId);
      const tab = sourcePane?.tabs[tabIndex];
      set((state) => ({
        layout: {
          ...state.layout,
          root: moveTabBetweenPanes(state.layout.root, sourcePaneId, tabIndex, targetPaneId),
        },
      }));
      if (tab) {
        void destroyExecutionScope(buildExecutionScopeId({
          paneId: sourcePaneId,
          tabId: tab.id,
        }));
      }
    },

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
    void destroyExecutionScope(buildExecutionScopeId({
      paneId: sourcePaneId,
      tabId: tab.id,
    }));
  },

  setTabDirty: (paneId, tabIndex, isDirty) => {
    const state = get();
    const pane = findPane(state.layout.root, paneId);
    if (!pane || tabIndex < 0 || tabIndex >= pane.tabs.length) return;
    if (pane.tabs[tabIndex].isDirty === isDirty) return;
    set((s) => ({
      layout: {
        ...s.layout,
        root: setTabDirtyUtil(s.layout.root, paneId, tabIndex, isDirty),
      },
    }));
  },

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
    void destroyExecutionScopes(
      pane.tabs.map((tab) => buildExecutionScopeId({
        paneId,
        tabId: tab.id,
      })),
    );
    void destroyDesktopWebviewsByLabels(
      pane.tabs
        .filter((tab) => isWebTabState(tab))
        .map((tab) => getDesktopWebviewLabelForTab(tab.id)),
    );
    pane.tabs
      .filter((tab) => isFileTabState(tab))
      .forEach((tab) => emitFileClose(tab.filePath));
    emitActiveFileChange(null);
    
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
    void destroyExecutionScopes(
      pane.tabs
        .filter((tab) => !tab.isDirty)
        .map((tab) => buildExecutionScopeId({
          paneId,
          tabId: tab.id,
        })),
    );
    void destroyDesktopWebviewsByLabels(
      pane.tabs
        .filter((tab) => !tab.isDirty && isWebTabState(tab))
        .map((tab) => getDesktopWebviewLabelForTab(tab.id)),
    );
    pane.tabs
      .filter((tab) => !tab.isDirty && isFileTabState(tab))
      .forEach((tab) => emitFileClose(tab.filePath));
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
    void destroyExecutionScopes(
      pane.tabs
        .filter((tab, index) => index !== keepTabIndex)
        .map((tab) => buildExecutionScopeId({
          paneId,
          tabId: tab.id,
        })),
    );
    void destroyDesktopWebviewsByLabels(
      pane.tabs
        .filter((tab, index) => index !== keepTabIndex && isWebTabState(tab))
        .map((tab) => getDesktopWebviewLabelForTab(tab.id)),
    );
    pane.tabs
      .filter((tab, index) => index !== keepTabIndex && isFileTabState(tab))
      .forEach((tab) => emitFileClose(tab.filePath));
    emitActiveFileChange(pane.tabs[keepTabIndex]?.filePath ?? null);
    
    return unsavedTabs;
  },

  closeTabsToRight: (paneId, tabIndex) => {
    const state = get();
    const pane = findPane(state.layout.root, paneId);
    if (!pane || tabIndex < 0 || tabIndex >= pane.tabs.length - 1) return [];

    const closingTabs = pane.tabs.slice(tabIndex + 1);
    const unsavedTabs = closingTabs.filter((tab) => tab.isDirty);
    set({
      layout: {
        ...state.layout,
        root: removeTabsToRightInPaneUtil(state.layout.root, paneId, tabIndex),
      },
    });
    void destroyExecutionScopes(
      closingTabs.map((tab) => buildExecutionScopeId({
        paneId,
        tabId: tab.id,
      })),
    );
    void destroyDesktopWebviewsByLabels(
      closingTabs
        .filter((tab) => isWebTabState(tab))
        .map((tab) => getDesktopWebviewLabelForTab(tab.id)),
    );
    closingTabs
      .filter((tab) => isFileTabState(tab))
      .forEach((tab) => emitFileClose(tab.filePath));

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
