import type { PdfTextQuote } from "@/types/universal-annotation";
import type {
  PdfNativePageTextLayout,
  PdfNativeTextChar,
} from "@/lib/pdf-native-text-engine";
import {
  buildRenderedPdfPageTextModel,
  normalizePdfText,
  resolvePdfPageTextOffset,
} from "@/lib/pdf-page-text-cache";
import {
  projectPdfSelectionRectsToPages,
  type PdfCanonicalSelection,
  type PdfSelectionClientRect,
} from "@/lib/pdf-selection-session";

const PDF_TEXT_CONTEXT_RADIUS = 32;
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

function expandPdfLigatures(text: string): string {
  return Array.from(text ?? "", (character) => PDF_LIGATURE_MAP[character] ?? character).join("");
}

function normalizeComparablePdfText(text: string): string {
  return normalizePdfText(expandPdfLigatures(text));
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

function stripPdfWhitespace(text: string): string {
  return text.replace(/\s+/g, "");
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
  let pendingWhitespace = false;

  for (let index = 0; index < text.length; index += 1) {
    rawToNormalizedOffsets[index] = normalizedText.length;
    const expanded = expandPdfLigatures(text[index] ?? "");

    for (const character of expanded) {
      if (/\s/.test(character)) {
        if (sawNonWhitespace) {
          pendingWhitespace = true;
        }
        continue;
      }

      if (pendingWhitespace && normalizedText.length > 0 && !normalizedText.endsWith(" ")) {
        normalizedText += " ";
      }
      pendingWhitespace = false;
      normalizedText += character;
      sawNonWhitespace = true;
    }
  }

  rawToNormalizedOffsets[text.length] = normalizedText.length;
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
      const rawEnd = Math.max(rawStart, Math.min(layout.text.length, sourceChar.charIndex + sourceChar.text.length));
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
      exact: normalizedPageSlice,
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

function intersectsViewportRect(
  character: PdfNativeViewportChar,
  rect: PdfCanonicalSelection["viewportRects"][number],
): boolean {
  return !(
    character.right <= rect.left ||
    rect.left + rect.width <= character.left ||
    character.bottom <= rect.top ||
    rect.top + rect.height <= character.top
  );
}

function selectBoundaryChar(input: {
  chars: PdfNativeViewportChar[];
  rect: PdfCanonicalSelection["viewportRects"][number];
  side: "start" | "end";
}): PdfNativeViewportChar {
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
    return containing.reduce((best, character) => (
      input.side === "start"
        ? (character.normalizedStart < best.normalizedStart ? character : best)
        : (character.normalizedEnd > best.normalizedEnd ? character : best)
    ));
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

function getVerticalDistanceToChar(character: PdfNativeViewportChar, localY: number): number {
  if (localY >= character.top && localY <= character.bottom) {
    return 0;
  }
  return Math.min(
    Math.abs(localY - character.top),
    Math.abs(localY - character.bottom),
  );
}

function selectNearestLineChars(input: {
  chars: PdfNativeViewportChar[];
  localY: number;
}): PdfNativeViewportChar[] {
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
  chars: PdfNativeViewportChar[];
  point: { x: number; y: number };
  pageRect: DOMRect;
  side: "start" | "end";
}): PdfNativeViewportChar | null {
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
    return containingChars.reduce((best, character) => (
      input.side === "start"
        ? (character.normalizedStart < best.normalizedStart ? character : best)
        : (character.normalizedEnd > best.normalizedEnd ? character : best)
    ));
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

function choosePreferredNativeSelection(input: {
  offsetSelection: PdfResolvedSelection | null;
  geometrySelection: PdfResolvedSelection | null;
  textSearchSelection: PdfResolvedSelection | null;
  domSelectedText: string;
  viewportRectCount: number;
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

  const offsetCompact = getCompactSelectionText(input.offsetSelection);
  const geometryCompact = getCompactSelectionText(input.geometrySelection);
  const textSearchCompact = getCompactSelectionText(input.textSearchSelection);
  const domCompact = stripPdfWhitespace(input.domSelectedText);

  if (offsetCompact === domCompact && geometryCompact !== domCompact && textSearchCompact !== domCompact) {
    return input.offsetSelection;
  }
  if (geometryCompact === domCompact && offsetCompact !== domCompact && textSearchCompact !== domCompact) {
    return input.geometrySelection;
  }
  if (textSearchCompact === domCompact && offsetCompact !== domCompact && geometryCompact !== domCompact) {
    return input.textSearchSelection;
  }
  if (
    input.viewportRectCount > 1 &&
    geometryCompact &&
    domCompact &&
    domCompact.includes(geometryCompact) &&
    geometryCompact.length >= Math.max(1, offsetCompact.length)
  ) {
    return input.geometrySelection;
  }

  const offsetDistance = getSelectionDistanceFromDom(input.offsetSelection, input.domSelectedText);
  const geometryDistance = getSelectionDistanceFromDom(input.geometrySelection, input.domSelectedText);
  const textSearchDistance = getSelectionDistanceFromDom(input.textSearchSelection, input.domSelectedText);
  const bestDistance = Math.min(offsetDistance, geometryDistance, textSearchDistance);
  if (bestDistance === textSearchDistance) {
    return input.textSearchSelection;
  }
  if (bestDistance === geometryDistance) {
    return input.geometrySelection;
  }
  if (bestDistance === offsetDistance) {
    return input.offsetSelection;
  }

  if (textSearchCompact.length > Math.max(offsetCompact.length, geometryCompact.length)) {
    return input.textSearchSelection;
  }

  return geometryCompact.length > offsetCompact.length
    ? input.geometrySelection
    : input.offsetSelection;
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

  const pointerCompact = getCompactSelectionText(input.pointerSelection);
  const baseCompact = getCompactSelectionText(input.baseSelection);
  const domCompact = stripPdfWhitespace(input.domSelectedText);

  if (!pointerCompact) {
    return input.baseSelection;
  }
  if (!baseCompact) {
    return input.pointerSelection;
  }
  if (!domCompact) {
    return input.pointerSelection;
  }

  const pointerDistance = getSelectionDistanceFromDom(input.pointerSelection, input.domSelectedText);
  const baseDistance = getSelectionDistanceFromDom(input.baseSelection, input.domSelectedText);
  const pointerBoundaryDistance = getSelectionBoundaryDistance({
    selection: input.pointerSelection,
    viewportRects: input.viewportRects,
  });
  const baseBoundaryDistance = getSelectionBoundaryDistance({
    selection: input.baseSelection,
    viewportRects: input.viewportRects,
  });
  const shortPointerDrivenSelection =
    input.viewportRectCount <= 2 &&
    domCompact.length <= 96 &&
    pointerCompact.length <= 96;
  const dragSuggestsWiderSelection = (
    typeof input.dragDistanceX === "number" &&
    typeof input.referenceSpanWidth === "number" &&
    input.dragDistanceX > input.referenceSpanWidth + Math.max(24, input.referenceSpanWidth * 0.5) &&
    pointerCompact.length > baseCompact.length
  );

  if (pointerCompact === domCompact) {
    return input.pointerSelection;
  }

  if (dragSuggestsWiderSelection) {
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

  return pointerCompact.length >= baseCompact.length
    ? input.pointerSelection
    : input.baseSelection;
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
  source?: PdfTextQuote["source"];
  confidence?: PdfTextQuote["confidence"];
}): PdfResolvedSelection | null {
  const { exact, source } = resolveExactSelectionText({
    selectedText: input.selectedText,
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
  dragStartPoint?: { x: number; y: number };
  dragEndPoint?: { x: number; y: number };
}): PdfSelectionResolutionResult {
  const startPageElement = findPdfPageElementForNode(input.range.startContainer);
  const endPageElement = findPdfPageElementForNode(input.range.endContainer);
  const clientRects = rangeToClientRects(input.range);
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

  if (
    startOffset === null ||
    endOffset === null ||
    endOffset <= startOffset
  ) {
    return {
      ok: false,
      reason: "unresolved-text",
      viewportRects,
    };
  }

  const domSelectedText = pageModel.normalizedText.slice(startOffset, endOffset);
  if (!domSelectedText) {
    return {
      ok: false,
      reason: "unresolved-text",
      viewportRects,
    };
  }

  if (input.nativeLayout) {
    const nativeModel = buildNativeTextModel(input.nativeLayout);
    const offsetSelection = resolveNativeSelectionFromDomOffsets({
      layout: input.nativeLayout,
      domPageText: pageModel.normalizedText,
      domStartOffset: startOffset,
      domEndOffset: endOffset,
      pageNumber: startPageNumber,
      pageWidth: page.width,
      pageHeight: page.height,
    });
    const geometrySelection = resolveNativeSelectionFromViewportRects({
      layout: input.nativeLayout,
      nativeModel,
      viewportRects,
      pageNumber: startPageNumber,
      pageWidth: page.width,
      pageHeight: page.height,
    });
    const pointerSelection = input.dragStartPoint && input.dragEndPoint
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
    const textSearchSelection = resolveNativeSelectionFromSelectedTextAndGeometry({
      layout: input.nativeLayout,
      nativeModel,
      viewportRects,
      selectedText: domSelectedText,
      pageNumber: startPageNumber,
      pageWidth: page.width,
      pageHeight: page.height,
    });
    const viewportRectCount = viewportRects.filter((rect) => rect.pageNumber === startPageNumber).length;
    const baseNativeSelection = choosePreferredNativeSelection({
      offsetSelection,
      geometrySelection,
      textSearchSelection,
      domSelectedText,
      viewportRectCount,
    });
    const nativeSelection = choosePreferredPointerSelection({
      baseSelection: baseNativeSelection,
      pointerSelection,
      domSelectedText,
      viewportRectCount,
      viewportRects,
      dragDistanceX: input.dragStartPoint && input.dragEndPoint
        ? Math.abs(input.dragEndPoint.x - input.dragStartPoint.x)
        : undefined,
      referenceSpanWidth: viewportRectCount > 0
        ? (
            Math.max(...viewportRects.filter((rect) => rect.pageNumber === startPageNumber).map((rect) => rect.left + rect.width)) -
            Math.min(...viewportRects.filter((rect) => rect.pageNumber === startPageNumber).map((rect) => rect.left))
          )
        : undefined,
    });

    if (!nativeSelection) {
      return {
        ok: false,
        reason: "unresolved-text",
        viewportRects,
      };
    }

    return {
      ok: true,
      selection: nativeSelection,
    };
  }

  const selection = buildResolvedSelectionFromOffsets({
    pageNumber: startPageNumber,
    pageText: pageModel.normalizedText,
    startOffset,
    endOffset,
    viewportRects,
    pageWidth: page.width,
    pageHeight: page.height,
    selectedText: input.text || domSelectedText,
  });

  if (!selection) {
    return {
      ok: false,
      reason: "unresolved-text",
      viewportRects,
    };
  }

  return {
    ok: true,
    selection,
  };
}

export function resolvePdfSelectionFromNativeRange(input: {
  range: Range;
  text: string;
  pages: PdfRenderedPageContext[];
  nativeLayout?: PdfNativePageTextLayout | null;
  dragStartPoint?: { x: number; y: number };
  dragEndPoint?: { x: number; y: number };
}): PdfSelectionResolutionResult {
  return resolvePdfSelectionFromDomRange(input);
}
