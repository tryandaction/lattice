/** @vitest-environment jsdom */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TreeView } from "../tree-view";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useExplorerStore } from "@/stores/explorer-store";
import type { DirectoryNode } from "@/types/file-system";

const consumer = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-file-system", () => ({
  resolvePathFromLatticeRoot: (path: string) => path,
  useFileSystem: () => {
    consumer();
    return { rootHandle: null, copyEntry: vi.fn(), moveEntry: vi.fn() };
  },
}));
vi.mock("@/hooks/use-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/desktop-openers", () => ({
  canUseDesktopOpeners: () => false, openDesktopPath: vi.fn(),
  openDesktopTerminalAtPath: vi.fn(), revealDesktopPath: vi.fn(),
}));
vi.mock("@/lib/pdf-item", () => ({ createPdfItemNote: vi.fn(), ensurePdfItemWorkspace: vi.fn() }));

afterEach(cleanup);

describe("Explorer render isolation", () => {
  it("does not redraw unrelated file rows for tab changes or dirty-state updates", () => {
    useWorkspaceStore.setState({ layout: {
      activePaneId: "pane-test", root: { type: "pane", id: "pane-test", activeTabIndex: -1, tabs: [] },
    } });
    useExplorerStore.setState({ selectedPath: null, selectedKind: null, renamingPath: null, clipboard: null, compareSelection: null });
    const root: DirectoryNode = {
      name: "workspace", kind: "directory", path: "workspace", isExpanded: true,
      handle: { name: "workspace" } as FileSystemDirectoryHandle,
      children: Array.from({ length: 120 }, (_, index) => ({
        name: `note-${index}.md`, kind: "file", extension: "md", path: `workspace/note-${index}.md`,
        handle: { name: `note-${index}.md`, kind: "file" } as FileSystemFileHandle,
      })),
    };
    render(<TreeView root={root} />);
    consumer.mockClear();
    act(() => useWorkspaceStore.getState().openFileInActivePane(root.children[60].handle as FileSystemFileHandle, root.children[60].path));
    expect(consumer.mock.calls.length).toBe(1);
    expect(screen.getByRole("button", { name: /note-60.md/ }).parentElement?.className).toContain("bg-accent");
    consumer.mockClear();
    act(() => useWorkspaceStore.getState().openFileInActivePane(root.children[80].handle as FileSystemFileHandle, root.children[80].path));
    expect(consumer.mock.calls.length).toBe(2);
    expect(screen.getByRole("button", { name: /note-80.md/ }).parentElement?.className).toContain("bg-accent");
    consumer.mockClear();
    act(() => useWorkspaceStore.getState().setTabDirty("pane-test", 0, true));
    expect(consumer).not.toHaveBeenCalled();
  });

  it("keeps unrelated branches identical when expanding a directory", () => {
    const left: DirectoryNode = { name: "left", kind: "directory", path: "workspace/left", handle: {} as FileSystemDirectoryHandle, children: [], isExpanded: false };
    const right: DirectoryNode = { name: "right", kind: "directory", path: "workspace/right", handle: {} as FileSystemDirectoryHandle, children: [], isExpanded: false };
    const root: DirectoryNode = { name: "workspace", kind: "directory", path: "workspace", handle: {} as FileSystemDirectoryHandle, children: [left, right], isExpanded: true };
    useWorkspaceStore.setState({ fileTree: { root } });
    useWorkspaceStore.getState().toggleDirectory(left.path);
    expect(useWorkspaceStore.getState().fileTree.root?.children[0]).not.toBe(left);
    expect(useWorkspaceStore.getState().fileTree.root?.children[1]).toBe(right);
    const expanded = useWorkspaceStore.getState().fileTree;
    useWorkspaceStore.getState().toggleDirectory("workspace/missing");
    expect(useWorkspaceStore.getState().fileTree).toBe(expanded);
  });
});
