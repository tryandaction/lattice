import { describe, expect, it } from "vitest";
import { createTab, removeTabsToRightInPane } from "@/lib/layout-utils";

function fakeFileHandle(name: string): FileSystemFileHandle {
  return {
    kind: "file",
    name,
  } as FileSystemFileHandle;
}

describe("layout-utils tab batch operations", () => {
  it("removes tabs to the right while keeping active index in bounds", () => {
    const layout = {
      type: "pane" as const,
      id: "pane-main",
      tabs: [
        createTab(fakeFileHandle("a.md"), "workspace/a.md"),
        createTab(fakeFileHandle("b.md"), "workspace/b.md"),
        createTab(fakeFileHandle("c.md"), "workspace/c.md"),
      ],
      activeTabIndex: 2,
    };

    const next = removeTabsToRightInPane(layout, "pane-main", 0);

    expect(next.type).toBe("pane");
    if (next.type !== "pane") {
      throw new Error("Expected pane");
    }
    expect(next.tabs.map((tab) => tab.fileName)).toEqual(["a.md"]);
    expect(next.activeTabIndex).toBe(0);
  });
});
