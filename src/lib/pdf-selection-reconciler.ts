import type { BoundingBox, PdfTextQuote } from "@/types/universal-annotation";
import type {
  PdfNativePageTextLayout,
  PdfNativeTextChar,
} from "@/lib/pdf-native-text-engine";
import {
  buildRenderedPdfPageTextModel,
  normalizePdfText,
  resolvePdfPageTextOffset,
  type PdfPageTextModel,
} from "@/lib/pdf-page-text-cache";
import {
  buildPdfCanonicalChars,
  buildPdfRectsForOffsets,
  buildPdfReadableTextFromChars,
  buildPdfReadableTextForOffsets,
  type PdfCanonicalChar,
  resolvePdfPointerBoundary,
  type PdfCanonicalPointerBoundaryResult,
} from "@/lib/pdf-canonical-text-anchoring";
import {
  projectPdfSelectionRectsToPages,
  type PdfCanonicalSelection,
  type PdfSelectionClientRect,
} from "@/lib/pdf-selection-session";

const PDF_TEXT_CONTEXT_RADIUS = 32;
const PDF_SELECTION_MAX_TEXT_RECT_HEIGHT_RATIO = 0.12;
const PDF_SELECTION_MAX_TEXT_RECT_AREA_RATIO = 0.18;
const PDF_SELECTION_MAX_TEXT_RECT_LINE_MULTIPLIER = 3.5;
const PDF_LIGATURE_MAP: Record<string, string> = {
  "\u00a0": " ",
  "\ufb00": "ff",
  "\ufb01": "fi",
  "\ufb02": "fl",
  "\ufb03": "ffi",
  "\ufb04": "ffl",
  "\ufb05": "ft",
  "\ufb06": "st",
};
const NATIVE_MATCH_WINDOW_CHARS = 160;
const NATIVE_MAX_SELECTION_CHARS_FOR_FUZZY = 160;

export interface PdfRenderedPageContext {
  pageNumber: number;
  width: number;
  height: number;
  element: HTMLElement;
}

export type PdfResolvedSelection = PdfCanonicalSelection;

export type PdfSelectionResolutionFailureReason =
  | "cross-page"
  | "missing-page"
  | "missing-text-layer"
  | "unresolved-text";

export type PdfSelectionResolutionResult =
  | {
      ok: true;
      selection: PdfResolvedSelection;
    }
  | {
      ok: false;
      reason: PdfSelectionResolutionFailureReason;
      viewportRects: PdfCanonicalSelection["viewportRects"];
    };

interface PdfCompactOffsetModel {
  compactText: string;
  normalizedToCompact: number[];
  compactStartToNormalized: number[];
  compactEndToNormalized: number[];
}

interface PdfNativeNormalizedChar {
  sourceChar: PdfNativeTextChar;
  normalizedStart: number;
  normalizedEnd: number;
  text: string;
}

interface PdfNativeNormalizedModel {
  normalizedText: string;
  compact: PdfCompactOffsetModel;
  chars: PdfNativeNormalizedChar[];
}

interface PdfNativeViewportChar extends PdfNativeNormalizedChar {
  left: number;
  top: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
  centerX: number;
  centerY: number;
}

interface PdfVisualTextSlice {
  startOffset: number;
  endOffset: number;
  text: string;
  itemIndex: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  centerY: number;
  lineIndex?: number;
  blockIndex?: number;
  columnIndex?: number;
  layoutClass?: PdfPageTextModel["segments"][number]["layoutClass"];
}

type PdfViewportSelectableChar = Pick<
  PdfNativeViewportChar,
  "normalizedStart" | "normalizedEnd" | "left" | "top" | "width" | "height" | "right" | "bottom" | "centerX" | "centerY"
>;

type PdfRenderedViewportChar = PdfViewportSelectableChar & Pick<
  PdfCanonicalChar,
  "text" | "itemIndex" | "lineIndex" | "blockIndex" | "columnIndex" | "layoutClass"
>;

type PdfSelectionCandidateKind =
  | "dom"
  | "offset"
  | "geometry"
  | "textSearch"
  | "pointer";

interface PdfSelectionCandidateFeatures {
  selection: PdfResolvedSelection;
  kind: PdfSelectionCandidateKind;
  compact: string;
  length: number;
  distanceFromReference: number;
  overlap: number;
  boundaryDistance: number;
  exactReferenceMatch: boolean;
  containsReference: boolean;
  isContainedByReference: boolean;
}

function expandPdfLigatures(text: string): string {
  return Array.from(text ?? "", (character) => PDF_LIGATURE_MAP[character] ?? character).join("");
}

function normalizeComparablePdfText(text: string): string {
  return normalizePdfText(expandPdfLigatures(text));
}

function containsCjkText(text: string): boolean {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text);
}

function isCjkSameLengthTextConflict(left: string, right: string): boolean {
  const leftCompact = stripPdfWhitespace(normalizeComparablePdfText(left));
  const rightCompact = stripPdfWhitespace(normalizeComparablePdfText(right));
  return Boolean(
    leftCompact &&
    rightCompact &&
    leftCompact !== rightCompact &&
    leftCompact.length === rightCompact.length &&
    containsCjkText(leftCompact) &&
    containsCjkText(rightCompact),
  );
}

function findPdfPageElementForNode(node: Node | null | undefined): HTMLElement | null {
  if (!node) {
    return null;
  }

  if (node instanceof HTMLElement) {
    return node.closest<HTMLElement>("[data-page-number]");
  }

  return node.parentElement?.closest<HTMLElement>("[data-page-number]") ?? null;
}

function rangeToClientRects(range: Range): PdfSelectionClientRect[] {
  const rects = Array.from(range.getClientRects())
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .map((rect) => ({
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
    }));

  if (rects.length > 0) {
    return rects;
  }

  const boundingRect = range.getBoundingClientRect();
  if (boundingRect.width > 0 && boundingRect.height > 0) {
    return [{
      left: boundingRect.left,
      right: boundingRect.right,
      top: boundingRect.top,
      bottom: boundingRect.bottom,
    }];
  }

  return [];
}

function buildTextQuote(input: {
  pageText: string;
  startOffset: number;
  endOffset: number;
  exact?: string;
  source?: PdfTextQuote["source"];
  confidence?: PdfTextQuote["confidence"];
}): PdfTextQuote {
  const exact = normalizeComparablePdfText(input.exact ?? input.pageText.slice(input.startOffset, input.endOffset));

  return {
    exact,
    prefix: input.pageText.slice(Math.max(0, input.startOffset - PDF_TEXT_CONTEXT_RADIUS), input.startOffset),
    suffix: input.pageText.slice(input.endOffset, input.endOffset + PDF_TEXT_CONTEXT_RADIUS),
    source: input.source ?? "pdfjs-text-model",
    confidence: input.confidence ?? "exact",
  };
}

function buildReadablePdfSelectionText(input: {
  model?: PdfPageTextModel;
  startOffset: number;
  endOffset: number;
  viewportRects?: PdfCanonicalSelection["viewportRects"];
  pageNumber?: number;
  fallbackText: string;
}): string {
  if (!input.model) {
    return input.fallbackText;
  }

  const offsetChars = buildPdfCanonicalChars(input.model).filter((char) => (
    char.normalizedEnd > input.startOffset &&
    char.normalizedStart < input.endOffset
  ));
  const pageRects = typeof input.pageNumber === "number"
    ? normalizeViewportRects((input.viewportRects ?? []).filter((rect) => rect.pageNumber === input.pageNumber))
    : [];
  const geometryChars = pageRects.length > 0
    ? offsetChars.filter((char) => pageRects.some((rect) => intersectsViewportRect(char, rect)))
    : [];
  const readableText = geometryChars.length > 0
    ? buildPdfReadableTextFromChars(geometryChars, input.model.normalizedText)
    : buildPdfReadableTextForOffsets(input.model, input.startOffset, input.endOffset);

  return readableText ?? input.fallbackText;
}

function stripPdfWhitespace(text: string): string {
  return text.replace(/\s+/g, "");
}

function isSelectionWordBoundaryCharacter(character: string): boolean {
  return !character || !/[\p{L}\p{N}_-]/u.test(character);
}

function isSelectionTextAtWordBoundaries(baseText: string, subsetText: string): boolean {
  const base = normalizeComparablePdfText(baseText);
  const subset = normalizeComparablePdfText(subsetText);
  if (!base || !subset) {
    return false;
  }

  const start = base.indexOf(subset);
  if (start < 0) {
    return false;
  }

  const before = base[start - 1] ?? "";
  const after = base[start + subset.length] ?? "";
  return isSelectionWordBoundaryCharacter(before) && isSelectionWordBoundaryCharacter(after);
}

function isResolvedSelectionAtWordBoundaries(selection: PdfResolvedSelection, pageText: string): boolean {
  const before = pageText[selection.startOffset - 1] ?? "";
  const after = pageText[selection.endOffset] ?? "";
  return isSelectionWordBoundaryCharacter(before) && isSelectionWordBoundaryCharacter(after);
}

function isTrustworthyMultiLinePointerSelection(selection: PdfResolvedSelection): boolean {
  const compact = stripPdfWhitespace(normalizeComparablePdfText(selection.textQuote.exact));
  if (compact.length < 24 || selection.viewportRects.length < 2 || selection.pageRects.length < 2) {
    return false;
  }

  const maxRectWidth = Math.max(...selection.pageRects.map((rect) => rect.x2 - rect.x1));
  const maxRectHeight = Math.max(...selection.pageRects.map((rect) => rect.y2 - rect.y1));
  const maxRectArea = Math.max(...selection.pageRects.map((rect) => (
    Math.max(0, rect.x2 - rect.x1) * Math.max(0, rect.y2 - rect.y1)
  )));

  return maxRectWidth <= 0.72 && maxRectHeight <= 0.08 && maxRectArea <= 0.06;
}

function buildCompactOffsetModel(normalizedText: string): PdfCompactOffsetModel {
  const normalizedToCompact = new Array(normalizedText.length + 1).fill(0);
  const compactStartToNormalized: number[] = [];
  const compactEndToNormalized: number[] = [0];
  let compactText = "";
  let compactOffset = 0;

  for (let index = 0; index < normalizedText.length; index += 1) {
    normalizedToCompact[index] = compactOffset;
    const character = normalizedText[index];
    if (/\s/.test(character)) {
      continue;
    }

    compactStartToNormalized[compactOffset] = index;
    compactText += character;
    compactOffset += 1;
    compactEndToNormalized[compactOffset] = index + 1;
  }

  normalizedToCompact[normalizedText.length] = compactOffset;
  compactStartToNormalized[compactOffset] = normalizedText.length;

  return {
    compactText,
    normalizedToCompact,
    compactStartToNormalized,
    compactEndToNormalized,
  };
}

function buildNormalizedOffsetMap(text: string): {
  normalizedText: string;
  rawToNormalizedOffsets: number[];
} {
  const rawToNormalizedOffsets = new Array(text.length + 1).fill(0);
  let normalizedText = "";
  let sawNonWhitespace = false;
  let pendingWhitespaceStart: number | null = null;

  for (let index = 0; index < text.length; index += 1) {
    rawToNormalizedOffsets[index] = normalizedText.length;
    const expanded = expandPdfLigatures(text[index] ?? "");

    for (const character of expanded) {
      if (/\s/.test(character)) {
        if (sawNonWhitespace && pendingWhitespaceStart === null) {
          pendingWhitespaceStart = index;
        }
        rawToNormalizedOffsets[index + 1] = normalizedText.length;
        continue;
      }

      if (pendingWhitespaceStart !== null && normalizedText.length > 0 && !normalizedText.endsWith(" ")) {
        normalizedText += " ";
        for (let boundary = pendingWhitespaceStart + 1; boundary <= index; boundary += 1) {
          rawToNormalizedOffsets[boundary] = normalizedText.length;
        }
        pendingWhitespaceStart = null;
      }

      rawToNormalizedOffsets[index] = normalizedText.length;
      normalizedText += character;
      sawNonWhitespace = true;
      rawToNormalizedOffsets[index + 1] = normalizedText.length;
    }
  }

  rawToNormalizedOffsets[text.length] = normalizedText.length;
  if (pendingWhitespaceStart !== null) {
    for (let boundary = pendingWhitespaceStart + 1; boundary <= text.length; boundary += 1) {
      rawToNormalizedOffsets[boundary] = normalizedText.length;
    }
  }
  return {
    normalizedText,
    rawToNormalizedOffsets,
  };
}

function buildNativeTextModel(layout: PdfNativePageTextLayout): PdfNativeNormalizedModel {
  const { normalizedText, rawToNormalizedOffsets } = buildNormalizedOffsetMap(layout.text);
  const normalizedChars = [...layout.chars]
    .sort((left, right) => left.charIndex - right.charIndex)
    .map((sourceChar) => {
      const rawStart = Math.max(0, Math.min(layout.text.length, sourceChar.charIndex));
      const rawEndIndex = typeof sourceChar.charEndIndex === "number"
        ? sourceChar.charEndIndex
        : sourceChar.charIndex + sourceChar.text.length;
      const rawEnd = Math.max(rawStart, Math.min(layout.text.length, rawEndIndex));
      const normalizedStart = rawToNormalizedOffsets[rawStart] ?? 0;
      const normalizedEnd = rawToNormalizedOffsets[rawEnd] ?? normalizedStart;
      return {
        sourceChar,
        normalizedStart,
        normalizedEnd,
        text: normalizeComparablePdfText(sourceChar.text),
      } satisfies PdfNativeNormalizedChar;
    })
    .filter((character) => character.normalizedEnd > character.normalizedStart);

  return {
    normalizedText,
    compact: buildCompactOffsetModel(normalizedText),
    chars: normalizedChars,
  };
}

function resolveExactSelectionText(input: {
  selectedText: string;
  pageText: string;
  startOffset: number;
  endOffset: number;
}): { exact: string; source: PdfTextQuote["source"] } {
  const normalizedSelectedText = normalizeComparablePdfText(input.selectedText);
  const normalizedPageSlice = normalizeComparablePdfText(input.pageText.slice(input.startOffset, input.endOffset));

  if (!normalizedSelectedText) {
    return {
      exact: normalizedPageSlice,
      source: "pdfjs-text-model",
    };
  }

  if (!normalizedPageSlice) {
    return {
      exact: normalizedSelectedText,
      source: "dom-selection",
    };
  }

  if (stripPdfWhitespace(normalizedSelectedText) === stripPdfWhitespace(normalizedPageSlice)) {
    return {
      exact: normalizedSelectedText,
      source: "pdfjs-text-model",
    };
  }

  return {
    exact: normalizedSelectedText,
    source: "dom-selection",
  };
}

function findAllExactCompactMatches(haystack: string, needle: string): number[] {
  if (!needle) {
    return [];
  }

  const matches: number[] = [];
  let index = haystack.indexOf(needle);
  while (index >= 0) {
    matches.push(index);
    index = haystack.indexOf(needle, index + 1);
  }

  return matches;
}

function boundedLevenshteinDistance(left: string, right: string, maxDistance: number): number | null {
  const leftLength = left.length;
  const rightLength = right.length;

  if (Math.abs(leftLength - rightLength) > maxDistance) {
    return null;
  }

  const previous = new Array(rightLength + 1).fill(0);
  const current = new Array(rightLength + 1).fill(0);

  for (let j = 0; j <= rightLength; j += 1) {
    previous[j] = j;
  }

  for (let i = 1; i <= leftLength; i += 1) {
    current[0] = i;
    let rowMinimum = current[0];
    const leftChar = left[i - 1];

    for (let j = 1; j <= rightLength; j += 1) {
      const cost = leftChar === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost,
      );
      rowMinimum = Math.min(rowMinimum, current[j]);
    }

    if (rowMinimum > maxDistance) {
      return null;
    }

    for (let j = 0; j <= rightLength; j += 1) {
      previous[j] = current[j];
    }
  }

  return previous[rightLength] <= maxDistance ? previous[rightLength] : null;
}

function resolveNativeCompactMatch(input: {
  domPageText: string;
  domStartOffset: number;
  domEndOffset: number;
  nativeModel: PdfNativeNormalizedModel;
}): { compactStart: number; compactEnd: number } | null {
  const domCompactModel = buildCompactOffsetModel(input.domPageText);
  const compactStart = domCompactModel.normalizedToCompact[input.domStartOffset] ?? 0;
  const compactEnd = domCompactModel.normalizedToCompact[input.domEndOffset] ?? compactStart;
  const needle = domCompactModel.compactText.slice(compactStart, compactEnd);

  if (!needle) {
    return null;
  }

  const nativeCompactText = input.nativeModel.compact.compactText;
  const estimatedStart = Math.max(
    0,
    Math.min(
      nativeCompactText.length,
      Math.round((compactStart / Math.max(1, domCompactModel.compactText.length)) * nativeCompactText.length),
    ),
  );

  const exactMatches = findAllExactCompactMatches(nativeCompactText, needle);
  if (exactMatches.length > 0) {
    const nearestStart = exactMatches.reduce((best, candidate) => (
      Math.abs(candidate - estimatedStart) < Math.abs(best - estimatedStart) ? candidate : best
    ));
    return {
      compactStart: nearestStart,
      compactEnd: nearestStart + needle.length,
    };
  }

  if (needle.length > NATIVE_MAX_SELECTION_CHARS_FOR_FUZZY) {
    return null;
  }

  const maxDistance = Math.max(1, Math.min(6, Math.floor(needle.length * 0.12)));
  const windowStart = Math.max(0, estimatedStart - NATIVE_MATCH_WINDOW_CHARS);
  const windowEnd = Math.min(nativeCompactText.length, estimatedStart + needle.length + NATIVE_MATCH_WINDOW_CHARS);
  let bestMatch: { compactStart: number; compactEnd: number; distance: number } | null = null;

  for (let candidateStart = windowStart; candidateStart < windowEnd; candidateStart += 1) {
    for (let lengthDelta = -maxDistance; lengthDelta <= maxDistance; lengthDelta += 1) {
      const candidateLength = needle.length + lengthDelta;
      if (candidateLength <= 0) {
        continue;
      }

      const candidateEnd = candidateStart + candidateLength;
      if (candidateEnd > nativeCompactText.length) {
        continue;
      }

      const candidate = nativeCompactText.slice(candidateStart, candidateEnd);
      const distance = boundedLevenshteinDistance(candidate, needle, maxDistance);
      if (distance === null) {
        continue;
      }

      if (
        !bestMatch ||
        distance < bestMatch.distance ||
        (distance === bestMatch.distance && Math.abs(candidateStart - estimatedStart) < Math.abs(bestMatch.compactStart - estimatedStart))
      ) {
        bestMatch = {
          compactStart: candidateStart,
          compactEnd: candidateEnd,
          distance,
        };
      }
    }
  }

  if (!bestMatch) {
    return null;
  }

  return {
    compactStart: bestMatch.compactStart,
    compactEnd: bestMatch.compactEnd,
  };
}

function buildViewportRectsFromNativeChars(input: {
  nativeChars: PdfNativeNormalizedChar[];
  startOffset: number;
  endOffset: number;
  layout: PdfNativePageTextLayout;
  pageWidth: number;
  pageHeight: number;
  pageNumber: number;
}): PdfCanonicalSelection["viewportRects"] {
  const selectedRects = input.nativeChars
    .filter((character) => character.normalizedEnd > input.startOffset && character.normalizedStart < input.endOffset)
    .map((character) => ({
      left: (character.sourceChar.x1 / input.layout.width) * input.pageWidth,
      top: (character.sourceChar.y1 / input.layout.height) * input.pageHeight,
      width: ((character.sourceChar.x2 - character.sourceChar.x1) / input.layout.width) * input.pageWidth,
      height: ((character.sourceChar.y2 - character.sourceChar.y1) / input.layout.height) * input.pageHeight,
      pageNumber: input.pageNumber,
    }))
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .sort((left, right) => left.top - right.top || left.left - right.left);

  if (selectedRects.length === 0) {
    return [];
  }

  const averageHeight = selectedRects.reduce((sum, rect) => sum + rect.height, 0) / selectedRects.length;
  const lineTolerance = Math.max(4, averageHeight * 0.5);
  const gapTolerance = Math.max(24, averageHeight * 1.8);
  const merged: PdfCanonicalSelection["viewportRects"] = [];

  selectedRects.forEach((rect) => {
    const previous = merged[merged.length - 1];
    if (!previous) {
      merged.push({ ...rect });
      return;
    }

    const sameLine = Math.abs(previous.top - rect.top) <= lineTolerance;
    const gap = rect.left - (previous.left + previous.width);
    if (sameLine && gap <= gapTolerance) {
      const mergedLeft = Math.min(previous.left, rect.left);
      const mergedTop = Math.min(previous.top, rect.top);
      const mergedRight = Math.max(previous.left + previous.width, rect.left + rect.width);
      const mergedBottom = Math.max(previous.top + previous.height, rect.top + rect.height);
      previous.left = mergedLeft;
      previous.top = mergedTop;
      previous.width = mergedRight - mergedLeft;
      previous.height = mergedBottom - mergedTop;
      return;
    }

    merged.push({ ...rect });
  });

  return merged;
}

function buildNativeViewportChars(input: {
  nativeChars: PdfNativeNormalizedChar[];
  layout: PdfNativePageTextLayout;
  pageWidth: number;
  pageHeight: number;
}): PdfNativeViewportChar[] {
  return input.nativeChars
    .map((character) => {
      const left = (character.sourceChar.x1 / input.layout.width) * input.pageWidth;
      const top = (character.sourceChar.y1 / input.layout.height) * input.pageHeight;
      const width = ((character.sourceChar.x2 - character.sourceChar.x1) / input.layout.width) * input.pageWidth;
      const height = ((character.sourceChar.y2 - character.sourceChar.y1) / input.layout.height) * input.pageHeight;
      const right = left + width;
      const bottom = top + height;
      return {
        ...character,
        left,
        top,
        width,
        height,
        right,
        bottom,
        centerX: left + (width / 2),
        centerY: top + (height / 2),
      } satisfies PdfNativeViewportChar;
    })
    .filter((character) => character.width > 0 && character.height > 0);
}

function normalizeViewportRects(rects: PdfCanonicalSelection["viewportRects"]): PdfCanonicalSelection["viewportRects"] {
  return [...rects].sort((left, right) => (
    left.pageNumber - right.pageNumber ||
    left.top - right.top ||
    left.left - right.left
  ));
}

function getMedianPositive(values: number[]): number {
  const sorted = values
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right);
  if (sorted.length === 0) {
    return 0;
  }

  const middle = Math.floor(sorted.length / 2);
  const middleValue = sorted[middle] ?? 0;
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? middleValue) + middleValue) / 2
    : middleValue;
}

function isImplausibleTextSelectionViewportRect(input: {
  rect: PdfCanonicalSelection["viewportRects"][number];
  pageWidth: number;
  pageHeight: number;
  medianLineHeight: number;
}): boolean {
  const { rect, pageWidth, pageHeight, medianLineHeight } = input;
  const width = Math.max(0, rect.width);
  const height = Math.max(0, rect.height);
  if (width <= 0 || height <= 0 || pageWidth <= 0 || pageHeight <= 0) {
    return true;
  }

  const maxTextHeight = Math.max(
    pageHeight * PDF_SELECTION_MAX_TEXT_RECT_HEIGHT_RATIO,
    medianLineHeight > 0 ? medianLineHeight * PDF_SELECTION_MAX_TEXT_RECT_LINE_MULTIPLIER : 0,
    28,
  );
  const maxTextArea = pageWidth * pageHeight * PDF_SELECTION_MAX_TEXT_RECT_AREA_RATIO;
  return height > maxTextHeight || width * height > maxTextArea;
}

function filterImplausibleTextSelectionViewportRects(input: {
  viewportRects: PdfCanonicalSelection["viewportRects"];
  model: PdfPageTextModel;
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
}): {
  viewportRects: PdfCanonicalSelection["viewportRects"];
  removedCount: number;
  pageRectCount: number;
} {
  const medianLineHeight = getMedianPositive(input.model.itemRects.map((rect) => rect.height));
  let removedCount = 0;
  let pageRectCount = 0;
  const viewportRects = input.viewportRects.filter((rect) => {
    if (rect.pageNumber !== input.pageNumber) {
      return true;
    }

    pageRectCount += 1;
    if (isImplausibleTextSelectionViewportRect({
      rect,
      pageWidth: input.pageWidth,
      pageHeight: input.pageHeight,
      medianLineHeight,
    })) {
      removedCount += 1;
      return false;
    }
    return true;
  });

  return {
    viewportRects: normalizeViewportRects(viewportRects),
    removedCount,
    pageRectCount,
  };
}

type PdfRenderedViewportRectSlice = PdfCanonicalSelection["viewportRects"][number] & {
  lineIndex?: number;
  blockIndex?: number;
  startOffset: number;
  endOffset: number;
};

function shouldMergeRenderedViewportRectSlices(left: PdfRenderedViewportRectSlice, right: PdfRenderedViewportRectSlice): boolean {
  if (
    left.pageNumber !== right.pageNumber ||
    left.lineIndex !== right.lineIndex ||
    left.blockIndex !== right.blockIndex
  ) {
    return false;
  }

  const leftRight = left.left + left.width;
  const rightRight = right.left + right.width;
  const horizontalGap = right.left > leftRight
    ? right.left - leftRight
    : left.left > rightRight
      ? left.left - rightRight
      : 0;
  const leftCenterY = left.top + (left.height / 2);
  const rightCenterY = right.top + (right.height / 2);
  const minHeight = Math.min(left.height, right.height);
  const maxHeight = Math.max(left.height, right.height);
  const smallAttachment = minHeight <= maxHeight * 0.72;

  if (smallAttachment) {
    return (
      horizontalGap <= Math.max(10, maxHeight * 0.5) &&
      Math.abs(leftCenterY - rightCenterY) <= Math.max(14, maxHeight * 0.75)
    );
  }

  return (
    horizontalGap <= Math.max(12, minHeight * 0.6) &&
    Math.abs(leftCenterY - rightCenterY) <= Math.max(8, maxHeight * 0.4)
  );
}

function buildViewportRectsFromRenderedTextOffsets(input: {
  model: PdfPageTextModel;
  startOffset: number;
  endOffset: number;
  pageNumber: number;
}): PdfCanonicalSelection["viewportRects"] {
  const rectByItem = new Map(input.model.itemRects.map((rect) => [rect.itemIndex, rect]));
  const rects: PdfRenderedViewportRectSlice[] = [];

  input.model.segments.forEach((segment) => {
    const segmentStart = Math.max(input.startOffset, segment.pageTextStart);
    const segmentEnd = Math.min(input.endOffset, segment.pageTextEnd);
    if (segmentEnd <= segmentStart) {
      return;
    }

    const itemRect = rectByItem.get(segment.itemIndex);
    const segmentLength = segment.pageTextEnd - segment.pageTextStart;
    if (!itemRect || segmentLength <= 0 || itemRect.width <= 0 || itemRect.height <= 0) {
      return;
    }

    const startRatio = Math.max(0, Math.min(1, (segmentStart - segment.pageTextStart) / segmentLength));
    const endRatio = Math.max(startRatio, Math.min(1, (segmentEnd - segment.pageTextStart) / segmentLength));
    const width = itemRect.width * (endRatio - startRatio);
    if (width <= 0) {
      return;
    }

    rects.push({
      left: itemRect.left + (itemRect.width * startRatio),
      top: itemRect.top,
      width,
      height: itemRect.height,
      pageNumber: input.pageNumber,
      lineIndex: segment.lineIndex,
      blockIndex: segment.blockIndex,
      startOffset: segmentStart,
      endOffset: segmentEnd,
    });
  });

  const mergedRects = [...rects]
    .sort((left, right) => (
      (left.lineIndex ?? 0) - (right.lineIndex ?? 0) ||
      (left.blockIndex ?? 0) - (right.blockIndex ?? 0) ||
      left.startOffset - right.startOffset ||
      left.left - right.left
    ))
    .reduce<PdfRenderedViewportRectSlice[]>((merged, rect) => {
      const previous = merged[merged.length - 1];
      if (previous && shouldMergeRenderedViewportRectSlices(previous, rect)) {
        const rightEdge = Math.max(previous.left + previous.width, rect.left + rect.width);
        const bottomEdge = Math.max(previous.top + previous.height, rect.top + rect.height);
        previous.left = Math.min(previous.left, rect.left);
        previous.top = Math.min(previous.top, rect.top);
        previous.width = rightEdge - previous.left;
        previous.height = bottomEdge - previous.top;
        previous.endOffset = Math.max(previous.endOffset, rect.endOffset);
        return merged;
      }
      merged.push({ ...rect });
      return merged;
    }, []);

  return normalizeViewportRects(mergedRects.map((rect) => ({
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    pageNumber: rect.pageNumber,
  })));
}

function comparePointerBoundariesByVisualOrder(
  left: PdfCanonicalPointerBoundaryResult,
  right: PdfCanonicalPointerBoundaryResult,
): number {
  if (
    typeof left.lineIndex === "number" &&
    typeof right.lineIndex === "number" &&
    left.lineIndex !== right.lineIndex
  ) {
    return left.lineIndex - right.lineIndex;
  }

  return left.offset - right.offset;
}

function buildRenderedSelectionFromVisualBoundaries(input: {
  model: PdfPageTextModel;
  startBoundary: PdfCanonicalPointerBoundaryResult;
  endBoundary: PdfCanonicalPointerBoundaryResult;
  startOffset: number;
  endOffset: number;
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
}): PdfResolvedSelection | null {
  if (
    typeof input.startBoundary.lineIndex !== "number" ||
    typeof input.endBoundary.lineIndex !== "number"
  ) {
    return null;
  }

  const [firstBoundary, lastBoundary] = comparePointerBoundariesByVisualOrder(input.startBoundary, input.endBoundary) <= 0
    ? [input.startBoundary, input.endBoundary]
    : [input.endBoundary, input.startBoundary];
  const firstLineIndex = firstBoundary.lineIndex;
  const lastLineIndex = lastBoundary.lineIndex;
  if (typeof firstLineIndex !== "number" || typeof lastLineIndex !== "number") {
    return null;
  }

  const preferredLayoutClass = firstBoundary.layoutClass;
  const preferredBlockIndex = firstBoundary.blockIndex;
  const preferredColumnIndex = firstBoundary.columnIndex;
  const rectByItem = new Map(input.model.itemRects.map((rect) => [rect.itemIndex, rect]));
  const slices: PdfRenderedViewportRectSlice[] = [];

  input.model.segments.forEach((segment) => {
    const lineIndex = segment.lineIndex;
    if (typeof lineIndex !== "number" || lineIndex < firstLineIndex || lineIndex > lastLineIndex) {
      return;
    }
    if ((segment.layoutClass ?? "main") !== preferredLayoutClass) {
      return;
    }
    if (typeof preferredColumnIndex === "number" && segment.columnIndex !== preferredColumnIndex) {
      return;
    }
    if (typeof preferredBlockIndex === "number" && segment.blockIndex !== preferredBlockIndex) {
      return;
    }

    const itemRect = rectByItem.get(segment.itemIndex);
    const segmentLength = segment.pageTextEnd - segment.pageTextStart;
    if (!itemRect || segmentLength <= 0 || itemRect.width <= 0 || itemRect.height <= 0) {
      return;
    }

    let segmentStart = segment.pageTextStart;
    let segmentEnd = segment.pageTextEnd;
    if (lineIndex === firstLineIndex) {
      segmentStart = Math.max(segmentStart, firstBoundary.offset);
    }
    if (lineIndex === lastLineIndex) {
      segmentEnd = Math.min(segmentEnd, lastBoundary.offset);
    }
    segmentStart = Math.max(segmentStart, input.startOffset);
    segmentEnd = Math.min(segmentEnd, input.endOffset);
    if (segmentEnd <= segmentStart) {
      return;
    }

    const startRatio = Math.max(0, Math.min(1, (segmentStart - segment.pageTextStart) / segmentLength));
    const endRatio = Math.max(startRatio, Math.min(1, (segmentEnd - segment.pageTextStart) / segmentLength));
    const left = itemRect.left + (itemRect.width * startRatio);
    const right = itemRect.left + (itemRect.width * endRatio);
    if (right <= left) {
      return;
    }

    slices.push({
      left,
      top: itemRect.top,
      width: right - left,
      height: itemRect.height,
      pageNumber: input.pageNumber,
      lineIndex,
      blockIndex: segment.blockIndex,
      startOffset: segmentStart,
      endOffset: segmentEnd,
    });
  });

  if (slices.length === 0) {
    return null;
  }

  const orderedSlices = [...slices].sort((left, right) => (
    (left.lineIndex ?? 0) - (right.lineIndex ?? 0) ||
    left.left - right.left ||
    left.startOffset - right.startOffset
  ));
  const selectedText = orderedSlices
    .map((slice) => input.model.normalizedText.slice(slice.startOffset, slice.endOffset))
    .join(" ");
  if (!stripPdfWhitespace(normalizeComparablePdfText(selectedText))) {
    return null;
  }

  const mergedRects = orderedSlices
    .reduce<PdfRenderedViewportRectSlice[]>((merged, rect) => {
      const previous = merged[merged.length - 1];
      if (previous && shouldMergeRenderedViewportRectSlices(previous, rect)) {
        const rightEdge = Math.max(previous.left + previous.width, rect.left + rect.width);
        const bottomEdge = Math.max(previous.top + previous.height, rect.top + rect.height);
        previous.left = Math.min(previous.left, rect.left);
        previous.top = Math.min(previous.top, rect.top);
        previous.width = rightEdge - previous.left;
        previous.height = bottomEdge - previous.top;
        previous.endOffset = Math.max(previous.endOffset, rect.endOffset);
        return merged;
      }
      merged.push({ ...rect });
      return merged;
    }, []);

  return buildResolvedSelectionFromOffsets({
    pageNumber: input.pageNumber,
    pageText: input.model.normalizedText,
    startOffset: Math.min(...orderedSlices.map((slice) => slice.startOffset)),
    endOffset: Math.max(...orderedSlices.map((slice) => slice.endOffset)),
    viewportRects: normalizeViewportRects(mergedRects.map((rect) => ({
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      pageNumber: rect.pageNumber,
    }))),
    pageWidth: input.pageWidth,
    pageHeight: input.pageHeight,
    selectedText,
    model: input.model,
    source: "pdfjs-text-model",
    confidence: "exact",
  });
}

function clampRatio(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function hasMeaningfulDrag(input: {
  dragStartPoint?: { x: number; y: number };
  dragEndPoint?: { x: number; y: number };
}): input is {
  dragStartPoint: { x: number; y: number };
  dragEndPoint: { x: number; y: number };
} {
  if (!input.dragStartPoint || !input.dragEndPoint) {
    return false;
  }

  const dx = input.dragEndPoint.x - input.dragStartPoint.x;
  const dy = input.dragEndPoint.y - input.dragStartPoint.y;
  return Math.hypot(dx, dy) >= 3;
}

function constrainViewportRectsToDragBounds(input: {
  viewportRects: PdfCanonicalSelection["viewportRects"];
  pageElement: HTMLElement;
  pageNumber: number;
  dragStartPoint?: { x: number; y: number };
  dragEndPoint?: { x: number; y: number };
  preserveLineEdges?: boolean;
}): PdfCanonicalSelection["viewportRects"] {
  if (!hasMeaningfulDrag(input) || input.viewportRects.length === 0) {
    return input.viewportRects;
  }

  const pageRect = input.pageElement.getBoundingClientRect();
  if (pageRect.width <= 0 || pageRect.height <= 0) {
    return input.viewportRects;
  }

  const start = {
    x: input.dragStartPoint.x - pageRect.left,
    y: input.dragStartPoint.y - pageRect.top,
  };
  const end = {
    x: input.dragEndPoint.x - pageRect.left,
    y: input.dragEndPoint.y - pageRect.top,
  };
  const isForward = start.y < end.y || (Math.abs(start.y - end.y) <= 2 && start.x <= end.x);
  const first = isForward ? start : end;
  const last = isForward ? end : start;
  const toleranceY = Math.max(3, pageRect.height * 0.003);
  const lineRects = input.viewportRects.filter((rect) => rect.pageNumber === input.pageNumber);
  const startLineRects = lineRects.filter((rect) => (
    start.y >= rect.top - toleranceY &&
    start.y <= rect.top + rect.height + toleranceY
  ));
  const endLineRects = lineRects.filter((rect) => (
    end.y >= rect.top - toleranceY &&
    end.y <= rect.top + rect.height + toleranceY
  ));
  const startColumnRect = startLineRects
    .filter((rect) => start.x >= rect.left - Math.max(8, rect.height) && start.x <= rect.left + rect.width + Math.max(8, rect.height))
    .sort((left, right) => (
      Math.abs((left.left + left.width / 2) - start.x) - Math.abs((right.left + right.width / 2) - start.x)
    ))[0] ?? null;
  const endColumnRect = endLineRects
    .filter((rect) => end.x >= rect.left - Math.max(8, rect.height) && end.x <= rect.left + rect.width + Math.max(8, rect.height))
    .sort((left, right) => (
      Math.abs((left.left + left.width / 2) - end.x) - Math.abs((right.left + right.width / 2) - end.x)
    ))[0] ?? null;
  const columnLeft = startColumnRect && endColumnRect
    ? Math.min(startColumnRect.left, endColumnRect.left)
    : null;
  const columnRight = startColumnRect && endColumnRect
    ? Math.max(startColumnRect.left + startColumnRect.width, endColumnRect.left + endColumnRect.width)
    : null;
  const columnToleranceX = Math.max(10, pageRect.width * 0.025);

  const constrained = input.viewportRects
    .map((rect) => {
      if (rect.pageNumber !== input.pageNumber) {
        return rect;
      }

      const rectBottom = rect.top + rect.height;
      if (rectBottom < first.y - toleranceY || rect.top > last.y + toleranceY) {
        return null;
      }

      let left = rect.left;
      let right = rect.left + rect.width;
      const overlapsFirstLine = first.y >= rect.top - toleranceY && first.y <= rectBottom + toleranceY;
      const overlapsLastLine = last.y >= rect.top - toleranceY && last.y <= rectBottom + toleranceY;
      if (
        columnLeft !== null &&
        columnRight !== null &&
        !overlapsFirstLine &&
        !overlapsLastLine
      ) {
        const clippedLeft = Math.max(left, columnLeft - columnToleranceX);
        const clippedRight = Math.min(right, columnRight + columnToleranceX);
        if (clippedRight <= clippedLeft) {
          return null;
        }
        left = clippedLeft;
        right = clippedRight;
      }
      if (!input.preserveLineEdges && overlapsFirstLine) {
        left = Math.max(left, first.x);
      }
      if (!input.preserveLineEdges && overlapsLastLine) {
        right = Math.min(right, last.x);
      }
      if (right <= left) {
        return null;
      }

      return {
        ...rect,
        left,
        width: right - left,
      };
    })
    .filter((rect): rect is PdfCanonicalSelection["viewportRects"][number] => Boolean(rect));

  return constrained.length > 0 ? normalizeViewportRects(constrained) : input.viewportRects;
}

function resolveSegmentForOffset(
  model: PdfPageTextModel,
  offset: number,
): PdfPageTextModel["segments"][number] | null {
  const clampedOffset = Math.max(0, Math.min(model.normalizedText.length, offset));
  return model.segments.find((segment) => (
    segment.pageTextStart <= clampedOffset &&
    segment.pageTextEnd > clampedOffset
  )) ?? model.segments.find((segment) => segment.pageTextEnd === clampedOffset) ?? null;
}

function constrainViewportRectsToBoundaryTextColumn(input: {
  viewportRects: PdfCanonicalSelection["viewportRects"];
  model: PdfPageTextModel;
  pageNumber: number;
  startOffset: number;
  endOffset: number;
}): PdfCanonicalSelection["viewportRects"] {
  const pageRects = input.viewportRects.filter((rect) => rect.pageNumber === input.pageNumber);
  if (pageRects.length <= 2) {
    return input.viewportRects;
  }

  const startSegment = resolveSegmentForOffset(input.model, input.startOffset);
  const endSegment = resolveSegmentForOffset(input.model, Math.max(input.startOffset, input.endOffset - 1));
  const itemRectMap = new Map(input.model.itemRects.map((rect) => [rect.itemIndex, rect]));
  const startRect = startSegment ? itemRectMap.get(startSegment.itemIndex) : null;
  const endRect = endSegment ? itemRectMap.get(endSegment.itemIndex) : null;
  if (!startRect || !endRect) {
    return input.viewportRects;
  }

  const startColumn = startSegment?.columnIndex;
  const endColumn = endSegment?.columnIndex;
  const sameKnownColumn = (
    typeof startColumn === "number" &&
    startColumn === endColumn
  );
  const startCenterX = startRect.left + (startRect.width / 2);
  const endCenterX = endRect.left + (endRect.width / 2);
  const pageCenterX = input.model.viewportWidth / 2;
  const sameSideOfPage = (
    input.model.viewportWidth > 0 &&
    (
      (startCenterX < pageCenterX && endCenterX < pageCenterX) ||
      (startCenterX > pageCenterX && endCenterX > pageCenterX)
    )
  );
  if (!sameKnownColumn && !sameSideOfPage) {
    return input.viewportRects;
  }

  let columnLeft = Math.min(startRect.left, endRect.left);
  let columnRight = Math.max(startRect.left + startRect.width, endRect.left + endRect.width);
  if (sameKnownColumn) {
    input.model.segments.forEach((segment) => {
      if (segment.columnIndex !== startColumn) {
        return;
      }
      const rect = itemRectMap.get(segment.itemIndex);
      if (!rect) {
        return;
      }
      columnLeft = Math.min(columnLeft, rect.left);
      columnRight = Math.max(columnRight, rect.left + rect.width);
    });
  }

  const toleranceX = Math.max(10, input.model.viewportWidth * 0.025);
  const filtered = input.viewportRects.filter((rect) => {
    if (rect.pageNumber !== input.pageNumber) {
      return true;
    }
    const centerX = rect.left + (rect.width / 2);
    return centerX >= columnLeft - toleranceX && centerX <= columnRight + toleranceX;
  });

  const filteredPageRects = filtered.filter((rect) => rect.pageNumber === input.pageNumber);
  return filteredPageRects.length > 0 ? normalizeViewportRects(filtered) : input.viewportRects;
}

function viewportRectsVerticallyOverlap(
  left: Pick<PdfCanonicalSelection["viewportRects"][number], "top" | "height">,
  right: Pick<PdfCanonicalSelection["viewportRects"][number], "top" | "height">,
): boolean {
  const overlap = Math.min(left.top + left.height, right.top + right.height) - Math.max(left.top, right.top);
  if (overlap <= 0) {
    return false;
  }
  return overlap >= Math.min(left.height, right.height) * 0.35;
}

function getViewportRectIntersection(
  left: Pick<PdfCanonicalSelection["viewportRects"][number], "left" | "top" | "width" | "height">,
  right: Pick<PdfCanonicalSelection["viewportRects"][number], "left" | "top" | "width" | "height">,
): { left: number; top: number; right: number; bottom: number; width: number; height: number } | null {
  const intersectionLeft = Math.max(left.left, right.left);
  const intersectionTop = Math.max(left.top, right.top);
  const intersectionRight = Math.min(left.left + left.width, right.left + right.width);
  const intersectionBottom = Math.min(left.top + left.height, right.top + right.height);
  const width = intersectionRight - intersectionLeft;
  const height = intersectionBottom - intersectionTop;
  if (width <= 0 || height <= 0) {
    return null;
  }

  return {
    left: intersectionLeft,
    top: intersectionTop,
    right: intersectionRight,
    bottom: intersectionBottom,
    width,
    height,
  };
}

function normalizeVisualTextSlices(slices: PdfVisualTextSlice[]): PdfVisualTextSlice[] {
  const sorted = [...slices].sort((left, right) => (
    (left.blockIndex ?? 0) - (right.blockIndex ?? 0) ||
    (left.lineIndex ?? 0) - (right.lineIndex ?? 0) ||
    left.top - right.top ||
    left.left - right.left ||
    left.startOffset - right.startOffset
  ));
  const merged: PdfVisualTextSlice[] = [];

  for (const slice of sorted) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      (previous.blockIndex ?? 0) === (slice.blockIndex ?? 0) &&
      Math.abs((previous.lineIndex ?? 0) - (slice.lineIndex ?? 0)) <= 1 &&
      slice.startOffset <= previous.endOffset &&
      Math.abs(slice.centerY - previous.centerY) <= Math.max(2, (previous.bottom - previous.top) * 0.45)
    ) {
      previous.endOffset = Math.max(previous.endOffset, slice.endOffset);
      previous.text = "";
      previous.left = Math.min(previous.left, slice.left);
      previous.top = Math.min(previous.top, slice.top);
      previous.right = Math.max(previous.right, slice.right);
      previous.bottom = Math.max(previous.bottom, slice.bottom);
      previous.centerY = (previous.top + previous.bottom) / 2;
      previous.lineIndex = Math.min(previous.lineIndex ?? slice.lineIndex ?? 0, slice.lineIndex ?? previous.lineIndex ?? 0);
      continue;
    }

    merged.push({ ...slice });
  }

  return merged;
}

const RENDERED_LAYOUT_PRIORITY: Record<NonNullable<PdfVisualTextSlice["layoutClass"]>, number> = {
  main: 0,
  list: 1,
  caption: 2,
  footnote: 3,
  metadata: 4,
  auxiliary: 5,
  equation: 6,
  sidebar: 7,
};

function resolveRenderedSelectionFromViewportRects(input: {
  model: PdfPageTextModel;
  viewportRects: PdfCanonicalSelection["viewportRects"];
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
}): PdfResolvedSelection | null {
  const sortedRects = normalizeViewportRects(
    input.viewportRects.filter((rect) => rect.pageNumber === input.pageNumber),
  );
  if (sortedRects.length === 0) {
    return null;
  }

  const rectByItem = new Map(input.model.itemRects.map((rect) => [rect.itemIndex, rect]));
  const canonicalChars = buildPdfCanonicalChars(input.model);
  const slices: PdfVisualTextSlice[] = [];

  const pushCharSlice = (
    selectionRect: PdfCanonicalSelection["viewportRects"][number],
    chars: PdfRenderedViewportChar[],
  ): boolean => {
    const visibleChars = chars
      .filter((character) => intersectsViewportRect(character, selectionRect))
      .sort((left, right) => left.normalizedStart - right.normalizedStart);
    if (visibleChars.length === 0) {
      return false;
    }

    const startChar = selectBoundaryChar({
      chars: visibleChars,
      rect: selectionRect,
      side: "start",
    });
    const endChar = selectBoundaryChar({
      chars: visibleChars,
      rect: selectionRect,
      side: "end",
    });
    const startOffset = Math.min(startChar.normalizedStart, endChar.normalizedStart);
    const endOffset = Math.max(startChar.normalizedEnd, endChar.normalizedEnd);
    if (endOffset <= startOffset) {
      return false;
    }

    const boundedChars = visibleChars.filter((character) => (
      character.normalizedEnd > startOffset && character.normalizedStart < endOffset
    ));
    if (boundedChars.length === 0) {
      return false;
    }

    const firstChar = boundedChars[0];
    slices.push({
      startOffset,
      endOffset,
      text: input.model.normalizedText.slice(startOffset, endOffset),
      itemIndex: firstChar.itemIndex,
      left: Math.max(Math.min(...boundedChars.map((character) => character.left)), selectionRect.left),
      top: Math.max(Math.min(...boundedChars.map((character) => character.top)), selectionRect.top),
      right: Math.min(
        Math.max(...boundedChars.map((character) => character.right)),
        selectionRect.left + selectionRect.width,
      ),
      bottom: Math.min(
        Math.max(...boundedChars.map((character) => character.bottom)),
        selectionRect.top + selectionRect.height,
      ),
      centerY: boundedChars.reduce((sum, character) => sum + character.centerY, 0) / boundedChars.length,
      lineIndex: firstChar.lineIndex,
      blockIndex: firstChar.blockIndex,
      columnIndex: firstChar.columnIndex,
      layoutClass: firstChar.layoutClass,
    });
    return true;
  };

  for (const segment of input.model.segments) {
    const itemRect = rectByItem.get(segment.itemIndex);
    const segmentLength = segment.pageTextEnd - segment.pageTextStart;
    if (!itemRect || itemRect.width <= 0 || itemRect.height <= 0 || segmentLength <= 0) {
      continue;
    }

    for (const selectionRect of sortedRects) {
      const intersection = getViewportRectIntersection(itemRect, selectionRect);
      if (!intersection) {
        continue;
      }

      const verticalOverlapRatio = intersection.height / Math.min(itemRect.height, selectionRect.height);
      const horizontalOverlapRatio = intersection.width / Math.min(itemRect.width, selectionRect.width);
      if (verticalOverlapRatio < 0.35 || horizontalOverlapRatio < 0.02) {
        continue;
      }

      const segmentChars = canonicalChars.filter((character) => character.itemIndex === segment.itemIndex);
      if (segmentChars.length > 0 && pushCharSlice(selectionRect, segmentChars)) {
        continue;
      }

      const selectionLeft = clampRatio((selectionRect.left - itemRect.left) / itemRect.width);
      const selectionRight = clampRatio(((selectionRect.left + selectionRect.width) - itemRect.left) / itemRect.width);
      if (selectionRight <= selectionLeft) {
        continue;
      }

      const segmentStartOffset = segment.pageTextStart + Math.floor(selectionLeft * segmentLength);
      const segmentEndOffset = segment.pageTextStart + Math.ceil(selectionRight * segmentLength);
      if (segmentEndOffset <= segmentStartOffset) {
        continue;
      }

      const segmentLeft = itemRect.left + (
        itemRect.width * ((segmentStartOffset - segment.pageTextStart) / segmentLength)
      );
      const segmentRight = itemRect.left + (
        itemRect.width * ((segmentEndOffset - segment.pageTextStart) / segmentLength)
      );
      if (segmentRight <= segmentLeft) {
        continue;
      }

      slices.push({
        startOffset: segmentStartOffset,
        endOffset: segmentEndOffset,
        text: input.model.normalizedText.slice(segmentStartOffset, segmentEndOffset),
        itemIndex: segment.itemIndex,
        left: Math.max(segmentLeft, intersection.left),
        top: intersection.top,
        right: Math.min(segmentRight, intersection.right),
        bottom: intersection.bottom,
        centerY: (intersection.top + intersection.bottom) / 2,
        lineIndex: segment.lineIndex,
        blockIndex: segment.blockIndex,
        columnIndex: segment.columnIndex,
        layoutClass: segment.layoutClass,
      });
    }
  }

  const visualSlices = normalizeVisualTextSlices(slices)
    .map((slice) => ({
      ...slice,
      text: input.model.normalizedText.slice(slice.startOffset, slice.endOffset),
    }))
    .filter((slice) => normalizeComparablePdfText(slice.text).length > 0);
  if (visualSlices.length === 0) {
    return null;
  }

  const dominantLayout = visualSlices.reduce((best, slice) => {
    const layoutClass = slice.layoutClass ?? "main";
    const weight = slice.endOffset - slice.startOffset;
    best.set(layoutClass, (best.get(layoutClass) ?? 0) + weight);
    return best;
  }, new Map<NonNullable<PdfVisualTextSlice["layoutClass"]>, number>());
  const preferredLayoutClass = [...dominantLayout.entries()]
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }
      return RENDERED_LAYOUT_PRIORITY[left[0]] - RENDERED_LAYOUT_PRIORITY[right[0]];
    })[0]?.[0];
  const layoutFilteredSlices = preferredLayoutClass
    ? visualSlices.filter((slice) => (slice.layoutClass ?? "main") === preferredLayoutClass)
    : visualSlices;
  if (layoutFilteredSlices.length === 0) {
    return null;
  }

  const dominantBlock = layoutFilteredSlices.reduce((best, slice) => {
    const blockIndex = slice.blockIndex ?? 0;
    const weight = slice.endOffset - slice.startOffset;
    const current = best.get(blockIndex) ?? 0;
    best.set(blockIndex, current + weight);
    return best;
  }, new Map<number, number>());
  const preferredBlockIndex = [...dominantBlock.entries()]
    .sort((left, right) => right[1] - left[1])[0]?.[0];
  const blockFilteredSlices = typeof preferredBlockIndex === "number"
    ? layoutFilteredSlices.filter((slice) => (slice.blockIndex ?? 0) === preferredBlockIndex)
    : layoutFilteredSlices;
  const dominantColumn = blockFilteredSlices.reduce((best, slice) => {
    if (typeof slice.columnIndex !== "number") {
      return best;
    }
    best.set(slice.columnIndex, (best.get(slice.columnIndex) ?? 0) + (slice.endOffset - slice.startOffset));
    return best;
  }, new Map<number, number>());
  const preferredColumnIndex = [...dominantColumn.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
  const filteredVisualSlices = typeof preferredColumnIndex === "number"
    ? blockFilteredSlices.filter((slice) => slice.columnIndex === preferredColumnIndex)
    : blockFilteredSlices;
  if (filteredVisualSlices.length === 0) {
    return null;
  }

  const startOffset = Math.min(...filteredVisualSlices.map((slice) => slice.startOffset));
  const endOffset = Math.max(...filteredVisualSlices.map((slice) => slice.endOffset));
  const selectedText = filteredVisualSlices
    .map((slice) => slice.text)
    .join(" ");
  const visualViewportRects = normalizeViewportRects(
    filteredVisualSlices
      .map((slice) => {
        const itemRect = rectByItem.get(slice.itemIndex);
        const heightTop = itemRect ? Math.max(itemRect.top, slice.top) : slice.top;
        const heightBottom = itemRect ? Math.min(itemRect.top + itemRect.height, slice.bottom) : slice.bottom;
        return {
          left: slice.left,
          top: heightTop,
          width: slice.right - slice.left,
          height: heightBottom - heightTop,
          pageNumber: input.pageNumber,
        };
      })
      .filter((rect) => rect.width > 0 && rect.height > 0),
  );

  return buildResolvedSelectionFromOffsets({
    pageNumber: input.pageNumber,
    pageText: input.model.normalizedText,
    startOffset,
    endOffset,
    viewportRects: visualViewportRects.length > 0 ? visualViewportRects : sortedRects,
    pageWidth: input.pageWidth,
    pageHeight: input.pageHeight,
    selectedText,
    model: input.model,
    source: "pdfjs-text-model",
    confidence: "exact",
  });
}

function getPdfCharRectDistance(
  char: Pick<PdfCanonicalChar, "left" | "right" | "top" | "bottom">,
  point: { x: number; y: number },
): number {
  const dx = point.x < char.left
    ? char.left - point.x
    : point.x > char.right
      ? point.x - char.right
      : 0;
  const dy = point.y < char.top
    ? char.top - point.y
    : point.y > char.bottom
      ? point.y - char.bottom
      : 0;
  return Math.hypot(dx, dy);
}

function compareZoteroPointerChars(left: PdfCanonicalChar, right: PdfCanonicalChar): number {
  const layoutDiff = RENDERED_LAYOUT_PRIORITY[left.layoutClass] - RENDERED_LAYOUT_PRIORITY[right.layoutClass];
  if (layoutDiff !== 0) {
    return layoutDiff;
  }

  return (
    (left.blockIndex ?? 0) - (right.blockIndex ?? 0) ||
    (left.columnIndex ?? 0) - (right.columnIndex ?? 0) ||
    (left.lineIndex ?? 0) - (right.lineIndex ?? 0) ||
    left.left - right.left ||
    left.normalizedStart - right.normalizedStart
  );
}

function resolveZoteroPointerCharOffset(input: {
  chars: PdfCanonicalChar[];
  point: { x: number; y: number };
  side: "start" | "end";
}): { offset: number; char: PdfCanonicalChar } | null {
  if (input.chars.length === 0) {
    return null;
  }

  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  input.chars.forEach((char, index) => {
    const distance = getPdfCharRectDistance(char, input.point);
    if (
      distance < bestDistance ||
      (
        distance === bestDistance &&
        Math.abs(char.centerY - input.point.y) < Math.abs(input.chars[bestIndex].centerY - input.point.y)
      )
    ) {
      bestDistance = distance;
      bestIndex = index;
    }
  });

  const char = input.chars[bestIndex];
  const midpoint = char.left + (char.width / 2);
  let offset = bestIndex;
  if (input.point.x > midpoint) {
    offset += 1;
  }

  return {
    offset: Math.max(0, Math.min(input.chars.length, offset)),
    char,
  };
}

function buildViewportRectsFromZoteroPointerChars(input: {
  chars: PdfCanonicalChar[];
  pageNumber: number;
}): PdfCanonicalSelection["viewportRects"] {
  const lineRects = input.chars
    .filter((char) => !/^\s$/.test(char.text))
    .reduce<Array<{
      left: number;
      top: number;
      right: number;
      bottom: number;
      lineIndex?: number;
      blockIndex?: number;
      columnIndex?: number;
      layoutClass: PdfCanonicalChar["layoutClass"];
    }>>((rects, char) => {
      const previous = rects[rects.length - 1];
      if (
        previous &&
        previous.layoutClass === char.layoutClass &&
        previous.blockIndex === char.blockIndex &&
        previous.columnIndex === char.columnIndex &&
        previous.lineIndex === char.lineIndex
      ) {
        previous.left = Math.min(previous.left, char.left);
        previous.top = Math.min(previous.top, char.top);
        previous.right = Math.max(previous.right, char.right);
        previous.bottom = Math.max(previous.bottom, char.bottom);
        return rects;
      }

      rects.push({
        left: char.left,
        top: char.top,
        right: char.right,
        bottom: char.bottom,
        lineIndex: char.lineIndex,
        blockIndex: char.blockIndex,
        columnIndex: char.columnIndex,
        layoutClass: char.layoutClass,
      });
      return rects;
    }, []);

  return normalizeViewportRects(lineRects
    .map((rect) => ({
      left: rect.left,
      top: rect.top,
      width: rect.right - rect.left,
      height: rect.bottom - rect.top,
      pageNumber: input.pageNumber,
    }))
    .filter((rect) => rect.width > 0 && rect.height > 0));
}

function isPdfCharCenterInsideViewportRect(
  char: Pick<PdfCanonicalChar, "centerX" | "centerY" | "height">,
  rect: PdfCanonicalSelection["viewportRects"][number],
): boolean {
  const tolerance = Math.max(1.5, Math.min(6, char.height * 0.18));
  return (
    char.centerX >= rect.left - tolerance &&
    char.centerX <= rect.left + rect.width + tolerance &&
    char.centerY >= rect.top - tolerance &&
    char.centerY <= rect.top + rect.height + tolerance
  );
}

function filterZoteroCharsToDominantVisualScope(chars: PdfCanonicalChar[]): PdfCanonicalChar[] {
  if (chars.length === 0) {
    return chars;
  }

  const columnWeights = chars.reduce((weights, char) => {
    if (typeof char.columnIndex === "number") {
      weights.set(char.columnIndex, (weights.get(char.columnIndex) ?? 0) + Math.max(1, char.text.trim().length));
    }
    return weights;
  }, new Map<number, number>());
  const preferredColumn = [...columnWeights.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
  if (typeof preferredColumn === "number") {
    const columnChars = chars.filter((char) => char.columnIndex === preferredColumn);
    if (columnChars.length > 0) {
      return columnChars;
    }
  }

  return chars;
}

function buildZoteroSelectionFromChars(input: {
  model: PdfPageTextModel;
  chars: PdfCanonicalChar[];
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
}): PdfResolvedSelection | null {
  const selectedChars = [...input.chars]
    .filter((char) => char.width > 0 && char.height > 0 && !/^\s$/.test(char.text))
    .sort(compareZoteroPointerChars);
  if (selectedChars.length === 0) {
    return null;
  }

  const exact = buildPdfReadableTextFromChars(selectedChars, input.model.normalizedText);
  if (!stripPdfWhitespace(exact)) {
    return null;
  }

  const viewportRects = buildViewportRectsFromZoteroPointerChars({
    chars: selectedChars,
    pageNumber: input.pageNumber,
  });
  if (viewportRects.length === 0) {
    return null;
  }

  const startOffset = Math.min(...selectedChars.map((char) => char.normalizedStart));
  const endOffset = Math.max(...selectedChars.map((char) => char.normalizedEnd));
  const textQuote = buildTextQuote({
    pageText: input.model.normalizedText,
    startOffset,
    endOffset,
    exact,
    source: "pdfjs-text-model",
    confidence: "exact",
  });
  const pageRects = viewportRects
    .map((rect) => ({
      x1: Math.max(0, Math.min(1, rect.left / input.pageWidth)),
      y1: Math.max(0, Math.min(1, rect.top / input.pageHeight)),
      x2: Math.max(0, Math.min(1, (rect.left + rect.width) / input.pageWidth)),
      y2: Math.max(0, Math.min(1, (rect.top + rect.height) / input.pageHeight)),
    }))
    .filter((rect) => rect.x2 > rect.x1 && rect.y2 > rect.y1);
  if (pageRects.length === 0) {
    return null;
  }

  const quads = pageRects.map((rect) => ({
    x1: rect.x1,
    y1: rect.y1,
    x2: rect.x2,
    y2: rect.y1,
    x3: rect.x2,
    y3: rect.y2,
    x4: rect.x1,
    y4: rect.y2,
  }));

  return {
    pageNumber: input.pageNumber,
    startOffset,
    endOffset,
    text: textQuote.exact,
    textQuote,
    pageRects,
    viewportRects,
    textKernelVersion: 1,
    quads,
    textSource: textQuote.source,
    textConfidence: 1,
  };
}

function resolveRenderedSelectionFromZoteroHighlightRects(input: {
  model: PdfPageTextModel;
  viewportRects: PdfCanonicalSelection["viewportRects"];
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
}): PdfResolvedSelection | null {
  const rects = normalizeViewportRects(input.viewportRects.filter((rect) => rect.pageNumber === input.pageNumber));
  if (rects.length === 0) {
    return null;
  }

  const chars = buildPdfCanonicalChars(input.model)
    .filter((char) => (
      char.width > 0 &&
      char.height > 0 &&
      !/^\s$/.test(char.text) &&
      rects.some((rect) => isPdfCharCenterInsideViewportRect(char, rect))
    ))
    .sort(compareZoteroPointerChars);
  const scopedChars = filterZoteroCharsToDominantVisualScope(chars);
  return buildZoteroSelectionFromChars({
    model: input.model,
    chars: scopedChars,
    pageNumber: input.pageNumber,
    pageWidth: input.pageWidth,
    pageHeight: input.pageHeight,
  });
}

function chooseZoteroGeometrySelection(input: {
  rectSelection: PdfResolvedSelection | null;
  pointerSelection: PdfResolvedSelection | null;
  rectCount: number;
}): PdfResolvedSelection | null {
  if (!input.rectSelection) {
    return input.pointerSelection;
  }
  if (!input.pointerSelection) {
    return input.rectSelection;
  }

  const rectCompact = stripPdfWhitespace(input.rectSelection.textQuote.exact);
  const pointerCompact = stripPdfWhitespace(input.pointerSelection.textQuote.exact);
  if (!rectCompact) {
    return input.pointerSelection;
  }
  if (!pointerCompact) {
    return input.rectSelection;
  }

  if (input.rectCount >= 1) {
    if (pointerCompact.includes(rectCompact) && pointerCompact.length > rectCompact.length + Math.max(8, Math.ceil(rectCompact.length * 0.12))) {
      return input.pointerSelection;
    }
    const rectIsPollutedPointerSuperset =
      rectCompact.includes(pointerCompact) &&
      pointerCompact.length >= 8 &&
      rectCompact.length > pointerCompact.length &&
      isSelectionTextAtWordBoundaries(
        input.rectSelection.textQuote.exact,
        input.pointerSelection.textQuote.exact,
      );
    if (rectIsPollutedPointerSuperset) {
      return input.pointerSelection;
    }
    if (rectCompact.includes(pointerCompact) && rectCompact.length >= pointerCompact.length) {
      return input.rectSelection;
    }
    if (input.rectSelection.viewportRects.length >= input.pointerSelection.viewportRects.length) {
      return input.rectSelection;
    }
  }

  return input.pointerSelection;
}

function dragEndpointsMissSingleRect(input: {
  pageElement: HTMLElement;
  viewportRects: PdfCanonicalSelection["viewportRects"];
  pageNumber: number;
  dragStartPoint?: { x: number; y: number };
  dragEndPoint?: { x: number; y: number };
}): boolean {
  if (!hasMeaningfulDrag(input)) {
    return false;
  }
  const rects = input.viewportRects.filter((rect) => rect.pageNumber === input.pageNumber);
  if (rects.length !== 1) {
    return false;
  }
  const pageRect = input.pageElement.getBoundingClientRect();
  const rect = rects[0];
  const tolerance = Math.max(4, rect.height * 0.35);
  const start = {
    x: input.dragStartPoint.x - pageRect.left,
    y: input.dragStartPoint.y - pageRect.top,
  };
  const end = {
    x: input.dragEndPoint.x - pageRect.left,
    y: input.dragEndPoint.y - pageRect.top,
  };
  const containsPoint = (point: { x: number; y: number }) => (
    point.x >= rect.left - tolerance &&
    point.x <= rect.left + rect.width + tolerance &&
    point.y >= rect.top - tolerance &&
    point.y <= rect.top + rect.height + tolerance
  );
  return !containsPoint(start) || !containsPoint(end);
}

function resolveRenderedSelectionFromZoteroPointerRange(input: {
  model: PdfPageTextModel;
  pageElement: HTMLElement;
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
  dragStartPoint: { x: number; y: number };
  dragEndPoint: { x: number; y: number };
}): PdfResolvedSelection | null {
  const pageRect = input.pageElement.getBoundingClientRect();
  if (pageRect.width <= 0 || pageRect.height <= 0) {
    return null;
  }

  const allChars = buildPdfCanonicalChars(input.model)
    .filter((char) => char.width > 0 && char.height > 0 && !/^\s$/.test(char.text))
    .sort(compareZoteroPointerChars);
  if (allChars.length === 0) {
    return null;
  }

  const startPoint = {
    x: input.dragStartPoint.x - pageRect.left,
    y: input.dragStartPoint.y - pageRect.top,
  };
  const endPoint = {
    x: input.dragEndPoint.x - pageRect.left,
    y: input.dragEndPoint.y - pageRect.top,
  };
  const startBoundarySeed = resolveZoteroPointerCharOffset({
    chars: allChars,
    point: startPoint,
    side: "start",
  });
  if (!startBoundarySeed) {
    return null;
  }

  const scopedChars = allChars.filter((char) => (
    char.layoutClass === startBoundarySeed.char.layoutClass &&
    (
      typeof startBoundarySeed.char.columnIndex === "number"
        ? char.columnIndex === startBoundarySeed.char.columnIndex
        : typeof startBoundarySeed.char.blockIndex !== "number" || char.blockIndex === startBoundarySeed.char.blockIndex
    )
  ));
  const activeChars = scopedChars.length > 0 ? scopedChars : allChars;
  const startBoundary = resolveZoteroPointerCharOffset({
    chars: activeChars,
    point: startPoint,
    side: "start",
  });
  const endBoundary = resolveZoteroPointerCharOffset({
    chars: activeChars,
    point: endPoint,
    side: "end",
  });
  if (!startBoundary || !endBoundary) {
    return null;
  }

  const rangeStartIndex = Math.min(startBoundary.offset, endBoundary.offset);
  const rangeEndIndex = Math.max(startBoundary.offset, endBoundary.offset);
  if (rangeEndIndex <= rangeStartIndex) {
    return null;
  }

  const selectedChars = activeChars.slice(rangeStartIndex, rangeEndIndex);
  const selectionLineCount = new Set(selectedChars.map((char) => char.lineIndex).filter((lineIndex) => typeof lineIndex === "number")).size;
  const dragDistance = Math.hypot(
    input.dragEndPoint.x - input.dragStartPoint.x,
    input.dragEndPoint.y - input.dragStartPoint.y,
  );
  const maxCharHeight = Math.max(...selectedChars.map((char) => char.height), 0);
  if (selectionLineCount <= 1 && dragDistance <= Math.max(18, maxCharHeight * 1.25)) {
    return null;
  }

  return buildZoteroSelectionFromChars({
    model: input.model,
    chars: selectedChars,
    pageNumber: input.pageNumber,
    pageWidth: input.pageWidth,
    pageHeight: input.pageHeight,
  });
}

function resolveRenderedSelectionFromPointerBounds(input: {
  model: PdfPageTextModel;
  pageElement: HTMLElement;
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
  dragStartPoint: { x: number; y: number };
  dragEndPoint: { x: number; y: number };
}): PdfResolvedSelection | null {
  const pageRect = input.pageElement.getBoundingClientRect();
  const canonicalChars = buildPdfCanonicalChars(input.model);
  const startBoundary = resolvePdfPointerBoundary({
    model: input.model,
    point: input.dragStartPoint,
    pageRect,
    side: "start",
  });
  const endBoundary = resolvePdfPointerBoundary({
    model: input.model,
    point: input.dragEndPoint,
    pageRect,
    side: "end",
    preferredLayoutClass: startBoundary?.layoutClass,
    preferredBlockIndex: startBoundary?.blockIndex,
    preferredColumnIndex: startBoundary?.columnIndex,
  });

  if (!startBoundary || !endBoundary) {
    return null;
  }

  let startOffset = Math.min(startBoundary.offset, endBoundary.offset);
  let endOffset = Math.max(startBoundary.offset, endBoundary.offset);
  const dragDistance = Math.hypot(
    input.dragEndPoint.x - input.dragStartPoint.x,
    input.dragEndPoint.y - input.dragStartPoint.y,
  );
  const startChar = canonicalChars.find((char) => char.normalizedStart <= startOffset && char.normalizedEnd >= startOffset)
    ?? canonicalChars.find((char) => char.normalizedStart === startOffset)
    ?? canonicalChars[0];
  const endChar = [...canonicalChars].reverse().find((char) => char.normalizedEnd >= endOffset && char.normalizedStart < endOffset)
    ?? [...canonicalChars].reverse().find((char) => char.normalizedEnd === endOffset)
    ?? canonicalChars[canonicalChars.length - 1];
  if (dragDistance <= Math.max(18, Math.max(startChar?.height ?? 0, endChar?.height ?? 0) * 1.25)) {
    const expanded = expandRenderedSelectionToWord({
      model: input.model,
      startOffset,
      endOffset,
    });
    startOffset = expanded.startOffset;
    endOffset = expanded.endOffset;
  }
  if (endOffset <= startOffset) {
    return null;
  }

  const visualBoundarySelection = buildRenderedSelectionFromVisualBoundaries({
    model: input.model,
    startBoundary,
    endBoundary,
    startOffset,
    endOffset,
    pageNumber: input.pageNumber,
    pageWidth: input.pageWidth,
    pageHeight: input.pageHeight,
  });
  if (visualBoundarySelection) {
    return visualBoundarySelection;
  }

  const viewportRects = buildViewportRectsFromRenderedTextOffsets({
    model: input.model,
    startOffset,
    endOffset,
    pageNumber: input.pageNumber,
  });

  return buildResolvedSelectionFromOffsets({
    pageNumber: input.pageNumber,
    pageText: input.model.normalizedText,
    startOffset,
    endOffset,
    viewportRects,
    pageWidth: input.pageWidth,
    pageHeight: input.pageHeight,
    selectedText: input.model.normalizedText.slice(startOffset, endOffset),
    model: input.model,
    source: "pdfjs-text-model",
    confidence: "exact",
  });
}

function resolveRenderedSelectionFromSelectedTextAndGeometry(input: {
  model: PdfPageTextModel;
  viewportRects: PdfCanonicalSelection["viewportRects"];
  selectedText: string;
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
}): PdfResolvedSelection | null {
  const selectedCompactText = stripPdfWhitespace(normalizeComparablePdfText(input.selectedText));
  if (!selectedCompactText) {
    return null;
  }

  const compactModel = buildCompactOffsetModel(input.model.normalizedText);
  const compactMatches = findAllExactCompactMatches(compactModel.compactText, selectedCompactText);
  if (compactMatches.length === 0) {
    return null;
  }

  const referenceRects = normalizeViewportRects(
    input.viewportRects.filter((rect) => rect.pageNumber === input.pageNumber),
  );
  const referenceLeft = referenceRects.length > 0
    ? Math.min(...referenceRects.map((rect) => rect.left))
    : null;
  const referenceTop = referenceRects.length > 0
    ? Math.min(...referenceRects.map((rect) => rect.top))
    : null;

  const candidates = compactMatches
    .map((compactStart) => {
      const compactEnd = compactStart + selectedCompactText.length;
      const startOffset = compactModel.compactStartToNormalized[compactStart];
      const endOffset = compactModel.compactEndToNormalized[compactEnd];
      if (
        typeof startOffset !== "number" ||
        typeof endOffset !== "number" ||
        endOffset <= startOffset
      ) {
        return null;
      }

      const viewportRects = buildViewportRectsFromRenderedTextOffsets({
        model: input.model,
        startOffset,
        endOffset,
        pageNumber: input.pageNumber,
      });
      const firstRect = normalizeViewportRects(viewportRects)[0] ?? null;
      const visualDistance = firstRect && referenceLeft !== null && referenceTop !== null
        ? Math.abs(firstRect.left - referenceLeft) + (Math.abs(firstRect.top - referenceTop) * 0.35)
        : 0;
      const selection = buildResolvedSelectionFromOffsets({
        pageNumber: input.pageNumber,
        pageText: input.model.normalizedText,
        startOffset,
        endOffset,
        viewportRects,
        pageWidth: input.pageWidth,
        pageHeight: input.pageHeight,
        selectedText: input.model.normalizedText.slice(startOffset, endOffset),
        model: input.model,
        source: "pdfjs-text-model",
        confidence: "exact",
      });

      return selection ? { selection, visualDistance } : null;
    })
    .filter((candidate): candidate is { selection: PdfResolvedSelection; visualDistance: number } => Boolean(candidate));

  return candidates
    .sort((left, right) => left.visualDistance - right.visualDistance)[0]?.selection ?? null;
}

function choosePreferredRenderedSelection(input: {
  domSelection: PdfResolvedSelection | null;
  geometrySelection: PdfResolvedSelection | null;
  viewportRects: PdfCanonicalSelection["viewportRects"];
  allowGeometryOverride: boolean;
  liveSelectedText?: string;
}): PdfResolvedSelection | null {
  if (!input.domSelection) {
    return input.geometrySelection;
  }
  if (!input.geometrySelection) {
    return input.domSelection;
  }
  if (!input.allowGeometryOverride) {
    return input.domSelection;
  }

  const domFeatures = buildSelectionCandidateFeatures({
    selection: input.domSelection,
    kind: "dom",
    referenceText: input.liveSelectedText ?? input.domSelection.textQuote.exact,
    viewportRects: input.viewportRects,
  });
  const geometryFeatures = buildSelectionCandidateFeatures({
    selection: input.geometrySelection,
    kind: "geometry",
    referenceText: input.liveSelectedText ?? input.domSelection.textQuote.exact,
    viewportRects: input.viewportRects,
  });
  const domCompact = domFeatures?.compact ?? "";
  const geometryCompact = geometryFeatures?.compact ?? "";
  const liveCompact = stripPdfWhitespace(normalizeComparablePdfText(input.liveSelectedText ?? ""));
  const explicitMultiRectReference = input.viewportRects.length > 1;
  const domTracksReferenceRows =
    explicitMultiRectReference &&
    input.domSelection.pageRects.length === input.viewportRects.length &&
    input.geometrySelection.pageRects.length === input.viewportRects.length;
  const geometryIsVisualSubsetOfPollutedDom =
    explicitMultiRectReference &&
    domFeatures &&
    geometryFeatures &&
    geometryCompact.length >= Math.max(12, Math.ceil(domCompact.length * 0.25)) &&
    domCompact.includes(geometryCompact) &&
    domCompact.length > geometryCompact.length + Math.max(12, Math.ceil(geometryCompact.length * 0.12)) &&
    geometryFeatures.boundaryDistance <= domFeatures.boundaryDistance + Math.max(16, input.viewportRects.length * 4) &&
    geometryFeatures.overlap >= Math.max(0.08, domFeatures.overlap - 0.12);
  if (geometryIsVisualSubsetOfPollutedDom) {
    return input.geometrySelection;
  }
  if (
    domTracksReferenceRows &&
    liveCompact &&
    domCompact.includes(liveCompact) &&
    domCompact.length > liveCompact.length
  ) {
    const domIsPollutedSuperset =
      geometryFeatures?.compact &&
      domCompact.includes(geometryFeatures.compact) &&
      domCompact.length > geometryFeatures.compact.length + Math.max(12, Math.ceil(geometryFeatures.compact.length * 0.12)) &&
      geometryFeatures.boundaryDistance <= (domFeatures?.boundaryDistance ?? Number.POSITIVE_INFINITY) + Math.max(8, explicitMultiRectReference ? input.viewportRects.length * 2 : 0) &&
      geometryFeatures.overlap >= Math.max(0.12, (domFeatures?.overlap ?? 0) - 0.08);
    if (domIsPollutedSuperset) {
      return input.geometrySelection;
    }
    return input.domSelection;
  }
  if (
    domFeatures &&
    geometryFeatures &&
    domFeatures.overlap >= 0.75 &&
    domFeatures.boundaryDistance <= 12 &&
    geometryFeatures.overlap <= 0.05 &&
    geometryFeatures.boundaryDistance > domFeatures.boundaryDistance + 24
  ) {
    return input.domSelection;
  }
  if (
    isCjkSameLengthTextConflict(input.domSelection.textQuote.exact, input.geometrySelection.textQuote.exact) &&
    geometryFeatures &&
    domFeatures &&
    geometryFeatures.boundaryDistance <= domFeatures.boundaryDistance + 2 &&
    geometryFeatures.overlap >= domFeatures.overlap - 0.05
  ) {
    return input.geometrySelection;
  }
  if (liveCompact) {
    if (geometryCompact === liveCompact && domCompact !== liveCompact) {
      if (
        explicitMultiRectReference &&
        domCompact.includes(liveCompact) &&
        domCompact.length > liveCompact.length
      ) {
        const domIsPollutedSuperset =
          geometryFeatures &&
          domFeatures &&
          geometryFeatures.boundaryDistance <= domFeatures.boundaryDistance + Math.max(8, input.viewportRects.length * 2) &&
          geometryFeatures.overlap >= Math.max(0.12, domFeatures.overlap - 0.08);
        return domIsPollutedSuperset ? input.geometrySelection : input.domSelection;
      }
      return input.geometrySelection;
    }
    if (
      geometryCompact === liveCompact &&
      domCompact.includes(liveCompact) &&
      domCompact.length > liveCompact.length
    ) {
      return input.geometrySelection;
    }
  }

  if (
    domCompact &&
    geometryCompact === domCompact &&
    explicitMultiRectReference &&
    input.domSelection.pageRects.length > 1 &&
    input.geometrySelection.pageRects.length === input.domSelection.pageRects.length
  ) {
    return input.domSelection;
  }

  if (isBoundaryPunctuationSuperset(input.geometrySelection.textQuote.exact, input.domSelection.textQuote.exact)) {
    return input.domSelection;
  }

  const geometryIsOnlyAnOverwideSuperset =
    domCompact.length > 0 &&
    geometryCompact.length > domCompact.length + Math.max(8, Math.ceil(domCompact.length * 0.2)) &&
    geometryCompact.includes(domCompact);

  if (geometryIsOnlyAnOverwideSuperset) {
    return input.domSelection;
  }

  if (
    geometryFeatures &&
    domFeatures &&
    geometryFeatures.overlap >= 0.55 &&
    geometryFeatures.overlap >= domFeatures.overlap + 0.2
  ) {
    return input.geometrySelection;
  }

  if (
    geometryFeatures &&
    domFeatures &&
    geometryFeatures.overlap >= 0.55 &&
    geometryFeatures.boundaryDistance <= 18 &&
    geometryFeatures.overlap >= domFeatures.overlap + 0.15
  ) {
    return input.geometrySelection;
  }

  const candidates = [
    domFeatures,
    geometryFeatures,
  ].filter((candidate): candidate is PdfSelectionCandidateFeatures => Boolean(candidate));
  if (candidates.length === 0) {
    return input.domSelection;
  }
  candidates.sort(compareSelectionCandidateFeatures);
  return candidates[0]?.selection ?? input.domSelection;
}

function intersectsViewportRect(
  character: PdfViewportSelectableChar,
  rect: PdfCanonicalSelection["viewportRects"][number],
): boolean {
  if (
    character.right <= rect.left ||
    rect.left + rect.width <= character.left
  ) {
    return false;
  }

  return viewportRectsVerticallyOverlap(character, rect);
}

function selectBoundaryChar(input: {
  chars: PdfViewportSelectableChar[];
  rect: PdfCanonicalSelection["viewportRects"][number];
  side: "start" | "end";
}): PdfViewportSelectableChar {
  const boundary = input.side === "start" ? input.rect.left : input.rect.left + input.rect.width;
  const tolerance = Math.max(
    1,
    Math.min(
      6,
      ...input.chars.map((character) => Math.max(character.width * 0.35, character.height * 0.12)),
    ),
  );
  const containing = input.chars.filter((character) => (
    boundary >= character.left - tolerance &&
    boundary <= character.right + tolerance
  ));

  if (containing.length > 0) {
    if (input.side === "start") {
      const rightLeaning = containing
        .filter((character) => character.centerX >= boundary)
        .sort((left, right) => left.left - right.left || left.normalizedStart - right.normalizedStart);
      if (rightLeaning.length > 0) {
        return rightLeaning[0];
      }
      return containing
        .sort((left, right) => right.right - left.right || right.normalizedStart - left.normalizedStart)[0];
    }

    const leftLeaning = containing
      .filter((character) => character.centerX <= boundary)
      .sort((left, right) => right.right - left.right || right.normalizedEnd - left.normalizedEnd);
    if (leftLeaning.length > 0) {
      return leftLeaning[0];
    }
    return containing
      .sort((left, right) => left.left - right.left || left.normalizedEnd - right.normalizedEnd)[0];
  }

  if (input.side === "start") {
    const rightSide = input.chars
      .filter((character) => character.left >= boundary - tolerance)
      .sort((left, right) => left.left - right.left || left.normalizedStart - right.normalizedStart);
    if (rightSide.length > 0) {
      return rightSide[0];
    }
    return input.chars[input.chars.length - 1];
  }

  const leftSide = input.chars
    .filter((character) => character.right <= boundary + tolerance)
    .sort((left, right) => right.right - left.right || right.normalizedEnd - left.normalizedEnd);
  if (leftSide.length > 0) {
    return leftSide[0];
  }
  return input.chars[0];
}

function getVerticalDistanceToChar(character: PdfViewportSelectableChar, localY: number): number {
  if (localY >= character.top && localY <= character.bottom) {
    return 0;
  }
  return Math.min(
    Math.abs(localY - character.top),
    Math.abs(localY - character.bottom),
  );
}

function selectNearestLineChars(input: {
  chars: PdfViewportSelectableChar[];
  localY: number;
}): PdfViewportSelectableChar[] {
  if (input.chars.length === 0) {
    return [];
  }

  const bestCharacter = input.chars.reduce((best, character) => {
    const bestDistance = getVerticalDistanceToChar(best, input.localY);
    const currentDistance = getVerticalDistanceToChar(character, input.localY);
    if (currentDistance === bestDistance) {
      return Math.abs(character.centerY - input.localY) < Math.abs(best.centerY - input.localY)
        ? character
        : best;
    }
    return currentDistance < bestDistance ? character : best;
  });

  const lineTolerance = Math.max(2, Math.min(14, bestCharacter.height * 0.65));
  return input.chars.filter((character) => (
    Math.abs(character.centerY - bestCharacter.centerY) <= lineTolerance
  ));
}

function selectCharForPointer(input: {
  chars: PdfViewportSelectableChar[];
  point: { x: number; y: number };
  pageRect: DOMRect;
  side: "start" | "end";
}): PdfViewportSelectableChar | null {
  if (input.chars.length === 0) {
    return null;
  }

  const localX = input.point.x - input.pageRect.left;
  const localY = input.point.y - input.pageRect.top;
  const sameLineChars = selectNearestLineChars({
    chars: input.chars,
    localY,
  });
  const scopedChars = sameLineChars.length > 0 ? sameLineChars : input.chars;
  const horizontalTolerance = Math.max(
    1,
    Math.min(
      6,
      ...scopedChars.map((character) => Math.max(character.width * 0.25, character.height * 0.1)),
    ),
  );
  const containingChars = scopedChars.filter((character) => (
    localX >= character.left - horizontalTolerance &&
    localX <= character.right + horizontalTolerance
  ));

  if (containingChars.length > 0) {
    const midpointFiltered = input.side === "start"
      ? containingChars.filter((character) => localX <= character.centerX + horizontalTolerance)
      : containingChars.filter((character) => localX >= character.centerX - horizontalTolerance);
    const candidates = midpointFiltered.length > 0 ? midpointFiltered : containingChars;
    return candidates.reduce((best, character) => {
      const bestDistance = Math.abs(best.centerX - localX);
      const currentDistance = Math.abs(character.centerX - localX);
      if (currentDistance === bestDistance) {
        return input.side === "start"
          ? (character.normalizedStart < best.normalizedStart ? character : best)
          : (character.normalizedEnd > best.normalizedEnd ? character : best);
      }
      return currentDistance < bestDistance ? character : best;
    });
  }

  return scopedChars.reduce((best, character) => {
    const bestDistance = Math.abs(best.centerX - localX) + (Math.abs(best.centerY - localY) * 0.35);
    const currentDistance = Math.abs(character.centerX - localX) + (Math.abs(character.centerY - localY) * 0.35);
    if (currentDistance === bestDistance) {
      return input.side === "start"
        ? (character.normalizedStart < best.normalizedStart ? character : best)
        : (character.normalizedEnd > best.normalizedEnd ? character : best);
    }
    return currentDistance < bestDistance ? character : best;
  });
}

function getSelectionBoundaryDistance(input: {
  selection: PdfResolvedSelection | null;
  viewportRects: PdfCanonicalSelection["viewportRects"];
}): number {
  if (!input.selection) {
    return Number.POSITIVE_INFINITY;
  }

  const candidateRects = normalizeViewportRects(input.selection.viewportRects);
  const referenceRects = normalizeViewportRects(input.viewportRects);
  if (candidateRects.length === 0 || referenceRects.length === 0) {
    return Number.POSITIVE_INFINITY;
  }

  const firstCandidate = candidateRects[0];
  const lastCandidate = candidateRects[candidateRects.length - 1];
  const firstReference = referenceRects[0];
  const lastReference = referenceRects[referenceRects.length - 1];

  return (
    Math.abs(firstCandidate.left - firstReference.left) +
    (Math.abs(firstCandidate.top - firstReference.top) * 0.35) +
    Math.abs((lastCandidate.left + lastCandidate.width) - (lastReference.left + lastReference.width)) +
    (Math.abs(lastCandidate.top - lastReference.top) * 0.35)
  );
}

function getSelectionGeometryOverlapRatio(input: {
  selection: PdfResolvedSelection | null;
  viewportRects: PdfCanonicalSelection["viewportRects"];
}): number {
  if (!input.selection) {
    return 0;
  }

  const candidateRects = normalizeViewportRects(input.selection.viewportRects);
  const referenceRects = normalizeViewportRects(input.viewportRects);
  if (candidateRects.length === 0 || referenceRects.length === 0) {
    return 0;
  }

  let intersectionArea = 0;
  let referenceArea = 0;

  for (const referenceRect of referenceRects) {
    referenceArea += Math.max(0, referenceRect.width) * Math.max(0, referenceRect.height);
    for (const candidateRect of candidateRects) {
      const overlapWidth = Math.max(0, Math.min(candidateRect.left + candidateRect.width, referenceRect.left + referenceRect.width) - Math.max(candidateRect.left, referenceRect.left));
      const overlapHeight = Math.max(0, Math.min(candidateRect.top + candidateRect.height, referenceRect.top + referenceRect.height) - Math.max(candidateRect.top, referenceRect.top));
      intersectionArea += overlapWidth * overlapHeight;
    }
  }

  if (referenceArea <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(1, intersectionArea / referenceArea));
}

function buildSelectionCandidateFeatures(input: {
  selection: PdfResolvedSelection | null;
  kind: PdfSelectionCandidateKind;
  referenceText: string;
  viewportRects: PdfCanonicalSelection["viewportRects"];
}): PdfSelectionCandidateFeatures | null {
  if (!input.selection) {
    return null;
  }

  const compact = getCompactSelectionText(input.selection);
  const referenceCompact = stripPdfWhitespace(normalizeComparablePdfText(input.referenceText));
  return {
    selection: input.selection,
    kind: input.kind,
    compact,
    length: compact.length,
    distanceFromReference: getSelectionDistanceFromDom(input.selection, input.referenceText),
    overlap: getSelectionGeometryOverlapRatio({
      selection: input.selection,
      viewportRects: input.viewportRects,
    }),
    boundaryDistance: getSelectionBoundaryDistance({
      selection: input.selection,
      viewportRects: input.viewportRects,
    }),
    exactReferenceMatch: compact.length > 0 && compact === referenceCompact,
    containsReference: Boolean(referenceCompact) && compact.includes(referenceCompact),
    isContainedByReference: Boolean(referenceCompact) && referenceCompact.includes(compact),
  };
}

function compareSelectionCandidateFeatures(
  left: PdfSelectionCandidateFeatures,
  right: PdfSelectionCandidateFeatures,
): number {
  if (left.exactReferenceMatch !== right.exactReferenceMatch) {
    return left.exactReferenceMatch ? -1 : 1;
  }
  if (left.overlap !== right.overlap) {
    return right.overlap - left.overlap;
  }
  if (left.distanceFromReference !== right.distanceFromReference) {
    return left.distanceFromReference - right.distanceFromReference;
  }
  if (left.boundaryDistance !== right.boundaryDistance) {
    return left.boundaryDistance - right.boundaryDistance;
  }
  if (left.length !== right.length) {
    return right.length - left.length;
  }

  const kindRank = (kind: PdfSelectionCandidateKind): number => {
    switch (kind) {
      case "pointer":
        return 0;
      case "geometry":
        return 1;
      case "offset":
        return 2;
      case "textSearch":
        return 3;
      case "dom":
        return 4;
      default:
        return 5;
    }
  };

  return kindRank(left.kind) - kindRank(right.kind);
}

function chooseBestSelectionCandidate(
  candidates: Array<PdfSelectionCandidateFeatures | null | undefined>,
): PdfResolvedSelection | null {
  const availableCandidates = candidates.filter((candidate): candidate is PdfSelectionCandidateFeatures => Boolean(candidate));
  if (availableCandidates.length === 0) {
    return null;
  }
  availableCandidates.sort(compareSelectionCandidateFeatures);
  return availableCandidates[0]?.selection ?? null;
}

function isBoundaryPunctuationSuperset(candidateText: string, baseText: string): boolean {
  const normalizedCandidate = normalizeComparablePdfText(candidateText);
  const normalizedBase = normalizeComparablePdfText(baseText);
  if (!normalizedCandidate || !normalizedBase || normalizedCandidate === normalizedBase) {
    return false;
  }

  if (normalizedCandidate.startsWith(normalizedBase)) {
    const trailing = normalizedCandidate.slice(normalizedBase.length);
    return trailing.length > 0 && trailing.length <= 2 && /^[\p{P}\p{S}\s]+$/u.test(trailing);
  }

  if (normalizedCandidate.endsWith(normalizedBase)) {
    const leading = normalizedCandidate.slice(0, normalizedCandidate.length - normalizedBase.length);
    return leading.length > 0 && leading.length <= 2 && /^[\p{P}\p{S}\s]+$/u.test(leading);
  }

  return false;
}

function resolveNativeSelectionFromPointerBounds(input: {
  layout: PdfNativePageTextLayout;
  nativeModel: PdfNativeNormalizedModel;
  pageElement: HTMLElement;
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
  dragStartPoint: { x: number; y: number };
  dragEndPoint: { x: number; y: number };
}): PdfResolvedSelection | null {
  const nativeViewportChars = buildNativeViewportChars({
    nativeChars: input.nativeModel.chars,
    layout: input.layout,
    pageWidth: input.pageWidth,
    pageHeight: input.pageHeight,
  });
  const pageRect = input.pageElement.getBoundingClientRect();
  const startChar = selectCharForPointer({
    chars: nativeViewportChars,
    point: input.dragStartPoint,
    pageRect,
    side: "start",
  });
  const endChar = selectCharForPointer({
    chars: nativeViewportChars,
    point: input.dragEndPoint,
    pageRect,
    side: "end",
  });

  if (!startChar || !endChar) {
    return null;
  }

  const startOffset = Math.min(startChar.normalizedStart, endChar.normalizedStart);
  const endOffset = Math.max(startChar.normalizedEnd, endChar.normalizedEnd);
  if (endOffset <= startOffset) {
    return null;
  }

  const viewportRects = buildViewportRectsFromNativeChars({
    nativeChars: input.nativeModel.chars,
    startOffset,
    endOffset,
    layout: input.layout,
    pageWidth: input.pageWidth,
    pageHeight: input.pageHeight,
    pageNumber: input.pageNumber,
  });

  return buildResolvedSelectionFromOffsets({
    pageNumber: input.pageNumber,
    pageText: input.nativeModel.normalizedText,
    startOffset,
    endOffset,
    viewportRects,
    pageWidth: input.pageWidth,
    pageHeight: input.pageHeight,
    selectedText: input.nativeModel.normalizedText.slice(startOffset, endOffset),
    source: "pdfium-native",
    confidence: "validated-native",
  });
}

function resolveNativeSelectionFromViewportRects(input: {
  layout: PdfNativePageTextLayout;
  nativeModel: PdfNativeNormalizedModel;
  viewportRects: PdfCanonicalSelection["viewportRects"];
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
}): PdfResolvedSelection | null {
  const sortedRects = normalizeViewportRects(
    input.viewportRects.filter((rect) => rect.pageNumber === input.pageNumber),
  );
  if (sortedRects.length === 0) {
    return null;
  }

  const nativeViewportChars = buildNativeViewportChars({
    nativeChars: input.nativeModel.chars,
    layout: input.layout,
    pageWidth: input.pageWidth,
    pageHeight: input.pageHeight,
  });

  const intersectedChars = nativeViewportChars
    .filter((character) => sortedRects.some((rect) => intersectsViewportRect(character, rect)))
    .sort((left, right) => left.normalizedStart - right.normalizedStart);

  if (intersectedChars.length === 0) {
    return null;
  }

  const firstRect = sortedRects[0];
  const lastRect = sortedRects[sortedRects.length - 1];
  const firstLineChars = intersectedChars.filter((character) => intersectsViewportRect(character, firstRect));
  const lastLineChars = intersectedChars.filter((character) => intersectsViewportRect(character, lastRect));
  const startChar = selectBoundaryChar({
    chars: firstLineChars.length > 0 ? firstLineChars : intersectedChars,
    rect: firstRect,
    side: "start",
  });
  const endChar = selectBoundaryChar({
    chars: lastLineChars.length > 0 ? lastLineChars : intersectedChars,
    rect: lastRect,
    side: "end",
  });

  const startOffset = Math.min(startChar.normalizedStart, endChar.normalizedStart);
  const endOffset = Math.max(startChar.normalizedEnd, endChar.normalizedEnd);
  if (endOffset <= startOffset) {
    return null;
  }

  const viewportRects = buildViewportRectsFromNativeChars({
    nativeChars: input.nativeModel.chars,
    startOffset,
    endOffset,
    layout: input.layout,
    pageWidth: input.pageWidth,
    pageHeight: input.pageHeight,
    pageNumber: input.pageNumber,
  });

  return buildResolvedSelectionFromOffsets({
    pageNumber: input.pageNumber,
    pageText: input.nativeModel.normalizedText,
    startOffset,
    endOffset,
    viewportRects,
    pageWidth: input.pageWidth,
    pageHeight: input.pageHeight,
    selectedText: input.nativeModel.normalizedText.slice(startOffset, endOffset),
    source: "pdfium-native",
    confidence: "validated-native",
  });
}

function resolveNativeSelectionFromSelectedTextAndGeometry(input: {
  layout: PdfNativePageTextLayout;
  nativeModel: PdfNativeNormalizedModel;
  viewportRects: PdfCanonicalSelection["viewportRects"];
  selectedText: string;
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
}): PdfResolvedSelection | null {
  const selectedCompactText = stripPdfWhitespace(normalizeComparablePdfText(input.selectedText));
  if (!selectedCompactText) {
    return null;
  }

  const nativeViewportChars = buildNativeViewportChars({
    nativeChars: input.nativeModel.chars,
    layout: input.layout,
    pageWidth: input.pageWidth,
    pageHeight: input.pageHeight,
  });
  const intersectedChars = nativeViewportChars
    .filter((character) => input.viewportRects.some((rect) => intersectsViewportRect(character, rect)))
    .sort((left, right) => left.normalizedStart - right.normalizedStart);
  const estimatedNormalizedStart = intersectedChars[0]?.normalizedStart ?? 0;
  const estimatedCompactStart = input.nativeModel.compact.normalizedToCompact[estimatedNormalizedStart] ?? 0;
  const compactMatches = findAllExactCompactMatches(input.nativeModel.compact.compactText, selectedCompactText);
  if (compactMatches.length === 0) {
    return null;
  }

  const compactStart = compactMatches.reduce((best, candidate) => (
    Math.abs(candidate - estimatedCompactStart) < Math.abs(best - estimatedCompactStart) ? candidate : best
  ));
  const compactEnd = compactStart + selectedCompactText.length;
  const normalizedStart = input.nativeModel.compact.compactStartToNormalized[compactStart];
  const normalizedEnd = input.nativeModel.compact.compactEndToNormalized[compactEnd];
  if (
    typeof normalizedStart !== "number" ||
    typeof normalizedEnd !== "number" ||
    normalizedEnd <= normalizedStart
  ) {
    return null;
  }

  const viewportRects = buildViewportRectsFromNativeChars({
    nativeChars: input.nativeModel.chars,
    startOffset: normalizedStart,
    endOffset: normalizedEnd,
    layout: input.layout,
    pageWidth: input.pageWidth,
    pageHeight: input.pageHeight,
    pageNumber: input.pageNumber,
  });

  return buildResolvedSelectionFromOffsets({
    pageNumber: input.pageNumber,
    pageText: input.nativeModel.normalizedText,
    startOffset: normalizedStart,
    endOffset: normalizedEnd,
    viewportRects,
    pageWidth: input.pageWidth,
    pageHeight: input.pageHeight,
    selectedText: input.nativeModel.normalizedText.slice(normalizedStart, normalizedEnd),
    source: "pdfium-native",
    confidence: "validated-native",
  });
}

function getCompactSelectionText(selection: PdfResolvedSelection | null | undefined): string {
  return stripPdfWhitespace(selection?.textQuote.exact ?? selection?.text ?? "");
}

function getSelectionDistanceFromDom(selection: PdfResolvedSelection | null, domSelectedText: string): number {
  if (!selection) {
    return Number.POSITIVE_INFINITY;
  }

  const candidate = getCompactSelectionText(selection);
  const expected = stripPdfWhitespace(domSelectedText);
  if (!candidate && !expected) {
    return 0;
  }
  if (!candidate || !expected) {
    return Math.max(candidate.length, expected.length);
  }

  const maxDistance = Math.max(2, Math.ceil(expected.length * 0.25));
  const distance = boundedLevenshteinDistance(candidate, expected, maxDistance);
  return distance ?? Number.POSITIVE_INFINITY;
}

function selectionTextMatchesLiveText(selection: PdfResolvedSelection | null, liveSelectedText: string): boolean {
  if (!selection) {
    return false;
  }

  const liveCompact = stripPdfWhitespace(normalizeComparablePdfText(liveSelectedText));
  if (!liveCompact) {
    return true;
  }

  const selectionCompact = getCompactSelectionText(selection);
  if (!selectionCompact) {
    return false;
  }

  if (selectionCompact === liveCompact) {
    return true;
  }

  const distance = getSelectionDistanceFromDom(selection, liveSelectedText);
  const maxDistance = Math.max(1, Math.ceil(liveCompact.length * 0.08));
  return distance <= maxDistance;
}

function hasPdfLineBreakHyphenArtifact(text: string): boolean {
  return /[\p{L}]-\s+[\p{Ll}]/u.test(text);
}

function lockSelectionQuoteToLiveText(input: {
  selection: PdfResolvedSelection;
  liveSelectedText: string;
}): PdfResolvedSelection {
  const liveExact = normalizeComparablePdfText(input.liveSelectedText);
  if (!stripPdfWhitespace(liveExact)) {
    return input.selection;
  }

  if (input.selection.textQuote.exact === liveExact && input.selection.text === liveExact) {
    return input.selection;
  }

  return {
    ...input.selection,
    text: liveExact,
    textQuote: {
      ...input.selection.textQuote,
      exact: liveExact,
      source: "dom-selection",
      confidence: "exact",
    },
  };
}

function shouldAllowLiveTextOverride(input: {
  selection: PdfResolvedSelection;
  liveSelectedText: string;
  domOffsetText: string;
}): boolean {
  const liveCompact = stripPdfWhitespace(normalizeComparablePdfText(input.liveSelectedText));
  if (!liveCompact) {
    return false;
  }

  const selectionCompact = getCompactSelectionText(input.selection);
  if (!selectionCompact) {
    return false;
  }

  if (liveCompact === selectionCompact) {
    return true;
  }

  if (
    isCjkSameLengthTextConflict(liveCompact, selectionCompact)
  ) {
    return false;
  }

  const liveLooksLikeContaminatedSuperset =
    liveCompact.includes(selectionCompact) &&
    liveCompact.length > selectionCompact.length + Math.max(8, Math.ceil(selectionCompact.length * 0.08)) &&
    input.selection.textQuote.source !== "dom-selection";
  if (liveLooksLikeContaminatedSuperset) {
    return false;
  }

  const liveLooksLikeBoundaryCorrection =
    liveCompact.length >= Math.max(6, Math.ceil(selectionCompact.length * 0.08)) &&
    (
      selectionCompact.startsWith(liveCompact) ||
      selectionCompact.endsWith(liveCompact)
    );
  if (liveLooksLikeBoundaryCorrection) {
    return true;
  }

  const domOffsetCompact = stripPdfWhitespace(normalizeComparablePdfText(input.domOffsetText));
  if (liveCompact === domOffsetCompact && selectionTextMatchesLiveText(input.selection, input.liveSelectedText)) {
    return true;
  }

  return selectionTextMatchesLiveText(input.selection, input.liveSelectedText);
}

function reconcileSelectionQuoteWithLiveDomText(input: {
  selection: PdfResolvedSelection;
  liveSelectedText: string;
  domOffsetText: string;
}): PdfResolvedSelection {
  const liveExact = normalizeComparablePdfText(input.liveSelectedText);
  const liveCompact = stripPdfWhitespace(liveExact);
  if (!liveCompact) {
    return input.selection;
  }

  const selectionCompact = getCompactSelectionText(input.selection);
  if (!selectionCompact) {
    return input.selection;
  }

  const selectionExact = input.selection.textQuote.exact;
  if (
    hasPdfLineBreakHyphenArtifact(liveExact) &&
    !hasPdfLineBreakHyphenArtifact(selectionExact)
  ) {
    return input.selection;
  }

  const liveTextCanOverride = shouldAllowLiveTextOverride(input);
  const liveOnlyDiffersByWhitespace = liveCompact === selectionCompact;
  const liveFixesHyphenSpacing =
    liveOnlyDiffersByWhitespace &&
    /(?:-\s|\s-)/.test(selectionExact) &&
    !/(?:-\s|\s-)/.test(liveExact);

  if (
    (liveExact === selectionExact || liveFixesHyphenSpacing) &&
    input.selection.textQuote.source !== "dom-selection"
  ) {
    return {
      ...input.selection,
      text: liveExact,
      textQuote: {
        ...input.selection.textQuote,
        exact: liveExact,
        source: "dom-selection",
        confidence: "exact",
      },
    };
  }

  if (liveOnlyDiffersByWhitespace) {
    return input.selection;
  }

  const domOffsetCompact = stripPdfWhitespace(normalizeComparablePdfText(input.domOffsetText));
  if (liveCompact === domOffsetCompact) {
    return liveTextCanOverride
      ? lockSelectionQuoteToLiveText({
          selection: input.selection,
          liveSelectedText: input.liveSelectedText,
        })
      : input.selection;
  }

  return liveTextCanOverride
    ? lockSelectionQuoteToLiveText({
        selection: input.selection,
        liveSelectedText: input.liveSelectedText,
      })
    : input.selection;
}

export function choosePreferredNativeSelection(input: {
  offsetSelection: PdfResolvedSelection | null;
  geometrySelection: PdfResolvedSelection | null;
  textSearchSelection: PdfResolvedSelection | null;
  domSelectedText: string;
  viewportRectCount: number;
  viewportRects: PdfCanonicalSelection["viewportRects"];
}): PdfResolvedSelection | null {
  const availableSelections = [
    input.offsetSelection,
    input.geometrySelection,
    input.textSearchSelection,
  ].filter((selection): selection is PdfResolvedSelection => Boolean(selection));

  if (availableSelections.length === 1) {
    return availableSelections[0];
  }

  if (input.offsetSelection && !input.geometrySelection && !input.textSearchSelection) {
    return input.offsetSelection;
  }
  if (input.geometrySelection && !input.offsetSelection && !input.textSearchSelection) {
    return input.geometrySelection;
  }
  if (!input.offsetSelection && !input.geometrySelection && !input.textSearchSelection) {
    return null;
  }

  const offsetFeatures = buildSelectionCandidateFeatures({
    selection: input.offsetSelection,
    kind: "offset",
    referenceText: input.domSelectedText,
    viewportRects: input.viewportRects,
  });
  const geometryFeatures = buildSelectionCandidateFeatures({
    selection: input.geometrySelection,
    kind: "geometry",
    referenceText: input.domSelectedText,
    viewportRects: input.viewportRects,
  });
  const textSearchFeatures = buildSelectionCandidateFeatures({
    selection: input.textSearchSelection,
    kind: "textSearch",
    referenceText: input.domSelectedText,
    viewportRects: input.viewportRects,
  });
  const domCompact = stripPdfWhitespace(input.domSelectedText);

  if (
    geometryFeatures &&
    geometryFeatures.compact &&
    geometryFeatures.overlap >= 0.55 &&
    geometryFeatures.overlap >= Math.max(offsetFeatures?.overlap ?? 0, textSearchFeatures?.overlap ?? 0) + 0.2
  ) {
    return geometryFeatures.selection;
  }

  if (offsetFeatures?.exactReferenceMatch && !geometryFeatures?.exactReferenceMatch && !textSearchFeatures?.exactReferenceMatch) {
    return offsetFeatures.selection;
  }
  if (geometryFeatures?.exactReferenceMatch && !offsetFeatures?.exactReferenceMatch && !textSearchFeatures?.exactReferenceMatch) {
    return geometryFeatures.selection;
  }
  if (textSearchFeatures?.exactReferenceMatch && !offsetFeatures?.exactReferenceMatch && !geometryFeatures?.exactReferenceMatch) {
    return textSearchFeatures.selection;
  }
  if (
    input.viewportRectCount > 1 &&
    geometryFeatures?.compact &&
    domCompact &&
    domCompact.includes(geometryFeatures.compact) &&
    geometryFeatures.length >= Math.max(1, offsetFeatures?.length ?? 0)
  ) {
    return geometryFeatures.selection;
  }

  return chooseBestSelectionCandidate([
    offsetFeatures,
    geometryFeatures,
    textSearchFeatures,
  ]);
}

function choosePreferredPointerSelection(input: {
  baseSelection: PdfResolvedSelection | null;
  pointerSelection: PdfResolvedSelection | null;
  domSelectedText: string;
  viewportRectCount: number;
  viewportRects: PdfCanonicalSelection["viewportRects"];
  dragDistanceX?: number;
  referenceSpanWidth?: number;
}): PdfResolvedSelection | null {
  if (!input.pointerSelection) {
    return input.baseSelection;
  }
  if (!input.baseSelection) {
    return input.pointerSelection;
  }

  const pointerFeatures = buildSelectionCandidateFeatures({
    selection: input.pointerSelection,
    kind: "pointer",
    referenceText: input.domSelectedText,
    viewportRects: input.viewportRects,
  });
  const baseFeatures = buildSelectionCandidateFeatures({
    selection: input.baseSelection,
    kind: "geometry",
    referenceText: input.domSelectedText,
    viewportRects: input.viewportRects,
  });
  const domCompact = stripPdfWhitespace(input.domSelectedText);

  if (!pointerFeatures?.compact) {
    return input.baseSelection;
  }
  if (!baseFeatures?.compact) {
    return input.pointerSelection;
  }

  const pointerCompact = pointerFeatures.compact;
  const baseCompact = baseFeatures.compact;
  const pointerDistance = pointerFeatures.distanceFromReference;
  const baseDistance = baseFeatures.distanceFromReference;
  const pointerBoundaryDistance = pointerFeatures.boundaryDistance;
  const baseBoundaryDistance = baseFeatures.boundaryDistance;
  const shortPointerDrivenSelection =
    input.viewportRectCount <= 2 &&
    domCompact.length <= 96 &&
    pointerCompact.length <= 96;
  const domLooksLikeStrayMarker =
    /^[\d*†‡§¶,.;:()[\]{}-]{1,4}$/.test(domCompact) &&
    /[\p{L}]{3,}/u.test(pointerCompact);
  const dragSuggestsWiderSelection = (
    typeof input.dragDistanceX === "number" &&
    typeof input.referenceSpanWidth === "number" &&
    input.dragDistanceX > input.referenceSpanWidth + Math.max(24, input.referenceSpanWidth * 0.5) &&
    pointerCompact.length > baseCompact.length
  );
  const pointerStronglyTracksVisualDrag =
    input.viewportRectCount <= 3 &&
    pointerBoundaryDistance <= Math.max(10, baseBoundaryDistance + 1) &&
    pointerCompact !== baseCompact &&
    !pointerCompact.includes(domCompact) &&
    !domCompact.includes(pointerCompact);
  const pointerIsTrimmedVisualSubset =
    baseCompact.includes(pointerCompact) &&
    pointerCompact.length >= Math.max(12, Math.ceil(baseCompact.length * 0.35)) &&
    baseCompact.length > pointerCompact.length + 8 &&
    pointerBoundaryDistance <= baseBoundaryDistance + Math.max(12, input.viewportRectCount * 4) &&
    pointerFeatures.overlap >= Math.max(0.08, baseFeatures.overlap - 0.12);
  const pointerMatchesShortVisualOnlySelection =
    !domCompact &&
    input.viewportRectCount === 1 &&
    pointerCompact.length >= 4 &&
    pointerCompact.length < baseCompact.length &&
    pointerFeatures.overlap >= Math.max(0.70, baseFeatures.overlap - 0.08) &&
    pointerBoundaryDistance <= baseBoundaryDistance + 2;

  if (!domCompact) {
    const pointerLooksLikeMinorTrimOfGeometry =
      baseCompact.includes(pointerCompact) &&
      baseCompact.length <= pointerCompact.length + Math.max(8, Math.ceil(baseCompact.length * 0.15));
    if (
      input.viewportRectCount === 1 &&
      pointerCompact !== baseCompact &&
      !pointerLooksLikeMinorTrimOfGeometry
    ) {
      return input.pointerSelection;
    }
    if (pointerMatchesShortVisualOnlySelection || pointerStronglyTracksVisualDrag) {
      return input.pointerSelection;
    }
    return chooseBestSelectionCandidate([
      baseFeatures,
      pointerFeatures,
    ]) ?? input.baseSelection;
  }

  if (pointerCompact === domCompact) {
    return input.pointerSelection;
  }

  if (domLooksLikeStrayMarker) {
    return input.pointerSelection;
  }

  if (dragSuggestsWiderSelection) {
    return input.pointerSelection;
  }

  if (pointerStronglyTracksVisualDrag) {
    return input.pointerSelection;
  }

  if (pointerIsTrimmedVisualSubset) {
    return input.pointerSelection;
  }

  if (shortPointerDrivenSelection) {
    const pointerLengthDelta = Math.abs(pointerCompact.length - domCompact.length);
    const pointerContainsDom = pointerCompact.includes(domCompact);
    const domContainsPointer = domCompact.includes(pointerCompact);
    const pointerLooksPlausible =
      pointerLengthDelta <= Math.max(4, Math.ceil(domCompact.length * 0.5)) ||
      pointerContainsDom ||
      domContainsPointer;

    if (pointerLooksPlausible) {
      return input.pointerSelection;
    }

    // For short mouse-driven selections, trust pointer bounds over a conflicting DOM range.
    if (baseDistance > 0 || pointerBoundaryDistance + 2 < baseBoundaryDistance) {
      return input.pointerSelection;
    }
  }

  if (pointerBoundaryDistance + 1 < baseBoundaryDistance) {
    return input.pointerSelection;
  }
  if (baseBoundaryDistance + 1 < pointerBoundaryDistance) {
    return input.baseSelection;
  }

  if (pointerDistance < baseDistance) {
    return input.pointerSelection;
  }
  if (baseDistance < pointerDistance) {
    return input.baseSelection;
  }

  return chooseBestSelectionCandidate([
    pointerFeatures,
    baseFeatures,
  ]) ?? (
    pointerCompact.length >= baseCompact.length
      ? input.pointerSelection
      : input.baseSelection
  );
}

function isPdfWordCharacter(character: string): boolean {
  return /[\p{L}\p{N}_-]/u.test(character);
}

function expandRenderedSelectionToWord(input: {
  model: PdfPageTextModel;
  startOffset: number;
  endOffset: number;
}): { startOffset: number; endOffset: number } {
  const text = input.model.normalizedText;
  let startOffset = Math.max(0, Math.min(text.length, input.startOffset));
  let endOffset = Math.max(startOffset, Math.min(text.length, input.endOffset));

  while (startOffset > 0 && isPdfWordCharacter(text[startOffset - 1] ?? "")) {
    startOffset -= 1;
  }
  while (endOffset < text.length && isPdfWordCharacter(text[endOffset] ?? "")) {
    endOffset += 1;
  }

  return { startOffset, endOffset };
}

function shouldPreferDomSelectionOverNative(input: {
  domSelection: PdfResolvedSelection | null;
  nativeSelection: PdfResolvedSelection | null;
  viewportRects: PdfCanonicalSelection["viewportRects"];
  pointerWasUsed: boolean;
}): boolean {
  if (!input.domSelection || !input.nativeSelection) {
    return false;
  }

  const domCompact = getCompactSelectionText(input.domSelection);
  const nativeCompact = getCompactSelectionText(input.nativeSelection);
  if (!domCompact || !nativeCompact) {
    return false;
  }

  if (input.pointerWasUsed) {
    return false;
  }

  const domOverlap = getSelectionGeometryOverlapRatio({
    selection: input.domSelection,
    viewportRects: input.viewportRects,
  });
  const nativeOverlap = getSelectionGeometryOverlapRatio({
    selection: input.nativeSelection,
    viewportRects: input.viewportRects,
  });
  const domBoundaryDistance = getSelectionBoundaryDistance({
    selection: input.domSelection,
    viewportRects: input.viewportRects,
  });
  const nativeBoundaryDistance = getSelectionBoundaryDistance({
    selection: input.nativeSelection,
    viewportRects: input.viewportRects,
  });

  if (
    domOverlap >= 0.7 &&
    nativeOverlap < 0.45 &&
    nativeBoundaryDistance > Math.max(domBoundaryDistance + 24, domBoundaryDistance * 1.5)
  ) {
    return true;
  }

  if (
    domCompact !== nativeCompact &&
    getSelectionDistanceFromDom(input.domSelection, input.domSelection.textQuote.exact) === 0
  ) {
    const nativeDistanceFromDom = getSelectionDistanceFromDom(input.nativeSelection, input.domSelection.textQuote.exact);
    const maxNativeTextDrift = Math.max(4, Math.ceil(domCompact.length * 0.18));
    if (nativeDistanceFromDom > maxNativeTextDrift) {
      return true;
    }
  }

  if (domCompact === nativeCompact) {
    return domBoundaryDistance + 2 < nativeBoundaryDistance;
  }

  const nativeIsStrictSubstring =
    domCompact.includes(nativeCompact) &&
    domCompact.length - nativeCompact.length >= Math.max(6, Math.ceil(domCompact.length * 0.12));
  if (nativeIsStrictSubstring) {
    return domBoundaryDistance <= nativeBoundaryDistance + 2;
  }

  const nativeDistance = getSelectionDistanceFromDom(input.nativeSelection, input.domSelection.textQuote.exact);
  const maxAcceptableDistance = Math.max(6, Math.ceil(domCompact.length * 0.18));

  return nativeDistance > maxAcceptableDistance && domBoundaryDistance + 2 <= nativeBoundaryDistance;
}

function shouldRejectNativeSelectionForRenderedVisual(input: {
  renderedSelection: PdfResolvedSelection | null;
  nativeSelection: PdfResolvedSelection | null;
  liveSelectedText: string;
  viewportRects: PdfCanonicalSelection["viewportRects"];
  pointerWasUsed: boolean;
}): boolean {
  if (!input.renderedSelection || !input.nativeSelection || input.pointerWasUsed) {
    return false;
  }

  const renderedCompact = getCompactSelectionText(input.renderedSelection);
  const nativeCompact = getCompactSelectionText(input.nativeSelection);
  if (!renderedCompact || !nativeCompact || renderedCompact === nativeCompact) {
    return false;
  }

  const liveCompact = stripPdfWhitespace(normalizeComparablePdfText(input.liveSelectedText));
  const renderedOverlap = getSelectionGeometryOverlapRatio({
    selection: input.renderedSelection,
    viewportRects: input.viewportRects,
  });
  const nativeOverlap = getSelectionGeometryOverlapRatio({
    selection: input.nativeSelection,
    viewportRects: input.viewportRects,
  });
  const renderedBoundaryDistance = getSelectionBoundaryDistance({
    selection: input.renderedSelection,
    viewportRects: input.viewportRects,
  });
  const nativeBoundaryDistance = getSelectionBoundaryDistance({
    selection: input.nativeSelection,
    viewportRects: input.viewportRects,
  });
  const renderedTracksVisualSelection =
    renderedOverlap >= 0.65 &&
    renderedBoundaryDistance <= Math.max(12, nativeBoundaryDistance + 2);

  if (renderedTracksVisualSelection && nativeOverlap + 0.12 < renderedOverlap) {
    return true;
  }

  if (
    liveCompact &&
    nativeCompact === liveCompact &&
    renderedCompact !== liveCompact &&
    renderedTracksVisualSelection &&
    nativeBoundaryDistance > renderedBoundaryDistance + 8
  ) {
    return true;
  }

  return renderedTracksVisualSelection && nativeBoundaryDistance > Math.max(renderedBoundaryDistance + 18, renderedBoundaryDistance * 1.5);
}

function buildResolvedSelectionFromOffsets(input: {
  pageNumber: number;
  pageText: string;
  startOffset: number;
  endOffset: number;
  viewportRects: PdfCanonicalSelection["viewportRects"];
  pageWidth: number;
  pageHeight: number;
  selectedText: string;
  model?: PdfPageTextModel;
  source?: PdfTextQuote["source"];
  confidence?: PdfTextQuote["confidence"];
}): PdfResolvedSelection | null {
  const selectedText = buildReadablePdfSelectionText({
    model: input.model,
    startOffset: input.startOffset,
    endOffset: input.endOffset,
    viewportRects: input.viewportRects,
    pageNumber: input.pageNumber,
    fallbackText: input.selectedText,
  });
  const { exact, source } = resolveExactSelectionText({
    selectedText,
    pageText: input.pageText,
    startOffset: input.startOffset,
    endOffset: input.endOffset,
  });
  const textQuote = buildTextQuote({
    pageText: input.pageText,
    startOffset: input.startOffset,
    endOffset: input.endOffset,
    exact,
    source: input.source ?? source,
    confidence: input.confidence,
  });
  if (!textQuote.exact) {
    return null;
  }

  const pageRects = input.viewportRects
    .filter((rect) => rect.pageNumber === input.pageNumber)
    .map((rect) => ({
      x1: Math.max(0, Math.min(1, rect.left / input.pageWidth)),
      y1: Math.max(0, Math.min(1, rect.top / input.pageHeight)),
      x2: Math.max(0, Math.min(1, (rect.left + rect.width) / input.pageWidth)),
      y2: Math.max(0, Math.min(1, (rect.top + rect.height) / input.pageHeight)),
    }))
    .filter((rect) => rect.x2 > rect.x1 && rect.y2 > rect.y1);

  if (pageRects.length === 0) {
    return null;
  }

  return {
    pageNumber: input.pageNumber,
    startOffset: input.startOffset,
    endOffset: input.endOffset,
    text: textQuote.exact,
    textQuote: {
      ...textQuote,
      exact: textQuote.exact,
    },
    pageRects,
    viewportRects: input.viewportRects,
  };
}

function rebuildFinalSelectionGeometryFromOffsets(input: {
  selection: PdfResolvedSelection;
  model: PdfPageTextModel;
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
}): PdfResolvedSelection {
  if (
    input.selection.pageNumber !== input.pageNumber ||
    input.selection.endOffset <= input.selection.startOffset ||
    (
      input.selection.textSource &&
      input.selection.textSource !== "pdfjs-text-model"
    ) ||
    (
      !input.selection.textSource &&
      input.selection.textQuote.source !== "pdfjs-text-model"
    )
  ) {
    return input.selection;
  }

  const offsetReadableText = buildPdfReadableTextForOffsets(
    input.model,
    input.selection.startOffset,
    input.selection.endOffset,
  ) ?? input.model.normalizedText.slice(input.selection.startOffset, input.selection.endOffset);
  const exactCompact = stripPdfWhitespace(normalizeComparablePdfText(input.selection.textQuote.exact));
  const offsetCompact = stripPdfWhitespace(normalizeComparablePdfText(offsetReadableText));
  if (!exactCompact || exactCompact !== offsetCompact) {
    return input.selection;
  }

  const offsetPageRects = buildPdfRectsForOffsets(
    input.model,
    input.selection.startOffset,
    input.selection.endOffset,
  )
    .filter((rect) => rect.x2 > rect.x1 && rect.y2 > rect.y1);
  if (offsetPageRects.length === 0) {
    return input.selection;
  }

  if (rectsApproximatelyEqual(input.selection.pageRects, offsetPageRects)) {
    return input.selection;
  }
  if (!shouldUseOffsetTextMarkupGeometry({
    selection: input.selection,
    offsetPageRects,
    pageNumber: input.pageNumber,
    pageWidth: input.pageWidth,
    pageHeight: input.pageHeight,
  })) {
    return input.selection;
  }

  const pageRects = offsetPageRects;

  const viewportRects = normalizeViewportRects(pageRects.map((rect) => ({
    left: rect.x1 * input.pageWidth,
    top: rect.y1 * input.pageHeight,
    width: (rect.x2 - rect.x1) * input.pageWidth,
    height: (rect.y2 - rect.y1) * input.pageHeight,
    pageNumber: input.pageNumber,
  })));
  if (viewportRects.length === 0) {
    return input.selection;
  }

  const quads = pageRects.map((rect) => ({
    x1: rect.x1,
    y1: rect.y1,
    x2: rect.x2,
    y2: rect.y1,
    x3: rect.x2,
    y3: rect.y2,
    x4: rect.x1,
    y4: rect.y2,
  }));

  return {
    ...input.selection,
    pageRects,
    viewportRects,
    quads,
    textKernelVersion: input.selection.textKernelVersion ?? 1,
    textSource: input.selection.textSource ?? "pdfjs-text-model",
  };
}

function rectsApproximatelyEqual(left: BoundingBox[], right: BoundingBox[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((leftRect, index) => {
    const rightRect = right[index];
    if (!rightRect) {
      return false;
    }
    return Math.abs(leftRect.x1 - rightRect.x1) < 0.001 &&
      Math.abs(leftRect.y1 - rightRect.y1) < 0.001 &&
      Math.abs(leftRect.x2 - rightRect.x2) < 0.001 &&
      Math.abs(leftRect.y2 - rightRect.y2) < 0.001;
  });
}

function shouldUseOffsetTextMarkupGeometry(input: {
  selection: PdfResolvedSelection;
  offsetPageRects: BoundingBox[];
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
}): boolean {
  const currentPageRects = input.selection.pageRects.filter((rect) => rect.x2 > rect.x1 && rect.y2 > rect.y1);
  if (currentPageRects.length === 0) {
    return true;
  }
  if (rectsApproximatelyEqual(currentPageRects, input.offsetPageRects)) {
    return false;
  }
  if (isLikelyCoarseFinalTextMarkupGeometry(input)) {
    return true;
  }

  const currentMaxHeight = Math.max(...currentPageRects.map((rect) => rect.y2 - rect.y1));
  const offsetMaxHeight = Math.max(...input.offsetPageRects.map((rect) => rect.y2 - rect.y1));
  const currentMaxWidth = Math.max(...currentPageRects.map((rect) => rect.x2 - rect.x1));
  const offsetMaxWidth = Math.max(...input.offsetPageRects.map((rect) => rect.x2 - rect.x1));
  const currentArea = currentPageRects.reduce((sum, rect) => sum + Math.max(0, rect.x2 - rect.x1) * Math.max(0, rect.y2 - rect.y1), 0);
  const offsetArea = input.offsetPageRects.reduce((sum, rect) => sum + Math.max(0, rect.x2 - rect.x1) * Math.max(0, rect.y2 - rect.y1), 0);

  return currentMaxHeight > offsetMaxHeight * 1.75 ||
    currentMaxWidth > offsetMaxWidth * 1.35 ||
    currentArea > offsetArea * 1.5;
}

function isLikelyCoarseFinalTextMarkupGeometry(input: {
  selection: PdfResolvedSelection;
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
}): boolean {
  const viewportRects = normalizeViewportRects(
    input.selection.viewportRects.filter((rect) => rect.pageNumber === input.pageNumber),
  );
  if (viewportRects.length === 0) {
    return true;
  }

  const compactLength = stripPdfWhitespace(normalizeComparablePdfText(input.selection.textQuote.exact)).length;
  const wordCount = (input.selection.textQuote.exact.match(/[\p{L}\p{N}]+/gu) ?? []).length;
  const likelyMultiLineText = compactLength >= 48 || wordCount >= 8;
  const maxViewportHeightRatio = Math.max(...viewportRects.map((rect) => rect.height / Math.max(1, input.pageHeight)));
  const maxPageRectHeightRatio = input.selection.pageRects.length > 0
    ? Math.max(...input.selection.pageRects.map((rect) => Math.max(0, rect.y2 - rect.y1)))
    : 0;
  const spansSeveralRows = maxViewportHeightRatio > 0.045 || maxPageRectHeightRatio > 0.045;
  if (spansSeveralRows && viewportRects.length <= 1) {
    return true;
  }

  return likelyMultiLineText && viewportRects.length <= 1 && maxViewportHeightRatio > 0.028;
}

function reconcileSelectionGeometryWithViewportRects(input: {
  selection: PdfResolvedSelection;
  viewportRects: PdfCanonicalSelection["viewportRects"];
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
}): PdfResolvedSelection {
  const medianLineHeight = getMedianPositive(
    input.selection.viewportRects
      .filter((rect) => rect.pageNumber === input.pageNumber)
      .map((rect) => rect.height),
  );
  const referenceViewportRects = normalizeViewportRects(
    input.viewportRects
      .filter((rect) => rect.pageNumber === input.pageNumber)
      .filter((rect) => !isImplausibleTextSelectionViewportRect({
        rect,
        pageWidth: input.pageWidth,
        pageHeight: input.pageHeight,
        medianLineHeight,
      })),
  );
  if (referenceViewportRects.length === 0) {
    return input.selection;
  }
  const candidateViewportRects = normalizeViewportRects(
    input.selection.viewportRects.filter((rect) => rect.pageNumber === input.pageNumber),
  );
  const clippedViewportRects = candidateViewportRects.flatMap((candidateRect) => (
    referenceViewportRects
      .map((referenceRect) => getViewportRectIntersection(candidateRect, referenceRect))
      .filter((intersection): intersection is NonNullable<ReturnType<typeof getViewportRectIntersection>> => Boolean(intersection))
      .map((intersection) => ({
        left: intersection.left,
        top: intersection.top,
        width: intersection.width,
        height: intersection.height,
        pageNumber: input.pageNumber,
      }))
  ));
  const nextViewportRects = normalizeViewportRects(
    clippedViewportRects.length > 0
      ? clippedViewportRects
      : candidateViewportRects.length > 0
        ? candidateViewportRects
        : referenceViewportRects,
  );

  const pageRects = nextViewportRects.map((rect) => ({
    x1: Math.max(0, Math.min(1, rect.left / input.pageWidth)),
    y1: Math.max(0, Math.min(1, rect.top / input.pageHeight)),
    x2: Math.max(0, Math.min(1, (rect.left + rect.width) / input.pageWidth)),
    y2: Math.max(0, Math.min(1, (rect.top + rect.height) / input.pageHeight)),
  })).filter((rect) => rect.x2 > rect.x1 && rect.y2 > rect.y1);

  if (pageRects.length === 0) {
    return input.selection;
  }

  return {
    ...input.selection,
    pageRects,
    viewportRects: nextViewportRects,
  };
}

function ensureSelectionHasViewportRects(input: {
  selection: PdfResolvedSelection;
  fallbackViewportRects: PdfCanonicalSelection["viewportRects"];
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
}): PdfResolvedSelection {
  if (input.selection.viewportRects.some((rect) => rect.pageNumber === input.pageNumber)) {
    return input.selection;
  }

  const fallbackViewportRects = normalizeViewportRects(
    input.fallbackViewportRects.filter((rect) => rect.pageNumber === input.pageNumber),
  );
  if (fallbackViewportRects.length === 0) {
    return input.selection;
  }

  return reconcileSelectionGeometryWithViewportRects({
    selection: input.selection,
    viewportRects: fallbackViewportRects,
    pageNumber: input.pageNumber,
    pageWidth: input.pageWidth,
    pageHeight: input.pageHeight,
  });
}

function resolveNativeSelectionFromDomOffsets(input: {
  layout: PdfNativePageTextLayout;
  domPageText: string;
  domStartOffset: number;
  domEndOffset: number;
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
}): PdfResolvedSelection | null {
  const nativeModel = buildNativeTextModel(input.layout);
  const compactMatch = resolveNativeCompactMatch({
    domPageText: input.domPageText,
    domStartOffset: input.domStartOffset,
    domEndOffset: input.domEndOffset,
    nativeModel,
  });

  if (!compactMatch) {
    return null;
  }

  const normalizedStart = nativeModel.compact.compactStartToNormalized[compactMatch.compactStart];
  const normalizedEnd = nativeModel.compact.compactEndToNormalized[compactMatch.compactEnd];
  if (
    typeof normalizedStart !== "number" ||
    typeof normalizedEnd !== "number" ||
    normalizedEnd <= normalizedStart
  ) {
    return null;
  }

  const viewportRects = buildViewportRectsFromNativeChars({
    nativeChars: nativeModel.chars,
    startOffset: normalizedStart,
    endOffset: normalizedEnd,
    layout: input.layout,
    pageWidth: input.pageWidth,
    pageHeight: input.pageHeight,
    pageNumber: input.pageNumber,
  });

  return buildResolvedSelectionFromOffsets({
    pageNumber: input.pageNumber,
    pageText: nativeModel.normalizedText,
    startOffset: normalizedStart,
    endOffset: normalizedEnd,
    viewportRects,
    pageWidth: input.pageWidth,
    pageHeight: input.pageHeight,
    selectedText: nativeModel.normalizedText.slice(normalizedStart, normalizedEnd),
    source: "pdfium-native",
    confidence: "validated-native",
  });
}

export function resolvePdfSelectionFromDomRange(input: {
  range: Range;
  text: string;
  pages: PdfRenderedPageContext[];
  nativeLayout?: PdfNativePageTextLayout | null;
  clientRects?: PdfSelectionClientRect[];
  dragStartPoint?: { x: number; y: number };
  dragEndPoint?: { x: number; y: number };
  ignoreDomText?: boolean;
}): PdfSelectionResolutionResult {
  const startPageElement = findPdfPageElementForNode(input.range.startContainer);
  const endPageElement = findPdfPageElementForNode(input.range.endContainer);
  const hasExplicitSelectionClientRects = Boolean(input.clientRects && input.clientRects.length > 0);
  const clientRects: PdfSelectionClientRect[] = hasExplicitSelectionClientRects && input.clientRects
    ? input.clientRects
    : rangeToClientRects(input.range);
  const pageGeometries = input.pages.map((page) => {
    const pageRect = page.element.getBoundingClientRect();
    return {
      pageNumber: page.pageNumber,
      left: pageRect.left,
      top: pageRect.top,
      width: pageRect.width,
      height: pageRect.height,
    };
  });
  const viewportRects = projectPdfSelectionRectsToPages({
    clientRects,
    pages: pageGeometries,
  });

  if (!startPageElement || !endPageElement) {
    return {
      ok: false,
      reason: "missing-page",
      viewportRects,
    };
  }

  const startPageNumber = Number(startPageElement.dataset.pageNumber ?? "0");
  const endPageNumber = Number(endPageElement.dataset.pageNumber ?? "0");
  if (
    !Number.isInteger(startPageNumber) ||
    !Number.isInteger(endPageNumber) ||
    startPageNumber < 1 ||
    endPageNumber < 1
  ) {
    return {
      ok: false,
      reason: "missing-page",
      viewportRects,
    };
  }

  if (startPageNumber !== endPageNumber) {
    return {
      ok: false,
      reason: "cross-page",
      viewportRects,
    };
  }

  const page = input.pages.find((candidate) => candidate.pageNumber === startPageNumber);
  if (!page) {
    return {
      ok: false,
      reason: "missing-page",
      viewportRects,
    };
  }

  const pageModel = buildRenderedPdfPageTextModel(page.element);
  if (!pageModel) {
    return {
      ok: false,
      reason: "missing-text-layer",
      viewportRects,
    };
  }

  const startOffset = resolvePdfPageTextOffset({
    model: pageModel,
    container: input.range.startContainer,
    offset: input.range.startOffset,
    affinity: "start",
  });
  const endOffset = resolvePdfPageTextOffset({
    model: pageModel,
    container: input.range.endContainer,
    offset: input.range.endOffset,
    affinity: "end",
  });

  const hasPointerGeometry = hasMeaningfulDrag(input);
  const geometryFirst = Boolean(input.ignoreDomText && (hasExplicitSelectionClientRects || hasPointerGeometry));
  const hasResolvedDomOffsets = startOffset !== null && endOffset !== null && endOffset > startOffset;

  if (!hasResolvedDomOffsets && !geometryFirst) {
    return {
      ok: false,
      reason: "unresolved-text",
      viewportRects,
    };
  }

  const domSelectedText = hasResolvedDomOffsets ? pageModel.normalizedText.slice(startOffset, endOffset) : "";
  if (!domSelectedText && !geometryFirst) {
    return {
      ok: false,
      reason: "unresolved-text",
      viewportRects,
    };
  }

  const offsetViewportRects = hasResolvedDomOffsets
    ? buildViewportRectsFromRenderedTextOffsets({
        model: pageModel,
        startOffset,
        endOffset,
        pageNumber: startPageNumber,
      })
    : [];
  const projectedViewportRectFilter = filterImplausibleTextSelectionViewportRects({
    viewportRects,
    model: pageModel,
    pageNumber: startPageNumber,
    pageWidth: page.width,
    pageHeight: page.height,
  });
  const offsetViewportRectFilter = filterImplausibleTextSelectionViewportRects({
    viewportRects: offsetViewportRects,
    model: pageModel,
    pageNumber: startPageNumber,
    pageWidth: page.width,
    pageHeight: page.height,
  });
  const filteredViewportRects = projectedViewportRectFilter.viewportRects;
  const filteredOffsetViewportRects = offsetViewportRectFilter.viewportRects;
  const hasImplausibleSelectionGeometry = projectedViewportRectFilter.removedCount > 0 || offsetViewportRectFilter.removedCount > 0;
  const rawSelectionViewportRects = filteredViewportRects.length > 0 ? filteredViewportRects : filteredOffsetViewportRects;
  const dragConstrainedViewportRects = constrainViewportRectsToDragBounds({
    viewportRects: rawSelectionViewportRects,
    pageElement: page.element,
    pageNumber: startPageNumber,
    dragStartPoint: input.dragStartPoint,
    dragEndPoint: input.dragEndPoint,
    preserveLineEdges: geometryFirst,
  });
  const selectionViewportRects = geometryFirst
    ? dragConstrainedViewportRects
    : constrainViewportRectsToBoundaryTextColumn({
        viewportRects: dragConstrainedViewportRects,
        model: pageModel,
        pageNumber: startPageNumber,
        startOffset: startOffset ?? 0,
        endOffset: endOffset ?? 0,
      });
  const domOffsetViewportRects = filteredOffsetViewportRects.length > 0 ? filteredOffsetViewportRects : selectionViewportRects;
  const fallbackViewportRectsForSelection = domOffsetViewportRects.length > 0
    ? domOffsetViewportRects
    : selectionViewportRects;
  const liveSelectedText = geometryFirst ? "" : input.text;
  const domOffsetText = geometryFirst ? "" : domSelectedText;
  const finalizeResolvedSelection = (selection: PdfResolvedSelection): PdfResolvedSelection => {
    const quoteReconciledSelection = reconcileSelectionQuoteWithLiveDomText({
      selection: ensureSelectionHasViewportRects({
        selection,
        fallbackViewportRects: fallbackViewportRectsForSelection,
        pageNumber: startPageNumber,
        pageWidth: page.width,
        pageHeight: page.height,
      }),
      liveSelectedText,
      domOffsetText,
    });
    return rebuildFinalSelectionGeometryFromOffsets({
      selection: quoteReconciledSelection,
      model: pageModel,
      pageNumber: startPageNumber,
      pageWidth: page.width,
      pageHeight: page.height,
    });
  };
  const strictDomSelection = hasResolvedDomOffsets && domSelectedText
    ? buildResolvedSelectionFromOffsets({
        pageNumber: startPageNumber,
        pageText: pageModel.normalizedText,
        startOffset,
        endOffset,
        viewportRects: domOffsetViewportRects,
        pageWidth: page.width,
        pageHeight: page.height,
        selectedText: domSelectedText,
        model: pageModel,
      })
    : null;
  const renderedGeometrySelection = resolveRenderedSelectionFromViewportRects({
    model: pageModel,
    viewportRects: selectionViewportRects,
    pageNumber: startPageNumber,
    pageWidth: page.width,
    pageHeight: page.height,
  });
  const shouldUseRenderedTextSearch = Boolean(
    !geometryFirst &&
    input.text &&
    stripPdfWhitespace(normalizeComparablePdfText(input.text)) !== stripPdfWhitespace(normalizeComparablePdfText(domSelectedText)) &&
    !isCjkSameLengthTextConflict(input.text, domSelectedText),
  );
  const renderedTextSearchSelection = shouldUseRenderedTextSearch
    ? resolveRenderedSelectionFromSelectedTextAndGeometry({
        model: pageModel,
        viewportRects: selectionViewportRects,
        selectedText: input.text,
        pageNumber: startPageNumber,
        pageWidth: page.width,
        pageHeight: page.height,
      })
    : null;
  const renderedPointerSelection = hasMeaningfulDrag(input)
    ? (
        resolveRenderedSelectionFromZoteroPointerRange({
          model: pageModel,
          pageElement: page.element,
          pageNumber: startPageNumber,
          pageWidth: page.width,
          pageHeight: page.height,
          dragStartPoint: input.dragStartPoint,
          dragEndPoint: input.dragEndPoint,
        }) ?? resolveRenderedSelectionFromPointerBounds({
          model: pageModel,
          pageElement: page.element,
          pageNumber: startPageNumber,
          pageWidth: page.width,
          pageHeight: page.height,
          dragStartPoint: input.dragStartPoint,
          dragEndPoint: input.dragEndPoint,
        })
      )
    : null;
  if (hasImplausibleSelectionGeometry && renderedPointerSelection) {
    return {
      ok: true,
      selection: finalizeResolvedSelection(renderedPointerSelection),
    };
  }
  if (geometryFirst) {
    if (
      renderedPointerSelection &&
      isResolvedSelectionAtWordBoundaries(renderedPointerSelection, pageModel.normalizedText)
    ) {
      return {
        ok: true,
        selection: finalizeResolvedSelection(renderedPointerSelection),
      };
    }
    if (renderedPointerSelection && isTrustworthyMultiLinePointerSelection(renderedPointerSelection)) {
      return {
        ok: true,
        selection: finalizeResolvedSelection(renderedPointerSelection),
      };
    }

    const rectDrivenSelection = resolveRenderedSelectionFromZoteroHighlightRects({
      model: pageModel,
      viewportRects: selectionViewportRects,
      pageNumber: startPageNumber,
      pageWidth: page.width,
      pageHeight: page.height,
    });
    if (
      rectDrivenSelection &&
      renderedPointerSelection &&
      dragEndpointsMissSingleRect({
        pageElement: page.element,
        viewportRects: selectionViewportRects,
        pageNumber: startPageNumber,
        dragStartPoint: input.dragStartPoint,
        dragEndPoint: input.dragEndPoint,
      })
    ) {
      return {
        ok: true,
        selection: finalizeResolvedSelection(renderedPointerSelection),
      };
    }
    const zoteroGeometrySelection = chooseZoteroGeometrySelection({
      rectSelection: rectDrivenSelection,
      pointerSelection: renderedPointerSelection,
      rectCount: selectionViewportRects.filter((rect) => rect.pageNumber === startPageNumber).length,
    });
    if (zoteroGeometrySelection) {
      return {
        ok: true,
        selection: finalizeResolvedSelection(zoteroGeometrySelection),
      };
    }

    const viewportRectCount = selectionViewportRects.filter((rect) => rect.pageNumber === startPageNumber).length;
    const geometryFirstSelection = choosePreferredPointerSelection({
      baseSelection: renderedGeometrySelection,
      pointerSelection: renderedPointerSelection,
      domSelectedText: "",
      viewportRectCount,
      viewportRects: selectionViewportRects,
      dragDistanceX: input.dragStartPoint && input.dragEndPoint
        ? Math.abs(input.dragEndPoint.x - input.dragStartPoint.x)
        : undefined,
      referenceSpanWidth: viewportRectCount > 0
        ? (
            Math.max(...selectionViewportRects.filter((rect) => rect.pageNumber === startPageNumber).map((rect) => rect.left + rect.width)) -
            Math.min(...selectionViewportRects.filter((rect) => rect.pageNumber === startPageNumber).map((rect) => rect.left))
          )
        : undefined,
    });
    if (geometryFirstSelection) {
      return {
        ok: true,
        selection: finalizeResolvedSelection(geometryFirstSelection),
      };
    }
  }

  if (input.nativeLayout) {
    const nativeModel = buildNativeTextModel(input.nativeLayout);
    const offsetSelection = hasResolvedDomOffsets
      ? resolveNativeSelectionFromDomOffsets({
          layout: input.nativeLayout,
          domPageText: pageModel.normalizedText,
          domStartOffset: startOffset,
          domEndOffset: endOffset,
          pageNumber: startPageNumber,
          pageWidth: page.width,
          pageHeight: page.height,
        })
      : null;
    const geometrySelection = resolveNativeSelectionFromViewportRects({
      layout: input.nativeLayout,
      nativeModel,
      viewportRects: selectionViewportRects,
      pageNumber: startPageNumber,
      pageWidth: page.width,
      pageHeight: page.height,
    });
    const pointerSelection = hasMeaningfulDrag(input)
      ? resolveNativeSelectionFromPointerBounds({
          layout: input.nativeLayout,
          nativeModel,
          pageElement: page.element,
          pageNumber: startPageNumber,
          pageWidth: page.width,
          pageHeight: page.height,
          dragStartPoint: input.dragStartPoint,
          dragEndPoint: input.dragEndPoint,
        })
      : null;
    const selectionCandidateText = liveSelectedText || domSelectedText;
    const textSearchSelection = selectionCandidateText
      ? resolveNativeSelectionFromSelectedTextAndGeometry({
          layout: input.nativeLayout,
          nativeModel,
          viewportRects: selectionViewportRects,
          selectedText: selectionCandidateText,
          pageNumber: startPageNumber,
          pageWidth: page.width,
          pageHeight: page.height,
        })
      : null;
    const viewportRectCount = selectionViewportRects.filter((rect) => rect.pageNumber === startPageNumber).length;
    const baseNativeSelection = choosePreferredNativeSelection({
      offsetSelection,
      geometrySelection,
      textSearchSelection,
      domSelectedText: selectionCandidateText,
      viewportRectCount,
      viewportRects: selectionViewportRects,
    });
    const nativeSelection = choosePreferredPointerSelection({
      baseSelection: baseNativeSelection,
      pointerSelection,
      domSelectedText: selectionCandidateText,
      viewportRectCount,
      viewportRects: selectionViewportRects,
      dragDistanceX: input.dragStartPoint && input.dragEndPoint
        ? Math.abs(input.dragEndPoint.x - input.dragStartPoint.x)
        : undefined,
      referenceSpanWidth: viewportRectCount > 0
        ? (
            Math.max(...selectionViewportRects.filter((rect) => rect.pageNumber === startPageNumber).map((rect) => rect.left + rect.width)) -
            Math.min(...selectionViewportRects.filter((rect) => rect.pageNumber === startPageNumber).map((rect) => rect.left))
          )
        : undefined,
    });
    const nativeMatchesLiveSelection = selectionTextMatchesLiveText(nativeSelection, selectionCandidateText);
    const nativePointerTracksSelection = Boolean(pointerSelection && nativeSelection === pointerSelection);
    const safeNativeSelection = nativeMatchesLiveSelection || nativePointerTracksSelection ? nativeSelection : null;
    const pointerWasUsed = Boolean(pointerSelection && safeNativeSelection === pointerSelection);

    if (!safeNativeSelection) {
      const fallbackSelection = choosePreferredRenderedSelection({
        domSelection: strictDomSelection,
        geometrySelection: renderedGeometrySelection,
        viewportRects: selectionViewportRects,
        allowGeometryOverride: hasExplicitSelectionClientRects,
        liveSelectedText,
      });
      const pointerFallbackSelection = choosePreferredPointerSelection({
        baseSelection: fallbackSelection,
        pointerSelection: renderedPointerSelection,
        domSelectedText: selectionCandidateText,
        viewportRectCount,
        viewportRects: selectionViewportRects,
        dragDistanceX: input.dragStartPoint && input.dragEndPoint
          ? Math.abs(input.dragEndPoint.x - input.dragStartPoint.x)
          : undefined,
        referenceSpanWidth: viewportRectCount > 0
          ? (
              Math.max(...selectionViewportRects.filter((rect) => rect.pageNumber === startPageNumber).map((rect) => rect.left + rect.width)) -
              Math.min(...selectionViewportRects.filter((rect) => rect.pageNumber === startPageNumber).map((rect) => rect.left))
            )
          : undefined,
      });
      if (pointerFallbackSelection) {
        return {
          ok: true,
          selection: finalizeResolvedSelection(pointerFallbackSelection),
        };
      }

      return {
        ok: false,
        reason: "unresolved-text",
        viewportRects,
      };
    }

    const renderedFallbackSelection = choosePreferredRenderedSelection({
      domSelection: strictDomSelection,
      geometrySelection: renderedGeometrySelection,
      viewportRects: selectionViewportRects,
      allowGeometryOverride: hasExplicitSelectionClientRects,
      liveSelectedText,
    });

    if (shouldRejectNativeSelectionForRenderedVisual({
      renderedSelection: renderedFallbackSelection,
      nativeSelection: safeNativeSelection,
      liveSelectedText,
      viewportRects: selectionViewportRects,
      pointerWasUsed,
    })) {
      if (renderedFallbackSelection) {
        const geometryReconciledSelection = hasExplicitSelectionClientRects
          ? reconcileSelectionGeometryWithViewportRects({
              selection: renderedFallbackSelection,
              viewportRects: selectionViewportRects,
              pageNumber: startPageNumber,
              pageWidth: page.width,
              pageHeight: page.height,
            })
          : renderedFallbackSelection;
        return {
          ok: true,
          selection: finalizeResolvedSelection(geometryReconciledSelection),
        };
      }
    }

    if (shouldPreferDomSelectionOverNative({
      domSelection: renderedFallbackSelection,
      nativeSelection: safeNativeSelection,
      viewportRects: selectionViewportRects,
      pointerWasUsed,
    })) {
      if (renderedFallbackSelection) {
        const geometryReconciledSelection = hasExplicitSelectionClientRects
          ? reconcileSelectionGeometryWithViewportRects({
              selection: renderedFallbackSelection,
              viewportRects: selectionViewportRects,
              pageNumber: startPageNumber,
              pageWidth: page.width,
              pageHeight: page.height,
            })
          : renderedFallbackSelection;
        return {
          ok: true,
          selection: finalizeResolvedSelection(geometryReconciledSelection),
        };
      }
    }

    const geometryReconciledNativeSelection = hasExplicitSelectionClientRects
      ? reconcileSelectionGeometryWithViewportRects({
          selection: safeNativeSelection,
          viewportRects: selectionViewportRects,
          pageNumber: startPageNumber,
          pageWidth: page.width,
          pageHeight: page.height,
        })
      : safeNativeSelection;
    return {
      ok: true,
      selection: finalizeResolvedSelection(geometryReconciledNativeSelection),
    };
  }

  const renderedSelection = choosePreferredRenderedSelection({
    domSelection: strictDomSelection,
    geometrySelection: chooseBestSelectionCandidate([
      buildSelectionCandidateFeatures({
        selection: renderedGeometrySelection,
        kind: "geometry",
        referenceText: liveSelectedText || domSelectedText,
        viewportRects: selectionViewportRects,
      }),
      buildSelectionCandidateFeatures({
        selection: renderedTextSearchSelection,
        kind: "textSearch",
        referenceText: liveSelectedText || domSelectedText,
        viewportRects: selectionViewportRects,
      }),
    ]),
    viewportRects: selectionViewportRects,
    allowGeometryOverride: hasExplicitSelectionClientRects,
    liveSelectedText,
  });
  const viewportRectCount = selectionViewportRects.filter((rect) => rect.pageNumber === startPageNumber).length;
  const pointerRenderedSelection = choosePreferredPointerSelection({
    baseSelection: renderedSelection,
    pointerSelection: renderedPointerSelection,
    domSelectedText: liveSelectedText || domSelectedText,
    viewportRectCount,
    viewportRects: selectionViewportRects,
    dragDistanceX: input.dragStartPoint && input.dragEndPoint
      ? Math.abs(input.dragEndPoint.x - input.dragStartPoint.x)
      : undefined,
    referenceSpanWidth: viewportRectCount > 0
      ? (
          Math.max(...selectionViewportRects.filter((rect) => rect.pageNumber === startPageNumber).map((rect) => rect.left + rect.width)) -
          Math.min(...selectionViewportRects.filter((rect) => rect.pageNumber === startPageNumber).map((rect) => rect.left))
        )
      : undefined,
  });
  if (pointerRenderedSelection) {
    return {
      ok: true,
      selection: finalizeResolvedSelection(pointerRenderedSelection),
    };
  }

  const selection = hasResolvedDomOffsets && domSelectedText
    ? buildResolvedSelectionFromOffsets({
        pageNumber: startPageNumber,
        pageText: pageModel.normalizedText,
        startOffset,
        endOffset,
        viewportRects: domOffsetViewportRects,
        pageWidth: page.width,
        pageHeight: page.height,
        selectedText: domSelectedText,
        model: pageModel,
      })
    : null;

  if (!selection) {
    return {
      ok: false,
      reason: "unresolved-text",
      viewportRects,
    };
  }

  if (
    renderedSelection &&
    isCjkSameLengthTextConflict(selection.textQuote.exact, renderedSelection.textQuote.exact)
  ) {
    const geometryReconciledRenderedSelection = hasExplicitSelectionClientRects
      ? reconcileSelectionGeometryWithViewportRects({
          selection: renderedSelection,
          viewportRects: selectionViewportRects,
          pageNumber: startPageNumber,
          pageWidth: page.width,
          pageHeight: page.height,
        })
      : renderedSelection;
    return {
      ok: true,
      selection: finalizeResolvedSelection(geometryReconciledRenderedSelection),
    };
  }

  if (renderedSelection) {
    const geometryReconciledRenderedSelection = hasExplicitSelectionClientRects
      ? reconcileSelectionGeometryWithViewportRects({
          selection: renderedSelection,
          viewportRects: selectionViewportRects,
          pageNumber: startPageNumber,
          pageWidth: page.width,
          pageHeight: page.height,
        })
      : renderedSelection;
    return {
      ok: true,
      selection: finalizeResolvedSelection(geometryReconciledRenderedSelection),
    };
  }

  const geometryReconciledSelection = hasExplicitSelectionClientRects
    ? reconcileSelectionGeometryWithViewportRects({
        selection,
        viewportRects: selectionViewportRects,
        pageNumber: startPageNumber,
        pageWidth: page.width,
        pageHeight: page.height,
      })
    : selection;
  return {
    ok: true,
    selection: finalizeResolvedSelection(geometryReconciledSelection),
  };
}

export function resolvePdfSelectionFromNativeRange(input: {
  range: Range;
  text: string;
  pages: PdfRenderedPageContext[];
  nativeLayout?: PdfNativePageTextLayout | null;
  clientRects?: PdfSelectionClientRect[];
  dragStartPoint?: { x: number; y: number };
  dragEndPoint?: { x: number; y: number };
  ignoreDomText?: boolean;
}): PdfSelectionResolutionResult {
  return resolvePdfSelectionFromDomRange(input);
}
