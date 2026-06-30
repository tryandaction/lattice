/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
    refreshDirectory: vi.fn(async () => undefined),
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
  useFileSystem: () => ({
    deleteFile: vi.fn(),
    refreshDirectory: mocks.refreshDirectory,
  }),
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
  createPdfItemNote: vi.fn(),
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

vi.mock("@/hooks/use-i18n", () => ({
  useI18n: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      if (key === "pdf.workspace.count.annotations") return `${values?.count} annotations`;
      if (key === "pdf.workspace.count.notes") return `${values?.count} related files`;
      const labels: Record<string, string> = {
        "pdf.workspace.title": "PDF Item",
        "pdf.workspace.action.newNote": "New note",
        "pdf.workspace.action.newNotebook": "New Notebook",
        "pdf.workspace.action.reveal": "Reveal in Explorer",
        "pdf.workspace.meta.copy": "Copy summary",
        "pdf.workspace.meta.copyCitation": "Copy citation",
        "pdf.workspace.meta.copyBibtex": "Copy BibTeX",
        "pdf.workspace.meta.authors": "Authors",
        "pdf.workspace.meta.year": "Year",
        "pdf.workspace.meta.pages": "Pages",
      };
      return labels[key] ?? key;
    },
  }),
}));

describe("PdfItemWorkspacePanel", () => {
  beforeEach(() => {
    refreshDirectory.mockClear();
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

  it("shows original routing paths for copied PDFs and resolves by fingerprint", async () => {
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
      expect(screen.getByText(/Original PDF:/)).toBeTruthy();
      expect(screen.getByText(/Item workspace:/)).toBeTruthy();
    });

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
