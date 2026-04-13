"use client";

import type { AnnotationFileType, UniversalAnnotationFile } from "@/types/universal-annotation";
import type { AnnotationSourceRecord } from "@/types/annotation-registry";
import type { FileIdentity, WorkspaceIdentity } from "@/types/workspace-identity";
import { resolveFileIdentity } from "@/lib/file-identity";
import {
  loadAnnotationsForFileIdentity,
  resolveAnnotationFileCandidates,
} from "@/lib/universal-annotation-storage";

export interface ResolvedPdfDocumentBinding {
  documentId: string;
  fileIdentity: FileIdentity;
  canonicalStorageFileId: string;
  storageCandidates: string[];
  annotationFile: UniversalAnnotationFile;
  resolvedSource: AnnotationSourceRecord | null;
}

export async function resolvePdfDocumentBinding(input: {
  rootHandle: FileSystemDirectoryHandle;
  fileHandle?: FileSystemFileHandle | null;
  fileName: string;
  filePath: string;
  workspaceIdentity: WorkspaceIdentity | null;
  fileType?: AnnotationFileType;
}): Promise<ResolvedPdfDocumentBinding> {
  const fileIdentity = await resolveFileIdentity({
    fileHandle: input.fileHandle,
    fileName: input.fileName,
    filePath: input.filePath,
    workspaceIdentity: input.workspaceIdentity,
  });

  const storageCandidates = resolveAnnotationFileCandidates(
    input.fileName,
    input.filePath,
    fileIdentity.primaryFileId,
  );

  const loaded = await loadAnnotationsForFileIdentity({
    rootHandle: input.rootHandle,
    fileIdentity,
    workspaceKey: input.workspaceIdentity?.workspaceKey ?? null,
    fileType: input.fileType ?? "pdf",
  });

  return {
    documentId: loaded.annotationFile.documentId,
    fileIdentity,
    canonicalStorageFileId: fileIdentity.primaryFileId,
    storageCandidates,
    annotationFile: loaded.annotationFile,
    resolvedSource: loaded.source,
  };
}
