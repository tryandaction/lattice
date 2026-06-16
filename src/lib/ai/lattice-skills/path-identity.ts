import { resolveFileIdentity } from '@/lib/file-identity';
import { getAnnotationFilePath } from '@/lib/universal-annotation-storage';
import {
  getDefaultPdfItemFolderPath,
  getPdfItemAnnotationIndexPath,
} from '@/lib/pdf-item';
import { normalizeWorkspacePath } from '@/lib/link-router/path-utils';
import type { FileIdentity, WorkspaceIdentity } from '@/types/workspace-identity';

export type LatticePathIdentityKind = 'generic' | 'pdf';

export interface LatticePathIdentityInput {
  fileHandle?: FileSystemFileHandle | null;
  fileName?: string;
  filePathOrAbsolutePath: string;
  workspaceIdentity: WorkspaceIdentity | null;
  kind?: LatticePathIdentityKind;
}

export interface LatticePathIdentity {
  kind: LatticePathIdentityKind;
  latticePath: string;
  fileName: string;
  fileIdentity: FileIdentity;
  fileId: string;
  fileIdCandidates: string[];
  annotationPath: string;
  itemFolderPath: string | null;
  itemManifestPath: string | null;
  annotationIndexPath: string | null;
}

function inferFileName(path: string, explicitName?: string): string {
  if (explicitName?.trim()) {
    return explicitName.trim();
  }
  const normalized = normalizeWorkspacePath(path);
  return normalized.split('/').filter(Boolean).pop() || 'untitled';
}

function stripWorkspaceDisplayPrefix(path: string, workspaceIdentity: WorkspaceIdentity | null): string {
  const normalizedPath = normalizeWorkspacePath(path);
  if (!workspaceIdentity?.displayPath) {
    return normalizedPath;
  }
  const normalizedDisplayPath = normalizeWorkspacePath(workspaceIdentity.displayPath);
  if (normalizedPath === normalizedDisplayPath) {
    return normalizedPath.split('/').filter(Boolean).pop() ?? normalizedPath;
  }
  if (normalizedPath.startsWith(`${normalizedDisplayPath}/`)) {
    return normalizedPath.slice(normalizedDisplayPath.length + 1);
  }
  return normalizedPath;
}

function inferKind(path: string, kind?: LatticePathIdentityKind): LatticePathIdentityKind {
  if (kind) {
    return kind;
  }
  return /\.pdf(?:$|[?#])/i.test(path) ? 'pdf' : 'generic';
}

export async function resolveLatticePathIdentity(input: LatticePathIdentityInput): Promise<LatticePathIdentity> {
  const latticePath = stripWorkspaceDisplayPrefix(input.filePathOrAbsolutePath, input.workspaceIdentity);
  const fileName = inferFileName(latticePath, input.fileName);
  const resolvedKind = inferKind(latticePath, input.kind);
  const fileIdentity = await resolveFileIdentity({
    fileHandle: input.fileHandle,
    fileName,
    filePath: latticePath,
    workspaceIdentity: input.workspaceIdentity,
  });
  const annotationPath = getAnnotationFilePath(fileIdentity.primaryFileId);
  const itemFolderPath = resolvedKind === 'pdf' ? getDefaultPdfItemFolderPath(fileIdentity.relativePathFromRoot) : null;
  const annotationIndexPath = itemFolderPath ? getPdfItemAnnotationIndexPath(itemFolderPath) : null;

  return {
    kind: resolvedKind,
    latticePath: fileIdentity.relativePathFromRoot,
    fileName,
    fileIdentity,
    fileId: fileIdentity.primaryFileId,
    fileIdCandidates: fileIdentity.fileIdCandidates,
    annotationPath,
    itemFolderPath,
    itemManifestPath: itemFolderPath ? `${itemFolderPath}/manifest.json` : null,
    annotationIndexPath,
  };
}
