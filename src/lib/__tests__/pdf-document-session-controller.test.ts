/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const getPageMock = vi.fn();
const getOutlineMock = vi.fn(async () => []);
const getDestinationMock = vi.fn();
const getPageIndexMock = vi.fn();
const destroyDocumentMock = vi.fn(async () => undefined);
const destroyLoadingTaskMock = vi.fn();
const getDocumentMock = vi.fn();

vi.mock("react-pdf", () => ({
  pdfjs: {
    getDocument: (...args: unknown[]) => getDocumentMock(...args),
  },
}));

import { createPdfDocumentSessionController } from "@/lib/pdf-document-session-controller";

function createDocument(pageCount = 6) {
  return {
    numPages: pageCount,
    getPage: getPageMock,
    getOutline: getOutlineMock,
    getDestination: getDestinationMock,
    getPageIndex: getPageIndexMock,
    destroy: destroyDocumentMock,
  };
}

describe("pdf-document-session-controller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const pdfDocument = createDocument();
    getDocumentMock.mockReturnValue({
      promise: Promise.resolve(pdfDocument),
      destroy: destroyLoadingTaskMock,
    });
    getPageMock.mockImplementation(async (pageNumber: number) => ({
      pageNumber,
      getTextContent: vi.fn(async () => ({
        items: [{ str: `page-${pageNumber}` }],
      })),
    }));
  });

  it("invalidates old generations when a new document load starts", async () => {
    let releaseFirst = () => {};
    const firstPromise = new Promise<ReturnType<typeof createDocument>>((resolve) => {
      releaseFirst = () => resolve(createDocument());
    });
    const secondDocument = createDocument();

    getDocumentMock
      .mockReturnValueOnce({
        promise: firstPromise,
        destroy: destroyLoadingTaskMock,
      })
      .mockReturnValueOnce({
        promise: Promise.resolve(secondDocument),
        destroy: destroyLoadingTaskMock,
      });

    const controller = createPdfDocumentSessionController();
    const firstLoad = controller.loadDocument(new Uint8Array([1, 2, 3]));
    const secondLoad = controller.loadDocument(new Uint8Array([4, 5, 6]));

    releaseFirst();

    await expect(firstLoad).rejects.toThrow("Stale PDF session");
    await expect(secondLoad).resolves.toEqual({
      document: secondDocument,
      generationId: controller.currentGenerationId,
    });
  });

  it("caches text extraction results per page", async () => {
    const controller = createPdfDocumentSessionController();
    const { generationId } = await controller.loadDocument(new Uint8Array([1, 2, 3]));

    const first = await controller.loadTextForPage(2, generationId);
    const second = await controller.loadTextForPage(2, generationId);

    expect(first).toBe("page-2");
    expect(second).toBe("page-2");
    expect(getPageMock).toHaveBeenCalledTimes(1);
  });
});
