export interface AnnotationSourceRecord {
  documentId: string;
  workspaceKey: string | null;
  sourcePath: string;
  sourceKind: "current-root" | "nested-lattice" | "registry";
  fileId: string;
  canonicalPath: string | null;
  relativePathFromRoot: string | null;
  fileFingerprint: string | null;
  versionFingerprint?: string | null;
  updatedAt: number;
}

export interface AnnotationLocationAlias {
  documentId: string;
  sourcePath: string;
  canonicalPath: string | null;
  relativePathFromRoot: string | null;
  fileId: string;
  workspaceKey: string | null;
  fileFingerprint?: string | null;
  versionFingerprint?: string | null;
  updatedAt: number;
}

export interface AnnotationRegistryConflict {
  canonicalPath: string;
  contenderDocumentIds: string[];
  contenderFingerprints: string[];
  contenderVersionFingerprints: string[];
  workspaceKeys: Array<string | null>;
  status: "open" | "resolved";
  resolution: "manual" | "keep-current" | "keep-legacy" | null;
  detectedAt: number;
  updatedAt: number;
}

export interface AnnotationRegistryEntry {
  documentId: string;
  fileFingerprints: string[];
  versionFingerprints: string[];
  canonicalPaths: string[];
  aliases: AnnotationLocationAlias[];
  updatedAt: number;
}
