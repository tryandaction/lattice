import type { PdfCanonicalSelection } from "@/lib/pdf-selection-session";
import type { PdfTextQuoteSource } from "@/types/universal-annotation";
import type { PdfPageTextModel } from "@/lib/pdf-page-text-cache";

export function reconcilePdfSelectionLineBreakText(input: {
  text: string;
  canonicalText: string;
  model: PdfPageTextModel;
  startOffset: number;
  endOffset: number;
}): string {
  let text = input.text;
  const segments = input.model.segments.filter((segment) => (
    segment.pageTextEnd > input.startOffset && segment.pageTextStart < input.endOffset
  ));
  for (let index = 1; index < segments.length; index += 1) {
    const previous = segments[index - 1];
    const next = segments[index];
    if (
      (!previous.hasEOL && previous.lineIndex === next.lineIndex) ||
      (previous.columnIndex !== undefined && next.columnIndex !== undefined && previous.columnIndex !== next.columnIndex)
    ) {
      continue;
    }
    const previousText = previous.normalizedText.slice(Math.max(0, input.startOffset - previous.pageTextStart));
    const nextText = next.normalizedText.slice(0, input.endOffset - next.pageTextStart);
    const left = previousText.match(/([\p{L}]+)-$/u)?.[1];
    const right = nextText.match(/^([\p{Ll}]+)/u)?.[1];
    if (!left || !right) {
      continue;
    }
    const joined = new RegExp(`(?<![\\p{L}])${left}${right}(?![\\p{L}])`, "u");
    if (!joined.test(input.canonicalText)) {
      continue;
    }
    // Only repair a word proven to cross a hyphenated visual line boundary.
    // Normal spaces, isotope notation and mathematical symbols stay untouched.
    const split = new RegExp(`(?<![\\p{L}])${left}-?\\s+${right}(?![\\p{L}])`, "gu");
    text = text.replace(split, `${left}${right}`);
  }
  return text;
}

export interface PdfSelectionResolutionCandidate extends PdfCanonicalSelection {
  source: PdfTextQuoteSource;
  geometryAgreement: number;
  pointerAgreement: number;
}

export interface PdfSelectionPointerIntent {
  pageNumber: number;
  meaningful: boolean;
}

const SOURCE_SCORE: Record<PdfTextQuoteSource, number> = {
  "pdfium-native": 12,
  "validated-native-fallback": 10,
  "pdfjs-text-model": 8,
  "ocr-text-model": 6,
  "dom-selection": 2,
};

function clampAgreement(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function isCompletePdfSelectionCandidate(candidate: PdfSelectionResolutionCandidate): boolean {
  const exact = candidate.textQuote.exact.trim();
  return Boolean(
    Number.isInteger(candidate.pageNumber) &&
    candidate.pageNumber > 0 &&
    Number.isInteger(candidate.startOffset) &&
    Number.isInteger(candidate.endOffset) &&
    candidate.startOffset >= 0 &&
    candidate.endOffset > candidate.startOffset &&
    exact &&
    candidate.text.trim() &&
    candidate.pageRects.length > 0 &&
    candidate.viewportRects.length > 0 &&
    candidate.pageRects.every((rect) => (
      rect.x2 > rect.x1 &&
      rect.y2 > rect.y1
    )) &&
    candidate.viewportRects.every((rect) => (
      rect.pageNumber === candidate.pageNumber &&
      rect.width > 0 &&
      rect.height > 0
    ))
  );
}

function candidateMatchesPointerIntent(
  candidate: PdfSelectionResolutionCandidate,
  pointerIntent: PdfSelectionPointerIntent | undefined,
): boolean {
  if (!pointerIntent) {
    return true;
  }
  if (candidate.pageNumber !== pointerIntent.pageNumber) {
    return false;
  }
  if (!pointerIntent.meaningful) {
    return true;
  }

  return clampAgreement(candidate.pointerAgreement) >= 0.2 &&
    clampAgreement(candidate.geometryAgreement) >= 0.15;
}

function scorePdfSelectionCandidate(candidate: PdfSelectionResolutionCandidate): number {
  const geometryScore = clampAgreement(candidate.geometryAgreement) * 48;
  const pointerScore = clampAgreement(candidate.pointerAgreement) * 32;
  const confidenceScore = candidate.textQuote.confidence === "validated-native" ? 10 : 8;
  const sourceScore = SOURCE_SCORE[candidate.source] ?? 0;
  const sourceConsistencyScore = candidate.textQuote.source === candidate.source ? 2 : 0;
  return geometryScore + pointerScore + confidenceScore + sourceScore + sourceConsistencyScore;
}

export function choosePdfSelectionCandidate(input: {
  candidates: readonly PdfSelectionResolutionCandidate[];
  pointerIntent?: PdfSelectionPointerIntent;
}): PdfSelectionResolutionCandidate | null {
  let bestCandidate: PdfSelectionResolutionCandidate | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const candidate of input.candidates) {
    if (
      !isCompletePdfSelectionCandidate(candidate) ||
      !candidateMatchesPointerIntent(candidate, input.pointerIntent)
    ) {
      continue;
    }

    const score = scorePdfSelectionCandidate(candidate);
    if (score > bestScore) {
      bestCandidate = candidate;
      bestScore = score;
    }
  }

  return bestCandidate;
}
