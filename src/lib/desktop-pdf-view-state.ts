import type { PersistedFileViewState } from "@/lib/file-view-state";
import { clampPdfScale } from "@/lib/pdf-view-state";
import type { PdfNavigationState } from "@/types/pdf-runtime";

const DEFAULT_ZOOM_SCALE = 1;
const MIN_ZOOM_SCALE = 0.5;
const MAX_ZOOM_SCALE = 3.0;

export function createDefaultPdfNavigationState(): PdfNavigationState {
  return {
    currentPage: 1,
    zoomMode: "fit-page",
    zoomScale: DEFAULT_ZOOM_SCALE,
  };
}

function isValidNavigationState(candidate: unknown): candidate is PdfNavigationState {
  if (typeof candidate !== "object" || candidate === null) {
    return false;
  }

  const state = candidate as Record<string, unknown>;
  return (
    typeof state.currentPage === "number" &&
    Number.isInteger(state.currentPage) &&
    state.currentPage > 0 &&
    (state.zoomMode === "manual" || state.zoomMode === "fit-page") &&
    typeof state.zoomScale === "number" &&
    Number.isFinite(state.zoomScale)
  );
}

export function normalizePdfNavigationState(input: Partial<PdfNavigationState> | null | undefined): PdfNavigationState {
  const fallback = createDefaultPdfNavigationState();
  return {
    currentPage: typeof input?.currentPage === "number" && Number.isInteger(input.currentPage) && input.currentPage > 0
      ? input.currentPage
      : fallback.currentPage,
    zoomMode: input?.zoomMode === "manual" || input?.zoomMode === "fit-page"
      ? input.zoomMode
      : fallback.zoomMode,
    zoomScale: clampPdfScale(
      typeof input?.zoomScale === "number" && Number.isFinite(input.zoomScale)
        ? input.zoomScale
        : fallback.zoomScale,
      MIN_ZOOM_SCALE,
      MAX_ZOOM_SCALE,
    ),
  };
}

export function readDesktopPdfNavigationState(
  state: PersistedFileViewState | { viewState?: Record<string, unknown> } | null | undefined,
): PdfNavigationState | null {
  const candidate = state?.viewState?.desktopPdf;
  if (!isValidNavigationState(candidate)) {
    return null;
  }

  return normalizePdfNavigationState(candidate);
}

export function buildDesktopPdfReaderEditorState(
  navigationState: PdfNavigationState,
): Required<Pick<PersistedFileViewState, "cursorPosition" | "scrollTop" | "scrollLeft" | "viewState">> {
  const normalized = normalizePdfNavigationState(navigationState);
  return {
    cursorPosition: 0,
    scrollTop: 0,
    scrollLeft: 0,
    viewState: {
      desktopPdf: normalized,
    },
  };
}
