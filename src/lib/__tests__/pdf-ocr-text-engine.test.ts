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
