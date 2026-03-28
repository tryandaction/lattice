/**
 * @vitest-environment jsdom
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WorkspaceSearchPanel } from "../workspace-search-panel";
import { useWorkspaceStore } from "@/stores/workspace-store";

const navigateLinkMock = vi.fn().mockResolvedValue(true);
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
const originalConsoleError = console.error;

vi.mock("@/lib/link-router/navigate-link", () => ({
  navigateLink: (...args: unknown[]) => navigateLinkMock(...args),
}));

function createFileHandle(name: string, content: string): FileSystemFileHandle {
  return {
    name,
    getFile: vi.fn(async () => new File([content], name, { type: "text/plain" })),
  } as unknown as FileSystemFileHandle;
}

afterEach(() => {
  consoleErrorSpy?.mockRestore();
  navigateLinkMock.mockClear();
  useWorkspaceStore.setState((state) => ({
    ...state,
    rootHandle: null,
    fileTree: { root: null },
  }));
});

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
    const first = String(args[0] ?? "");
    if (first.includes("not wrapped in act")) {
      return;
    }
    originalConsoleError(...args);
  });
});

describe("WorkspaceSearchPanel", () => {
  async function runInteraction(action: () => void | Promise<void>) {
    await act(async () => {
      await action();
      await Promise.resolve();
      await Promise.resolve();
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
      fireEvent.click(screen.getByText("文件名"));
    });
    expect(screen.getByText("文件名")).toBeTruthy();

    await runInteraction(() => {
      fireEvent.click(screen.getByText((_, element) => element?.textContent === "keyword appears here"));
    });

    await waitFor(() => {
      expect(navigateLinkMock).toHaveBeenCalledWith("workspace/note.md#line=3", expect.objectContaining({
        paneId: "pane-initial",
      }));
    });
  });
});
