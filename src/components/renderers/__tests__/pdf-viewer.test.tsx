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

vi.mock("@/hooks/use-i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
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
});
