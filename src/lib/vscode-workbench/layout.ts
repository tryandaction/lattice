import { addTabToPane } from "@/lib/layout-utils";
import {
  isPaneNode,
  isVSCodeWorkbenchTabState,
  type LayoutNode,
  type TabState,
  type VSCodeWorkbenchTabState,
} from "@/types/layout";

const VSCODE_WORKBENCH_TAB_ID = "vscode-workbench";

export interface LocatedVSCodeWorkbenchTab {
  paneId: string;
  tab: VSCodeWorkbenchTabState;
}

function createVSCodeWorkbenchTab(workspacePath: string): VSCodeWorkbenchTabState {
  return {
    id: VSCODE_WORKBENCH_TAB_ID,
    kind: "vscode-workbench",
    fileName: "VS Code",
    filePath: `${VSCODE_WORKBENCH_TAB_ID}:${workspacePath}`,
    workspacePath,
    isDirty: false,
    scrollPosition: 0,
  };
}

export function findVSCodeWorkbenchTabs(root: LayoutNode): LocatedVSCodeWorkbenchTab[] {
  if (isPaneNode(root)) {
    return root.tabs
      .filter(isVSCodeWorkbenchTabState)
      .map((tab) => ({ paneId: root.id, tab }));
  }

  return root.children.flatMap(findVSCodeWorkbenchTabs);
}

function removeVSCodeWorkbenchTabs(root: LayoutNode): LayoutNode {
  if (isPaneNode(root)) {
    const activeTab = root.tabs[root.activeTabIndex];
    const tabs = root.tabs.filter((tab) => !isVSCodeWorkbenchTabState(tab));
    if (tabs.length === root.tabs.length) {
      return root;
    }

    const activeTabIndex = tabs.length === 0
      ? -1
      : activeTab && !isVSCodeWorkbenchTabState(activeTab)
        ? tabs.findIndex((tab) => tab.id === activeTab.id)
        : Math.min(Math.max(root.activeTabIndex, 0), tabs.length - 1);

    return {
      ...root,
      tabs,
      activeTabIndex: Math.max(0, activeTabIndex),
    };
  }

  return {
    ...root,
    children: root.children.map(removeVSCodeWorkbenchTabs),
  };
}

export function placeVSCodeWorkbenchTab(
  root: LayoutNode,
  targetPaneId: string,
  workspacePath: string,
): { root: LayoutNode; tab: VSCodeWorkbenchTabState } {
  const existing = findVSCodeWorkbenchTabs(root)[0]?.tab;
  const tab: VSCodeWorkbenchTabState = existing
    ? {
        ...existing,
        filePath: `${VSCODE_WORKBENCH_TAB_ID}:${workspacePath}`,
        workspacePath,
      }
    : createVSCodeWorkbenchTab(workspacePath);

  const withoutWorkbench = removeVSCodeWorkbenchTabs(root);
  return {
    root: addTabToPane(withoutWorkbench, targetPaneId, tab as TabState),
    tab,
  };
}
