import { describe, expect, it } from "vitest";
import { createTab } from "@/lib/layout-utils";
import {
  findVSCodeWorkbenchTabs,
  placeVSCodeWorkbenchTab,
} from "../layout";
import {
  isFileTabState,
  isVSCodeWorkbenchTabState,
  isWebTabState,
  type LayoutNode,
} from "@/types/layout";

function fileHandle(name: string): FileSystemFileHandle {
  return { kind: "file", name } as FileSystemFileHandle;
}

function splitLayout(): LayoutNode {
  return {
    type: "split",
    id: "split-root",
    direction: "horizontal",
    sizes: [50, 50],
    children: [
      {
        type: "pane",
        id: "pane-left",
        tabs: [createTab(fileHandle("paper.pdf"), "workspace/paper.pdf")],
        activeTabIndex: 0,
      },
      {
        type: "pane",
        id: "pane-right",
        tabs: [createTab(fileHandle("notes.md"), "workspace/notes.md")],
        activeTabIndex: 0,
      },
    ],
  };
}

describe("VS Code Workbench singleton layout", () => {
  it("creates one transient Workbench tab without changing document tabs", () => {
    const placed = placeVSCodeWorkbenchTab(splitLayout(), "pane-left", "C:/workspace");
    const workbenchTabs = findVSCodeWorkbenchTabs(placed.root);

    expect(workbenchTabs).toHaveLength(1);
    expect(workbenchTabs[0]?.paneId).toBe("pane-left");
    expect(workbenchTabs[0]?.tab.id).toBe("vscode-workbench");
    expect(isVSCodeWorkbenchTabState(workbenchTabs[0]!.tab)).toBe(true);
    expect(isFileTabState(workbenchTabs[0]!.tab)).toBe(false);
    expect(isWebTabState(workbenchTabs[0]!.tab)).toBe(false);
  });

  it("moves the same Workbench tab between panes instead of duplicating it", () => {
    const first = placeVSCodeWorkbenchTab(splitLayout(), "pane-left", "C:/workspace");
    const second = placeVSCodeWorkbenchTab(first.root, "pane-right", "C:/workspace");
    const workbenchTabs = findVSCodeWorkbenchTabs(second.root);

    expect(workbenchTabs).toHaveLength(1);
    expect(workbenchTabs[0]?.paneId).toBe("pane-right");
    expect(workbenchTabs[0]?.tab.id).toBe(first.tab.id);
    expect(second.tab.id).toBe(first.tab.id);
  });
});
