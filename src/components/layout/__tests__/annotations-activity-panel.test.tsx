/**
 * @vitest-environment jsdom
 */

import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnnotationsActivityPanel } from "../annotations-activity-panel";
import { useWorkspaceStore } from "@/stores/workspace-store";

const navigateLinkMock = vi.fn().mockResolvedValue(true);
const loadAnnotationsFromDiskMock = vi.fn();
const loadPdfItemManifestMock = vi.fn();

vi.mock("@/lib/link-router/navigate-link", () => ({
  navigateLink: (...args: unknown[]) => navigateLinkMock(...args),
}));

vi.mock("@/lib/universal-annotation-storage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/universal-annotation-storage")>("@/lib/universal-annotation-storage");
  return {
    ...actual,
    loadAnnotationsFromDisk: (...args: unknown[]) => loadAnnotationsFromDiskMock(...args),
  };
});

vi.mock("@/lib/pdf-item", async () => {
  const actual = await vi.importActual<typeof import("@/lib/pdf-item")>("@/lib/pdf-item");
  return {
    ...actual,
    loadPdfItemManifest: (...args: unknown[]) => loadPdfItemManifestMock(...args),
  };
});

function createFileHandle(name: string): FileSystemFileHandle {
  return { name } as FileSystemFileHandle;
}

afterEach(() => {
  navigateLinkMock.mockClear();
  loadAnnotationsFromDiskMock.mockReset();
  loadPdfItemManifestMock.mockReset();
});

describe("AnnotationsActivityPanel", () => {
  it("filters to current file and navigates to a pdf annotation target", async () => {
    loadPdfItemManifestMock.mockResolvedValue({
      version: 3,
      itemId: "docs-paper.pdf",
      pdfPath: "docs/paper.pdf",
      itemFolderPath: ".lattice/items/docs-paper.pdf",
      annotationIndexPath: ".lattice/items/docs-paper.pdf/_annotations.md",
      createdAt: 1,
      updatedAt: 1,
    });
    loadAnnotationsFromDiskMock.mockImplementation(async (fileId: string) => {
      if (fileId === "docs-paper.pdf") {
        return {
          version: 2,
          fileId,
          fileType: "pdf",
          lastModified: Date.now(),
          annotations: [
            {
              id: "ann-pdf",
              target: { type: "pdf", page: 3, rects: [{ x1: 0.1, y1: 0.1, x2: 0.2, y2: 0.2 }] },
              style: { color: "#ff0", type: "highlight" },
              content: "pdf match",
              createdAt: 10,
              author: "user",
            },
          ],
        };
      }

      return {
        version: 2,
        fileId,
        fileType: "code",
        lastModified: Date.now(),
        annotations: [
          {
            id: "ann-md",
            target: { type: "code_line", line: 8 },
            style: { color: "#0ff", type: "highlight" },
            content: "markdown match",
            createdAt: 5,
            author: "user",
          },
        ],
      };
    });

    await act(async () => {
      useWorkspaceStore.setState((state) => ({
        ...state,
        rootHandle: { name: "workspace" } as FileSystemDirectoryHandle,
        fileTree: {
          root: {
            name: "workspace",
            kind: "directory",
            handle: { name: "workspace" } as FileSystemDirectoryHandle,
            path: "workspace",
            isExpanded: true,
            children: [
              {
                name: "paper.pdf",
                kind: "file",
                handle: createFileHandle("paper.pdf"),
                extension: "pdf",
                path: "docs/paper.pdf",
              },
              {
                name: "note.md",
                kind: "file",
                handle: createFileHandle("note.md"),
                extension: "md",
                path: "notes/note.md",
              },
            ],
          },
        },
        layout: {
          activePaneId: "pane-initial",
          root: {
            type: "pane",
            id: "pane-initial",
            activeTabIndex: 0,
            tabs: [
              {
                id: "tab-pdf",
                fileHandle: createFileHandle("paper.pdf"),
                fileName: "paper.pdf",
                filePath: "docs/paper.pdf",
                isDirty: false,
                scrollPosition: 0,
              },
            ],
          },
        },
      }));
    });

    render(<AnnotationsActivityPanel />);

    await waitFor(() => {
      expect(screen.getByText("paper.pdf")).toBeTruthy();
      expect(screen.getByText("note.md")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("当前文件"));

    await waitFor(() => {
      expect(screen.getByText("paper.pdf")).toBeTruthy();
      expect(screen.queryByText("note.md")).toBeNull();
      expect(screen.getAllByText("1").length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByText("pdf match"));

    await waitFor(() => {
      expect(navigateLinkMock).toHaveBeenCalledWith("docs/paper.pdf#annotation=ann-pdf", expect.objectContaining({
        paneId: "pane-initial",
      }));
    });
  });
});
