import type { BoundingBox, ImageAnnotationPreview, PdfTextQuote } from "@/types/universal-annotation";

export type PdfSelectionPhase =
  | "idle"
  | "native_dragging"
  | "frozen"
  | "committed"
  | "cancelled";

export interface PdfSelectionClientRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface PdfSelectionPageGeometry {
  pageNumber: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PdfTransientSelectionRect {
  left: number;
  top: number;
  width: number;
  height: number;
  pageNumber: number;
}

export interface PdfCanonicalSelection {
  pageNumber: number;
  startOffset: number;
  endOffset: number;
  text: string;
  textQuote: PdfTextQuote;
  pageRects: BoundingBox[];
  viewportRects: PdfTransientSelectionRect[];
}

export type PdfOverlayRectsByPage = Record<number, PdfTransientSelectionRect[]>;

export interface PdfSelectionSnapshot extends PdfCanonicalSelection {
  overlayRectsByPage: PdfOverlayRectsByPage;
  pageNumbers: number[];
  signature: string;
}

export interface PdfSelectionSessionState {
  token: number;
  phase: PdfSelectionPhase;
  timestamp: number;
  snapshot: PdfSelectionSnapshot | null;
}

const DEFAULT_REPLAY_WINDOW_MS = 450;

function round(value: number, precision = 4): string {
  return value.toFixed(precision);
}

function normalizeText(text: string | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim().slice(0, 240);
}

function sortSelectionRects(rects: PdfTransientSelectionRect[]): PdfTransientSelectionRect[] {
  return [...rects].sort((left, right) => (
    left.pageNumber - right.pageNumber ||
    left.top - right.top ||
    left.left - right.left
  ));
}

function buildOverlayRectsByPage(rects: PdfTransientSelectionRect[]): PdfOverlayRectsByPage {
  const grouped: PdfOverlayRectsByPage = {};
  for (const rect of sortSelectionRects(rects)) {
    if (!grouped[rect.pageNumber]) {
      grouped[rect.pageNumber] = [];
    }
    grouped[rect.pageNumber].push(rect);
  }
  return grouped;
}

export function buildPdfSelectionSignature(input: {
  tool: "highlight" | "underline" | "area" | "select";
  selection: Pick<PdfCanonicalSelection, "pageNumber" | "startOffset" | "endOffset" | "text" | "pageRects">;
}): string {
  const rectSignature = input.selection.pageRects
    .map((rect) => [
      round(rect.x1),
      round(rect.y1),
      round(rect.x2),
      round(rect.y2),
    ].join(":"))
    .join("|");

  return [
    input.tool,
    input.selection.pageNumber,
    input.selection.startOffset,
    input.selection.endOffset,
    rectSignature,
    normalizeText(input.selection.text),
  ].join("::");
}

export function createIdlePdfSelectionSession(now = Date.now()): PdfSelectionSessionState {
  return {
    token: 0,
    phase: "idle",
    timestamp: now,
    snapshot: null,
  };
}

export function beginPdfSelectionSession(
  previous: PdfSelectionSessionState | null,
  now = Date.now(),
): PdfSelectionSessionState {
  return {
    token: (previous?.token ?? 0) + 1,
    phase: "native_dragging",
    timestamp: now,
    snapshot: null,
  };
}

export function createPdfSelectionSnapshot(input: {
  selection: PdfCanonicalSelection;
  signature: string;
}): PdfSelectionSnapshot {
  const overlayRectsByPage = buildOverlayRectsByPage(input.selection.viewportRects);
  return {
    ...input.selection,
    text: normalizeText(input.selection.text),
    textQuote: {
      ...input.selection.textQuote,
      exact: normalizeText(input.selection.textQuote.exact),
    },
    viewportRects: sortSelectionRects(input.selection.viewportRects),
    overlayRectsByPage,
    pageNumbers: [input.selection.pageNumber],
    signature: input.signature,
  };
}

export function updatePdfSelectionSession(
  previous: PdfSelectionSessionState | null,
  input: {
    phase: PdfSelectionPhase;
    snapshot?: PdfSelectionSnapshot | null;
    token?: number;
    now?: number;
  },
): PdfSelectionSessionState {
  const previousToken = previous?.token ?? 0;
  const nextSnapshot = input.snapshot === undefined
    ? previous?.snapshot ?? null
    : input.snapshot;

  return {
    token: input.token ?? previousToken,
    phase: input.phase,
    timestamp: input.now ?? Date.now(),
    snapshot: input.phase === "idle" || input.phase === "cancelled"
      ? null
      : nextSnapshot,
  };
}

export function isDuplicatePdfSelection(
  previous: PdfSelectionSessionState | null,
  nextSelection: {
    signature: string;
    token: number;
    now?: number;
    replayWindowMs?: number;
  },
): boolean {
  const now = nextSelection.now ?? Date.now();
  const replayWindowMs = nextSelection.replayWindowMs ?? DEFAULT_REPLAY_WINDOW_MS;

  return Boolean(
    previous &&
    previous.token === nextSelection.token &&
    previous.snapshot?.signature === nextSelection.signature &&
    previous.phase !== "native_dragging" &&
    previous.phase !== "cancelled" &&
    previous.phase !== "idle" &&
    now - previous.timestamp <= replayWindowMs,
  );
}

export function flattenPdfOverlayRectsByPage(overlayRectsByPage: PdfOverlayRectsByPage): PdfTransientSelectionRect[] {
  return sortSelectionRects(
    Object.values(overlayRectsByPage).flatMap((rects) => rects),
  );
}

export function getPdfSelectionSnapshotText(snapshot: PdfSelectionSnapshot | null | undefined): string {
  return normalizeText(snapshot?.textQuote?.exact || snapshot?.text);
}

export function projectPdfSelectionRectsToPages(input: {
  clientRects: PdfSelectionClientRect[];
  pages: PdfSelectionPageGeometry[];
}): PdfTransientSelectionRect[] {
  const rects: PdfTransientSelectionRect[] = [];

  for (const clientRect of input.clientRects) {
    for (const page of input.pages) {
      if (page.pageNumber < 1 || page.width <= 0 || page.height <= 0) {
        continue;
      }

      const left = Math.max(clientRect.left, page.left);
      const right = Math.min(clientRect.right, page.left + page.width);
      const top = Math.max(clientRect.top, page.top);
      const bottom = Math.min(clientRect.bottom, page.top + page.height);

      if (right - left <= 0 || bottom - top <= 0) {
        continue;
      }

      rects.push({
        left: left - page.left,
        top: top - page.top,
        width: right - left,
        height: bottom - top,
        pageNumber: page.pageNumber,
      });
    }
  }

  return sortSelectionRects(rects);
}

export function projectPdfScaledSelectionToViewportRects(input: {
  scaledPosition: {
    boundingRect: {
      width: number;
      height: number;
      pageNumber?: number;
    };
    rects: Array<{
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      width: number;
      height: number;
      pageNumber?: number;
    }>;
    pageNumber: number;
  };
  pages: Array<Pick<PdfSelectionPageGeometry, "pageNumber" | "width" | "height">>;
}): PdfTransientSelectionRect[] {
  const pageGeometryByNumber = new Map<number, Pick<PdfSelectionPageGeometry, "pageNumber" | "width" | "height">>(
    input.pages.map((page) => [page.pageNumber, page]),
  );

  const rects = input.scaledPosition.rects
    .map((rect) => {
      const pageNumber = rect.pageNumber ?? input.scaledPosition.pageNumber;
      const page = pageGeometryByNumber.get(pageNumber);
      const widthBasis = rect.width || input.scaledPosition.boundingRect.width || page?.width || 0;
      const heightBasis = rect.height || input.scaledPosition.boundingRect.height || page?.height || 0;

      if (!page || page.width <= 0 || page.height <= 0 || widthBasis <= 0 || heightBasis <= 0) {
        return null;
      }

      const left = (Math.min(rect.x1, rect.x2) / widthBasis) * page.width;
      const top = (Math.min(rect.y1, rect.y2) / heightBasis) * page.height;
      const width = (Math.abs(rect.x2 - rect.x1) / widthBasis) * page.width;
      const height = (Math.abs(rect.y2 - rect.y1) / heightBasis) * page.height;

      if (width <= 0 || height <= 0) {
        return null;
      }

      return {
        left,
        top,
        width,
        height,
        pageNumber,
      } satisfies PdfTransientSelectionRect;
    })
    .filter((rect): rect is PdfTransientSelectionRect => rect !== null);

  return sortSelectionRects(rects);
}

export function resolvePdfCopySelectionText(input: {
  nativeText: string;
  frozenSnapshot: PdfSelectionSnapshot | null | undefined;
}): string {
  const snapshotText = getPdfSelectionSnapshotText(input.frozenSnapshot);
  if (snapshotText) {
    return snapshotText;
  }

  const nativeText = normalizeText(input.nativeText);
  if (nativeText) {
    return nativeText;
  }

  return snapshotText;
}

export function buildPdfAreaPreview(input: {
  dataUrl: string | undefined;
  width: number;
  height: number;
}): ImageAnnotationPreview | undefined {
  if (!input.dataUrl) {
    return undefined;
  }

  const dataUrl = input.dataUrl.trim();
  if (!dataUrl.startsWith("data:image/")) {
    return undefined;
  }

  if (input.width <= 0 || input.height <= 0) {
    return undefined;
  }

  return {
    type: "image",
    dataUrl,
    width: input.width,
    height: input.height,
  };
}
