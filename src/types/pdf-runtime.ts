export type PdfRuntimeProfile = "desktop-performance" | "web-rich";

export type DesktopPdfMode = "reader" | "search" | "outline" | "annotate";

export type DesktopPdfZoomMode = "manual" | "fit-page";

export interface PdfNavigationState {
  currentPage: number;
  zoomMode: DesktopPdfZoomMode;
  zoomScale: number;
}

export interface PdfSearchTaskState {
  query: string;
  extractedPages: number;
  totalPages: number;
  status: "idle" | "extracting" | "ready" | "cancelled" | "error";
}

export interface ResolvedPdfOutlineItem {
  title: string;
  page: number;
  children: ResolvedPdfOutlineItem[];
}
