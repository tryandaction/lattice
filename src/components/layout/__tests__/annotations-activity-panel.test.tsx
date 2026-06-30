/**
 * @vitest-environment jsdom
 */

import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnnotationsActivityPanel } from "../annotations-activity-panel";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSettingsStore } from "@/stores/settings-store";
import { DEFAULT_SETTINGS } from "@/types/settings";

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

function seedEnglishSettings() {
  useSettingsStore.setState({
    settings: {
      ...DEFAULT_SETTINGS,
      language: "en-US",
      annotationsPanelScope: "all",
      annotationsPanelSort: "latest",
    },
    isLoading: false,
    isInitialized: true,
    error: null,
  });
}

function seedWorkspace() {
  return act(async () => {
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
}

function seedAnnotationLoaders() {
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
            target: {
              type: "pdf",
              page: 3,
              rects: [{ x1: 0.1, y1: 0.1, x2: 0.2, y2: 0.2 }],
              textQuote: {
                exact: "pdf match with full quote",
                prefix: "",
                suffix: "",
                source: "native",
                confidence: "high",
              },
            },
            style: { color: "#FFD400", type: "highlight" },
            content: "pdf match",
            comment: "important pdf comment",
            tags: ["physics"],
            createdAt: 10,
            author: "user",
          },
          ...Array.from({ length: 4 }, (_, index) => ({
            id: `ann-extra-${index}`,
            target: { type: "pdf" as const, page: index + 4, rects: [{ x1: 0.1, y1: 0.1, x2: 0.2, y2: 0.2 }] },
            style: { color: "#2EA8E5", type: "underline" as const },
            content: `extra annotation ${index + 1}`,
            createdAt: 9 - index,
            author: "user",
          })),
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
          style: { color: "#2EA8E5", type: "highlight" },
          content: "markdown match",
          createdAt: 5,
          author: "user",
        },
      ],
    };
  });
}

afterEach(() => {
  navigateLinkMock.mockClear();
  loadAnnotationsFromDiskMock.mockReset();
  loadPdfItemManifestMock.mockReset();
});

describe("AnnotationsActivityPanel", () => {
  it("searches rendered annotation content, keeps all matches visible, and navigates to targets", async () => {
    seedEnglishSettings();
    seedAnnotationLoaders();
    await seedWorkspace();

    render(<AnnotationsActivityPanel />);

    await waitFor(() => {
      expect(screen.getByText("paper.pdf")).toBeTruthy();
      expect(screen.getByText("note.md")).toBeTruthy();
    });

    expect(screen.getByText("pdf match with full quote")).toBeTruthy();
    expect(screen.getByText("important pdf comment")).toBeTruthy();
    expect(screen.getByText("extra annotation 4")).toBeTruthy();
    expect(screen.getAllByText("高亮").length).toBeGreaterThan(0);
    expect(screen.getByText("第 3 页")).toBeTruthy();
    const annotationButton = screen.getByText("pdf match with full quote").closest("button");
    expect(annotationButton?.querySelector("[style*='rgb(255, 212, 0)']")).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("搜索批注正文、评论、标签或文件..."), {
      target: { value: "markdown" },
    });

    await waitFor(() => {
      expect(screen.queryByText("paper.pdf")).toBeNull();
      expect(screen.getByText("note.md")).toBeTruthy();
      expect(screen.getByText("markdown match")).toBeTruthy();
    });

    fireEvent.change(screen.getByPlaceholderText("搜索批注正文、评论、标签或文件..."), {
      target: { value: "" },
    });

    fireEvent.click(screen.getByText("当前文件"));

    await waitFor(() => {
      expect(screen.getByText("paper.pdf")).toBeTruthy();
      expect(screen.queryByText("note.md")).toBeNull();
      expect(screen.getByText("5 条批注")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("pdf match with full quote"));

    await waitFor(() => {
      expect(navigateLinkMock).toHaveBeenCalledWith(
        "docs/paper.pdf#annotation=ann-pdf",
        expect.objectContaining({ paneId: "pane-initial" }),
      );
    });
  });
});
