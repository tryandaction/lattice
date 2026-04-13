import { getDesktopHandlePath } from "@/lib/desktop-file-system";
import { invokeTauriCommand, isTauriHost } from "@/lib/storage-adapter";

export interface PdfNativeTextChar {
  charIndex: number;
  text: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  fontSize: number;
}

export interface PdfNativePageTextLayout {
  source: "pdfium";
  pageNumber: number;
  width: number;
  height: number;
  text: string;
  chars: PdfNativeTextChar[];
}

const pdfNativePageLayoutCache = new Map<string, Promise<PdfNativePageTextLayout>>();
const pdfNativeResolvedLayoutCache = new Map<string, PdfNativePageTextLayout>();

function normalizeDesktopPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function buildPdfNativeLayoutCacheKey(path: string, pageNumber: number): string {
  return `${normalizeDesktopPath(path)}::${pageNumber}`;
}

export function getDesktopPdfPath(handle: FileSystemHandle | null | undefined): string | null {
  const fullPath = getDesktopHandlePath(handle);
  return fullPath ? normalizeDesktopPath(fullPath) : null;
}

export async function getDesktopPdfPageTextLayout(input: {
  fileHandle: FileSystemFileHandle | null | undefined;
  pageNumber: number;
  forceRefresh?: boolean;
}): Promise<PdfNativePageTextLayout | null> {
  if (!isTauriHost()) {
    return null;
  }

  const path = getDesktopPdfPath(input.fileHandle);
  if (!path || input.pageNumber < 1) {
    return null;
  }

  const cacheKey = buildPdfNativeLayoutCacheKey(path, input.pageNumber);
  if (input.forceRefresh) {
    pdfNativePageLayoutCache.delete(cacheKey);
  }

  const cached = pdfNativePageLayoutCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const request = invokeTauriCommand<PdfNativePageTextLayout>("desktop_extract_pdf_page_text_layout", {
    path,
    pageNumber: input.pageNumber,
  }, {
    timeoutMs: 20000,
  }).then((layout) => {
    pdfNativeResolvedLayoutCache.set(cacheKey, layout);
    return layout;
  }).catch((error) => {
    pdfNativePageLayoutCache.delete(cacheKey);
    pdfNativeResolvedLayoutCache.delete(cacheKey);
    throw error;
  });

  pdfNativePageLayoutCache.set(cacheKey, request);
  return request;
}

export function peekDesktopPdfPageTextLayout(input: {
  fileHandle: FileSystemFileHandle | null | undefined;
  pageNumber: number;
}): PdfNativePageTextLayout | null {
  const path = getDesktopPdfPath(input.fileHandle);
  if (!path || input.pageNumber < 1) {
    return null;
  }

  return pdfNativeResolvedLayoutCache.get(buildPdfNativeLayoutCacheKey(path, input.pageNumber)) ?? null;
}

export function prefetchDesktopPdfPageTextLayout(input: {
  fileHandle: FileSystemFileHandle | null | undefined;
  pageNumber: number;
}): void {
  void getDesktopPdfPageTextLayout(input).catch(() => undefined);
}

export function clearDesktopPdfPageTextLayoutCache(path?: string | null): void {
  if (!path) {
    pdfNativePageLayoutCache.clear();
    pdfNativeResolvedLayoutCache.clear();
    return;
  }

  const normalizedPath = normalizeDesktopPath(path);
  for (const key of pdfNativePageLayoutCache.keys()) {
    if (key.startsWith(`${normalizedPath}::`)) {
      pdfNativePageLayoutCache.delete(key);
    }
  }
  for (const key of pdfNativeResolvedLayoutCache.keys()) {
    if (key.startsWith(`${normalizedPath}::`)) {
      pdfNativeResolvedLayoutCache.delete(key);
    }
  }
}
