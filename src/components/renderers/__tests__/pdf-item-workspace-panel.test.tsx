/**
 * @vitest-environment jsdom
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import type { PdfItemNoteSummary } from "@/lib/pdf-item";
import { PdfItemWorkspacePanel } from "../pdf-item-workspace-panel";

const mocks = vi.hoisted(() => {
  const fileTreeRoot = {
    name: "workspace",
    kind: "directory",
    handle: {} as FileSystemDirectoryHandle,
    path: "workspace",
    isExpanded: true,
    children: [
      {
        name: "papers",
        kind: "directory",
        handle: {} as FileSystemDirectoryHandle,
        path: "workspace/papers",
        isExpanded: false,
        children: [
          {
            name: "paper.pdf",
            kind: "file",
            handle: {} as FileSystemFileHandle,
            extension: "pdf",
            path: "workspace/papers/paper.pdf",
          },
        ],
      },
    ],
  };

  return {
    fileSystemReads: vi.fn(),
    refreshDirectory: vi.fn(async () => undefined),
    hydratePdfVirtualChildren: vi.fn(async () => undefined),
    createPdfItemNote: vi.fn(),
    closeTabsByPath: vi.fn(),
    splitPane: vi.fn(),
    openFileInPane: vi.fn(),
    toggleDirectory: vi.fn(),
    setSelectedDirectoryPath: vi.fn(),
    setExplorerSelection: vi.fn(),
    copyToClipboard: vi.fn(async (_text: string) => true),
    resolveEntry: vi.fn<(
      rootHandle: FileSystemDirectoryHandle,
      path: string,
    ) => Promise<{ kind: "file"; handle: FileSystemFileHandle } | null>>(async () => null),
    resolveDirectoryHandle: vi.fn<() => Promise<FileSystemDirectoryHandle | null>>(async () => null),
    listPdfItemNotes: vi.fn<() => Promise<PdfItemNoteSummary[]>>(async () => []),
    loadPdfItemManifest: vi.fn(),
    fileTreeRoot,
  };
});

const {
  refreshDirectory,
  hydratePdfVirtualChildren,
  createPdfItemNote,
  closeTabsByPath,
  splitPane,
  openFileInPane,
  toggleDirectory,
  setSelectedDirectoryPath,
  setExplorerSelection,
  copyToClipboard,
  resolveEntry,
  resolveDirectoryHandle,
  listPdfItemNotes,
  loadPdfItemManifest,
  fileTreeRoot,
} = mocks;

vi.mock("@/hooks/use-file-system", () => ({
  useFileSystem: () => { mocks.fileSystemReads(); return ({
    deleteFile: vi.fn(),
    refreshDirectory: mocks.refreshDirectory,
    hydratePdfVirtualChildren: mocks.hydratePdfVirtualChildren,
  }); },
}));

vi.mock("@/stores/workspace-store", () => {
  const workspaceState = {
    layout: {
      activePaneId: "pane-main",
      root: null,
    },
    closeTabsByPath: mocks.closeTabsByPath,
    splitPane: mocks.splitPane,
    openFileInPane: mocks.openFileInPane,
    toggleDirectory: mocks.toggleDirectory,
    setSelectedDirectoryPath: mocks.setSelectedDirectoryPath,
    fileTree: { root: mocks.fileTreeRoot },
  };
  const useWorkspaceStore = (selector: (state: unknown) => unknown) => selector(workspaceState);
  useWorkspaceStore.getState = () => workspaceState;
  return { useWorkspaceStore };
});

vi.mock("@/stores/explorer-store", () => ({
  useExplorerStore: {
    getState: () => ({
      setSelection: mocks.setExplorerSelection,
    }),
  },
}));

vi.mock("@/lib/plugins/runtime", () => ({
  emitVaultChange: vi.fn(),
}));

vi.mock("@/lib/file-operations", () => ({
  getParentPath: (path: string) => path.split("/").slice(0, -1).join("/"),
  resolveEntry: mocks.resolveEntry,
  resolveDirectoryHandle: mocks.resolveDirectoryHandle,
}));

vi.mock("@/lib/pdf-item", () => ({
  createPdfItemNote: mocks.createPdfItemNote,
  ensurePdfItemWorkspace: vi.fn(async () => ({
    itemId: "item-1",
    itemFolderPath: ".lattice/items/item-1",
  })),
  listPdfItemNotes: mocks.listPdfItemNotes,
  loadPdfItemManifest: mocks.loadPdfItemManifest,
}));

vi.mock("@/lib/universal-annotation-storage", () => ({
  generateFileId: (path: string) => path.replace(/\W+/g, "-"),
}));

vi.mock("@/lib/pdf-metadata", () => ({
  extractPdfBibliographicSummary: vi.fn(async () => ({
    title: "Logical qubits with erasure conversion",
    authors: ["A. Researcher"],
    year: "2026",
    doi: "10.1234/example",
    arxivId: null,
    subject: null,
    keywords: [],
    creator: null,
    producer: null,
    pageCount: 12,
  })),
}));

vi.mock("@/lib/pdf-bibliography-enrichment", async () => {
  const actual = await vi.importActual<typeof import("@/lib/pdf-bibliography-enrichment")>("@/lib/pdf-bibliography-enrichment");
  return {
    ...actual,
    enrichPdfBibliography: vi.fn(async () => null),
  };
});

vi.mock("@/lib/link-router/open-external", () => ({
  openExternalUrl: vi.fn(),
}));

vi.mock("@/lib/clipboard", () => ({
  copyToClipboard: (text: string) => mocks.copyToClipboard(text),
}));

beforeEach(() => setLocale("en-US"));
afterEach(() => { cleanup(); setLocale("zh-CN"); });

describe("PdfItemWorkspacePanel", () => {
  beforeEach(() => {
    refreshDirectory.mockClear();
    hydratePdfVirtualChildren.mockClear();
    createPdfItemNote.mockReset();
    createPdfItemNote.mockResolvedValue({
      handle: { kind: "file", name: "Untitled.md" },
      path: ".lattice/items/item-1/Untitled.md",
    });
    closeTabsByPath.mockClear();
    splitPane.mockClear();
    openFileInPane.mockClear();
    toggleDirectory.mockClear();
    setSelectedDirectoryPath.mockClear();
    setExplorerSelection.mockClear();
    copyToClipboard.mockClear();
    resolveEntry.mockReset();
    resolveDirectoryHandle.mockReset();
    resolveDirectoryHandle.mockResolvedValue(null);
    listPdfItemNotes.mockReset();
    listPdfItemNotes.mockResolvedValue([]);
    loadPdfItemManifest.mockReset();
    loadPdfItemManifest.mockResolvedValue({
      itemId: "item-1",
      itemFolderPath: ".lattice/items/item-1",
      pdfPath: "workspace/paper.pdf",
      knownPdfPaths: ["workspace/paper.pdf"],
      fileFingerprint: null,
      versionFingerprint: null,
    });
  });

  it("hydrates only the current PDF subtree after creating a note", async () => {
    render(
      <PdfItemWorkspacePanel
        rootHandle={{ name: "workspace" } as FileSystemDirectoryHandle}
        fileName="paper.pdf"
        filePath="workspace/paper.pdf"
        paneId="pane-main"
        annotations={[]}
        manifest={{
          itemId: "item-1",
          itemFolderPath: ".lattice/items/item-1",
          pdfPath: "workspace/paper.pdf",
          knownPdfPaths: ["workspace/paper.pdf"],
          version: 4,
          annotationIndexPath: ".lattice/items/item-1/annotations/index.json",
          createdAt: 1,
          updatedAt: 1,
          fileFingerprint: null,
          versionFingerprint: null,
        }}
        pdfDocument={null}
      />,
    );

    fireEvent.click(screen.getByTitle("New note"));

    await waitFor(() => {
      expect(createPdfItemNote).toHaveBeenCalled();
      expect(hydratePdfVirtualChildren).toHaveBeenCalledWith(
        "workspace/paper.pdf",
        { force: true, expand: true },
      );
    });
    expect(refreshDirectory).not.toHaveBeenCalled();
  });

  it("keeps bibliography copy actions collapsed behind one compact icon menu", async () => {
    render(
      <PdfItemWorkspacePanel
        rootHandle={{ name: "workspace" } as FileSystemDirectoryHandle}
        fileName="paper.pdf"
        filePath="workspace/paper.pdf"
        paneId="pane-main"
        annotations={[
          {
            id: "ann-1",
            target: { type: "pdf", page: 2, rects: [] },
            style: { type: "highlight", color: "#FFD400" },
            content: "quote",
            author: "user",
            createdAt: 1,
          },
        ]}
        pdfDocument={{ getMetadata: vi.fn() } as never}
      />
    );

    await waitFor(() => {
      expect(screen.getByTitle("Copy summary")).toBeTruthy();
    });

    expect(screen.getByText("1 annotations")).toBeTruthy();
    expect(screen.getByText("0 related files")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Copy citation" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy BibTeX" })).toBeNull();

    fireEvent.click(screen.getByTitle("Copy summary"));

    expect(screen.getByRole("button", { name: "Copy citation" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy BibTeX" })).toBeTruthy();
  });

  it("reveals the source PDF in the explorer without requiring an item workspace manifest", async () => {
    render(
      <PdfItemWorkspacePanel
        rootHandle={{ name: "workspace" } as FileSystemDirectoryHandle}
        fileName="paper.pdf"
        filePath="workspace/papers/paper.pdf"
        paneId="pane-main"
        annotations={[]}
        manifest={null}
        pdfDocument={null}
      />,
    );

    const revealButton = screen.getByTitle("Reveal in Explorer") as HTMLButtonElement;
    expect(revealButton.disabled).toBe(false);

    fireEvent.click(revealButton);

    expect(setExplorerSelection).toHaveBeenCalledWith("workspace/papers/paper.pdf", "file");
    expect(setSelectedDirectoryPath).toHaveBeenCalledWith("workspace/papers");
    expect(toggleDirectory).toHaveBeenCalledWith("workspace/papers");
  });

  it("copies a useful markdown summary with source links and live counts", async () => {
    render(
      <PdfItemWorkspacePanel
        rootHandle={{ name: "workspace" } as FileSystemDirectoryHandle}
        fileName="paper.pdf"
        filePath="workspace/papers/paper.pdf"
        paneId="pane-main"
        annotations={[
          {
            id: "ann-1",
            target: { type: "pdf", page: 2, rects: [] },
            style: { type: "highlight", color: "#FFD400" },
            content: "quote",
            author: "user",
            createdAt: 1,
          },
        ]}
        pdfDocument={{ getMetadata: vi.fn() } as never}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTitle("Copy summary")).toBeTruthy();
    });

    fireEvent.click(screen.getByTitle("Copy summary"));
    fireEvent.click(screen.getAllByText("Copy summary").find((element) => element.tagName === "BUTTON")!);

    await waitFor(() => {
      expect(copyToClipboard).toHaveBeenCalled();
    });

    const copied = copyToClipboard.mock.calls[0]?.[0] ?? "";
    expect(copied).toContain("# Logical qubits with erasure conversion");
    expect(copied).toContain("- Source PDF: [paper.pdf](workspace/papers/paper.pdf)");
    expect(copied).toContain("- PDF path: `workspace/papers/paper.pdf`");
    expect(copied).toContain("- Pages: 12");
    expect(copied).toContain("- Annotations: 1");
    expect(copied).toContain("- DOI: [10.1234/example](https://doi.org/10.1234/example)");
  });

  it("shows arbitrary pdf item files and opens files without treating folders as files", async () => {
    resolveDirectoryHandle.mockResolvedValue({ name: "item-1" } as FileSystemDirectoryHandle);
    listPdfItemNotes.mockResolvedValue([
      {
        type: "directory",
        fileName: "assets",
        path: ".lattice/items/item-1/assets",
        depth: 0,
      },
      {
        type: "file",
        fileName: "plot.png",
        path: ".lattice/items/item-1/assets/plot.png",
        depth: 1,
      },
      {
        type: "file",
        fileName: "data.csv",
        path: ".lattice/items/item-1/data.csv",
        depth: 0,
      },
    ]);
    resolveEntry.mockImplementation(async (_rootHandle: FileSystemDirectoryHandle, path: string) => ({
      kind: "file" as const,
      handle: { name: String(path).split("/").pop() } as FileSystemFileHandle,
    }));
    splitPane.mockReturnValue("pane-side");

    render(
      <PdfItemWorkspacePanel
        rootHandle={{ name: "workspace" } as FileSystemDirectoryHandle}
        fileName="paper.pdf"
        filePath="workspace/paper.pdf"
        paneId="pane-main"
        annotations={[]}
        pdfDocument={null}
      />,
    );

    fireEvent.click(screen.getByText("PDF Item"));

    await waitFor(() => {
      expect(screen.getByText("assets")).toBeTruthy();
      expect(screen.getByText("data.csv")).toBeTruthy();
    });
    expect(screen.queryByText("plot.png")).toBeNull();

    fireEvent.click(screen.getByText("assets"));
    expect(setSelectedDirectoryPath).toHaveBeenCalledWith(".lattice/items/item-1/assets");
    expect(resolveEntry).not.toHaveBeenCalled();
    expect(screen.getByText("plot.png")).toBeTruthy();

    fireEvent.click(screen.getByText("plot.png"));
    await waitFor(() => {
      expect(openFileInPane).toHaveBeenCalledWith("pane-side", { name: "plot.png" }, ".lattice/items/item-1/assets/plot.png");
    });

    fireEvent.click(screen.getByText("data.csv"));
    await waitFor(() => {
      expect(openFileInPane).toHaveBeenCalledWith("pane-side", { name: "data.csv" }, ".lattice/items/item-1/data.csv");
    });
  });

  it("switches PDF path labels in place and preserves the actual paths and identity", async () => {
    resolveDirectoryHandle.mockResolvedValue({ name: "item-1" } as FileSystemDirectoryHandle);
    loadPdfItemManifest.mockResolvedValue({
      itemId: "item-1",
      itemFolderPath: ".lattice/items/original-paper",
      pdfPath: "workspace/copied/paper.pdf",
      knownPdfPaths: [
        "workspace/original/paper.pdf",
        "workspace/copied/paper.pdf",
      ],
      fileFingerprint: "same-content",
      versionFingerprint: "copy-version",
    });

    render(
      <PdfItemWorkspacePanel
        rootHandle={{ name: "workspace" } as FileSystemDirectoryHandle}
        documentId={null}
        fileFingerprint="same-content"
        versionFingerprint="copy-version"
        fileName="paper.pdf"
        filePath="workspace/copied/paper.pdf"
        paneId="pane-main"
        annotations={[]}
        pdfDocument={null}
      />,
    );

    fireEvent.click(screen.getByText("PDF Item"));

    await waitFor(() => {
      expect(screen.getByText(/Current PDF:/)).toBeTruthy();
      expect(screen.getByText(/Related PDF:/)).toBeTruthy();
      expect(screen.getByText(/Research files:/)).toBeTruthy();
    });

    act(() => setLocale("zh-CN"));
    expect(screen.getByText("当前 PDF：")).toBeTruthy();
    expect(screen.getByText("关联 PDF：")).toBeTruthy();
    expect(screen.getByText("研究文件目录：")).toBeTruthy();
    expect(screen.queryByText(/Current PDF:|Original PDF:|Item workspace:/)).toBeNull();

    expect(screen.getByText(/workspace\/copied\/paper\.pdf/)).toBeTruthy();
    expect(screen.getByText(/workspace\/original\/paper\.pdf/)).toBeTruthy();
    expect(screen.getByText(/\.lattice\/items\/original-paper/)).toBeTruthy();
    expect(loadPdfItemManifest).toHaveBeenCalledWith(
      { name: "workspace" },
      "workspace-copied-paper-pdf",
      "workspace/copied/paper.pdf",
      {
        documentId: null,
        fileFingerprint: "same-content",
        versionFingerprint: "copy-version",
      },
    );
  });
});

describe("shared PDF research files", () => {
  it("lists, opens, creates and removes cloud children without calling local filesystem hooks", async () => {
    vi.clearAllMocks(); mocks.splitPane.mockReturnValue("pane-child");
    const cloudSource = { children: [{ id: "child-1", parentId: "pdf", name: "analysis.md", kind: "markdown" as const }], canCreate: true, onOpenChild: vi.fn(async () => {}), onCreateChild: vi.fn(async () => {}), onDeleteChild: vi.fn(async () => {}), onRevealChildren: vi.fn() };
    render(<PdfItemWorkspacePanel rootHandle={{} as FileSystemDirectoryHandle} fileName="paper.pdf" filePath="cloud://pdf" paneId="pane-main" annotations={[]} cloudSource={cloudSource} />);
    expect(screen.getByText("1 related files")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /PDF Item/ }));
    fireEvent.click(screen.getByRole("button", { name: "analysis.md" }));
    await waitFor(() => expect(cloudSource.onOpenChild).toHaveBeenCalledWith("child-1", "pane-child"));
    fireEvent.click(screen.getByRole("button", { name: "New note" }));
    await waitFor(() => expect(cloudSource.onCreateChild).toHaveBeenCalledWith("note", "pane-child"));
    fireEvent.click(screen.getByRole("button", { name: "Reveal in Explorer" }));
    expect(cloudSource.onRevealChildren).toHaveBeenCalledOnce();
    expect(mocks.fileSystemReads).not.toHaveBeenCalled();
    expect(mocks.loadPdfItemManifest).not.toHaveBeenCalled();
    expect(mocks.resolveEntry).not.toHaveBeenCalled();
  });
  it("uses cloud permissions for new research note actions", () => {
    render(<PdfItemWorkspacePanel rootHandle={{} as FileSystemDirectoryHandle} fileName="paper.pdf" filePath="cloud://pdf" paneId="pane-main" annotations={[]} cloudSource={{ children: [], canCreate: false, onOpenChild: vi.fn(), onCreateChild: vi.fn(), onRevealChildren: vi.fn() }} />);
    expect((screen.getByRole("button", { name: "New note" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "New Notebook" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
