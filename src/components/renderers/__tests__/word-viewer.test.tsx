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
const readDesktopFileMetadataMock = vi.fn();
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
  readDesktopFileMetadata: (...args: unknown[]) => readDesktopFileMetadataMock(...args),
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
    readDesktopFileMetadataMock.mockResolvedValue({ size: 3, modifiedMs: 1000 });
    renderDocxAsyncMock.mockImplementation(async (_content, container: HTMLElement) => {
      container.innerHTML = "<div class=\"lattice-docx-wrapper\"><section class=\"lattice-docx\" style=\"width: 1200px;\"><p>Rendered DOCX page</p></section></div>";
    });
  });

  it("finds and highlights search terms split across docx preview spans", async () => {
    convertToHtmlMock.mockResolvedValue({
      value: "<p>high-fidelity excitation</p>",
      messages: [],
    });
    renderDocxAsyncMock.mockImplementation(async (_content, container: HTMLElement) => {
      container.innerHTML = [
        "<div class=\"lattice-docx-wrapper\"><section class=\"lattice-docx\" style=\"width: 1200px;\">",
        "<p><span>high-</span><span>fidelity</span><span> excitation</span></p>",
        "</section></div>",
      ].join("");
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
      expect(screen.getByText("high-")).toBeTruthy();
    });

    const searchAction = (paneCommandBarStateRef.current as { state?: { actions?: Array<{ id: string; onTrigger?: () => void }> } })?.state?.actions?.find((item) => item.id === "search");
    await act(async () => {
      searchAction?.onTrigger?.();
    });

    fireEvent.change(screen.getByPlaceholderText("viewer.word.search.placeholder"), {
      target: { value: "high-fidelity excitation" },
    });

    await waitFor(() => {
      const marks = screen.getByTestId("word-docx-preview").querySelectorAll("mark[data-word-search-match-index=\"0\"]");
      expect(marks).toHaveLength(3);
      expect(Array.from(marks).map((mark) => mark.textContent).join("")).toBe("high-fidelity excitation");
      expect(screen.getByText("1/1")).toBeTruthy();
    });
  });

  it("does not match search terms across separate docx block boundaries", async () => {
    convertToHtmlMock.mockResolvedValue({
      value: "<p>alpha</p><p>beta</p>",
      messages: [],
    });
    renderDocxAsyncMock.mockImplementation(async (_content, container: HTMLElement) => {
      container.innerHTML = [
        "<div class=\"lattice-docx-wrapper\"><section class=\"lattice-docx\" style=\"width: 1200px;\">",
        "<p>alpha</p><p>beta</p>",
        "</section></div>",
      ].join("");
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
      expect(screen.getByText("alpha")).toBeTruthy();
    });

    const searchAction = (paneCommandBarStateRef.current as { state?: { actions?: Array<{ id: string; onTrigger?: () => void }> } })?.state?.actions?.find((item) => item.id === "search");
    await act(async () => {
      searchAction?.onTrigger?.();
    });

    fireEvent.change(screen.getByPlaceholderText("viewer.word.search.placeholder"), {
      target: { value: "alphabeta" },
    });

    await waitFor(() => {
      expect(screen.getByTestId("word-docx-preview").querySelectorAll("mark[data-word-search-match-index]")).toHaveLength(0);
      expect(screen.getByText("viewer.word.search.noMatch")).toBeTruthy();
    });
  });

  it("fits wide docx tables using the widest rendered content", async () => {
    convertToHtmlMock.mockResolvedValue({
      value: "<p>Wide table</p>",
      messages: [],
    });
    renderDocxAsyncMock.mockImplementation(async (_content, container: HTMLElement) => {
      container.innerHTML = [
        "<div class=\"lattice-docx-wrapper\"><section class=\"lattice-docx\" style=\"width: 1000px;\">",
        "<table style=\"width: 1800px;\"><tbody><tr><td>Wide table</td></tr></tbody></table>",
        "</section></div>",
      ].join("");
    });
    const clientWidthSpy = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(956);

    try {
      render(
        <WordViewer
          content={new Uint8Array([1, 2, 3]).buffer}
          fileName="wide-table.docx"
          paneId="pane-left"
          filePath="docs/wide-table.docx"
        />,
      );

      await waitFor(() => {
        expect(screen.getByText("Wide table")).toBeTruthy();
      });

      await act(async () => {
        window.dispatchEvent(new Event("resize"));
      });

      await waitFor(() => {
        expect(screen.getByText("viewer.word.zoom.fitWidth")).toBeTruthy();
      });

      const shell = screen.getByTestId("word-docx-preview").parentElement as HTMLElement;
      expect(shell.style.getPropertyValue("--word-docx-zoom")).toBeCloseTo(0.5, 2);
    } finally {
      clientWidthSpy.mockRestore();
    }
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
    expect(convertToHtmlMock).toHaveBeenCalledWith(
      { arrayBuffer: expect.any(ArrayBuffer) },
      expect.objectContaining({
        styleMap: expect.arrayContaining([
          "p[style-name='Body Text'] => p:fresh",
          "p[style-name='Compact'] => p:fresh",
        ]),
      }),
    );

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

  it("imports docx semantic tables as editable Markdown tables", async () => {
    const writes: string[] = [];
    const closeMock = vi.fn();
    const createWritableMock = vi.fn(async () => ({
      write: vi.fn(async (value: string) => {
        writes.push(value);
      }),
      close: closeMock,
    }));
    createFileMock.mockResolvedValue({
      success: true,
      handle: { createWritable: createWritableMock },
      path: "docs/report.md",
    });
    convertToHtmlMock.mockResolvedValue({
      value: [
        "<h1>Report</h1>",
        "<table><tr><th>Title</th><th>Year</th></tr><tr><td><strong>Paper</strong></td><td>2026</td></tr></table>",
        "<p>See <a href=\"https://example.com\">source</a>.</p>",
      ].join(""),
      messages: [],
    });

    render(
      <WordViewer
        content={new Uint8Array([1, 2, 3]).buffer}
        fileName="report.docx"
        paneId="pane-left"
        filePath="docs/report.docx"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Report")).toBeTruthy();
    });

    const action = (paneCommandBarStateRef.current as { state?: { actions?: Array<{ id: string; onTrigger?: () => void | Promise<void> }> } })?.state?.actions?.find((item) => item.id === "import-as-note");
    await act(async () => {
      await action?.onTrigger?.();
    });

    await waitFor(() => {
      expect(createWritableMock).toHaveBeenCalledTimes(1);
      expect(closeMock).toHaveBeenCalledTimes(1);
    });
    expect(writes[0]).toContain("| Title | Year |");
    expect(writes[0]).toContain("| --- | --- |");
    expect(writes[0]).toContain("| **Paper** | 2026 |");
    expect(writes[0]).toContain("[source](https://example.com)");
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
      expect(readDesktopFileMetadataMock).toHaveBeenCalledWith("C:/vault/atom/docs/paper.docx");
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

  it("detects external Word edits when the window regains focus", async () => {
    convertToHtmlMock.mockResolvedValue({
      value: "<p>Body</p>",
      messages: [],
    });
    readDesktopFileMetadataMock
      .mockResolvedValueOnce({ size: 3, modifiedMs: 1000 })
      .mockResolvedValueOnce({ size: 3, modifiedMs: 1000 })
      .mockResolvedValueOnce({ size: 4, modifiedMs: 2000 });

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

    const openAction = (paneCommandBarStateRef.current as { state?: { actions?: Array<{ id: string; onTrigger?: () => void | Promise<void> }> } })?.state?.actions?.find((item) => item.id === "open-system-editor");
    await act(async () => {
      await openAction?.onTrigger?.();
    });

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByText("viewer.word.externalChanges.detected")).toBeTruthy();
    });
  });
});
