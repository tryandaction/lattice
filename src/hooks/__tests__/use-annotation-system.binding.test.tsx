/**
 * @vitest-environment jsdom
 */

import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useAnnotationSystem } from "../use-annotation-system";
import type { ResolvedPdfDocumentBinding } from "@/lib/pdf-document-binding";
import type { AnnotationItem, UniversalAnnotationFile } from "@/types/universal-annotation";
import type { FileIdentity, WorkspaceIdentity } from "@/types/workspace-identity";

const mocks = vi.hoisted(() => {
  const loadAnnotationsForFileIdentity = vi.fn();
  const saveWithRetry = vi.fn(async () => true);
  const ensureAnnotationsDirectory = vi.fn();
  const resolveFileIdentity = vi.fn();
  const useWorkspaceStore = vi.fn();
  return {
    loadAnnotationsForFileIdentity,
    saveWithRetry,
    ensureAnnotationsDirectory,
    resolveFileIdentity,
    useWorkspaceStore,
  };
});

vi.mock("../../lib/universal-annotation-storage", () => ({
  detectFileType: vi.fn(() => "pdf"),
  createUniversalAnnotationFile: vi.fn((fileId: string, fileType = "pdf", documentId = fileId) => ({
    version: 3,
    documentId,
    fileId,
    fileType,
    annotations: [],
    lastModified: Date.now(),
  })),
  saveWithRetry: mocks.saveWithRetry,
  ensureAnnotationsDirectory: mocks.ensureAnnotationsDirectory,
  deserializeAnnotationFile: vi.fn(() => null),
  loadAnnotationsForFileIdentity: mocks.loadAnnotationsForFileIdentity,
  resolveAnnotationFileCandidates: vi.fn(() => ["papers-paper.pdf", "paper.pdf"]),
}));

vi.mock("../../lib/annotation-migration", () => ({
  isLegacyAnnotationFile: vi.fn(() => false),
  migrateLegacyAnnotationFile: vi.fn(),
}));

vi.mock("../../lib/file-identity", () => ({
  resolveFileIdentity: mocks.resolveFileIdentity,
}));

vi.mock("../../stores/workspace-store", () => ({
  useWorkspaceStore: mocks.useWorkspaceStore,
}));

vi.mock("../../lib/logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

function createWorkspaceIdentity(): WorkspaceIdentity {
  return {
    workspaceKey: "ws",
    displayPath: "C:/workspace",
    rootName: "workspace",
    hostKind: "desktop",
    handleFingerprint: "root-fp",
    lastUsedAt: Date.now(),
  };
}

function createFileIdentity(): FileIdentity {
  return {
    primaryFileId: "papers-paper.pdf",
    fileIdCandidates: ["papers-paper.pdf", "paper.pdf"],
    canonicalPath: "C:/workspace/papers/paper.pdf",
    relativePathFromRoot: "papers/paper.pdf",
    fileName: "paper.pdf",
    fileFingerprint: "file-fp",
    versionFingerprint: "version-fp",
    size: 123,
    lastModified: 456,
  };
}

function createAnnotationFile(annotations: AnnotationItem[]): UniversalAnnotationFile {
  return {
    version: 3,
    documentId: "doc-1",
    fileId: "papers-paper.pdf",
    fileType: "pdf",
    annotations,
    lastModified: Date.now(),
  };
}

describe("useAnnotationSystem binding refresh", () => {
  const workspaceIdentity = createWorkspaceIdentity();

  beforeEach(() => {
    mocks.loadAnnotationsForFileIdentity.mockReset();
    mocks.saveWithRetry.mockClear();
    mocks.ensureAnnotationsDirectory.mockClear();
    mocks.resolveFileIdentity.mockReset();
    mocks.useWorkspaceStore.mockImplementation((selector: (state: { workspaceIdentity: WorkspaceIdentity }) => unknown) => (
      selector({ workspaceIdentity })
    ));
  });

  it("refreshes PDF annotations from disk even when the provided binding snapshot is stale", async () => {
    const persistedAnnotation: AnnotationItem = {
      id: "ann-highlight",
      target: {
        type: "pdf",
        page: 3,
        rects: [{ x1: 0.12, y1: 0.22, x2: 0.42, y2: 0.26 }],
      },
      style: {
        color: "#FFEB3B",
        type: "highlight",
      },
      content: "persisted text",
      author: "user",
      createdAt: 1,
    };

    const binding: ResolvedPdfDocumentBinding = {
      documentId: "doc-1",
      fileIdentity: createFileIdentity(),
      canonicalStorageFileId: "papers-paper.pdf",
      storageCandidates: ["papers-paper.pdf", "paper.pdf"],
      annotationFile: createAnnotationFile([]),
      resolvedSource: null,
    };

    mocks.loadAnnotationsForFileIdentity.mockResolvedValue({
      annotationFile: createAnnotationFile([persistedAnnotation]),
      source: {
        documentId: "doc-1",
        workspaceKey: "ws",
        sourcePath: ".lattice/annotations/papers-paper.pdf.json",
        sourceKind: "current-root",
        fileId: "papers-paper.pdf",
        canonicalPath: "C:/workspace/papers/paper.pdf",
        relativePathFromRoot: "papers/paper.pdf",
        fileFingerprint: "file-fp",
        versionFingerprint: "version-fp",
        updatedAt: Date.now(),
      },
    });

    const fileHandle = { name: "paper.pdf" } as FileSystemFileHandle;
    const rootHandle = {} as FileSystemDirectoryHandle;

    const { result } = renderHook(() => useAnnotationSystem({
      fileHandle,
      filePath: "papers/paper.pdf",
      storageFileId: "papers-paper.pdf",
      rootHandle,
      fileType: "pdf",
      binding,
    }));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.annotations).toHaveLength(1);
    });

    expect(mocks.loadAnnotationsForFileIdentity).toHaveBeenCalled();
    expect(result.current.annotations[0]?.id).toBe("ann-highlight");
    expect(result.current.fileId).toBe("papers-paper.pdf");
  });
});
