import type { AnnotationItem } from "@/types/universal-annotation";
import type { CloudLibraryWorkspaceController } from "./cloud-workspace";
import { fromLegacyAnnotation, toLegacyAnnotation } from "./annotation-adapter";
import type { ItemKind } from "./domain";
import type { PaneId } from "@/types/layout";

export interface CloudPdfWorkspace {
  children: Array<{ id: string; parentId?: string; name: string; kind: ItemKind }>;
  canCreate: boolean;
  onOpenChild: (id: string, paneId: PaneId) => Promise<void>;
  onCreateChild: (kind: "note" | "notebook", paneId: PaneId) => Promise<void>;
  onDeleteChild?: (id: string) => Promise<void>;
  onRevealChildren: () => void;
}

/** Shared renderer seam owned by the host. Never pass a cloud URL to local filesystem storage. */
export interface CloudPdfDocument {
  identity: string;
  /** Stable connection/resource identity, excluding the source version, for local view preferences. */
  viewScope?: string;
  sourceVersion?: string;
  authorId: string;
  authorNames?: Record<string, string>;
  canAnnotate: boolean;
  annotations: AnnotationItem[];
  workspace?: CloudPdfWorkspace;
  onPersist: (upserts: AnnotationItem[], removeIds?: string[]) => Promise<void>;
}

export async function persistCloudPdfAnnotations(controller: CloudLibraryWorkspaceController, libraryId: string, itemId: string, upserts: AnnotationItem[], removeIds: string[] = [], expectedVersion?: string) {
  if (!expectedVersion) throw new Error("PDF尚无可定位的阅读版本，请先保存文件。");
  await controller.assertCurrentVersion(libraryId, itemId, expectedVersion);
  await controller.persistAnnotations(libraryId, itemId, upserts.map(annotation => fromLegacyAnnotation(annotation, { itemId, versionId: expectedVersion })), removeIds);
}
export { toLegacyAnnotation };
