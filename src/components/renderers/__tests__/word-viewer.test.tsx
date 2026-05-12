/**
 * @vitest-environment jsdom
 */

import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WordViewer } from "../word-viewer";

const convertToHtmlMock = vi.fn();
const renderDocxAsyncMock = vi.fn();
const createFileMock = vi.fn();
const openFileInActivePaneMock = vi.fn();
const openSystemPathMock = vi.fn();
const readDesktopFileBytesMock = vi.fn();
const paneCommandBarStateRef: { current: unknown } = { current: null };

vi.mock("mammoth", () => ({
  default: {
    convertToHtml: (...args: unknown[]) => convertToHtmlMock(...args),
  },
}));

vi.mock("docx-preview", () => ({
  renderAsync: (...args: unknown[]) => renderDocxAsyncMock(...args),
}));

vi.mock("@/lib/link-router/open-external", () => ({
  openSystemPath: (...args: unknown[]) => openSystemPathMock(...args),
}));

vi.mock("@/lib/desktop-file-system", () => ({
  readDesktopFileBytes: (...args: unknown[]) => readDesktopFileBytesMock(...args),
}));

vi.mock("@/hooks/use-i18n", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      if (key === "viewer.word.error") {
        return `Error: ${params?.error ?? ""}`;
      }
      return key;
    },
  }),
}));

vi.mock("@/hooks/use-file-system", () => ({
  useFileSystem: () => ({
    createFile: (...args: unknown[]) => createFileMock(...args),
  }),
}));

vi.mock("@/stores/workspace-store", () => ({
  useWorkspaceStore: (selector: (state: { openFileInActivePane: typeof openFileInActivePaneMock; workspaceRootPath: string | null; workspaceIdentity: { workspaceKey: string } | null; rootHandle: { name: string } }) => unknown) =>
    selector({
      openFileInActivePane: openFileInActivePaneMock,
      workspaceRootPath: "C:/vault/atom",
      workspaceIdentity: { workspaceKey: "workspace-key" },
      rootHandle: { name: "atom" },
    }),
}));

vi.mock("@/hooks/use-persisted-view-state", () => ({
  usePersistedViewState: () => undefined,
}));

vi.mock("@/hooks/use-selection-context-menu", () => ({
  useSelectionContextMenu: () => ({
    menuState: null,
    closeMenu: vi.fn(),
  }),
}));

vi.mock("@/components/ai/selection-context-menu", () => ({
  SelectionContextMenu: () => null,
}));

vi.mock("@/components/ai/selection-ai-hub", () => ({
  SelectionAiHub: () => null,
}));

vi.mock("@/hooks/use-pane-command-bar", () => ({
  usePaneCommandBar: (input: unknown) => {
    paneCommandBarStateRef.current = input;
  },
}));

vi.mock("@/lib/plugins/runtime", () => ({
  emitVaultChange: vi.fn(),
}));

describe("WordViewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    paneCommandBarStateRef.current = null;
    readDesktopFileBytesMock.mockResolvedValue(new Uint8Array([9, 8, 7]));
    renderDocxAsyncMock.mockImplementation(async (_content, container: HTMLElement) => {
      container.innerHTML = "<div class=\"lattice-docx-wrapper\"><section class=\"lattice-docx\" style=\"width: 1200px;\"><p>Rendered DOCX page</p></section></div>";
    });
  });

  it("renders high-fidelity docx preview and keeps semantic HTML for text features", async () => {
    convertToHtmlMock.mockResolvedValue({
      value: "<h1>Title</h1><p>Body</p>",
      messages: [{ message: "Unrecognised paragraph style: Body Text" }],
    });

    render(
      <WordViewer
        content={new Uint8Array([1, 2, 3]).buffer}
        fileName="paper.docx"
        paneId="pane-left"
        filePath="docs/paper.docx"
      />,
    );

    await waitFor(() => {
      expect(renderDocxAsyncMock).toHaveBeenCalledTimes(1);
      expect(screen.getByText("Rendered DOCX page")).toBeTruthy();
    });

    expect(screen.getByTestId("word-semantic-preview").className).toContain("hidden");
    expect(screen.queryByText("Unrecognised paragraph style: Body Text")).toBeNull();
    expect(screen.getByText("viewer.word.diagnostics.show")).toBeTruthy();

    fireEvent.click(screen.getByText("viewer.word.diagnostics.show"));
    expect(screen.getByText("Unrecognised paragraph style: Body Text")).toBeTruthy();
  });

  it("shows conversion error details when mammoth fails", async () => {
    renderDocxAsyncMock.mockRejectedValue(new Error("preview failed"));
    convertToHtmlMock.mockRejectedValue(new Error("conversion failed"));

    render(
      <WordViewer
        content={new Uint8Array([1, 2, 3]).buffer}
        fileName="paper.doc"
        paneId="pane-left"
        filePath="docs/paper.doc"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Error: conversion failed")).toBeTruthy();
    });
  });

  it("registers an enabled import-as-note action after conversion", async () => {
    convertToHtmlMock.mockResolvedValue({
      value: "<h1>Title</h1><p>Body</p>",
      messages: [],
    });

    render(
      <WordViewer
        content={new Uint8Array([1, 2, 3]).buffer}
        fileName="paper.docx"
        paneId="pane-left"
        filePath="docs/paper.docx"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Title")).toBeTruthy();
    });

    let action: { id: string; disabled?: boolean; onTrigger?: () => void } | undefined;
    await waitFor(() => {
      action = (paneCommandBarStateRef.current as { state?: { actions?: Array<{ id: string; disabled?: boolean; onTrigger?: () => void }> } })?.state?.actions?.find((item) => item.id === "import-as-note");
      expect(action).toBeTruthy();
      expect(action?.disabled).toBe(false);
    });
    expect(typeof action?.onTrigger).toBe("function");
  });

  it("registers distinct command bar icons for search, system editing, and import", async () => {
    convertToHtmlMock.mockResolvedValue({
      value: "<p>Body</p>",
      messages: [],
    });

    render(
      <WordViewer
        content={new Uint8Array([1, 2, 3]).buffer}
        fileName="paper.docx"
        paneId="pane-left"
        filePath="atom/docs/paper.docx"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Rendered DOCX page")).toBeTruthy();
    });

    const actions = (paneCommandBarStateRef.current as { state?: { actions?: Array<{ id: string; icon?: string; disabled?: boolean; onTrigger?: () => void }> } })?.state?.actions ?? [];
    expect(actions.find((item) => item.id === "search")?.icon).toBe("search");
    expect(actions.find((item) => item.id === "fit-width")?.icon).toBe("arrow-left-right");
    expect(actions.find((item) => item.id === "fit-width")?.disabled).toBe(false);
    expect(actions.find((item) => item.id === "actual-size")?.icon).toBe("maximize-2");
    expect(actions.find((item) => item.id === "zoom-out")?.icon).toBe("zoom-out");
    expect(actions.find((item) => item.id === "zoom-in")?.icon).toBe("zoom-in");
    expect(actions.find((item) => item.id === "open-system-editor")?.icon).toBe("file-pen-line");
    expect(actions.find((item) => item.id === "reload-from-disk")?.icon).toBe("rotate-ccw");
    expect(actions.find((item) => item.id === "reload-from-disk")?.disabled).toBe(false);
    expect(actions.find((item) => item.id === "import-as-note")?.icon).toBe("file-output");
    expect(actions.find((item) => item.id === "open-system-editor")?.disabled).toBe(false);
  });

  it("opens the original docx in the system editor for fidelity-preserving edits", async () => {
    convertToHtmlMock.mockResolvedValue({
      value: "<p>Body</p>",
      messages: [],
    });
    openSystemPathMock.mockResolvedValue(true);

    render(
      <WordViewer
        content={new Uint8Array([1, 2, 3]).buffer}
        fileName="paper.docx"
        paneId="pane-left"
        filePath="atom/docs/paper.docx"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Rendered DOCX page")).toBeTruthy();
    });

    const action = (paneCommandBarStateRef.current as { state?: { actions?: Array<{ id: string; onTrigger?: () => void }> } })?.state?.actions?.find((item) => item.id === "open-system-editor");
    await act(async () => {
      action?.onTrigger?.();
    });

    await waitFor(() => {
      expect(openSystemPathMock).toHaveBeenCalledWith("C:/vault/atom/docs/paper.docx");
    });
  });

  it("reloads the original docx from disk after native editing", async () => {
    convertToHtmlMock.mockResolvedValue({
      value: "<p>Body</p>",
      messages: [],
    });

    render(
      <WordViewer
        content={new Uint8Array([1, 2, 3]).buffer}
        fileName="paper.docx"
        paneId="pane-left"
        filePath="atom/docs/paper.docx"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Rendered DOCX page")).toBeTruthy();
    });

    const action = (paneCommandBarStateRef.current as { state?: { actions?: Array<{ id: string; onTrigger?: () => void | Promise<void> }> } })?.state?.actions?.find((item) => item.id === "reload-from-disk");
    await act(async () => {
      await action?.onTrigger?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(readDesktopFileBytesMock).toHaveBeenCalledWith("C:/vault/atom/docs/paper.docx");
      expect(renderDocxAsyncMock).toHaveBeenCalledTimes(2);
      expect(screen.getByText("viewer.word.reload.lastReloaded")).toBeTruthy();
    });
  });
});
