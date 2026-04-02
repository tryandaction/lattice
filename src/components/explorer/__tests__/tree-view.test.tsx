/**
 * @vitest-environment jsdom
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TreeView } from "../tree-view";
import { useExplorerStore } from "@/stores/explorer-store";

const copyEntry = vi.fn();
const moveEntry = vi.fn();
const setSelectedDirectoryPath = vi.fn();
const updateTabPath = vi.fn();
const updateTabPathPrefix = vi.fn();

vi.mock("@/hooks/use-file-system", () => ({
  useFileSystem: () => ({
    copyEntry,
    moveEntry,
  }),
}));

vi.mock("@/stores/workspace-store", () => ({
  useWorkspaceStore: (selector: (state: {
    setSelectedDirectoryPath: typeof setSelectedDirectoryPath;
    updateTabPath: typeof updateTabPath;
    updateTabPathPrefix: typeof updateTabPathPrefix;
    layout: {
      activePaneId: string;
      root: {
        type: "pane";
        id: string;
        tabs: never[];
        activeTabIndex: number;
      };
    };
  }) => unknown) => selector({
    setSelectedDirectoryPath,
    updateTabPath,
    updateTabPathPrefix,
    layout: {
      activePaneId: "pane-1",
      root: {
        type: "pane",
        id: "pane-1",
        tabs: [],
        activeTabIndex: -1,
      },
    },
  }),
}));

describe("TreeView rename keyboard handling", () => {
  beforeEach(() => {
    copyEntry.mockReset();
    moveEntry.mockReset();
    setSelectedDirectoryPath.mockReset();
    updateTabPath.mockReset();
    updateTabPathPrefix.mockReset();
    useExplorerStore.setState({
      selectedPath: "workspace/file.md",
      selectedKind: "file",
      renamingPath: "workspace/file.md",
      clipboard: { mode: "copy", path: "workspace/other.md", kind: "file" },
      dragOverPath: null,
    });
  });

  afterEach(() => {
    useExplorerStore.setState({
      selectedPath: null,
      selectedKind: null,
      renamingPath: null,
      clipboard: null,
      dragOverPath: null,
    });
  });

  it("重命名输入框内按 Ctrl/Cmd+V 不应触发 Explorer 粘贴", () => {
    act(() => {
      render(
        <TreeView
          root={{
            name: "workspace",
            kind: "directory",
            path: "workspace",
            isExpanded: true,
            children: [
              {
                name: "file.md",
                kind: "file",
                handle: {} as FileSystemFileHandle,
                extension: "md",
                path: "workspace/file.md",
              },
            ],
            handle: {} as FileSystemDirectoryHandle,
          }}
        />
      );
    });

    const input = screen.getByDisplayValue("file.md");
    act(() => {
      fireEvent.keyDown(input, { key: "v", ctrlKey: true });
    });

    expect(copyEntry).not.toHaveBeenCalled();
    expect(moveEntry).not.toHaveBeenCalled();
  });
});
