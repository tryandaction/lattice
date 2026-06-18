import { normalizeWorkspacePath, safeDecodeLinkTarget } from "@/lib/link-router/path-utils";
import type { TreeNode } from "@/types/file-system";
import type { MarkdownLinkIndex } from "./link-index";

export interface MarkdownAttachmentCleanupCandidate {
  path: string;
  displayPath: string;
  extension: string;
  referenced: boolean;
}

const DEFAULT_ATTACHMENT_EXTENSIONS = new Set([
  "avif",
  "bmp",
  "gif",
  "jpeg",
  "jpg",
  "m4a",
  "mov",
  "mp3",
  "mp4",
  "ogg",
  "pdf",
  "png",
  "svg",
  "wav",
  "webm",
  "webp",
]);

function getExtension(path: string): string {
  const name = path.split("/").pop() ?? path;
  const dotIndex = name.lastIndexOf(".");
  return dotIndex >= 0 ? name.slice(dotIndex + 1).toLowerCase() : "";
}

function stripWorkspaceRoot(path: string, workspaceRootName?: string | null): string {
  const normalized = normalizeWorkspacePath(path);
  if (!workspaceRootName) return normalized;
  const root = normalizeWorkspacePath(workspaceRootName);
  return normalized === root
    ? ""
    : normalized.startsWith(`${root}/`)
      ? normalized.slice(root.length + 1)
      : normalized;
}

function stripFragment(path: string): string {
  const hashIndex = path.indexOf("#");
  return hashIndex >= 0 ? path.slice(0, hashIndex) : path;
}

function collectAttachmentPaths(
  node: TreeNode | null,
  workspaceRootName: string | null | undefined,
  extensions: Set<string>,
  output: MarkdownAttachmentCleanupCandidate[],
): void {
  if (!node) return;
  if (node.kind === "directory") {
    for (const child of node.children) {
      collectAttachmentPaths(child, workspaceRootName, extensions, output);
    }
    return;
  }

  const extension = (node.extension || getExtension(node.name)).toLowerCase();
  if (!extensions.has(extension)) return;

  const path = stripWorkspaceRoot(node.path, workspaceRootName);
  if (!path) return;
  output.push({
    path,
    displayPath: node.path,
    extension,
    referenced: false,
  });
}

function collectReferencedPaths(index: MarkdownLinkIndex): Set<string> {
  const referenced = new Set<string>();
  for (const links of index.outgoingByFile.values()) {
    for (const link of links) {
      const resolvedPath = link.resolvedPath ? normalizeWorkspacePath(link.resolvedPath) : "";
      if (resolvedPath) {
        referenced.add(resolvedPath);
      }

      const decodedRawTarget = normalizeWorkspacePath(stripFragment(safeDecodeLinkTarget(link.rawTarget)));
      if (decodedRawTarget) {
        referenced.add(decodedRawTarget);
      }
    }
  }
  return referenced;
}

export function findUnreferencedMarkdownAttachments(input: {
  root: TreeNode | null;
  index: MarkdownLinkIndex;
  workspaceRootName?: string | null;
  attachmentExtensions?: Iterable<string>;
}): MarkdownAttachmentCleanupCandidate[] {
  const extensions = new Set(
    Array.from(input.attachmentExtensions ?? DEFAULT_ATTACHMENT_EXTENSIONS, (item) => item.toLowerCase()),
  );
  const attachments: MarkdownAttachmentCleanupCandidate[] = [];
  collectAttachmentPaths(input.root, input.workspaceRootName, extensions, attachments);

  const referenced = collectReferencedPaths(input.index);
  return attachments
    .map((attachment) => ({
      ...attachment,
      referenced: referenced.has(attachment.path),
    }))
    .filter((attachment) => !attachment.referenced)
    .sort((left, right) => left.path.localeCompare(right.path));
}
