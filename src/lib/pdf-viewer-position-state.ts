import type { RelativeScrollState } from "@/lib/pdf-view-state";

export type PdfFitMode = "manual" | "width" | "page";

export interface PdfViewerViewState {
  scale: number;
  fitMode: PdfFitMode;
  scrollTop?: number;
  scrollLeft?: number;
  currentPage?: number;
  relativeScroll?: RelativeScrollState;
}

export const DEFAULT_PDF_VIEWER_VIEW_STATE: PdfViewerViewState = {
  scale: 1.2,
  fitMode: "width",
};

export function getPdfViewerViewStateKey(paneId: string | undefined, documentId: string): string {
  return `${paneId ?? "document"}:${documentId}`;
}

export function readPdfViewerViewState(value: unknown): PdfViewerViewState | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<PdfViewerViewState>;
  const scale = typeof candidate.scale === "number" && Number.isFinite(candidate.scale)
    ? candidate.scale
    : null;
  const fitMode = candidate.fitMode === "manual" || candidate.fitMode === "width" || candidate.fitMode === "page"
    ? candidate.fitMode
    : null;
  if (scale === null || !fitMode) {
    return null;
  }

  const relativeScroll = candidate.relativeScroll &&
    typeof candidate.relativeScroll.topRatio === "number" &&
    typeof candidate.relativeScroll.leftRatio === "number"
      ? {
          topRatio: Math.max(0, Math.min(1, candidate.relativeScroll.topRatio)),
          leftRatio: Math.max(0, Math.min(1, candidate.relativeScroll.leftRatio)),
        }
      : undefined;

  return {
    scale,
    fitMode,
    scrollTop: typeof candidate.scrollTop === "number" && Number.isFinite(candidate.scrollTop) ? candidate.scrollTop : undefined,
    scrollLeft: typeof candidate.scrollLeft === "number" && Number.isFinite(candidate.scrollLeft) ? candidate.scrollLeft : undefined,
    currentPage: typeof candidate.currentPage === "number" && Number.isInteger(candidate.currentPage) && candidate.currentPage > 0
      ? candidate.currentPage
      : undefined,
    relativeScroll,
  };
}

export function buildViewerVisiblePageSeed(pageNumber: number, pageBuffer = 2): Set<number> {
  const safePage = Number.isInteger(pageNumber) && pageNumber > 0 ? pageNumber : 1;
  const pages = new Set<number>();
  for (let page = safePage - pageBuffer; page <= safePage + pageBuffer; page += 1) {
    if (page > 0) {
      pages.add(page);
    }
  }
  return pages;
}
