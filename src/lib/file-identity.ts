"use client";

import { generateFileId } from "@/lib/universal-annotation-storage";
import type { FileIdentity, WorkspaceIdentity } from "@/types/workspace-identity";
import { normalizeWorkspacePath } from "@/lib/link-router/path-utils";

const FILE_FINGERPRINT_SLICE_BYTES = 64 * 1024;

function joinDisplayPath(basePath: string | null | undefined, relativePath: string): string {
  const normalizedRelativePath = normalizeWorkspacePath(relativePath);
  if (!basePath) {
    return normalizedRelativePath;
  }

  const normalizedBasePath = normalizeWorkspacePath(basePath);
  const baseName = normalizedBasePath.split("/").filter(Boolean).pop();
  if (baseName && normalizedRelativePath.startsWith(`${baseName}/`)) {
    return `${normalizedBasePath}/${normalizedRelativePath.slice(baseName.length + 1)}`;
  }
  if (baseName && normalizedRelativePath === baseName) {
    return normalizedBasePath;
  }

  return `${normalizedBasePath}/${normalizedRelativePath}`;
}

function buildRelativePathSuffixes(filePath: string): string[] {
  const normalizedPath = normalizeWorkspacePath(filePath);
  const parts = normalizedPath.split("/").filter(Boolean);
  const suffixes: string[] = [];

  for (let index = 0; index < parts.length; index += 1) {
    suffixes.push(parts.slice(index).join("/"));
  }

  return Array.from(new Set(suffixes));
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function buildFileFingerprint(
  fileHandle: FileSystemFileHandle | null | undefined,
): Promise<{ fingerprint: string | null; size: number | null; lastModified: number | null }> {
  if (!fileHandle) {
    return {
      fingerprint: null,
      size: null,
      lastModified: null,
    };
  }

  try {
    const file = await fileHandle.getFile();
    const size = file.size;
    const lastModified = file.lastModified;
    const headBytes = await file.slice(0, Math.min(size, FILE_FINGERPRINT_SLICE_BYTES)).arrayBuffer();
    const tailStart = Math.max(0, size - FILE_FINGERPRINT_SLICE_BYTES);
    const tailBytes = tailStart > 0
      ? await file.slice(tailStart, size).arrayBuffer()
      : new ArrayBuffer(0);
    const meta = new TextEncoder().encode(`${file.name}:${size}:${lastModified}:`);
    const merged = new Uint8Array(meta.byteLength + headBytes.byteLength + tailBytes.byteLength);
    merged.set(meta, 0);
    merged.set(new Uint8Array(headBytes), meta.byteLength);
    merged.set(new Uint8Array(tailBytes), meta.byteLength + headBytes.byteLength);
    const digest = await crypto.subtle.digest("SHA-256", merged);
    return {
      fingerprint: toHex(digest),
      size,
      lastModified,
    };
  } catch {
    return {
      fingerprint: null,
      size: null,
      lastModified: null,
    };
  }
}

export async function resolveFileIdentity(input: {
  fileHandle?: FileSystemFileHandle | null;
  fileName: string;
  filePath: string;
  workspaceIdentity: WorkspaceIdentity | null;
}): Promise<FileIdentity> {
  const relativePathFromRoot = normalizeWorkspacePath(input.filePath);
  const pathCandidates = buildRelativePathSuffixes(relativePathFromRoot);
  const fileIdCandidates = Array.from(new Set([
    ...pathCandidates.map((path) => generateFileId(path)),
    generateFileId(input.fileName),
  ]));
  const fingerprint = await buildFileFingerprint(input.fileHandle);

  return {
    primaryFileId: fileIdCandidates[0],
    fileIdCandidates,
    canonicalPath: input.workspaceIdentity?.hostKind === "desktop"
      ? joinDisplayPath(input.workspaceIdentity.displayPath, relativePathFromRoot)
      : `${input.workspaceIdentity?.workspaceKey ?? "__workspace__"}:${relativePathFromRoot}`,
    relativePathFromRoot,
    fileName: input.fileName,
    fileFingerprint: fingerprint.fingerprint,
    size: fingerprint.size,
    lastModified: fingerprint.lastModified,
  };
}
