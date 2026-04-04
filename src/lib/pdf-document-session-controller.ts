import { pdfjs } from "react-pdf";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type { ResolvedPdfOutlineItem } from "@/types/pdf-runtime";

const TEXT_CACHE_LIMIT = 32;
const PAGE_CACHE_LIMIT = 3;

class StalePdfSessionError extends Error {
  constructor() {
    super("Stale PDF session");
  }
}

async function resolveOutlineItems(
  pdfDocument: PDFDocumentProxy,
  items: Array<{ title?: string | null; dest: unknown; items?: unknown[] }>,
): Promise<ResolvedPdfOutlineItem[]> {
  const resolved: ResolvedPdfOutlineItem[] = [];

  for (const item of items) {
    let page = 1;
    try {
      let destination = item.dest;
      if (typeof destination === "string") {
        destination = await pdfDocument.getDestination(destination);
      }
      if (Array.isArray(destination) && destination[0]) {
        const pageIndex = await pdfDocument.getPageIndex(destination[0]);
        page = pageIndex + 1;
      }
    } catch {
      page = 1;
    }

    const children = Array.isArray(item.items) && item.items.length > 0
      ? await resolveOutlineItems(pdfDocument, item.items as Array<{ title?: string | null; dest: unknown; items?: unknown[] }>)
      : [];

    resolved.push({
      title: item.title?.trim() || `Page ${page}`,
      page,
      children,
    });
  }

  return resolved;
}

export class PdfDocumentSessionController {
  private generationId = 0;
  private loadingTask: PDFDocumentLoadingTask | null = null;
  private documentProxy: PDFDocumentProxy | null = null;
  private pageCache = new Map<number, Promise<PDFPageProxy>>();
  private textCache = new Map<number, Promise<string>>();
  private outlinePromise: Promise<ResolvedPdfOutlineItem[]> | null = null;

  get currentGenerationId(): number {
    return this.generationId;
  }

  private assertGeneration(generationId: number): void {
    if (generationId !== this.generationId) {
      throw new StalePdfSessionError();
    }
  }

  private trimPageCache(keepPages: number[]): void {
    const keep = new Set(keepPages);
    for (const pageNumber of Array.from(this.pageCache.keys())) {
      if (!keep.has(pageNumber)) {
        this.pageCache.delete(pageNumber);
      }
    }

    if (this.pageCache.size <= PAGE_CACHE_LIMIT) {
      return;
    }

    const overflow = Array.from(this.pageCache.keys()).filter((pageNumber) => !keep.has(pageNumber));
    while (this.pageCache.size > PAGE_CACHE_LIMIT && overflow.length > 0) {
      const candidate = overflow.shift();
      if (typeof candidate === "number") {
        this.pageCache.delete(candidate);
      }
    }
  }

  private touchTextCache(pageNumber: number, promise: Promise<string>): void {
    this.textCache.delete(pageNumber);
    this.textCache.set(pageNumber, promise);
    while (this.textCache.size > TEXT_CACHE_LIMIT) {
      const oldest = this.textCache.keys().next().value;
      if (typeof oldest === "number") {
        this.textCache.delete(oldest);
      } else {
        break;
      }
    }
  }

  async loadDocument(data: Uint8Array): Promise<{ document: PDFDocumentProxy; generationId: number }> {
    this.cancelPendingWork();
    await this.destroyDocument();

    const generationId = ++this.generationId;
    const loadingTask = pdfjs.getDocument({ data });
    this.loadingTask = loadingTask;

    try {
      const document = await loadingTask.promise;
      this.assertGeneration(generationId);
      this.documentProxy = document;
      this.pageCache.clear();
      this.textCache.clear();
      this.outlinePromise = null;
      return { document, generationId };
    } catch (error) {
      if (generationId === this.generationId) {
        this.loadingTask = null;
        this.documentProxy = null;
      }
      throw error;
    }
  }

  cancelPendingWork(): void {
    this.generationId += 1;
    this.pageCache.clear();
    this.textCache.clear();
    this.outlinePromise = null;
  }

  async destroyDocument(): Promise<void> {
    const loadingTask = this.loadingTask;
    const documentProxy = this.documentProxy;

    this.loadingTask = null;
    this.documentProxy = null;
    this.pageCache.clear();
    this.textCache.clear();
    this.outlinePromise = null;

    try {
      loadingTask?.destroy();
    } catch {
      // Ignore destroy races from pdf.js transport teardown.
    }

    try {
      await documentProxy?.destroy();
    } catch {
      // Ignore destroy races during rapid file switches.
    }
  }

  async loadPage(pageNumber: number, generationId: number, keepPages: number[] = [pageNumber]): Promise<PDFPageProxy> {
    this.assertGeneration(generationId);
    const documentProxy = this.documentProxy;
    if (!documentProxy) {
      throw new Error("PDF document is not loaded");
    }

    const cached = this.pageCache.get(pageNumber);
    if (cached) {
      this.trimPageCache(keepPages);
      return cached;
    }

    const promise = documentProxy.getPage(pageNumber).then((page) => {
      this.assertGeneration(generationId);
      return page;
    });
    this.pageCache.set(pageNumber, promise);
    this.trimPageCache(keepPages);
    return promise;
  }

  async loadTextForPage(pageNumber: number, generationId: number): Promise<string> {
    this.assertGeneration(generationId);
    const cached = this.textCache.get(pageNumber);
    if (cached) {
      return cached;
    }

    const promise = this.loadPage(pageNumber, generationId, [pageNumber]).then(async (page) => {
      const textContent = await page.getTextContent();
      this.assertGeneration(generationId);
      return textContent.items
        .map((item) => ("str" in item ? item.str ?? "" : ""))
        .join(" ")
        .toLowerCase();
    });

    this.touchTextCache(pageNumber, promise);
    return promise;
  }

  async loadOutline(generationId: number): Promise<ResolvedPdfOutlineItem[]> {
    this.assertGeneration(generationId);
    const documentProxy = this.documentProxy;
    if (!documentProxy) {
      return [];
    }

    if (this.outlinePromise) {
      return this.outlinePromise;
    }

    this.outlinePromise = documentProxy.getOutline().then(async (outline) => {
      this.assertGeneration(generationId);
      if (!outline || outline.length === 0) {
        return [];
      }
      return resolveOutlineItems(
        documentProxy,
        outline as Array<{ title?: string | null; dest: unknown; items?: unknown[] }>,
      );
    });

    return this.outlinePromise;
  }
}

export function createPdfDocumentSessionController(): PdfDocumentSessionController {
  return new PdfDocumentSessionController();
}

export function isStalePdfSessionError(error: unknown): boolean {
  return error instanceof StalePdfSessionError;
}
