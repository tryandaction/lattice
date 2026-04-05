/**
 * @vitest-environment jsdom
 */

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PDFViewer } from "../pdf-viewer";

const mockPdfDocument = vi.hoisted(() => ({
  numPages: 3,
  getPage: vi.fn(),
  getOutline: vi.fn(async () => []),
  mountCount: 0,
  unmountCount: 0,
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
      file,
    }: {
      children: React.ReactNode;
      onLoadSuccess?: (pdf: typeof mockPdfDocument) => void;
      file?: unknown;
    }) => {
      ReactModule.useEffect(() => {
        mockPdfDocument.mountCount += 1;
        onLoadSuccess?.(mockPdfDocument);
        return () => {
          mockPdfDocument.unmountCount += 1;
        };
      }, [onLoadSuccess]);

      return <div data-testid="mock-react-pdf-document" data-file-type={typeof file}>{children}</div>;
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

vi.mock("@/hooks/use-i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

describe("PDFViewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPdfDocument.mountCount = 0;
    mockPdfDocument.unmountCount = 0;
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
        source={{ kind: "buffer", data: new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer }}
        documentId="paper-1"
        fileName="paper.pdf"
        paneId="pane-left"
      />,
    );

    await screen.findByTestId("mock-react-pdf-document");

    await waitFor(() => {
      expect(mockPdfDocument.getPage).not.toHaveBeenCalled();
    });
  });

  it("emits the explicit annotation mode request from the toolbar button", async () => {
    const onRequestAnnotationMode = vi.fn();

    render(
      <PDFViewer
        source={{ kind: "buffer", data: new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer }}
        documentId="paper-1"
        fileName="paper.pdf"
        paneId="pane-left"
        canAnnotate={true}
        onRequestAnnotationMode={onRequestAnnotationMode}
      />,
    );

    fireEvent.click(await screen.findByTestId("pdf-annotate-trigger-pane-left"));

    expect(onRequestAnnotationMode).toHaveBeenCalledTimes(1);
  });

  it("remounts the document when documentId changes even if filename stays the same", async () => {
    const source = { kind: "buffer" as const, data: new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer };
    const { rerender } = render(
      <PDFViewer
        source={source}
        documentId="paper-1"
        fileName="paper.pdf"
        paneId="pane-left"
      />,
    );

    await screen.findByTestId("mock-react-pdf-document");
    expect(mockPdfDocument.mountCount).toBe(1);

    rerender(
      <PDFViewer
        source={source}
        documentId="paper-2"
        fileName="paper.pdf"
        paneId="pane-left"
      />,
    );

    await waitFor(() => {
      expect(mockPdfDocument.mountCount).toBe(2);
      expect(mockPdfDocument.unmountCount).toBe(1);
    });
  });
});
