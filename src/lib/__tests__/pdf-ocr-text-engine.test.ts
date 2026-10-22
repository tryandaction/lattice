import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPdfTextKernelAnchor } from "../pdf-text-kernel";

const mocks = vi.hoisted(() => ({
  getDesktopPdfPath: vi.fn(),
  invokeTauriCommand: vi.fn(),
  isTauriHost: vi.fn(),
}));

vi.mock("../pdf-native-text-engine", () => ({
  getDesktopPdfPath: mocks.getDesktopPdfPath,
}));

vi.mock("../storage-adapter", () => ({
  invokeTauriCommand: mocks.invokeTauriCommand,
  isTauriHost: mocks.isTauriHost,
}));

import {
  buildPdfPageTextModelFromOcrLayout,
  clearDesktopPdfOcrPageTextLayoutCache,
  createDesktopPdfOcrPageProvider,
  getDesktopPdfOcrPageTextLayout,
  getPdfOcrPageTextKernel,
  peekDesktopPdfOcrPageTextLayout,
  registerPdfOcrPageProvider,
  resolvePdfOcrSelectionFromPointer,
  shouldUsePdfOcrFallback,
  type PdfOcrPageTextLayout,
} from "../pdf-ocr-text-engine";

function createOcrLayout(): PdfOcrPageTextLayout {
  return {
    source: "ocr",
    pageNumber: 1,
    width: 600,
    height: 800,
    text: "Scanned text",
    confidence: 0.92,
    words: [
      { text: "Scanned", left: 40, top: 60, width: 90, height: 20, confidence: 0.95, lineIndex: 0, wordIndex: 0 },
      { text: "text", left: 140, top: 60, width: 44, height: 20, confidence: 0.89, lineIndex: 0, wordIndex: 1 },
    ],
  };
}

describe("pdf-ocr-text-engine", () => {
  afterEach(() => {
    registerPdfOcrPageProvider(null);
    clearDesktopPdfOcrPageTextLayoutCache();
    vi.clearAllMocks();
  });

  it("detects low-text pages as OCR fallback candidates", () => {
    expect(shouldUsePdfOcrFallback({ textLength: 0, textItemCount: 0 })).toBe(true);
    expect(shouldUsePdfOcrFallback({ textLength: 120, textItemCount: 8 })).toBe(false);
  });

  it("converts OCR words into a page text model", () => {
    const model = buildPdfPageTextModelFromOcrLayout(createOcrLayout());

    expect(model).not.toBeNull();
    expect(model?.normalizedText).toBe("Scanned text");
    expect(model?.segments).toHaveLength(2);
    expect(model?.itemRects[0]).toMatchObject({ left: 40, top: 60, width: 90, height: 20 });
  });

  it("keeps OCR words left-to-right when baselines jitter within one recognized line", () => {
    const model = buildPdfPageTextModelFromOcrLayout({
      source: "ocr",
      pageNumber: 1,
      width: 600,
      height: 800,
      text: "justice. Scientific skepticism would trust",
      confidence: 0.9,
      words: [
        { text: "justice.", left: 20, top: 102, width: 60, height: 20, confidence: 0.9, lineIndex: 4, wordIndex: 0 },
        { text: "Scientific", left: 90, top: 99, width: 75, height: 20, confidence: 0.9, lineIndex: 4, wordIndex: 1 },
        { text: "skepticism", left: 175, top: 103, width: 80, height: 20, confidence: 0.9, lineIndex: 4, wordIndex: 2 },
        { text: "would", left: 265, top: 100, width: 45, height: 20, confidence: 0.9, lineIndex: 4, wordIndex: 3 },
        { text: "trust", left: 320, top: 98, width: 38, height: 20, confidence: 0.9, lineIndex: 4, wordIndex: 4 },
      ],
    });

    expect(model?.normalizedText).toBe("justice. Scientific skepticism would trust");
  });

  it("builds an OCR-backed text kernel and anchors with OCR source", async () => {
    registerPdfOcrPageProvider(async () => createOcrLayout());

    const kernelPage = await getPdfOcrPageTextKernel({
      pageNumber: 1,
      width: 600,
      height: 800,
      image: new Blob(),
    });
    const model = buildPdfPageTextModelFromOcrLayout(createOcrLayout());
    expect(kernelPage).not.toBeNull();
    expect(model).not.toBeNull();
    if (!kernelPage || !model) {
      throw new Error("Expected OCR kernel and model");
    }

    const anchor = buildPdfTextKernelAnchor({
      page: kernelPage,
      model,
      startCharIndex: 0,
      endCharIndex: "Scanned".length,
    });

    expect(kernelPage.source).toBe("ocr");
    expect(kernelPage.chars[0].source).toBe("ocr");
    expect(anchor?.text).toBe("Scanned");
    expect(anchor?.quote.source).toBe("ocr-text-model");
  });

  it("resolves scanned-page text from pointer geometry without a DOM text range", () => {
    const selection = resolvePdfOcrSelectionFromPointer({
      layout: createOcrLayout(),
      pageRect: new DOMRect(100, 200, 1200, 1600),
      dragStartPoint: { x: 182, y: 330 },
      dragEndPoint: { x: 468, y: 330 },
    });

    expect(selection).not.toBeNull();
    expect(selection?.text).toBe("Scanned text");
    expect(selection?.textQuote.source).toBe("ocr-text-model");
    expect(selection?.pageRects).toHaveLength(1);
    expect(selection?.viewportRects).toHaveLength(1);
  });

  it("keeps a near-horizontal OCR drag on its starting line when adjacent word boxes overlap", () => {
    const selection = resolvePdfOcrSelectionFromPointer({
      layout: {
        source: "ocr",
        pageNumber: 1,
        width: 600,
        height: 800,
        text: "Alpha Beta noise",
        confidence: 0.9,
        words: [
          { text: "Alpha", left: 40, top: 60, width: 60, height: 20, confidence: 0.92, lineIndex: 0, wordIndex: 0 },
          { text: "Beta", left: 120, top: 60, width: 60, height: 20, confidence: 0.91, lineIndex: 0, wordIndex: 1 },
          { text: "noise", left: 175, top: 64, width: 55, height: 20, confidence: 0.75, lineIndex: 1, wordIndex: 0 },
        ],
      },
      pageRect: new DOMRect(0, 0, 600, 800),
      dragStartPoint: { x: 41, y: 70 },
      dragEndPoint: { x: 190, y: 70 },
    });

    expect(selection?.text).toBe("Alpha Beta");
    expect(selection?.pageRects).toHaveLength(1);
  });

  it("creates a desktop OCR provider backed by the Tauri OCR command", async () => {
    const fileHandle = {} as FileSystemFileHandle;
    mocks.isTauriHost.mockReturnValue(true);
    mocks.getDesktopPdfPath.mockReturnValue("C:/papers/scanned.pdf");
    mocks.invokeTauriCommand.mockResolvedValue({ ...createOcrLayout(), pageNumber: 2 });

    const provider = createDesktopPdfOcrPageProvider(fileHandle, {
      dpi: 260,
      language: "eng+chi_sim",
      psm: 6,
      timeoutMs: 120000,
    });
    const layout = await provider({
      pageNumber: 2,
      width: 600,
      height: 800,
      image: new Blob(),
    });

    expect(layout?.source).toBe("ocr");
    expect(layout?.pageNumber).toBe(2);
    expect(mocks.invokeTauriCommand).toHaveBeenCalledWith("desktop_ocr_pdf_page_text_layout", {
      path: "C:/papers/scanned.pdf",
      pageNumber: 2,
      options: {
        dpi: 260,
        language: "eng+chi_sim",
        psm: 6,
      },
    }, {
      timeoutMs: 120000,
    });
  });

  it("stores resolved desktop OCR layouts for non-blocking page reuse", async () => {
    const fileHandle = {} as FileSystemFileHandle;
    mocks.isTauriHost.mockReturnValue(true);
    mocks.getDesktopPdfPath.mockReturnValue("C:/papers/scanned.pdf");
    mocks.invokeTauriCommand.mockResolvedValue({ ...createOcrLayout(), pageNumber: 3 });

    expect(peekDesktopPdfOcrPageTextLayout({
      fileHandle,
      pageNumber: 3,
      options: { language: "eng+chi_sim", psm: 6 },
    })).toBeNull();

    await getDesktopPdfOcrPageTextLayout({
      fileHandle,
      pageNumber: 3,
      options: { language: "eng+chi_sim", psm: 6 },
    });

    expect(peekDesktopPdfOcrPageTextLayout({
      fileHandle,
      pageNumber: 3,
      options: { language: "eng+chi_sim", psm: 6 },
    })?.text).toBe("Scanned text");
  });

  it("limits concurrent desktop OCR work so page prefetch cannot saturate the UI", async () => {
    const fileHandle = {} as FileSystemFileHandle;
    const resolvers: Array<(layout: PdfOcrPageTextLayout) => void> = [];
    mocks.isTauriHost.mockReturnValue(true);
    mocks.getDesktopPdfPath.mockReturnValue("C:/papers/scanned.pdf");
    mocks.invokeTauriCommand.mockImplementation((_command, args: { pageNumber: number }) => (
      new Promise<PdfOcrPageTextLayout>((resolve) => {
        resolvers.push((layout) => resolve({ ...layout, pageNumber: args.pageNumber }));
      })
    ));

    const requests = [1, 2, 3].map((pageNumber) => getDesktopPdfOcrPageTextLayout({
      fileHandle,
      pageNumber,
    }));
    await Promise.resolve();
    expect(mocks.invokeTauriCommand).toHaveBeenCalledTimes(2);

    resolvers[0](createOcrLayout());
    await requests[0];
    await vi.waitFor(() => {
      expect(mocks.invokeTauriCommand).toHaveBeenCalledTimes(3);
    });
    resolvers[1](createOcrLayout());
    resolvers[2](createOcrLayout());
    await Promise.all(requests);
  });

  it("evicts old resolved OCR layouts after the bounded page cache fills", async () => {
    const fileHandle = {} as FileSystemFileHandle;
    mocks.isTauriHost.mockReturnValue(true);
    mocks.getDesktopPdfPath.mockReturnValue("C:/papers/large-scan.pdf");
    mocks.invokeTauriCommand.mockImplementation((_command, args: { pageNumber: number }) => (
      Promise.resolve({ ...createOcrLayout(), pageNumber: args.pageNumber })
    ));

    for (let pageNumber = 1; pageNumber <= 25; pageNumber += 1) {
      await getDesktopPdfOcrPageTextLayout({ fileHandle, pageNumber });
    }

    expect(peekDesktopPdfOcrPageTextLayout({ fileHandle, pageNumber: 1 })).toBeNull();
    expect(peekDesktopPdfOcrPageTextLayout({ fileHandle, pageNumber: 25 })?.pageNumber).toBe(25);
  });

  it("does not invoke desktop OCR outside Tauri or without a desktop path", async () => {
    mocks.isTauriHost.mockReturnValue(false);
    await expect(getDesktopPdfOcrPageTextLayout({
      fileHandle: {} as FileSystemFileHandle,
      pageNumber: 1,
    })).resolves.toBeNull();
    expect(mocks.invokeTauriCommand).not.toHaveBeenCalled();

    mocks.isTauriHost.mockReturnValue(true);
    mocks.getDesktopPdfPath.mockReturnValue(null);
    await expect(getDesktopPdfOcrPageTextLayout({
      fileHandle: {} as FileSystemFileHandle,
      pageNumber: 1,
    })).resolves.toBeNull();
    expect(mocks.invokeTauriCommand).not.toHaveBeenCalled();
  });
});
