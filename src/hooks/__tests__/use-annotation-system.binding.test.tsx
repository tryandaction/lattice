/**
 * @vitest-environment jsdom
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useAnnotationSystem } from "../use-annotation-system";
import type { ResolvedPdfDocumentBinding } from "@/lib/pdf-document-binding";
import type { AnnotationItem, UniversalAnnotationFile } from "@/types/universal-annotation";
import type { FileIdentity, WorkspaceIdentity } from "@/types/workspace-identity";

const mocks = vi.hoisted(() => {
  const loadAnnotationsForFileIdentity = vi.fn();
  const saveWithRetry = vi.fn(async (_file: unknown, _root: unknown) => true);
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

  function fixture(id: string) {
    const annotation: AnnotationItem = { id: `ann-${id}`, target: { type: "pdf", page: 1, rects: [{ x1: .1, y1: .1, x2: .2, y2: .2 }] }, style: { type: "highlight", color: "#FFD400" }, content: id, author: "user", createdAt: 1 };
    const annotationFile = { ...createAnnotationFile([annotation]), fileId: `${id}.pdf`, documentId: id };
    const binding: ResolvedPdfDocumentBinding = { documentId: id, fileIdentity: { ...createFileIdentity(), primaryFileId: `${id}.pdf` }, canonicalStorageFileId: `${id}.pdf`, storageCandidates: [`${id}.pdf`], annotationFile, resolvedSource: null };
    return { annotation, binding, options: { fileHandle: { name: `${id}.pdf` } as FileSystemFileHandle, filePath: `${id}.pdf`, rootHandle: { name: `root-${id}` } as FileSystemDirectoryHandle, fileType: "pdf" as const, binding, saveDelay: 1000 } };
  }

  it("ignores a previous file's late restoration after switching files", async () => {
    const first = fixture("first");
    const second = fixture("second");
    let finishFirst!: (value: unknown) => void;
    mocks.loadAnnotationsForFileIdentity.mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }))
      .mockResolvedValueOnce({ annotationFile: second.binding.annotationFile, source: null });
    const { result, rerender } = renderHook((options) => useAnnotationSystem(options), { initialProps: first.options });
    await waitFor(() => expect(finishFirst).toBeTypeOf("function"));
    rerender(second.options);
    await waitFor(() => expect(result.current.annotations[0]?.id).toBe("ann-second"));
    await act(async () => { finishFirst({ annotationFile: first.binding.annotationFile, source: null }); });
    expect(result.current.annotations.map((item) => item.id)).toEqual(["ann-second"]);
    expect(result.current.fileId).toBe("second.pdf");
  });

  it("flushes the original file snapshot to its original root when switching before debounce", async () => {
    const first = fixture("first");
    const second = fixture("second");
    mocks.loadAnnotationsForFileIdentity.mockImplementation(async ({ fileIdentity }) => ({ annotationFile: fileIdentity.primaryFileId === "first.pdf" ? first.binding.annotationFile : second.binding.annotationFile, source: null }));
    const { result, rerender, unmount } = renderHook((options) => useAnnotationSystem(options), { initialProps: first.options });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    vi.useFakeTimers();
    try {
      act(() => { result.current.updateAnnotation("ann-first", { comment: "keep my edit" }); });
      await act(async () => { rerender(second.options); });
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(mocks.saveWithRetry).toHaveBeenCalledTimes(1);
      expect(mocks.saveWithRetry.mock.calls[0]).toEqual([expect.objectContaining({ fileId: "first.pdf", annotations: [expect.objectContaining({ id: "ann-first", comment: "keep my edit" })] }), first.options.rootHandle]);
      expect(result.current.annotations.map((item) => item.id)).toEqual(["ann-second"]);
    } finally { unmount(); vi.useRealTimers(); }
  });

  it("persists a final edit when the reader unmounts before debounce", async () => {
    const first = fixture("first");
    mocks.loadAnnotationsForFileIdentity.mockResolvedValue({ annotationFile: first.binding.annotationFile, source: null });
    const { result, unmount } = renderHook(() => useAnnotationSystem(first.options));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => { result.current.updateAnnotation("ann-first", { comment: "last edit" }); });
    await act(async () => { unmount(); });
    expect(mocks.saveWithRetry).toHaveBeenCalledWith(expect.objectContaining({ annotations: [expect.objectContaining({ comment: "last edit" })] }), first.options.rootHandle);
  });

  it("retries a failed debounce save during cleanup instead of discarding the dirty edit", async () => {
    const first = fixture("failed-debounce");
    mocks.loadAnnotationsForFileIdentity.mockResolvedValue({ annotationFile: first.binding.annotationFile, source: null });
    mocks.saveWithRetry.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const reader = renderHook(() => useAnnotationSystem(first.options));
    await waitFor(() => expect(reader.result.current.isLoading).toBe(false));
    vi.useFakeTimers();
    try {
      act(() => { reader.result.current.updateAnnotation(first.annotation.id, { comment: "recover this edit" }); });
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(reader.result.current.pendingSave).toBe(true);
      await act(async () => { reader.unmount(); });
      expect(mocks.saveWithRetry).toHaveBeenCalledTimes(2);
      expect(mocks.saveWithRetry.mock.calls[1]).toEqual([expect.objectContaining({ fileId: "failed-debounce.pdf", annotations: [expect.objectContaining({ comment: "recover this edit" })] }), first.options.rootHandle]);
    } finally { reader.unmount(); vi.useRealTimers(); }
  });

  it("keeps both panes synchronized so independent edits cannot overwrite each other", async () => {
    const first = fixture("dual-pane");
    mocks.loadAnnotationsForFileIdentity.mockResolvedValue({ annotationFile: first.binding.annotationFile, source: null });
    const left = renderHook(() => useAnnotationSystem(first.options));
    const right = renderHook(() => useAnnotationSystem(first.options));
    await waitFor(() => expect(left.result.current.isLoading || right.result.current.isLoading).toBe(false));
    act(() => { left.result.current.updateAnnotation(first.annotation.id, { comment: "left correction" }); });
    expect(right.result.current.annotations[0].comment).toBe("left correction");
    act(() => { right.result.current.upsertAnnotation({ ...first.annotation, id: "ann-from-right" }); });
    expect(left.result.current.annotations.map((item) => item.id)).toEqual(["ann-dual-pane", "ann-from-right"]);
    await act(async () => { right.unmount(); left.unmount(); });
    expect(mocks.saveWithRetry.mock.calls.at(-1)?.[0]).toMatchObject({ annotations: [expect.objectContaining({ id: "ann-dual-pane", comment: "left correction" }), expect.objectContaining({ id: "ann-from-right" })] });
  });

  it("retains an unsaved cleanup snapshot for reopening after storage recovers", async () => {
    const first = fixture("failed-cleanup");
    mocks.loadAnnotationsForFileIdentity.mockResolvedValue({ annotationFile: first.binding.annotationFile, source: null });
    mocks.saveWithRetry.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const original = renderHook(() => useAnnotationSystem(first.options));
    await waitFor(() => expect(original.result.current.isLoading).toBe(false));
    act(() => { original.result.current.updateAnnotation(first.annotation.id, { comment: "not yet on disk" }); });
    await act(async () => { original.unmount(); });
    const reopened = renderHook(() => useAnnotationSystem(first.options));
    await waitFor(() => expect(reopened.result.current.isLoading).toBe(false));
    expect(reopened.result.current.annotations[0].comment).toBe("not yet on disk");
    expect(reopened.result.current.pendingSave).toBe(true);
    await act(async () => { reopened.unmount(); });
    expect(mocks.saveWithRetry.mock.calls.at(-1)?.[0]).toMatchObject({ annotations: [expect.objectContaining({ comment: "not yet on disk" })] });
  });

  it("waits for the previous reader's pending write before reopening", async () => {
    const first = fixture("reopen");
    let persisted = first.binding.annotationFile;
    mocks.loadAnnotationsForFileIdentity.mockImplementation(async () => ({ annotationFile: persisted, source: { sourceKind: "current-root" } }));
    let finishWrite!: () => void;
    mocks.saveWithRetry.mockImplementationOnce((file) => new Promise<boolean>((resolve) => {
      finishWrite = () => { persisted = file as UniversalAnnotationFile; resolve(true); };
    }));
    const firstReader = renderHook(() => useAnnotationSystem(first.options));
    await waitFor(() => expect(firstReader.result.current.isLoading).toBe(false));
    act(() => { firstReader.result.current.updateAnnotation(first.annotation.id, { comment: "saved while closing" }); });
    await act(async () => { firstReader.unmount(); });
    const reopened = renderHook(() => useAnnotationSystem(first.options));
    await act(async () => { await Promise.resolve(); });
    expect(reopened.result.current.isLoading).toBe(true);
    await act(async () => { finishWrite(); });
    await waitFor(() => expect(reopened.result.current.annotations[0]?.comment).toBe("saved while closing"));
    reopened.unmount();
  });

  it("does not overwrite a newer durable edit when another pane has an older debounce pending", async () => {
    const first = fixture("pending-pane");
    let persisted = first.binding.annotationFile;
    mocks.loadAnnotationsForFileIdentity.mockResolvedValue({ annotationFile: persisted, source: null });
    mocks.saveWithRetry.mockImplementation(async (file) => { persisted = file as UniversalAnnotationFile; return true; });
    const left = renderHook(() => useAnnotationSystem(first.options));
    const right = renderHook(() => useAnnotationSystem(first.options));
    await waitFor(() => expect(left.result.current.isLoading || right.result.current.isLoading).toBe(false));
    vi.useFakeTimers();
    try {
      act(() => { left.result.current.updateAnnotation(first.annotation.id, { comment: "manual edit" }); });
      await act(async () => {
        expect(await right.result.current.persistAnnotationChanges([{ ...first.annotation, id: "ann-durable" }])).toBe(true);
      });
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(persisted.annotations.map((item) => item.id)).toEqual(["ann-pending-pane", "ann-durable"]);
      expect(persisted.annotations[0].comment).toBe("manual edit");
    } finally { left.unmount(); right.unmount(); vi.useRealTimers(); }
  });

  it("blocks editing when a path candidate cannot be read even if identity recovery returns empty", async () => {
    const first = fixture("denied-candidate");
    mocks.ensureAnnotationsDirectory.mockResolvedValue({
      getFileHandle: vi.fn().mockRejectedValue(new DOMException("Access denied", "NotAllowedError")),
    });
    mocks.resolveFileIdentity.mockResolvedValue(first.binding.fileIdentity);
    mocks.loadAnnotationsForFileIdentity.mockResolvedValue({ annotationFile: createAnnotationFile([]), source: null });
    const { result } = renderHook(() => useAnnotationSystem({ ...first.options, binding: null }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toContain("Access denied");
    act(() => { expect(result.current.upsertAnnotation(first.annotation)).toBe(false); });
    expect(mocks.saveWithRetry).not.toHaveBeenCalled();
  });

  it("stops identity recovery before storage side effects after the reader switches documents", async () => {
    const first = fixture("cancelled-identity");
    const second = fixture("current-identity");
    let finishIdentity!: (value: FileIdentity) => void;
    mocks.ensureAnnotationsDirectory.mockResolvedValue({
      getFileHandle: vi.fn().mockRejectedValue(new DOMException("Missing", "NotFoundError")),
    });
    mocks.resolveFileIdentity.mockImplementationOnce(() => new Promise((resolve) => { finishIdentity = resolve; }));
    mocks.loadAnnotationsForFileIdentity.mockResolvedValue({ annotationFile: second.binding.annotationFile, source: null });
    const initialOptions = { ...first.options, binding: null as ResolvedPdfDocumentBinding | null };
    const { result, rerender } = renderHook((options) => useAnnotationSystem(options), { initialProps: initialOptions });
    await waitFor(() => expect(finishIdentity).toBeTypeOf("function"));
    rerender(second.options);
    await waitFor(() => expect(result.current.annotations[0]?.id).toBe("ann-current-identity"));
    await act(async () => { finishIdentity(first.binding.fileIdentity); });
    expect(mocks.loadAnnotationsForFileIdentity).toHaveBeenCalledTimes(1);
    expect(result.current.annotations.map((item) => item.id)).toEqual(["ann-current-identity"]);
  });

  it("blocks mutations after restoration fails instead of replacing existing sidecars", async () => {
    const first = fixture("first");
    mocks.loadAnnotationsForFileIdentity.mockRejectedValue(new Error("Tauri command desktop_read_dir timed out"));
    const { result } = renderHook(() => useAnnotationSystem(first.options));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toContain("timed out");
    await act(async () => { expect(await result.current.persistAnnotationChanges([first.annotation])).toBe(false); });
    act(() => { expect(result.current.upsertAnnotation(first.annotation)).toBe(false); });
    expect(result.current.annotations).toEqual([]);
    expect(mocks.saveWithRetry).not.toHaveBeenCalled();
  });

  it("cancels fallback recovery before its deferred storage writes after a document switch", async () => {
    const first = fixture("fallback-cancelled");
    const second = fixture("fallback-current");
    let finishRecovery!: () => void;
    let obsoleteStorageWrites = 0;
    mocks.ensureAnnotationsDirectory.mockResolvedValue({
      getFileHandle: vi.fn().mockRejectedValue(new DOMException("Missing", "NotFoundError")),
    });
    mocks.resolveFileIdentity.mockResolvedValue(first.binding.fileIdentity);
    mocks.loadAnnotationsForFileIdentity.mockImplementationOnce(({ signal }: { signal?: AbortSignal }) => new Promise((resolve, reject) => {
      finishRecovery = () => {
        if (signal?.aborted) { reject(new DOMException("Cancelled", "AbortError")); return; }
        obsoleteStorageWrites += 1;
        resolve({ annotationFile: first.binding.annotationFile, source: null });
      };
    })).mockResolvedValueOnce({ annotationFile: second.binding.annotationFile, source: null });
    const initialOptions = { ...first.options, binding: null as ResolvedPdfDocumentBinding | null };
    const reader = renderHook((options) => useAnnotationSystem(options), { initialProps: initialOptions });
    await waitFor(() => expect(finishRecovery).toBeTypeOf("function"));
    reader.rerender(second.options);
    await waitFor(() => expect(reader.result.current.annotations[0]?.id).toBe("ann-fallback-current"));
    await act(async () => { finishRecovery(); });
    expect(obsoleteStorageWrites).toBe(0);
    expect(reader.result.current.annotations[0]?.id).toBe("ann-fallback-current");
    reader.unmount();
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
  it("waits for durable storage acknowledgement and preserves unrelated items on undo", async () => {
    const existing: AnnotationItem = { id: "ann-existing", target: { type: "pdf", page: 1, rects: [{ x1: .1, y1: .1, x2: .2, y2: .2 }] }, style: { type: "highlight", color: "#FFD400" }, content: "original", author: "user", createdAt: 1 };
    const added = { ...existing, id: "ann-ai", content: "AI exact quote", author: "ai" };
    const binding: ResolvedPdfDocumentBinding = { documentId: "doc-1", fileIdentity: createFileIdentity(), canonicalStorageFileId: "papers-paper.pdf", storageCandidates: ["papers-paper.pdf"], annotationFile: createAnnotationFile([existing]), resolvedSource: null };
    mocks.loadAnnotationsForFileIdentity.mockResolvedValue({ annotationFile: createAnnotationFile([existing]), source: null });
    const options = { fileHandle: { name: "paper.pdf" } as FileSystemFileHandle, filePath: "papers/paper.pdf", rootHandle: {} as FileSystemDirectoryHandle, fileType: "pdf" as const, binding };
    const { result } = renderHook(() => useAnnotationSystem(options));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    let finishSave!: (success: boolean) => void;
    mocks.saveWithRetry.mockImplementationOnce(() => new Promise<boolean>((resolve) => { finishSave = resolve; }));
    let saving!: Promise<boolean>;
    act(() => { saving = result.current.persistAnnotationChanges([added]); });
    expect(result.current.pendingSave).toBe(true);
    await waitFor(() => expect(finishSave).toBeTypeOf('function'));
    await act(async () => { finishSave(true); expect(await saving).toBe(true); });
    expect(result.current.annotations.map((item) => item.id)).toEqual(["ann-existing", "ann-ai"]);
    await act(async () => { expect(await result.current.persistAnnotationChanges([], ["ann-ai"])).toBe(true); });
    expect(result.current.annotations).toEqual([existing]);
    expect(mocks.saveWithRetry.mock.calls.at(-1)?.[0]).toMatchObject({ annotations: [existing] });
  });

  it("reports storage failure without publishing fake saved highlights, and allows retry", async () => {
    const added: AnnotationItem = { id: "ann-ai", target: { type: "pdf", page: 1, rects: [{ x1: .1, y1: .1, x2: .2, y2: .2 }] }, style: { type: "highlight", color: "#FFD400" }, content: "exact quote", author: "ai", createdAt: 1 };
    const binding: ResolvedPdfDocumentBinding = { documentId: "doc-1", fileIdentity: createFileIdentity(), canonicalStorageFileId: "papers-paper.pdf", storageCandidates: ["papers-paper.pdf"], annotationFile: createAnnotationFile([]), resolvedSource: null };
    mocks.loadAnnotationsForFileIdentity.mockResolvedValue({ annotationFile: createAnnotationFile([]), source: null });
    const options = { fileHandle: { name: "paper.pdf" } as FileSystemFileHandle, filePath: "papers/paper.pdf", rootHandle: {} as FileSystemDirectoryHandle, fileType: "pdf" as const, binding };
    const { result } = renderHook(() => useAnnotationSystem(options));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    mocks.saveWithRetry.mockResolvedValueOnce(false);
    await act(async () => { expect(await result.current.persistAnnotationChanges([added])).toBe(false); });
    expect(result.current.annotations).toEqual([]);
    expect(result.current.error).toContain("Failed to save");
    await act(async () => { expect(await result.current.persistAnnotationChanges([added])).toBe(true); });
    expect(result.current.annotations).toEqual([added]);
  });

  it("clears formula metadata and preview when their source selection changes", async () => {
    const rects = [{ x1: .1, y1: .1, x2: .2, y2: .2 }];
    const existing: AnnotationItem = {
      id: 'formula-source', target: { type: 'pdf', page: 1, rects },
      style: { type: 'highlight', color: '#FFD400' }, content: 'x=1', createdAt: 1, author: 'user',
      preview: { type: 'image', dataUrl: 'data:image/png;base64,aQ==', width: 10, height: 10 },
      formula: { status: 'ready', source: 'geometry', rawText: 'x=1', latex: 'x=1', originalRects: rects },
    };
    const binding: ResolvedPdfDocumentBinding = { documentId: 'doc-1', fileIdentity: createFileIdentity(), canonicalStorageFileId: 'papers-paper.pdf', storageCandidates: ['papers-paper.pdf'], annotationFile: createAnnotationFile([existing]), resolvedSource: null };
    mocks.loadAnnotationsForFileIdentity.mockResolvedValue({ annotationFile: binding.annotationFile, source: null });
    const options = { fileHandle: { name: 'paper.pdf' } as FileSystemFileHandle, filePath: 'papers/paper.pdf', rootHandle: {} as FileSystemDirectoryHandle, fileType: 'pdf' as const, binding, saveDelay: 10 };
    const { result, unmount } = renderHook(() => useAnnotationSystem(options));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => { result.current.updateAnnotation(existing.id, { comment: 'keep transcription' }); });
    expect(result.current.annotations[0].formula).toEqual(existing.formula);
    act(() => { result.current.updateAnnotation(existing.id, { target: { rects: [{ x1: .3, y1: .3, x2: .4, y2: .4 }] }, formula: undefined, preview: undefined }); });
    expect(result.current.annotations[0].formula).toBeUndefined();
    expect(result.current.annotations[0].preview).toBeUndefined();
    await waitFor(() => expect(mocks.saveWithRetry).toHaveBeenCalled());
    expect(mocks.saveWithRetry.mock.calls.at(-1)?.[0]).toMatchObject({
      annotations: [{ id: existing.id, formula: undefined, preview: undefined }],
    });
    unmount();
  });

  it("resumes pending user edits after a rejected AI save instead of clearing their dirty state", async () => {
    const existing: AnnotationItem = { id: "ann-user", target: { type: "pdf", page: 1, rects: [{ x1: .1, y1: .1, x2: .2, y2: .2 }] }, style: { type: "highlight", color: "#FFD400" }, content: "source", comment: "old", author: "user", createdAt: 1 };
    const added = { ...existing, id: "ann-ai", author: "ai", comment: "suggestion" };
    const binding: ResolvedPdfDocumentBinding = { documentId: "doc-1", fileIdentity: createFileIdentity(), canonicalStorageFileId: "papers-paper.pdf", storageCandidates: ["papers-paper.pdf"], annotationFile: createAnnotationFile([existing]), resolvedSource: null };
    mocks.loadAnnotationsForFileIdentity.mockResolvedValue({ annotationFile: binding.annotationFile, source: null });
    const options = { fileHandle: { name: "paper.pdf" } as FileSystemFileHandle, filePath: "papers/paper.pdf", rootHandle: {} as FileSystemDirectoryHandle, fileType: "pdf" as const, binding, saveDelay: 1000 };
    const { result, unmount } = renderHook(() => useAnnotationSystem(options));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    vi.useFakeTimers();
    try {
      act(() => { result.current.updateAnnotation(existing.id, { comment: "my unsaved correction" }); });
      expect(result.current.pendingSave).toBe(true);
      mocks.saveWithRetry.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
      await act(async () => { expect(await result.current.persistAnnotationChanges([added])).toBe(false); });
      expect(result.current.annotations).toHaveLength(1);
      expect(result.current.annotations[0].comment).toBe("my unsaved correction");
      expect(result.current.pendingSave).toBe(true);
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(mocks.saveWithRetry).toHaveBeenCalledTimes(2);
      expect(mocks.saveWithRetry.mock.calls[1][0]).toMatchObject({ annotations: [expect.objectContaining({ id: "ann-user", comment: "my unsaved correction" })] });
      expect(result.current.pendingSave).toBe(false);
    } finally { unmount(); vi.useRealTimers(); }
  });

});
