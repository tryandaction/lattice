import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspaceStore } from "../workspace-store";
import type { DirectoryNode } from "@/types/file-system";

describe("workspace root matching", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      workspaceRootHandle: null,
      workspaceRootHistory: new Map(),
    });
  });

  it("matches registered roots without treating an evidence fragment as a path segment", () => {
    const rootHandle = { name: "papers" } as FileSystemDirectoryHandle;
    useWorkspaceStore.getState().registerWorkspaceRoot("papers", rootHandle);

    expect(useWorkspaceStore.getState().findWorkspaceRootForPath("papers/paper.pdf#page=3"))
      .toBe(rootHandle);
  });

  it("preserves unrelated branches while expanding one directory", () => {
    const directory = (name: string): DirectoryNode => ({
      name, path: `workspace/${name}`, kind: "directory", isExpanded: false,
      handle: { name } as FileSystemDirectoryHandle, children: [],
    });
    const left = directory("left");
    const right = directory("right");
    useWorkspaceStore.setState({ fileTree: { root: {
      ...directory("workspace"), path: "workspace", children: [left, right],
    } } });
    useWorkspaceStore.getState().toggleDirectory(left.path);
    expect(useWorkspaceStore.getState().fileTree.root?.children[0]).toMatchObject({ isExpanded: true });
    expect(useWorkspaceStore.getState().fileTree.root?.children[1]).toBe(right);
    const tree = useWorkspaceStore.getState().fileTree;
    useWorkspaceStore.getState().toggleDirectory("workspace/missing");
    expect(useWorkspaceStore.getState().fileTree).toBe(tree);
  });
});
