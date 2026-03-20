export type PdfZoomMode = 'manual' | 'fit-width' | 'fit-page';

export interface PdfViewState {
  scale: number;
  zoomMode: PdfZoomMode;
  showSidebar: boolean;
}

export interface PdfEditorStateLike {
  cursorPosition?: number;
  scrollTop?: number;
  scrollLeft?: number;
  viewState?: Record<string, unknown>;
}

export interface ScrollContainerLike {
  scrollTop: number;
  scrollLeft: number;
  scrollHeight: number;
  clientHeight: number;
  scrollWidth: number;
  clientWidth: number;
  scrollTo: (options: { top?: number; left?: number; behavior?: ScrollBehavior }) => void;
}

export interface RelativeScrollState {
  topRatio: number;
  leftRatio: number;
}

let scopedPdfPaneId: string | null = null;

function isPdfZoomMode(value: unknown): value is PdfZoomMode {
  return value === 'manual' || value === 'fit-width' || value === 'fit-page';
}

export function readCachedPdfViewState(editorState: PdfEditorStateLike | undefined): PdfViewState | null {
  const candidate = editorState?.viewState?.pdf as Partial<PdfViewState> | undefined;
  if (!candidate) {
    return null;
  }

  if (typeof candidate.scale !== 'number' || !Number.isFinite(candidate.scale)) {
    return null;
  }

  if (!isPdfZoomMode(candidate.zoomMode) || typeof candidate.showSidebar !== 'boolean') {
    return null;
  }

  return {
    scale: candidate.scale,
    zoomMode: candidate.zoomMode,
    showSidebar: candidate.showSidebar,
  };
}

export function buildPdfEditorState(input: {
  scale: number;
  zoomMode: PdfZoomMode;
  showSidebar: boolean;
  scrollTop?: number;
  scrollLeft?: number;
}): Required<Pick<PdfEditorStateLike, 'cursorPosition' | 'scrollTop' | 'scrollLeft' | 'viewState'>> {
  return {
    cursorPosition: 0,
    scrollTop: input.scrollTop ?? 0,
    scrollLeft: input.scrollLeft ?? 0,
    viewState: {
      pdf: {
        scale: input.scale,
        zoomMode: input.zoomMode,
        showSidebar: input.showSidebar,
      } satisfies PdfViewState,
    },
  };
}

export function captureRelativeScrollPosition(container: Pick<ScrollContainerLike, 'scrollTop' | 'scrollLeft' | 'scrollHeight' | 'clientHeight' | 'scrollWidth' | 'clientWidth'>): RelativeScrollState {
  const maxScrollTop = Math.max(1, container.scrollHeight - container.clientHeight);
  const maxScrollLeft = Math.max(1, container.scrollWidth - container.clientWidth);

  return {
    topRatio: container.scrollTop / maxScrollTop,
    leftRatio: container.scrollLeft / maxScrollLeft,
  };
}

export function restoreRelativeScrollPosition(container: ScrollContainerLike, state: RelativeScrollState): void {
  const nextMaxTop = Math.max(0, container.scrollHeight - container.clientHeight);
  const nextMaxLeft = Math.max(0, container.scrollWidth - container.clientWidth);

  container.scrollTo({
    top: state.topRatio * nextMaxTop,
    left: state.leftRatio * nextMaxLeft,
    behavior: 'auto',
  });
}

export function setScopedPdfPaneId(paneId: string): void {
  scopedPdfPaneId = paneId;
}

export function clearScopedPdfPaneId(paneId?: string): void {
  if (!paneId || scopedPdfPaneId === paneId) {
    scopedPdfPaneId = null;
  }
}

export function getScopedPdfPaneId(): string | null {
  return scopedPdfPaneId;
}

export function isPdfInteractionActive(input: { paneId: string; isPaneActive: boolean }): boolean {
  return scopedPdfPaneId ? scopedPdfPaneId === input.paneId : input.isPaneActive;
}

export function clampPdfScale(scale: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, scale));
}

export function getPdfWheelZoomDelta(deltaY: number, step: number): number {
  return deltaY > 0 ? -step : step;
}
