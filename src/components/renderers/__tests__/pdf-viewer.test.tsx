/**
 * @vitest-environment jsdom
 */

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PDFViewer } from "../pdf-viewer";

const mockPdfDocument = vi.hoisted(() => ({
  numPages: 10,
  getPage: vi.fn(),
  getOutline: vi.fn(async () => []),
}));

vi.mock("react-pdf", async () => {
  const ReactModule = await import("react");

  return {
    pdfjs: {
      version: "test",
      GlobalWorkerOptions: { workerSrc: "" },
    },
    Document: ({
      children,
      onLoadSuccess,
    }: {
      children: React.ReactNode;
      onLoadSuccess?: (pdf: typeof mockPdfDocument) => void;
    }) => {
      ReactModule.useEffect(() => {
        onLoadSuccess?.(mockPdfDocument);
      }, [onLoadSuccess]);

      return <div data-testid="mock-react-pdf-document">{children}</div>;
    },
    Page: ({
      pageNumber,
      onLoadSuccess,
    }: {
      pageNumber: number;
      onLoadSuccess?: (page: { width: number; height: number; getViewport: (options: { scale: number }) => { width: number; height: number } }) => void;
    }) => {
      ReactModule.useEffect(() => {
        onLoadSuccess?.({
          width: 612,
          height: 792,
          getViewport: ({ scale }: { scale: number }) => ({
            width: 612 * scale,
            height: 792 * scale,
          }),
        });
      }, [onLoadSuccess]);

      return <div data-testid={`mock-react-pdf-page-${pageNumber}`}>page {pageNumber}</div>;
    },
  };
});

vi.mock("../pdf-outline-sidebar", () => ({
  PdfOutlineSidebar: () => null,
}));

vi.mock("../desktop-pdf-reader-shell", () => ({
  DesktopPdfReaderShell: ({ paneId }: { paneId?: string }) => (
    <div data-testid={`mock-desktop-pdf-reader-${paneId ?? "default"}`} />
  ),
}));

vi.mock("@/hooks/use-i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@/lib/storage-adapter", () => ({
  isTauriHost: () => false,
}));

describe("PDFViewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPdfDocument.getPage.mockResolvedValue({
      getTextContent: vi.fn(async () => ({ items: [{ str: "match" }] })),
    });

    class MockResizeObserver {
      observe() {}
      disconnect() {}
    }

    class MockIntersectionObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }

    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
    globalThis.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver;
  });

  it("does not extract page text while the search overlay is closed", async () => {
    render(
      <PDFViewer
        content={new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer}
        fileName="paper.pdf"
        paneId="pane-left"
      />,
    );

    await screen.findByTestId("mock-react-pdf-document");

    await waitFor(() => {
      expect(mockPdfDocument.getPage).not.toHaveBeenCalled();
    });
  });

  it("only mounts the near-viewport page window instead of all pages", async () => {
    render(
      <PDFViewer
        content={new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer}
        fileName="paper.pdf"
        paneId="pane-left"
      />,
    );

    await screen.findByTestId("mock-react-pdf-document");
    await waitFor(() => {
      expect(screen.getByText("of 10")).not.toBeNull();
    });

    expect(screen.getByTestId("mock-react-pdf-page-1")).not.toBeNull();
    expect(screen.getByTestId("mock-react-pdf-page-2")).not.toBeNull();
    expect(screen.queryByTestId("mock-react-pdf-page-6")).toBeNull();
    expect(screen.queryByTestId("mock-react-pdf-page-10")).toBeNull();
  });

  it("emits the explicit annotation mode request from the toolbar button", async () => {
    const onRequestAnnotationMode = vi.fn();

    render(
      <PDFViewer
        content={new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer}
        fileName="paper.pdf"
        paneId="pane-left"
        canAnnotate={true}
        onRequestAnnotationMode={onRequestAnnotationMode}
      />,
    );

    fireEvent.click(await screen.findByTestId("pdf-annotate-trigger-pane-left"));

    expect(onRequestAnnotationMode).toHaveBeenCalledTimes(1);
  });

  it("dispatches to the desktop reader shell for desktop runtime", async () => {
    render(
      <PDFViewer
        content={new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer}
        fileName="paper.pdf"
        paneId="pane-left"
        runtimeProfile="desktop-performance"
        fileId="paper-id"
        filePath="docs/paper.pdf"
      />,
    );

    expect(await screen.findByTestId("mock-desktop-pdf-reader-pane-left")).not.toBeNull();
  });
});
