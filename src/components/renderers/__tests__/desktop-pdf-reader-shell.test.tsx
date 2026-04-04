/**
 * @vitest-environment jsdom
 */

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const controllerState = vi.hoisted(() => {
  const page = {
    getViewport: ({ scale }: { scale: number }) => ({
      width: 600 * scale,
      height: 800 * scale,
    }),
    render: () => ({
      promise: Promise.resolve(),
      cancel: vi.fn(),
    }),
  };

  return {
    loadDocument: vi.fn(async () => ({
      document: { numPages: 8 },
      generationId: 1,
    })),
    cancelPendingWork: vi.fn(),
    destroyDocument: vi.fn(async () => undefined),
    loadPage: vi.fn(async () => page),
    loadTextForPage: vi.fn(async (pageNumber: number) => `page-${pageNumber} target`),
    loadOutline: vi.fn(async () => []),
  };
});

const contentCacheState = vi.hoisted(() => ({
  saveEditorState: vi.fn(),
  getEditorState: vi.fn(() => undefined),
}));

vi.mock("next/dynamic", () => ({
  default: () => ((props: { fileId?: string }) => <div data-testid="mock-desktop-highlighter">{props.fileId}</div>),
}));

vi.mock("@/hooks/use-i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@/stores/workspace-store", () => ({
  useWorkspaceStore: (selector: (state: { workspaceIdentity: { workspaceKey: string } | null; workspaceRootPath: string | null }) => unknown) => selector({
    workspaceIdentity: { workspaceKey: "workspace:test" },
    workspaceRootPath: "C:/workspace",
  }),
}));

vi.mock("@/stores/content-cache-store", () => ({
  useContentCacheStore: Object.assign(
    (selector: (state: typeof contentCacheState) => unknown) => selector(contentCacheState),
    {
      getState: () => contentCacheState,
    },
  ),
}));

vi.mock("@/lib/file-view-state", () => ({
  buildPersistedFileViewStateKey: () => "pdf-desktop:test",
  loadPersistedFileViewState: vi.fn(async () => null),
  savePersistedFileViewState: vi.fn(async () => undefined),
}));

vi.mock("@/lib/pdf-view-state", () => ({
  readCachedPdfViewState: vi.fn(() => null),
  clampPdfScale: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
}));

vi.mock("@/lib/pdf-document-session-controller", () => ({
  createPdfDocumentSessionController: () => controllerState,
  isStalePdfSessionError: () => false,
}));

import { DesktopPdfReaderShell } from "../desktop-pdf-reader-shell";

describe("DesktopPdfReaderShell", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    class MockResizeObserver {
      observe() {}
      disconnect() {}
    }

    Object.defineProperty(window.HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: vi.fn(() => ({
        canvas: document.createElement("canvas"),
      })),
    });

    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
  });

  it("loads the desktop reader without extracting search text by default", async () => {
    render(
      <DesktopPdfReaderShell
        content={new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer}
        fileName="paper.pdf"
        paneId="pane-left"
        fileId="paper-id"
        filePath="docs/paper.pdf"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("of 8")).not.toBeNull();
    });

    expect(controllerState.loadTextForPage).not.toHaveBeenCalled();
  });

  it("extracts text only after entering search mode", async () => {
    render(
      <DesktopPdfReaderShell
        content={new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer}
        fileName="paper.pdf"
        paneId="pane-left"
        fileId="paper-id"
        filePath="docs/paper.pdf"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("of 8")).not.toBeNull();
    });

    fireEvent.click(screen.getByTitle("pdf.search.open"));
    fireEvent.change(screen.getByPlaceholderText("pdf.search.placeholder"), {
      target: { value: "target" },
    });

    await waitFor(() => {
      expect(controllerState.loadTextForPage).toHaveBeenCalled();
    });
  });

  it("enters and exits annotation mode explicitly", async () => {
    render(
      <DesktopPdfReaderShell
        content={new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer}
        fileName="paper.pdf"
        paneId="pane-left"
        fileId="paper-id"
        filePath="docs/paper.pdf"
        canAnnotate={true}
        hasPersistedAnnotations={true}
        fileHandle={{ name: "paper.pdf" } as FileSystemFileHandle}
        rootHandle={{ name: "workspace" } as FileSystemDirectoryHandle}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("of 8")).not.toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: /pdf\.workspace\.note\.annotation/i }));
    expect(await screen.findByTestId("mock-desktop-highlighter")).not.toBeNull();

    fireEvent.click(screen.getByText("Reader"));
    await waitFor(() => {
      expect(screen.getByText("of 8")).not.toBeNull();
    });
  });
});
