export type WorkspaceHostKind = "web" | "desktop";

export interface WorkspaceIdentity {
  workspaceKey: string;
  displayPath: string | null;
  rootName: string;
  hostKind: WorkspaceHostKind;
  handleFingerprint: string | null;
  lastUsedAt: number;
}

export interface RegisteredWorkspaceHandle extends WorkspaceIdentity {
  handle: FileSystemDirectoryHandle;
}

export interface FileIdentity {
  primaryFileId: string;
  fileIdCandidates: string[];
  canonicalPath: string;
  relativePathFromRoot: string;
  fileName: string;
  fileFingerprint: string | null;
  versionFingerprint: string | null;
  size: number | null;
  lastModified: number | null;
}
