import type { PDFDocumentProxy } from "pdfjs-dist";
import { normalizePdfText, getPdfPageSearchText, prefetchPdfPageTextModel } from "@/lib/pdf-page-text-cache";
import {
  getDesktopPdfPageTextLayout,
  prefetchDesktopPdfPageTextLayout,
} from "@/lib/pdf-native-text-engine";
import { isTauriHost } from "@/lib/storage-adapter";

const PDF_LIGATURE_MAP: Record<string, string> = {
  "\u00a0": " ",
  "\ufb00": "ff",
  "\ufb01": "fi",
  "\ufb02": "fl",
  "\ufb03": "ffi",
  "\ufb04": "ffl",
  "\ufb05": "ft",
  "\ufb06": "st",
};

function expandPdfLigatures(text: string): string {
  return Array.from(text ?? "", (character) => PDF_LIGATURE_MAP[character] ?? character).join("");
}

function normalizePdfEngineText(text: string): string {
  return normalizePdfText(expandPdfLigatures(text));
}

export async function getPreferredPdfPageSearchText(input: {
  pdfDocument: PDFDocumentProxy;
  fileHandle?: FileSystemFileHandle | null;
  pageNumber: number;
}): Promise<string> {
  if (isTauriHost() && input.fileHandle) {
    try {
      const nativeLayout = await getDesktopPdfPageTextLayout({
        fileHandle: input.fileHandle,
        pageNumber: input.pageNumber,
      });
      if (nativeLayout?.text) {
        return normalizePdfEngineText(nativeLayout.text);
      }
    } catch {
      // Search should stay available even if native extraction fails.
    }
  }

  return getPdfPageSearchText(input.pdfDocument, input.pageNumber);
}

export function prefetchPreferredPdfPageText(input: {
  pdfDocument: PDFDocumentProxy;
  fileHandle?: FileSystemFileHandle | null;
  pageNumber: number;
}): void {
  if (isTauriHost() && input.fileHandle) {
    prefetchDesktopPdfPageTextLayout({
      fileHandle: input.fileHandle,
      pageNumber: input.pageNumber,
    });
    return;
  }

  prefetchPdfPageTextModel(input.pdfDocument, input.pageNumber);
}
