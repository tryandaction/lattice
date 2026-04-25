export type PdfZoomMode = 'manual' | 'fit-width' | 'fit-page';

export interface PdfViewAnchor {
  pageNumber: number;
  pageOffsetTopRatio: number;
  pageOffsetLeftRatio: number;
  viewportAnchorY: number;
  viewportAnchorX: number;
  captureRevision: number;
}

export interface PdfViewState {
  scale: number;
  zoomMode: PdfZoomMode;
  showSidebar: boolean;
  sidebarSize?: number;
  selectedAnnotationId?: string | null;
  anchor?: PdfViewAnchor;
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

export interface RectLike {
  top: number;
  left: number;
  width: number;
  height: number;
  bottom?: number;
  right?: number;
}

export interface PdfVisiblePageCandidate {
  pageNumber: number;
  rect: RectLike;
}

export interface PdfPageDimension {
  pageNumber: number;
  width: number;
  height: number;
}

export interface PdfAnchorComparison {
  ok: boolean;
  pageMatch: boolean;
  deltaTopRatio: number | null;
  deltaLeftRatio: number | null;
}

export const DEFAULT_PDF_VIEWPORT_ANCHOR = {
  x: 0.5,
  y: 0.35,
} as const;

const DEFAULT_ANCHOR_TOLERANCE = 0.08;
const DEFAULT_FIT_PADDING = 32;

let scopedPdfPaneId: string | null = null;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function isPdfZoomMode(value: unknown): value is PdfZoomMode {
  return value === 'manual' || value === 'fit-width' || value === 'fit-page';
}

function normalizeRect(rect: RectLike): Required<RectLike> {
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
    bottom: rect.bottom ?? rect.top + rect.height,
    right: rect.right ?? rect.left + rect.width,
  };
}

function isValidAnchor(value: unknown): value is PdfViewAnchor {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const anchor = value as Record<string, unknown>;
  return (
    typeof anchor.pageNumber === 'number' &&
    Number.isInteger(anchor.pageNumber) &&
    anchor.pageNumber > 0 &&
    typeof anchor.pageOffsetTopRatio === 'number' &&
    Number.isFinite(anchor.pageOffsetTopRatio) &&
    anchor.pageOffsetTopRatio >= 0 &&
    anchor.pageOffsetTopRatio <= 1 &&
    typeof anchor.pageOffsetLeftRatio === 'number' &&
    Number.isFinite(anchor.pageOffsetLeftRatio) &&
    anchor.pageOffsetLeftRatio >= 0 &&
    anchor.pageOffsetLeftRatio <= 1 &&
    typeof anchor.viewportAnchorY === 'number' &&
    Number.isFinite(anchor.viewportAnchorY) &&
    anchor.viewportAnchorY >= 0 &&
    anchor.viewportAnchorY <= 1 &&
    typeof anchor.viewportAnchorX === 'number' &&
    Number.isFinite(anchor.viewportAnchorX) &&
    anchor.viewportAnchorX >= 0 &&
    anchor.viewportAnchorX <= 1 &&
    typeof anchor.captureRevision === 'number' &&
    Number.isFinite(anchor.captureRevision)
  );
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
    sidebarSize: typeof candidate.sidebarSize === 'number' ? candidate.sidebarSize : undefined,
    selectedAnnotationId: typeof candidate.selectedAnnotationId === 'string' || candidate.selectedAnnotationId === null
      ? candidate.selectedAnnotationId
      : undefined,
    anchor: isValidAnchor(candidate.anchor) ? candidate.anchor : undefined,
  };
}

export function buildPdfEditorState(input: {
  scale: number;
  zoomMode: PdfZoomMode;
  showSidebar: boolean;
  sidebarSize?: number;
  selectedAnnotationId?: string | null;
  anchor?: PdfViewAnchor;
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
        ...(typeof input.sidebarSize === 'number' ? { sidebarSize: input.sidebarSize } : {}),
        ...(input.selectedAnnotationId !== undefined ? { selectedAnnotationId: input.selectedAnnotationId } : {}),
        ...(input.anchor ? { anchor: input.anchor } : {}),
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

export function getViewportAnchorPoint(
  shellRect: RectLike,
  viewportAnchorX: number = DEFAULT_PDF_VIEWPORT_ANCHOR.x,
  viewportAnchorY: number = DEFAULT_PDF_VIEWPORT_ANCHOR.y,
): { x: number; y: number } {
  const normalizedShell = normalizeRect(shellRect);
  return {
    x: normalizedShell.left + normalizedShell.width * viewportAnchorX,
    y: normalizedShell.top + normalizedShell.height * viewportAnchorY,
  };
}

export function calculateRectIntersectionArea(left: RectLike, right: RectLike): number {
  const a = normalizeRect(left);
  const b = normalizeRect(right);
  const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return width * height;
}

export function findPrimaryVisiblePdfPage(
  candidates: PdfVisiblePageCandidate[],
  shellRect: RectLike,
  viewportAnchorX = DEFAULT_PDF_VIEWPORT_ANCHOR.x,
  viewportAnchorY = DEFAULT_PDF_VIEWPORT_ANCHOR.y,
): number | null {
  if (candidates.length === 0) {
    return null;
  }

  const anchorPoint = getViewportAnchorPoint(shellRect, viewportAnchorX, viewportAnchorY);
  const scored = candidates
    .map((candidate) => {
      const rect = normalizeRect(candidate.rect);
      const visibleArea = calculateRectIntersectionArea(rect, shellRect);
      const containsAnchor = (
        anchorPoint.x >= rect.left &&
        anchorPoint.x <= rect.right &&
        anchorPoint.y >= rect.top &&
        anchorPoint.y <= rect.bottom
      );

      return {
        pageNumber: candidate.pageNumber,
        visibleArea,
        containsAnchor,
      };
    })
    .filter((candidate) => candidate.visibleArea > 0);

  if (scored.length === 0) {
    return null;
  }

  const anchored = scored.filter((candidate) => candidate.containsAnchor);
  const pool = anchored.length > 0 ? anchored : scored;
  pool.sort((left, right) => right.visibleArea - left.visibleArea || left.pageNumber - right.pageNumber);
  return pool[0]?.pageNumber ?? null;
}

export function capturePdfViewAnchor(input: {
  pageNumber: number;
  pageRect: RectLike;
  shellRect: RectLike;
  captureRevision: number;
  viewportAnchorX?: number;
  viewportAnchorY?: number;
}): PdfViewAnchor | null {
  const pageRect = normalizeRect(input.pageRect);
  if (pageRect.width <= 0 || pageRect.height <= 0) {
    return null;
  }

  const viewportAnchorX = input.viewportAnchorX ?? DEFAULT_PDF_VIEWPORT_ANCHOR.x;
  const viewportAnchorY = input.viewportAnchorY ?? DEFAULT_PDF_VIEWPORT_ANCHOR.y;
  const viewportPoint = getViewportAnchorPoint(input.shellRect, viewportAnchorX, viewportAnchorY);

  return {
    pageNumber: input.pageNumber,
    pageOffsetTopRatio: clamp01((viewportPoint.y - pageRect.top) / pageRect.height),
    pageOffsetLeftRatio: clamp01((viewportPoint.x - pageRect.left) / pageRect.width),
    viewportAnchorY,
    viewportAnchorX,
    captureRevision: input.captureRevision,
  };
}

export function resolvePdfAnchorScrollTarget(input: {
  anchor: PdfViewAnchor;
  pageRect: RectLike;
  containerRect: RectLike;
  containerScrollTop: number;
  containerScrollLeft: number;
  containerClientHeight: number;
  containerClientWidth: number;
}): { top: number; left: number } {
  const pageRect = normalizeRect(input.pageRect);
  const containerRect = normalizeRect(input.containerRect);

  const pageOffsetTopPx = pageRect.height * clamp01(input.anchor.pageOffsetTopRatio);
  const pageOffsetLeftPx = pageRect.width * clamp01(input.anchor.pageOffsetLeftRatio);
  const desiredProbeTop = input.containerClientHeight * clamp01(input.anchor.viewportAnchorY);
  const desiredProbeLeft = input.containerClientWidth * clamp01(input.anchor.viewportAnchorX);
  const pageOffsetTopInContainer = pageRect.top - containerRect.top + input.containerScrollTop;
  const pageOffsetLeftInContainer = pageRect.left - containerRect.left + input.containerScrollLeft;

  return {
    top: Math.max(0, pageOffsetTopInContainer + pageOffsetTopPx - desiredProbeTop),
    left: Math.max(0, pageOffsetLeftInContainer + pageOffsetLeftPx - desiredProbeLeft),
  };
}

export function comparePdfViewAnchor(
  expected: PdfViewAnchor | null | undefined,
  actual: PdfViewAnchor | null | undefined,
  tolerance = DEFAULT_ANCHOR_TOLERANCE,
): PdfAnchorComparison {
  if (!expected || !actual) {
    return {
      ok: false,
      pageMatch: false,
      deltaTopRatio: null,
      deltaLeftRatio: null,
    };
  }

  const deltaTopRatio = Math.abs(expected.pageOffsetTopRatio - actual.pageOffsetTopRatio);
  const deltaLeftRatio = Math.abs(expected.pageOffsetLeftRatio - actual.pageOffsetLeftRatio);
  const pageMatch = expected.pageNumber === actual.pageNumber;

  return {
    ok: pageMatch && deltaTopRatio <= tolerance && deltaLeftRatio <= tolerance,
    pageMatch,
    deltaTopRatio,
    deltaLeftRatio,
  };
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

export function calculatePdfFitScale(input: {
  zoomMode: Exclude<PdfZoomMode, 'manual'>;
  containerWidth: number;
  containerHeight: number;
  pageDimensions: PdfPageDimension[];
  targetPageNumber?: number | null;
  minScale: number;
  maxScale: number;
  padding?: number;
}): number | null {
  const {
    zoomMode,
    containerWidth,
    containerHeight,
    pageDimensions,
    targetPageNumber,
    minScale,
    maxScale,
    padding = DEFAULT_FIT_PADDING,
  } = input;

  if (
    !Number.isFinite(containerWidth) ||
    !Number.isFinite(containerHeight) ||
    containerWidth <= 0 ||
    containerHeight <= 0 ||
    pageDimensions.length === 0
  ) {
    return null;
  }

  const availableWidth = Math.max(1, containerWidth - padding);
  const availableHeight = Math.max(1, containerHeight - padding);

  if (zoomMode === 'fit-width') {
    const widestPage = pageDimensions.reduce<PdfPageDimension | null>((widest, page) => {
      if (!Number.isFinite(page.width) || page.width <= 0) {
        return widest;
      }
      if (!widest || page.width > widest.width) {
        return page;
      }
      return widest;
    }, null);

    if (!widestPage) {
      return null;
    }

    return clampPdfScale(availableWidth / widestPage.width, minScale, maxScale);
  }

  const targetPage = (
    (targetPageNumber
      ? pageDimensions.find((page) => page.pageNumber === targetPageNumber)
      : null) ?? pageDimensions[0]
  );

  if (
    !targetPage ||
    !Number.isFinite(targetPage.width) ||
    !Number.isFinite(targetPage.height) ||
    targetPage.width <= 0 ||
    targetPage.height <= 0
  ) {
    return null;
  }

  return clampPdfScale(
    Math.min(availableWidth / targetPage.width, availableHeight / targetPage.height),
    minScale,
    maxScale,
  );
}
