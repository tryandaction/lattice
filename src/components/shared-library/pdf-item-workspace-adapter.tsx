"use client";

import type { PDFDocumentProxy } from "pdfjs-dist";
import { PdfItemWorkspacePanel } from "@/components/renderers/pdf-item-workspace-panel";
import type { AnnotationItem } from "@/types/universal-annotation";
import type { PdfItemManifest } from "@/lib/pdf-item";
import type { PaneId } from "@/stores/workspace-store";
import {
  registerItemWorkspaceAdapter,
  type ItemWorkspaceItem,
} from "@/lib/shared-library/item-workspace";
import { SharedLibraryContentViewer } from "./content-viewer";
import { SharedAnnotationPanel } from "./shared-annotation-panel";

interface PdfWorkspaceContext {
  rootHandle: FileSystemDirectoryHandle | null;
  documentId: string | null;
  fileFingerprint: string | null;
  versionFingerprint: string | null;
  paneId: PaneId;
  annotations: AnnotationItem[];
  isAnnotationsLoading: boolean;
  manifest: PdfItemManifest | null;
  pdfDocument: PDFDocumentProxy | null;
}

function readPdfWorkspaceContext(item: ItemWorkspaceItem): PdfWorkspaceContext {
  const extras = item.extras ?? {};
  return {
    rootHandle: (extras.rootHandle as FileSystemDirectoryHandle | undefined) ?? null,
    documentId: typeof extras.documentId === "string" ? extras.documentId : null,
    fileFingerprint:
      typeof extras.fileFingerprint === "string" ? extras.fileFingerprint : null,
    versionFingerprint:
      typeof extras.versionFingerprint === "string" ? extras.versionFingerprint : null,
    paneId: typeof extras.paneId === "string" ? (extras.paneId as PaneId) : "pane-main",
    annotations: (extras.annotations as AnnotationItem[] | undefined) ?? [],
    isAnnotationsLoading: Boolean(extras.isAnnotationsLoading),
    manifest: (extras.manifest as PdfItemManifest | null | undefined) ?? null,
    pdfDocument: (extras.pdfDocument as PDFDocumentProxy | null | undefined) ?? null,
  };
}

/**
 * PDF item workspace adapter.
 *
 * Reuses the existing `PdfItemWorkspacePanel` for the header strip (notes,
 * bibliography copy actions, reveal-in-explorer) instead of reimplementing
 * it. The content viewer reads the durable shared-library content store and
 * reuses the existing PDF renderer for the actual document.
 */
export function registerPdfItemWorkspaceAdapter(): void {
  registerItemWorkspaceAdapter({
    kind: "pdf",
    label: "PDF",
    supportsAnnotations: true,
    supportsSearch: true,
    supportsVersions: true,
    renderHeader: (item) => {
      const context = readPdfWorkspaceContext(item);
      if (!context.rootHandle) {
        return null;
      }
      return (
        <PdfItemWorkspacePanel
          rootHandle={context.rootHandle}
          documentId={context.documentId}
          fileFingerprint={context.fileFingerprint}
          versionFingerprint={context.versionFingerprint}
          fileName={item.fileName ?? item.title}
          filePath={item.filePath ?? item.title}
          paneId={context.paneId}
          annotations={context.annotations}
          isAnnotationsLoading={context.isAnnotationsLoading}
          manifest={context.manifest}
          pdfDocument={context.pdfDocument}
        />
      );
    },
    renderViewer: (item) => <SharedLibraryContentViewer item={item} />,
    renderTools: (item) => (
      <SharedAnnotationPanel
        annotations={(item.extras?.annotations as import("@/lib/shared-library/domain").Annotation[] | undefined) ?? []}
        comments={(item.extras?.comments as import("@/lib/shared-library/domain").AnnotationComment[] | undefined) ?? []}
        onCreatePageNote={item.extras?.onCreatePageNote as ((page: number, body: string) => Promise<void>) | undefined}
        onCreateComment={item.extras?.onCreateComment as ((annotationId: string, parentId: string | undefined, body: string) => Promise<void>) | undefined}
      />
    ),
  });
}
