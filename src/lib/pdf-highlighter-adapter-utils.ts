import type { EvidenceAnchorRect } from "@/lib/ai/types";
import type { PdfSearchMatch } from "@/lib/pdf-search";
import type { PdfSelectionSnapshot } from "@/lib/pdf-selection-session";
import type { AnnotationItem, BoundingBox, PdfTarget, PdfTextQuote, PdfTextQuoteSource } from "@/types/universal-annotation";
import type { PdfCanonicalSelection } from "@/lib/pdf-selection-session";

export function dedupeAnnotationsById<T extends AnnotationItem>(annotations: T[]): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];

  for (let index = annotations.length - 1; index >= 0; index -= 1) {
    const annotation = annotations[index];
    if (seen.has(annotation.id)) {
      continue;
    }
    seen.add(annotation.id);
    deduped.unshift(annotation);
  }

  return deduped;
}

export function findPdfPageElementInScope(
  scopeRoot: ParentNode | null | undefined,
  pageNumber: number,
): HTMLElement | null {
  if (!scopeRoot || !Number.isInteger(pageNumber) || pageNumber < 1) {
    return null;
  }

  const selector = `[data-page-number="${pageNumber}"]`;
  const candidates = [
    ...(scopeRoot instanceof HTMLElement && scopeRoot.matches(selector) ? [scopeRoot] : []),
    ...Array.from(scopeRoot.querySelectorAll<HTMLElement>(selector)),
  ].filter((candidate, index, allCandidates) => allCandidates.indexOf(candidate) === index);

  if (candidates.length === 0) {
    return null;
  }

  if (candidates.length === 1) {
    return candidates[0];
  }

  return candidates
    .map((candidate, index) => {
      const rect = candidate.getBoundingClientRect();
      const score =
        (candidate.dataset.pdfPageVisible === "true" ? 1000 : 0) +
        (candidate.dataset.pdfPageMeasured === "true" ? 500 : 0) +
        (candidate.querySelector(".react-pdf__Page") ? 100 : 0) +
        (candidate.querySelector("canvas") ? 50 : 0) +
        (candidate.querySelector(".textLayer") ? 25 : 0) +
        (rect.width > 0 && rect.height > 0 ? 10 : 0);

      return {
        candidate,
        index,
        score,
        area: Math.max(0, rect.width) * Math.max(0, rect.height),
      };
    })
    .sort((left, right) => (
      right.score - left.score ||
      right.area - left.area ||
      left.index - right.index
    ))[0]?.candidate ?? null;
}

export function buildPdfSelectionRects(range: Range | undefined, pageElement: HTMLElement | null): EvidenceAnchorRect[] | undefined {
  if (!range || !pageElement) {
    return undefined;
  }

  const pageRect = pageElement.getBoundingClientRect();
  if (pageRect.width <= 0 || pageRect.height <= 0) {
    return undefined;
  }

  const rects = Array.from(range.getClientRects())
    .map((rect) => {
      const left = (rect.left - pageRect.left) / pageRect.width;
      const top = (rect.top - pageRect.top) / pageRect.height;
      const width = rect.width / pageRect.width;
      const height = rect.height / pageRect.height;
      return {
        left: Math.max(0, Math.min(1, left)),
        top: Math.max(0, Math.min(1, top)),
        width: Math.max(0, Math.min(1, width)),
        height: Math.max(0, Math.min(1, height)),
      };
    })
    .filter((rect) => rect.width > 0 && rect.height > 0);

  return rects.length > 0 ? rects : undefined;
}

export function buildPdfSelectionRectsFromSnapshot(
  snapshot: PdfSelectionSnapshot | null | undefined,
  scopeRoot: ParentNode | null | undefined,
): { pageNumber: number | undefined; rects: EvidenceAnchorRect[] | undefined } {
  if (!snapshot) {
    return { pageNumber: undefined, rects: undefined };
  }

  const pageNumber = snapshot.pageNumbers[0];
  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    return { pageNumber: undefined, rects: undefined };
  }

  const pageElement = findPdfPageElementInScope(scopeRoot, pageNumber);
  if (!pageElement) {
    return { pageNumber, rects: undefined };
  }

  const pageRect = pageElement.getBoundingClientRect();
  if (pageRect.width <= 0 || pageRect.height <= 0) {
    return { pageNumber, rects: undefined };
  }

  const rects = (snapshot.overlayRectsByPage[pageNumber] ?? [])
    .map((rect) => ({
      left: Math.max(0, Math.min(1, rect.left / pageRect.width)),
      top: Math.max(0, Math.min(1, rect.top / pageRect.height)),
      width: Math.max(0, Math.min(1, rect.width / pageRect.width)),
      height: Math.max(0, Math.min(1, rect.height / pageRect.height)),
    }))
    .filter((rect) => rect.width > 0 && rect.height > 0);

  return {
    pageNumber,
    rects: rects.length > 0 ? rects : undefined,
  };
}

export function buildPdfPreviewRect(input: {
  rects: PdfTarget["rects"];
  pageWidth: number;
  pageHeight: number;
  paddingRatio: number;
  minCssWidth: number;
  minCssHeight: number;
}): PdfTarget["rects"][number] | null {
  const validRects = input.rects.filter((rect) => (
    Number.isFinite(rect.x1) &&
    Number.isFinite(rect.y1) &&
    Number.isFinite(rect.x2) &&
    Number.isFinite(rect.y2) &&
    rect.x2 > rect.x1 &&
    rect.y2 > rect.y1
  ));

  if (validRects.length === 0 || input.pageWidth <= 0 || input.pageHeight <= 0) {
    return null;
  }

  const unionLeft = Math.max(0, Math.min(...validRects.map((rect) => rect.x1)));
  const unionTop = Math.max(0, Math.min(...validRects.map((rect) => rect.y1)));
  const unionRight = Math.min(1, Math.max(...validRects.map((rect) => rect.x2)));
  const unionBottom = Math.min(1, Math.max(...validRects.map((rect) => rect.y2)));
  if (unionRight <= unionLeft || unionBottom <= unionTop) {
    return null;
  }

  const minWidth = Math.min(1, input.minCssWidth / input.pageWidth);
  const minHeight = Math.min(1, input.minCssHeight / input.pageHeight);
  const centerX = (unionLeft + unionRight) / 2;
  const centerY = (unionTop + unionBottom) / 2;
  const halfWidth = Math.max((unionRight - unionLeft) / 2 + input.paddingRatio, minWidth / 2);
  const halfHeight = Math.max((unionBottom - unionTop) / 2 + input.paddingRatio, minHeight / 2);

  let x1 = centerX - halfWidth;
  let x2 = centerX + halfWidth;
  let y1 = centerY - halfHeight;
  let y2 = centerY + halfHeight;

  if (x1 < 0) {
    x2 = Math.min(1, x2 - x1);
    x1 = 0;
  }
  if (x2 > 1) {
    x1 = Math.max(0, x1 - (x2 - 1));
    x2 = 1;
  }
  if (y1 < 0) {
    y2 = Math.min(1, y2 - y1);
    y1 = 0;
  }
  if (y2 > 1) {
    y1 = Math.max(0, y1 - (y2 - 1));
    y2 = 1;
  }

  return { x1, y1, x2, y2 };
}

export function pdfSearchRectsToTargetRects(rects: PdfSearchMatch["rects"] | undefined): PdfTarget["rects"] | undefined {
  if (!rects?.length) {
    return undefined;
  }

  return rects.map((rect) => ({
    x1: rect.left,
    y1: rect.top,
    x2: rect.left + rect.width,
    y2: rect.top + rect.height,
  }));
}

export function resolveSidebarSelectionTarget(annotation: AnnotationItem): {
  annotationId: string;
  pdfTarget: PdfTarget | null;
} {
  return {
    annotationId: annotation.id,
    pdfTarget: annotation.target.type === "pdf" ? annotation.target as PdfTarget : null,
  };
}

export function shouldClearSelectedAnnotationAfterDelete(selectedAnnotationId: string | null, deletedId: string): boolean {
  return selectedAnnotationId === deletedId;
}

function normalizePdfComparableText(text: string | undefined): string {
  return (text ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactPdfComparableText(text: string | undefined): string {
  return normalizePdfComparableText(text).replace(/\s+/g, "");
}

function isWordCharacter(character: string | undefined): boolean {
  return Boolean(character) && /[\p{L}\p{N}]/u.test(character ?? "");
}

function hasSuspiciousQuoteBoundary(quote: Pick<PdfTextQuote, "exact" | "prefix" | "suffix">): boolean {
  const exact = normalizePdfComparableText(quote.exact);
  if (!exact) {
    return false;
  }

  const prefix = normalizePdfComparableText(quote.prefix);
  const suffix = normalizePdfComparableText(quote.suffix);
  const prefixTail = prefix.slice(-1);
  const exactHead = exact.slice(0, 1);
  const exactTail = exact.slice(-1);
  const suffixHead = suffix.slice(0, 1);

  return (
    (isWordCharacter(prefixTail) && isWordCharacter(exactHead)) ||
    (isWordCharacter(exactTail) && isWordCharacter(suffixHead))
  );
}

function containsControlArtifacts(text: string | undefined): boolean {
  return /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text ?? "");
}

export function shouldPreserveExistingPdfSelectionText(input: {
  selection: Pick<PdfCanonicalSelection, "text" | "textQuote" | "pageRects" | "textSource">;
  candidate: {
    text: string;
    quote: Pick<PdfTextQuote, "exact" | "prefix" | "suffix" | "source">;
    rects: BoundingBox[];
  };
}): boolean {
  const source = input.selection.textSource ?? input.selection.textQuote.source;
  const nativeSource = source === "pdfium-native" || source === "validated-native-fallback";
  if (!nativeSource) {
    return false;
  }

  if (input.candidate.quote.source === source) {
    return false;
  }

  const selectionCompact = compactPdfComparableText(input.selection.textQuote.exact || input.selection.text);
  const candidateCompact = compactPdfComparableText(input.candidate.quote.exact || input.candidate.text);
  if (!selectionCompact || !candidateCompact) {
    return false;
  }

  const multilineSelection = input.selection.pageRects.length > 1 || input.candidate.rects.length > 1;
  if (containsControlArtifacts(input.candidate.text) || containsControlArtifacts(input.candidate.quote.exact)) {
    return true;
  }

  if (multilineSelection && hasSuspiciousQuoteBoundary(input.candidate.quote)) {
    return true;
  }

  if (selectionCompact === candidateCompact) {
    return false;
  }

  if (
    selectionCompact.length >= 8 &&
    candidateCompact.length <= 2 &&
    selectionCompact !== candidateCompact
  ) {
    return true;
  }

  if (
    multilineSelection &&
    selectionCompact.length >= 12 &&
    !selectionCompact.includes(candidateCompact) &&
    !candidateCompact.includes(selectionCompact)
  ) {
    return true;
  }

  return false;
}
