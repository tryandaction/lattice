/**
 * @vitest-environment jsdom
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WorkspaceSearchPanel } from "../workspace-search-panel";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSettingsStore } from "@/stores/settings-store";
const navigateLinkMock = vi.fn().mockResolvedValue(true);
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
const originalConsoleError = console.error;
const extractRawTextMock = vi.fn();

vi.mock("@/lib/link-router/navigate-link", () => ({
  navigateLink: (...args: unknown[]) => navigateLinkMock(...args),
}));

vi.mock("mammoth", () => ({
  default: {
    extractRawText: (...args: unknown[]) => extractRawTextMock(...args),
  },
}));

function createFileHandle(name: string, content: string): FileSystemFileHandle {
  return {
    name,
    getFile: vi.fn(async () => new File([content], name, { type: "text/plain" })),
  } as unknown as FileSystemFileHandle;
}

afterEach(async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  consoleErrorSpy?.mockRestore();
  navigateLinkMock.mockClear();
  useWorkspaceStore.setState((state) => ({
    ...state,
    rootHandle: null,
    fileTree: { root: null },
  }));
  useSettingsStore.setState((state) => ({
    ...state,
    settings: {
      ...state.settings,
      searchPanelScope: "all",
      searchPanelMode: "name_and_content",
      searchPanelSort: "relevance",
    },
  }));
});

beforeEach(() => {
  vi.clearAllMocks();
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
    const message = args.map((value) => String(value ?? "")).join(" ");
    if (message.includes("not wrapped in act")) {
      return;
    }
    originalConsoleError(...args);
  });
});

describe("WorkspaceSearchPanel", () => {
  async function flushSearchWork() {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  async function runInteraction(action: () => void | Promise<void>) {
    await act(async () => {
      await action();
      await flushSearchWork();
    });
  }

  it("groups content matches and navigates to the matching line", async () => {
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
                name: "note.md",
                kind: "file",
                extension: "md",
                path: "workspace/note.md",
                handle: createFileHandle("note.md", "# Title\nalpha\nkeyword appears here\nomega"),
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
                id: "tab-note",
                fileHandle: createFileHandle("note.md", "# Title\nalpha\nkeyword appears here\nomega"),
                fileName: "note.md",
                filePath: "workspace/note.md",
                isDirty: false,
                scrollPosition: 0,
              },
            ],
          },
        },
      }));
    });

    render(<WorkspaceSearchPanel />);

    await runInteraction(() => {
      fireEvent.change(screen.getByPlaceholderText("搜索文件名或内容"), {
        target: { value: "keyword" },
      });
    });

    await waitFor(() => {
      expect(screen.getByText("note.md")).toBeTruthy();
      expect(screen.getByText((_, element) => element?.textContent === "keyword appears here")).toBeTruthy();
      expect(screen.getByText("第 3 行")).toBeTruthy();
      expect(screen.getByText("结果数: 1")).toBeTruthy();
    });

    expect(screen.getAllByText("keyword", { selector: "mark" }).length).toBeGreaterThan(0);

    await runInteraction(() => {
      fireEvent.click(screen.getByText("当前文件"));
    });
    expect(screen.getByText("结果数: 1")).toBeTruthy();

    await runInteraction(() => {
      fireEvent.click(screen.getByText("仅文件名"));
    });
    await waitFor(() => {
      expect(screen.getByText("当前文件中未找到匹配结果。")).toBeTruthy();
    });

    await runInteraction(() => {
      fireEvent.click(screen.getByText("文件名+内容"));
    });
    await waitFor(() => {
      expect(screen.getByText((_, element) => element?.textContent === "keyword appears here")).toBeTruthy();
    });

    await runInteraction(() => {
      fireEvent.click(screen.getByText((_, element) => element?.textContent === "keyword appears here"));
    });

    await waitFor(() => {
      expect(navigateLinkMock).toHaveBeenCalledWith("workspace/note.md#line=3", expect.objectContaining({
        paneId: "pane-initial",
      }));
    });
  });

  it("allows single CJK character queries", async () => {
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
                name: "quantum.md",
                kind: "file",
                extension: "md",
                path: "workspace/quantum.md",
                handle: createFileHandle("quantum.md", "量子纠错\n这里讨论量子码"),
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
            tabs: [],
          },
        },
      }));
    });

    render(<WorkspaceSearchPanel />);

    await runInteraction(() => {
      fireEvent.change(screen.getByPlaceholderText("搜索文件名或内容"), {
        target: { value: "量" },
      });
    });

    await waitFor(() => {
      expect(screen.getByText("quantum.md")).toBeTruthy();
      expect(screen.getByText((_, element) => element?.textContent === "量子纠错")).toBeTruthy();
    });
  });

  it("does not fall back to workspace-wide search when current-file scope has no active file", async () => {
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
                name: "quantum.md",
                kind: "file",
                extension: "md",
                path: "workspace/quantum.md",
                handle: createFileHandle("quantum.md", "量子纠错\n这里讨论量子码"),
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
            tabs: [],
          },
        },
      }));
      useSettingsStore.setState((state) => ({
        ...state,
        settings: {
          ...state.settings,
          searchPanelScope: "current",
        },
      }));
    });

    render(<WorkspaceSearchPanel />);

    await runInteraction(() => {
      fireEvent.change(screen.getByPlaceholderText("搜索文件名或内容"), {
        target: { value: "量" },
      });
    });

    await waitFor(() => {
      expect(screen.getByText("当前未打开文件，无法按“当前文件”范围搜索。")).toBeTruthy();
    });

    expect(screen.queryByText("quantum.md")).toBeNull();
  });

  it("shows snippet matches without fake line numbers for html files", async () => {
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
                name: "page.html",
                kind: "file",
                extension: "html",
                path: "workspace/page.html",
                handle: createFileHandle("page.html", "<h1>量子纠错</h1><p>这里系统讨论量子编码与稳定子。</p>"),
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
            tabs: [],
          },
        },
      }));
    });

    render(<WorkspaceSearchPanel />);

    await runInteraction(() => {
      fireEvent.change(screen.getByPlaceholderText("搜索文件名或内容"), {
        target: { value: "量" },
      });
    });

    await waitFor(() => {
      expect(screen.getByText("page.html")).toBeTruthy();
    });

    const snippetElements = screen
      .getAllByText((_, element) => element?.className === "mt-1 text-sm text-foreground/85")
      .map((element) => element.textContent ?? "");
    expect(snippetElements.some((text) => text.includes("量子纠错 这里系统讨论量子编码与稳定子。"))).toBe(true);

    expect(screen.queryByText(/第\s*\d+\s*行/)).toBeNull();
  });

  it("reuses cached extracted text for repeat docx searches within the same session", async () => {
    extractRawTextMock.mockResolvedValue({ value: "量子纠错 文档摘要" });

    const docxHandle = {
      name: "paper.docx",
      getFile: vi.fn(async () => new File([new Uint8Array([1, 2, 3])], "paper.docx", { lastModified: 123 })),
    } as unknown as FileSystemFileHandle;

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
                name: "paper.docx",
                kind: "file",
                extension: "docx",
                path: "workspace/paper.docx",
                handle: docxHandle,
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
            tabs: [],
          },
        },
      }));
    });

    render(<WorkspaceSearchPanel />);

    await runInteraction(() => {
      fireEvent.change(screen.getByPlaceholderText("搜索文件名或内容"), {
        target: { value: "量" },
      });
    });

    await waitFor(() => {
      expect(screen.getByText("paper.docx")).toBeTruthy();
    });

    await runInteraction(() => {
      fireEvent.change(screen.getByPlaceholderText("搜索文件名或内容"), {
        target: { value: "量子" },
      });
    });

    await waitFor(() => {
      expect(screen.getByText("paper.docx")).toBeTruthy();
    });

    expect(extractRawTextMock).toHaveBeenCalledTimes(1);
  });
});
