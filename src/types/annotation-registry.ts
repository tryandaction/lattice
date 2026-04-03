export interface AnnotationSourceRecord {
  workspaceKey: string | null;
  sourcePath: string;
  sourceKind: "current-root" | "nested-lattice" | "registry";
  fileId: string;
  canonicalPath: string | null;
  relativePathFromRoot: string | null;
  fileFingerprint: string | null;
  updatedAt: number;
}

export interface AnnotationLocationAlias {
  sourcePath: string;
  canonicalPath: string | null;
  relativePathFromRoot: string | null;
  fileId: string;
  workspaceKey: string | null;
  updatedAt: number;
}

export interface AnnotationRegistryEntry {
  fileFingerprint: string;
  canonicalPaths: string[];
  aliases: AnnotationLocationAlias[];
  updatedAt: number;
}
