import { describe, expect, it } from "vitest";
import { findUnreferencedMarkdownAttachments } from "../attachment-cleanup";
import { buildMarkdownLinkIndex } from "../link-index";
import type { DirectoryNode, FileNode, TreeNode } from "@/types/file-system";

function file(path: string, extension: string): FileNode {
  const name = path.split("/").pop() ?? path;
  return {
    name,
    kind: "file",
    handle: {} as FileSystemFileHandle,
    extension,
    path,
  };
}

function dir(path: string, children: TreeNode[]): DirectoryNode {
  const name = path.split("/").pop() ?? path;
  return {
    name,
    kind: "directory",
    handle: {} as FileSystemDirectoryHandle,
    children,
    path,
    isExpanded: true,
  };
}

describe("markdown attachment cleanup", () => {
  it("detects local attachments that are not referenced by markdown links", () => {
    const root = dir("vault", [
      file("vault/index.md", "md"),
      dir("vault/assets", [
        file("vault/assets/chart.png", "png"),
        file("vault/assets/unused.pdf", "pdf"),
        file("vault/assets/ignored.txt", "txt"),
      ]),
      dir("vault/media", [
        file("vault/media/clip.mp4", "mp4"),
      ]),
    ]);
    const index = buildMarkdownLinkIndex([
      {
        path: "index.md",
        content: [
          "![[assets/chart.png|Chart]]",
          "[Clip](media/clip.mp4#t=3)",
        ].join("\n"),
      },
      { path: "assets/chart.png", content: "" },
      { path: "assets/unused.pdf", content: "" },
      { path: "media/clip.mp4", content: "" },
    ]);

    expect(findUnreferencedMarkdownAttachments({
      root,
      index,
      workspaceRootName: "vault",
    })).toEqual([
      {
        path: "assets/unused.pdf",
        displayPath: "vault/assets/unused.pdf",
        extension: "pdf",
        referenced: false,
      },
    ]);
  });

  it("allows callers to narrow attachment extensions", () => {
    const root = dir("vault", [
      file("vault/assets/chart.png", "png"),
      file("vault/assets/paper.pdf", "pdf"),
    ]);
    const index = buildMarkdownLinkIndex([]);

    expect(findUnreferencedMarkdownAttachments({
      root,
      index,
      workspaceRootName: "vault",
      attachmentExtensions: ["png"],
    }).map((candidate) => candidate.path)).toEqual(["assets/chart.png"]);
  });
});
