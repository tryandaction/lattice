export interface AnnotationSourceRecord {
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
  sourcePath: string;
  canonicalPath: string | null;
  relativePathFromRoot: string | null;
  fileId: string;
  workspaceKey: string | null;
  versionFingerprint?: string | null;
  updatedAt: number;
}

export interface AnnotationRegistryConflict {
  canonicalPath: string;
  contenderFingerprints: string[];
  contenderVersionFingerprints: string[];
  workspaceKeys: Array<string | null>;
  status: "open" | "resolved";
  resolution: "manual" | "keep-current" | "keep-legacy" | null;
  detectedAt: number;
  updatedAt: number;
}

export interface AnnotationRegistryEntry {
  fileFingerprint: string;
  versionFingerprints: string[];
  canonicalPaths: string[];
  aliases: AnnotationLocationAlias[];
  updatedAt: number;
}
