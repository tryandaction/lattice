"use client";

import type { AnnotationFileType, UniversalAnnotationFile } from "@/types/universal-annotation";
import type { AnnotationSourceRecord } from "@/types/annotation-registry";
import type { FileIdentity, WorkspaceIdentity } from "@/types/workspace-identity";
import { resolveFileIdentity } from "@/lib/file-identity";
import { registerAnnotationLocation } from "@/lib/annotation-registry";
import {
  loadAnnotationsForFileIdentity,
  resolveAnnotationFileCandidates,
} from "@/lib/universal-annotation-storage";
import { isIndependentStoredPdf, resolvePdfItemLocation, resolvePdfItemLocationRoot } from "@/lib/pdf-item-location-registry";

export interface ResolvedPdfDocumentBinding {
  documentId: string;
  fileIdentity: FileIdentity;
  canonicalStorageFileId: string;
  storageCandidates: string[];
  annotationFile: UniversalAnnotationFile;
  resolvedSource: AnnotationSourceRecord | null;
  itemRootHandle?: FileSystemDirectoryHandle;
  storageWorkspaceKey?: string | null;
}

export async function resolvePdfDocumentBinding(input: {
  rootHandle: FileSystemDirectoryHandle;
  fileHandle?: FileSystemFileHandle | null;
  fileName: string;
  filePath: string;
  workspaceIdentity: WorkspaceIdentity | null;
  fileType?: AnnotationFileType;
  signal?: AbortSignal;
}): Promise<ResolvedPdfDocumentBinding> {
  const checkCancelled = () => {
    if (input.signal?.aborted) throw new DOMException("PDF binding cancelled", "AbortError");
  };
  checkCancelled();
  const fileIdentity = await resolveFileIdentity({
    fileHandle: input.fileHandle,
    fileName: input.fileName,
    filePath: input.filePath,
    workspaceIdentity: input.workspaceIdentity,
  });
  checkCancelled();

  let loaded = await loadAnnotationsForFileIdentity({ rootHandle: input.rootHandle, fileIdentity,
    workspaceKey: input.workspaceIdentity?.workspaceKey ?? null, fileType: input.fileType ?? 'pdf',
    preserveSourceRoot: true, signal: input.signal });
  checkCancelled();
  const itemLocation = await resolvePdfItemLocation({
    fileFingerprint: fileIdentity.fileFingerprint,
  });
  checkCancelled();
  let locatedItemRoot = itemLocation
    ? await resolvePdfItemLocationRoot(itemLocation)
    : null;
  checkCancelled();
  if (locatedItemRoot && itemLocation && await isIndependentStoredPdf(locatedItemRoot, itemLocation.pdfPath,
    input.rootHandle, fileIdentity.relativePathFromRoot, input.fileHandle)) locatedItemRoot = null;
  // Annotation provenance is a stronger owner than a later path-derived, empty
  // item manifest. Keep all subsequent reads and writes on that same owner.
  const itemRootHandle = loaded.storageRootHandle ?? (loaded.source ? input.rootHandle : locatedItemRoot) ?? input.rootHandle;
  const storageWorkspaceKey = loaded.source?.workspaceKey ?? (locatedItemRoot ? itemLocation?.workspaceKey : input.workspaceIdentity?.workspaceKey) ?? null;
  let storagePath = loaded.source?.relativePathFromRoot ?? (locatedItemRoot ? itemLocation?.pdfPath : null) ?? fileIdentity.relativePathFromRoot;
  const sameRoot = itemRootHandle === input.rootHandle || Boolean(itemRootHandle.isSameEntry && await itemRootHandle.isSameEntry(input.rootHandle));
  if (sameRoot) storagePath = fileIdentity.relativePathFromRoot;
  else if (input.fileHandle && itemRootHandle.resolve) {
    const locatedPath = await itemRootHandle.resolve(input.fileHandle);
    if (locatedPath?.length) storagePath = locatedPath.join('/');
  }
  checkCancelled();
  // Legacy nested recovery can mirror to a new id while retaining the old source for provenance.
  // An untouched original-root sidecar can instead embed an older id than its actual registered name.
  const canonicalStorageFileId = loaded.storageRootHandle
    ? loaded.source?.fileId ?? loaded.annotationFile.fileId : loaded.annotationFile.fileId;
  const storageIdentity = { ...fileIdentity, relativePathFromRoot: storagePath,
    canonicalPath: sameRoot ? fileIdentity.canonicalPath : loaded.source?.canonicalPath ?? fileIdentity.canonicalPath,
    primaryFileId: canonicalStorageFileId,
    fileIdCandidates: [canonicalStorageFileId, ...fileIdentity.fileIdCandidates] };
  if (!loaded.source && locatedItemRoot) {
    loaded = await loadAnnotationsForFileIdentity({ rootHandle: itemRootHandle, fileIdentity: storageIdentity,
      workspaceKey: storageWorkspaceKey, fileType: input.fileType ?? 'pdf',
      preferredDocumentId: itemLocation?.documentId ?? null, preserveSourceRoot: true, signal: input.signal });
  }
  checkCancelled();
  const storageCandidates = resolveAnnotationFileCandidates(input.fileName, storagePath, storageIdentity.primaryFileId);
  if (loaded.source && storagePath !== loaded.source.relativePathFromRoot) {
    await registerAnnotationLocation({ documentId: loaded.annotationFile.documentId,
      fileFingerprint: fileIdentity.fileFingerprint, versionFingerprint: fileIdentity.versionFingerprint,
      alias: { ...loaded.source, relativePathFromRoot: storagePath, canonicalPath: storageIdentity.canonicalPath,
        workspaceKey: storageWorkspaceKey, updatedAt: Date.now() } });
    checkCancelled();
  }

  return {
    documentId: loaded.annotationFile.documentId,
    fileIdentity: storageIdentity,
    canonicalStorageFileId: storageIdentity.primaryFileId,
    storageCandidates,
    annotationFile: loaded.annotationFile,
    resolvedSource: loaded.source,
    itemRootHandle,
    storageWorkspaceKey,
  };
}
