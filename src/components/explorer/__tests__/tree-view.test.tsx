/**
 * @vitest-environment jsdom
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TreeView } from "../tree-view";
import { useExplorerStore } from "@/stores/explorer-store";

const copyEntry = vi.fn();
const moveEntry = vi.fn();
const hydratePdfVirtualChildren = vi.fn();
const setSelectedDirectoryPath = vi.fn();
const updateTabPath = vi.fn();
const updateTabPathPrefix = vi.fn();

vi.mock("@/hooks/use-file-system", () => ({
  useFileSystem: () => ({
    copyEntry,
    moveEntry,
    hydratePdfVirtualChildren,
    deleteFile: vi.fn(),
    renameFile: vi.fn(),
    refreshDirectory: vi.fn(),
    rootHandle: null,
    createFile: vi.fn(),
    createDirectory: vi.fn(),
    openDirectoryAsWorkspace: vi.fn(),
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
    hydratePdfVirtualChildren.mockReset();
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

  it("does not crash when an expanded PDF node is still hydrating virtual children", () => {
    expect(() => {
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
                  name: "paper.pdf",
                  kind: "file",
                  handle: {} as FileSystemFileHandle,
                  extension: "pdf",
                  path: "workspace/paper.pdf",
                  canExpandVirtualChildren: true,
                  isExpanded: true,
                  virtualChildrenState: "loading",
                },
              ],
              handle: {} as FileSystemDirectoryHandle,
            }}
          />
        );
      });
    }).not.toThrow();

    expect(screen.getByText("paper.pdf")).toBeTruthy();
    expect(hydratePdfVirtualChildren).not.toHaveBeenCalled();
  });
});
