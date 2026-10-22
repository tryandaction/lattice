export const PDF_SELECTION_DRAG_THRESHOLD_PX = 3;

export type PdfSelectionGestureKind = "pointer_candidate" | "text_drag" | "cancelled";

export interface PdfSelectionGesturePoint {
  x: number;
  y: number;
}

export interface PdfSelectionPageAnchor extends PdfSelectionGesturePoint {
  pageNumber: number;
}

interface PdfSelectionPageRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Project the original page-local glyph position after scrolling or zooming. */
export function projectPdfSelectionPageAnchor(
  anchor: PdfSelectionPageAnchor,
  rect: PdfSelectionPageRect,
): PdfSelectionGesturePoint {
  return { x: rect.left + anchor.x * rect.width, y: rect.top + anchor.y * rect.height };
}

export interface PdfSelectionGestureState {
  token: number;
  pageNumber: number | null;
  pointerId: number | null;
  start: PdfSelectionGesturePoint;
  startAnchor?: PdfSelectionPageAnchor;
  end: PdfSelectionGesturePoint;
  kind: PdfSelectionGestureKind;
  startedOnLink: boolean;
  finished: boolean;
  linkClickPending: boolean;
}

interface PdfSelectionGestureEvent {
  point: PdfSelectionGesturePoint;
  token?: number;
  pointerId?: number | null;
}

function matchesPdfSelectionGesture(
  gesture: PdfSelectionGestureState,
  event: Pick<PdfSelectionGestureEvent, "token" | "pointerId">,
): boolean {
  if (event.token !== undefined && event.token !== gesture.token) {
    return false;
  }
  if (
    event.pointerId !== undefined &&
    event.pointerId !== null &&
    gesture.pointerId !== null &&
    event.pointerId !== gesture.pointerId
  ) {
    return false;
  }
  return true;
}

export function isMeaningfulPdfSelectionDrag(
  start: PdfSelectionGesturePoint | null | undefined,
  end: PdfSelectionGesturePoint | null | undefined,
): boolean {
  if (!start || !end) {
    return false;
  }
  return Math.hypot(end.x - start.x, end.y - start.y) >= PDF_SELECTION_DRAG_THRESHOLD_PX;
}

export function beginPdfSelectionGesture(input: {
  token: number;
  pageNumber: number | null;
  point: PdfSelectionGesturePoint;
  pointerId?: number | null;
  startedOnLink?: boolean;
  pageRect?: PdfSelectionPageRect;
}): PdfSelectionGestureState {
  const rect = input.pageRect;
  const startAnchor = input.pageNumber && rect && rect.width > 0 && rect.height > 0
    ? { pageNumber: input.pageNumber, x: (input.point.x - rect.left) / rect.width, y: (input.point.y - rect.top) / rect.height }
    : undefined;
  return {
    token: input.token,
    pageNumber: input.pageNumber,
    pointerId: input.pointerId ?? null,
    start: input.point,
    startAnchor,
    end: input.point,
    kind: "pointer_candidate",
    startedOnLink: input.startedOnLink ?? false,
    finished: false,
    linkClickPending: false,
  };
}

export function updatePdfSelectionGesture(
  gesture: PdfSelectionGestureState,
  event: PdfSelectionGestureEvent,
): PdfSelectionGestureState {
  if (gesture.kind === "cancelled" || gesture.finished || !matchesPdfSelectionGesture(gesture, event)) {
    return gesture;
  }

  const kind = gesture.kind === "text_drag" || isMeaningfulPdfSelectionDrag(gesture.start, event.point)
    ? "text_drag"
    : "pointer_candidate";
  return {
    ...gesture,
    end: event.point,
    kind,
    linkClickPending: kind === "text_drag",
  };
}

export function finishPdfSelectionGesture(
  gesture: PdfSelectionGestureState,
  event?: PdfSelectionGestureEvent,
): PdfSelectionGestureState {
  const updatedGesture = event ? updatePdfSelectionGesture(gesture, event) : gesture;
  if (
    updatedGesture.kind === "cancelled" ||
    updatedGesture.finished ||
    (event && !matchesPdfSelectionGesture(updatedGesture, event))
  ) {
    return updatedGesture;
  }
  return {
    ...updatedGesture,
    finished: true,
  };
}

export function cancelPdfSelectionGesture(
  gesture: PdfSelectionGestureState,
): PdfSelectionGestureState {
  if (gesture.kind === "cancelled") {
    return gesture;
  }
  return {
    ...gesture,
    kind: "cancelled",
    finished: true,
    linkClickPending: false,
  };
}

export function shouldSuppressPdfLinkClick(
  gesture: PdfSelectionGestureState | null | undefined,
): boolean {
  return gesture?.linkClickPending === true;
}

export function consumePdfSelectionLinkClickSuppression(
  gesture: PdfSelectionGestureState | null | undefined,
): PdfSelectionGestureState | null {
  if (!gesture) {
    return null;
  }
  if (!gesture.linkClickPending) {
    return gesture;
  }
  return {
    ...gesture,
    linkClickPending: false,
  };
}
