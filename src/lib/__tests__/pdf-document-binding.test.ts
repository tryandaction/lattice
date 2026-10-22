/**
 * @vitest-environment jsdom
 */

import { describe, expect, it, vi } from "vitest";
import { resolvePdfDocumentBinding } from "@/lib/pdf-document-binding";

const mocks = vi.hoisted(() => ({
  loadAnnotationsForFileIdentity: vi.fn(),
  resolveAnnotationFileCandidates: vi.fn(() => ["new-workspace-paper.pdf"]),
  resolvePdfItemLocation: vi.fn(),
  resolvePdfItemLocationRoot: vi.fn(),
  isIndependentStoredPdf: vi.fn(async () => false),
}));

vi.mock("@/lib/universal-annotation-storage", () => ({
  generateFileId: (path: string) => path.replace(/[^a-zA-Z0-9._-]+/g, "-"),
  loadAnnotationsForFileIdentity: mocks.loadAnnotationsForFileIdentity,
  resolveAnnotationFileCandidates: mocks.resolveAnnotationFileCandidates,
}));

vi.mock("@/lib/pdf-item-location-registry", () => ({
  resolvePdfItemLocation: mocks.resolvePdfItemLocation,
  resolvePdfItemLocationRoot: mocks.resolvePdfItemLocationRoot,
  isIndependentStoredPdf: mocks.isIndependentStoredPdf,
}));

function createPdfHandle(name: string, content: string): FileSystemFileHandle {
  const bytes = new TextEncoder().encode(content);
  return {
    kind: "file",
    name,
    getFile: async () => ({
      name,
      size: bytes.byteLength,
      lastModified: 1,
      slice: (start = 0, end = bytes.byteLength) => ({
        arrayBuffer: async () => bytes.slice(start, end).buffer,
      }),
    }),
  } as unknown as FileSystemFileHandle;
}

describe("resolvePdfDocumentBinding", () => {
  it("loads annotations and item workspace from a catalogued root after an external move", async () => {
    const currentRoot = { name: "new-workspace" } as FileSystemDirectoryHandle;
    const itemRoot = { name: "old-workspace" } as FileSystemDirectoryHandle;
    mocks.resolvePdfItemLocation.mockResolvedValue({
      documentId: "stable-doc-id",
      fileFingerprint: "stored-fingerprint",
      workspaceKey: "web:old-workspace",
      desktopRootPath: null,
      pdfPath: "old-workspace/paper.pdf",
      itemFolderPath: ".lattice/items/stable-item",
      updatedAt: 1,
    });
    mocks.resolvePdfItemLocationRoot.mockResolvedValue(itemRoot);
    mocks.loadAnnotationsForFileIdentity.mockResolvedValue({
      annotationFile: {
        version: 3,
        documentId: "stable-doc-id",
        fileId: "old-workspace-paper.pdf",
        fileType: "pdf",
        annotations: [],
        createdAt: 1,
        updatedAt: 1,
      },
      source: null,
    });

    const binding = await resolvePdfDocumentBinding({
      rootHandle: currentRoot,
      fileHandle: createPdfHandle("paper.pdf", "%PDF-moved"),
      fileName: "paper.pdf",
      filePath: "new-workspace/paper.pdf",
      workspaceIdentity: {
        workspaceKey: "web:new-workspace",
        displayPath: "new-workspace",
        rootName: "new-workspace",
        hostKind: "web",
        handleFingerprint: null,
        lastUsedAt: 1,
      },
      fileType: "pdf",
    });

    expect(mocks.resolvePdfItemLocation).toHaveBeenCalledWith({
      fileFingerprint: expect.any(String),
    });
    expect(mocks.loadAnnotationsForFileIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ rootHandle: itemRoot }),
    );
    expect(binding.itemRootHandle).toBe(itemRoot);
    expect(binding.documentId).toBe("stable-doc-id");
  });
});
