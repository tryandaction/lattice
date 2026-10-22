import { describe, expect, it } from "vitest";
import {
  copyTreeNode,
  insertTreeNode,
  relocateTreeNode,
  removeTreeNode,
} from "@/lib/file-tree-operations";
import type { DirectoryNode, FileNode } from "@/types/file-system";

function file(name: string, path: string): FileNode {
  return {
    name,
    kind: "file",
    handle: { kind: "file", name } as FileSystemFileHandle,
    extension: name.split(".").pop() ?? "",
    path,
  };
}

function directory(name: string, path: string, children: DirectoryNode["children"] = []): DirectoryNode {
  return {
    name,
    kind: "directory",
    handle: { kind: "directory", name } as FileSystemDirectoryHandle,
    children,
    path,
    isExpanded: true,
  };
}

describe("file-tree-operations", () => {
  it("inserts a node into its parent using Explorer sort order", () => {
    const root = directory("workspace", "workspace", [file("z.md", "workspace/z.md")]);

    const next = insertTreeNode(root, "workspace", directory("docs", "workspace/docs"));

    expect(next.children.map((node) => node.name)).toEqual(["docs", "z.md"]);
    expect(root.children.map((node) => node.name)).toEqual(["z.md"]);
  });

  it("removes a nested node without mutating the previous tree", () => {
    const root = directory("workspace", "workspace", [
      directory("docs", "workspace/docs", [file("notes.md", "workspace/docs/notes.md")]),
    ]);

    const result = removeTreeNode(root, "workspace/docs/notes.md");

    expect(result.removed?.path).toBe("workspace/docs/notes.md");
    expect(result.root.children[0]?.kind === "directory" ? result.root.children[0].children : []).toEqual([]);
    expect(root.children[0]?.kind === "directory" ? root.children[0].children : []).toHaveLength(1);
  });

  it("relocates a directory and rewrites every descendant path", () => {
    const root = directory("workspace", "workspace", [
      directory("archive", "workspace/archive"),
      directory("docs", "workspace/docs", [file("notes.md", "workspace/docs/notes.md")]),
    ]);

    const next = relocateTreeNode(root, {
      sourcePath: "workspace/docs",
      targetDirectoryPath: "workspace/archive",
      nextPath: "workspace/archive/docs",
    });

    expect(next.children.map((node) => node.name)).toEqual(["archive"]);
    const archive = next.children[0];
    const moved = archive.kind === "directory" ? archive.children[0] : null;
    expect(moved?.path).toBe("workspace/archive/docs");
    expect(moved?.kind === "directory" ? moved.children[0]?.path : null).toBe("workspace/archive/docs/notes.md");
  });

  it("copies a node into another directory without removing the source", () => {
    const root = directory("workspace", "workspace", [
      directory("archive", "workspace/archive"),
      file("notes.md", "workspace/notes.md"),
    ]);

    const next = copyTreeNode(root, {
      sourcePath: "workspace/notes.md",
      targetDirectoryPath: "workspace/archive",
      nextPath: "workspace/archive/notes.md",
    });

    expect(next.children.map((node) => node.name)).toEqual(["archive", "notes.md"]);
    expect(next.children[0]?.kind === "directory" ? next.children[0].children.map((node) => node.name) : []).toEqual(["notes.md"]);
  });

  it("removes a source when the destination is a hidden PDF item directory", () => {
    const root = directory("workspace", "workspace", [file("notes.md", "workspace/notes.md")]);

    const next = relocateTreeNode(root, {
      sourcePath: "workspace/notes.md",
      targetDirectoryPath: null,
      nextPath: ".lattice/items/paper/notes.md",
    });

    expect(next.children).toEqual([]);
  });
});
