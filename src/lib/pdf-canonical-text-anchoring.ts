import type { BoundingBox, PdfTextQuote } from "@/types/universal-annotation";
import type {
  PdfPageTextItemRect,
  PdfPageTextLayoutClass,
  PdfPageTextModel,
} from "@/lib/pdf-page-text-cache";
import { normalizePdfReadableText } from "@/lib/pdf-readable-text";

const PDF_TEXT_CONTEXT_RADIUS = 32;
const PDF_CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]+/g;
const PDF_CONTROL_CHAR = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u;
const MAIN_LAYOUT_PRIORITY: Record<PdfPageTextLayoutClass, number> = {
  main: 0,
  list: 1,
  caption: 2,
  footnote: 3,
  metadata: 4,
  auxiliary: 5,
  equation: 6,
  sidebar: 7,
};

export interface PdfCanonicalChar {
  normalizedStart: number;
  normalizedEnd: number;
  text: string;
  itemIndex: number;
  lineIndex?: number;
  blockIndex?: number;
  columnIndex?: number;
  layoutClass: PdfPageTextLayoutClass;
  left: number;
  top: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
  centerX: number;
  centerY: number;
}

export interface PdfCanonicalBoundary {
  offset: number;
  x: number;
  y: number;
  height: number;
  lineIndex?: number;
  blockIndex?: number;
  columnIndex?: number;
  layoutClass: PdfPageTextLayoutClass;
}

export interface PdfCanonicalPointerBoundaryResult {
  offset: number;
  layoutClass: PdfPageTextLayoutClass;
  lineIndex?: number;
  blockIndex?: number;
  columnIndex?: number;
}

export interface PdfCanonicalTextAnchor {
  startOffset: number;
  endOffset: number;
  pageText: string;
  textQuote: PdfTextQuote;
  rects: BoundingBox[];
}

export interface PdfVisualColumnScope {
  boundaryX: number;
  side: "left" | "right";
}

function isVisualColumnTextChar(char: PdfCanonicalChar): boolean {
  return char.width > 0 && char.height > 0 && !/^\s$/u.test(char.text);
}

/**
 * Finds the physical gutter of a two-column text layer in the vertical band
 * touched by a selection. The rendered text model can assign a shared block
 * or column index to a heading that visually belongs to the other column, so
 * the blank horizontal band is a stronger boundary than metadata alone.
 */
export function resolvePdfVisualColumnScope(input: {
  chars: PdfCanonicalChar[];
  viewportWidth: number;
  verticalRange?: { top: number; bottom: number };
  startX: number;
  endX: number;
}): PdfVisualColumnScope | null {
  if (input.viewportWidth <= 0) {
    return null;
  }

  const allChars = input.chars.filter(isVisualColumnTextChar);
  if (allChars.length < 16) {
    return null;
  }
  const verticalTop = input.verticalRange
    ? Math.min(input.verticalRange.top, input.verticalRange.bottom)
    : Number.NEGATIVE_INFINITY;
  const verticalBottom = input.verticalRange
    ? Math.max(input.verticalRange.top, input.verticalRange.bottom)
    : Number.POSITIVE_INFINITY;
  const scopedChars = allChars.filter((char) => (
    char.centerY >= verticalTop - Math.max(2, char.height * 0.8) &&
    char.centerY <= verticalBottom + Math.max(2, char.height * 0.8)
  ));
  if (scopedChars.length < 12) {
    return null;
  }

  const centers = [...new Set(scopedChars.map((char) => Math.round(char.centerX * 100) / 100))]
    .sort((left, right) => left - right);
  if (centers.length < 4) {
    return null;
  }
  const medianWidth = [...scopedChars.map((char) => char.width)].sort((left, right) => left - right)[Math.floor(scopedChars.length / 2)] ?? 0;
  const minimumGap = Math.max(12, medianWidth * 2.5, input.viewportWidth * 0.015);
  const candidateGaps = centers.slice(1).map((right, index) => ({
    left: centers[index],
    right,
    gap: right - centers[index],
  })).filter((candidate) => (
    candidate.gap >= minimumGap &&
    candidate.left > input.viewportWidth * 0.18 &&
    candidate.right < input.viewportWidth * 0.82
  ));
  if (candidateGaps.length === 0) {
    return null;
  }

  const bestGap = candidateGaps.reduce((best, candidate) => candidate.gap > best.gap ? candidate : best);
  const boundaryX = (bestGap.left + bestGap.right) / 2;
  const leftChars = scopedChars.filter((char) => char.centerX < boundaryX);
  const rightChars = scopedChars.filter((char) => char.centerX > boundaryX);
  if (leftChars.length < 6 || rightChars.length < 6) {
    return null;
  }

  const medianHeight = [...scopedChars.map((char) => char.height)].sort((left, right) => left - right)[Math.floor(scopedChars.length / 2)] ?? 0;
  const rangeHeight = Number.isFinite(verticalTop) && Number.isFinite(verticalBottom) ? verticalBottom - verticalTop : Number.POSITIVE_INFINITY;
  const alignedRowCenters = leftChars.flatMap((leftChar) => rightChars
    .filter((rightChar) => {
      const minHeight = Math.max(1, Math.min(leftChar.height, rightChar.height));
      const verticalOverlap = Math.min(leftChar.bottom, rightChar.bottom) - Math.max(leftChar.top, rightChar.top);
      const centerDistance = Math.abs(leftChar.centerY - rightChar.centerY);
      return verticalOverlap >= minHeight * 0.35 || centerDistance <= minHeight * 0.65;
    })
    .map((rightChar) => (leftChar.centerY + rightChar.centerY) / 2))
    .sort((left, right) => left - right);
  const rowClusterTolerance = Math.max(2.5, medianHeight * 0.6);
  const alignedVisualRows = alignedRowCenters.reduce<number[]>((rows, centerY) => {
    if (rows.length === 0 || centerY - rows[rows.length - 1] > rowClusterTolerance) {
      rows.push(centerY);
    }
    return rows;
  }, []);
  if (alignedVisualRows.length < (rangeHeight <= medianHeight * 2.2 ? 1 : 2)) {
    return null;
  }

  const startSide = input.startX < boundaryX ? "left" : "right";
  const endSide = input.endX < boundaryX ? "left" : "right";
  if (startSide !== endSide) {
    return null;
  }

  return { boundaryX, side: startSide };
}

export type PdfCanonicalTextAnchorResolveReason =
  | "empty-exact"
  | "exact-not-found-in-pdf-text-model"
  | "context-mismatch"
  | "ambiguous-exact-quote"
  | "ambiguous-geometry"
  | "invalid-anchor";

export type PdfCanonicalTextAnchorResolveResult =
  | {
      ok: true;
      anchor: PdfCanonicalTextAnchor;
      candidateCount: number;
      ambiguityScore?: number;
    }
  | {
      ok: false;
      reason: PdfCanonicalTextAnchorResolveReason;
      candidateCount: number;
      candidates?: Array<{ startOffset: number; endOffset: number; rects: BoundingBox[] }>;
    };

export type PdfCanonicalTextAnchorRecoveryReason =
  | "stored-offsets-and-geometry"
  | "stored-offsets"
  | "exact-context"
  | "exact-geometry"
  | "exact-quote"
  | "context-recovery"
  | "geometry-recovery";

export type PdfCanonicalTextAnchorRecoveryResult =
  | ({
      ok: true;
      reason: PdfCanonicalTextAnchorRecoveryReason;
      confidence: number;
      source: PdfTextQuote["source"];
    } & PdfCanonicalTextAnchor)
  | {
      ok: false;
      reason: "unresolved";
      confidence: 0;
      source: PdfTextQuote["source"];
    };

function normalizeText(text: string | null | undefined): string {
  return (text ?? "").replace(PDF_CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
}

function compactText(text: string): string {
  return normalizeText(text).replace(/\s+/g, "");
}

function isPdfCompactIgnoredCharacter(character: string): boolean {
  return /\s/.test(character) || PDF_CONTROL_CHAR.test(character);
}

function isPdfLooseMathComparableCharacter(character: string): boolean {
  return character === "(" || character === ")" || character === "^";
}

function buildWhitespaceCompactIndex(text: string): { compact: string; offsets: number[] } {
  let compact = "";
  const offsets: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] ?? "";
    if (isPdfCompactIgnoredCharacter(character)) {
      continue;
    }
    compact += character;
    offsets.push(index);
  }
  return { compact, offsets };
}

function buildHyphenationInsensitiveCompactIndex(text: string): { compact: string; offsets: number[] } {
  let compact = "";
  const offsets: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] ?? "";
    if (isPdfCompactIgnoredCharacter(character)) {
      continue;
    }

    if (
      character === "-" &&
      index > 0 &&
      /[\p{L}\p{N}]/u.test(text[index - 1] ?? "") &&
      (
        index === text.length - 1 ||
        (
          /\s/.test(text[index + 1] ?? "") &&
          /[\p{L}\p{N}]/u.test(text[index + 2] ?? "")
        )
      )
    ) {
      continue;
    }

    compact += character;
    offsets.push(index);
  }
  return { compact, offsets };
}

function buildLooseMathHyphenationInsensitiveCompactIndex(text: string): { compact: string; offsets: number[] } {
  let compact = "";
  const offsets: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] ?? "";
    if (isPdfCompactIgnoredCharacter(character) || isPdfLooseMathComparableCharacter(character)) {
      continue;
    }

    if (
      character === "-" &&
      index > 0 &&
      /[\p{L}\p{N}]/u.test(text[index - 1] ?? "") &&
      (
        index === text.length - 1 ||
        (
          isPdfCompactIgnoredCharacter(text[index + 1] ?? "") &&
          /[\p{L}\p{N}]/u.test(text[index + 2] ?? "")
        )
      )
    ) {
      continue;
    }

    compact += character;
    offsets.push(index);
  }
  return { compact, offsets };
}

function deformatReadablePdfExponentText(text: string): string {
  return text
    .replace(/(\([^()]{1,48}\/[^()]{1,48}\))\^\(([^()]{1,24})\)/g, "$1$2")
    .replace(/(\([^()]{1,48}\/[^()]{1,48}\))\^(\d+)/g, "$1$2")
    .replace(/\b(\d+(?:\.\d+)?)\^-(\d+)\b/g, "$1-$2");
}

function buildPdfExactSearchNeedles(exact: string): string[] {
  const readable = normalizePdfReadableText(exact);
  return Array.from(new Set([
    exact,
    readable,
    deformatReadablePdfExponentText(exact),
    deformatReadablePdfExponentText(readable),
  ]))
    .map((candidate) => compactText(candidate))
    .filter(Boolean);
}

function isReadableWordCharacter(character: string): boolean {
  return /[\p{L}\p{N}]/u.test(character);
}

function isLowercaseReadableLetter(character: string): boolean {
  return /\p{Ll}/u.test(character);
}

function shouldAvoidReadableSpaceBefore(character: string): boolean {
  return !character || /^[)\]\},.;:!?%]$/u.test(character) || /^[\u0300-\u036f]$/u.test(character);
}

function shouldAvoidReadableSpaceAfter(character: string): boolean {
  return /^[([\{/$]$/u.test(character);
}

function shouldInsertReadableSpaceForGeometryGap(
  previousCharacter: string,
  nextCharacter: string,
): boolean {
  if (!previousCharacter || /\s/.test(previousCharacter) || /\s/.test(nextCharacter)) {
    return false;
  }
  if (shouldAvoidReadableSpaceBefore(nextCharacter) || shouldAvoidReadableSpaceAfter(previousCharacter)) {
    return false;
  }

  return /[\p{L}\p{N}=+\-*/<>≤≥√|)\]]/u.test(previousCharacter) &&
    /[\p{L}\p{N}=+\-*/<>≤≥√|([{\u0394\u03a9]/u.test(nextCharacter);
}

function hasReadableWhitespaceBetweenChars(
  pageText: string | undefined,
  previousChar: PdfCanonicalChar,
  currentChar: PdfCanonicalChar,
): boolean {
  if (!pageText || previousChar.normalizedEnd >= currentChar.normalizedStart) {
    return false;
  }

  return /\s/.test(pageText.slice(previousChar.normalizedEnd, currentChar.normalizedStart));
}

function shouldInsertReadableSpaceBetweenAdjacentChars(input: {
  previousChar: PdfCanonicalChar;
  currentChar: PdfCanonicalChar;
  previousOutputChar: string;
  currentCharacter: string;
  pageText?: string;
}): boolean {
  const hasSourceWhitespace = hasReadableWhitespaceBetweenChars(input.pageText, input.previousChar, input.currentChar);
  if (hasSourceWhitespace && shouldInsertReadableSpaceForGeometryGap(input.previousOutputChar, input.currentCharacter)) {
    return true;
  }

  const sameVisualLine = areReadableCharsOnSameVisualLine(input.previousChar, input.currentChar);
  if (!sameVisualLine) {
    return input.pageText
      ? hasSourceWhitespace && shouldInsertReadableSpaceForGeometryGap(input.previousOutputChar, input.currentCharacter)
      : true;
  }
  if (input.pageText && !hasSourceWhitespace) {
    return false;
  }

  const horizontalGap = input.currentChar.left - input.previousChar.right;
  const gapThreshold = Math.max(2.5, Math.min(input.previousChar.height, input.currentChar.height) * 0.24);
  return horizontalGap > gapThreshold &&
    shouldInsertReadableSpaceForGeometryGap(input.previousOutputChar, input.currentCharacter);
}

function getReadableLineTolerance(left: PdfCanonicalChar, right: PdfCanonicalChar): number {
  return Math.max(2.5, Math.min(left.height, right.height) * 0.72);
}

function areReadableCharsGeometricallyOnSameLine(left: PdfCanonicalChar, right: PdfCanonicalChar): boolean {
  const minHeight = Math.max(1, Math.min(left.height, right.height));
  const maxHeight = Math.max(1, Math.max(left.height, right.height));
  const verticalOverlap = Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top);
  const centerDistance = Math.abs(left.centerY - right.centerY);
  if (verticalOverlap >= minHeight * 0.52 && centerDistance <= minHeight * 0.58) {
    return true;
  }

  const verticalGap = Math.max(0, -verticalOverlap);
  const horizontalGap = Math.max(0, left.left - right.right, right.left - left.right);
  const unionHeight = Math.max(left.bottom, right.bottom) - Math.min(left.top, right.top);
  const isInlineScriptPair =
    minHeight / maxHeight <= 0.72 &&
    verticalGap <= Math.max(2.5, minHeight * 0.25) &&
    centerDistance <= maxHeight * 0.72 &&
    unionHeight <= maxHeight * 1.5 &&
    horizontalGap <= maxHeight * 0.95;
  if (isInlineScriptPair) {
    return true;
  }

  return centerDistance <= Math.max(
    getReadableLineTolerance(left, right),
    minHeight * 0.58,
  );
}

function areReadableCharsTooFarForSameLine(left: PdfCanonicalChar, right: PdfCanonicalChar): boolean {
  const maxHeight = Math.max(1, Math.max(left.height, right.height));
  const minHeight = Math.max(1, Math.min(left.height, right.height));
  const verticalGap = Math.max(0, Math.max(left.top, right.top) - Math.min(left.bottom, right.bottom));
  const centerDistance = Math.abs(left.centerY - right.centerY);
  return verticalGap > maxHeight * 0.45 || centerDistance > maxHeight + minHeight * 0.5;
}

function areReadableCharsOnSameVisualLine(left: PdfCanonicalChar, right: PdfCanonicalChar): boolean {
  if (
    (left.blockIndex ?? 0) !== (right.blockIndex ?? 0) ||
    (left.columnIndex ?? 0) !== (right.columnIndex ?? 0)
  ) {
    return false;
  }

  if (
    typeof left.lineIndex === "number" &&
    typeof right.lineIndex === "number"
  ) {
    return left.lineIndex === right.lineIndex &&
      !areReadableCharsTooFarForSameLine(left, right) &&
      areReadableCharsGeometricallyOnSameLine(left, right);
  }

  if (left.layoutClass !== right.layoutClass) {
    return false;
  }

  return areReadableCharsGeometricallyOnSameLine(left, right);
}

function compareReadableChars(left: PdfCanonicalChar, right: PdfCanonicalChar): number {
  if (areReadableCharsOnSameVisualLine(left, right)) {
    return (
      left.normalizedStart - right.normalizedStart ||
      left.left - right.left
    );
  }

  const layoutDiff = MAIN_LAYOUT_PRIORITY[left.layoutClass] - MAIN_LAYOUT_PRIORITY[right.layoutClass];
  if (layoutDiff !== 0) {
    return layoutDiff;
  }

  const blockDiff = (left.blockIndex ?? 0) - (right.blockIndex ?? 0);
  if (blockDiff !== 0) {
    return blockDiff;
  }

  const columnDiff = (left.columnIndex ?? 0) - (right.columnIndex ?? 0);
  if (columnDiff !== 0) {
    return columnDiff;
  }

  if (!areReadableCharsOnSameVisualLine(left, right)) {
    const centerDiff = left.centerY - right.centerY;
    if (Math.abs(centerDiff) > getReadableLineTolerance(left, right)) {
      return centerDiff;
    }
    const topDiff = left.top - right.top;
    if (topDiff !== 0) {
      return topDiff;
    }
  }

  return (
    (left.lineIndex ?? 0) - (right.lineIndex ?? 0) ||
    left.normalizedStart - right.normalizedStart ||
    left.left - right.left
  );
}

function compareReadableCharsByTextOrder(left: PdfCanonicalChar, right: PdfCanonicalChar): number {
  return (
    left.normalizedStart - right.normalizedStart ||
    left.normalizedEnd - right.normalizedEnd ||
    left.itemIndex - right.itemIndex ||
    left.left - right.left ||
    left.top - right.top
  );
}

function repairReadableTextArtifacts(text: string): string {
  return normalizePdfReadableText(text);
}

function appendReadableSpace(output: string, nextCharacter: string): string {
  if (!output || /\s$/.test(output) || shouldAvoidReadableSpaceBefore(nextCharacter)) {
    return output;
  }

  const previousCharacter = output[output.length - 1] ?? "";
  if (shouldAvoidReadableSpaceAfter(previousCharacter)) {
    return output;
  }

  return `${output} `;
}

function clampOffset(value: number, max: number): number {
  return Math.max(0, Math.min(max, value));
}

function buildTextQuote(
  pageText: string,
  startOffset: number,
  endOffset: number,
  exact: string,
  source: PdfTextQuote["source"],
): PdfTextQuote {
  return {
    exact,
    prefix: pageText.slice(Math.max(0, startOffset - PDF_TEXT_CONTEXT_RADIUS), startOffset),
    suffix: pageText.slice(endOffset, endOffset + PDF_TEXT_CONTEXT_RADIUS),
    source,
    confidence: "exact",
  };
}

function resolveRawRangeForNormalizedOffsets(input: {
  rawToNormalizedOffsets?: number[];
  localStart: number;
  localEnd: number;
}): { rawStart: number; rawEnd: number } | null {
  const offsets = input.rawToNormalizedOffsets;
  if (!offsets || offsets.length === 0) {
    return null;
  }

  let rawStart = -1;
  for (let index = 0; index < offsets.length - 1; index += 1) {
    if (offsets[index] === input.localStart && offsets[index + 1] > offsets[index]) {
      rawStart = index;
      break;
    }
  }
  if (rawStart < 0) {
    return null;
  }

  let rawEnd = rawStart + 1;
  while (rawEnd < offsets.length && offsets[rawEnd] < input.localEnd) {
    rawEnd += 1;
  }
  if (rawEnd <= rawStart) {
    return null;
  }

  return { rawStart, rawEnd };
}

function measureRenderedCharRect(input: {
  model: PdfPageTextModel;
  segment: PdfPageTextModel["segments"][number];
  itemRect: PdfPageTextItemRect;
  localStart: number;
  localEnd: number;
}): { left: number; top: number; width: number; height: number } | null {
  if (!(input.segment.textNode instanceof Text) || !input.segment.textNode.parentElement) {
    return null;
  }

  const rawRange = resolveRawRangeForNormalizedOffsets({
    rawToNormalizedOffsets: input.segment.rawToNormalizedOffsets,
    localStart: input.localStart,
    localEnd: input.localEnd,
  });
  if (!rawRange) {
    return null;
  }

  const range = document.createRange();
  range.setStart(input.segment.textNode, rawRange.rawStart);
  range.setEnd(input.segment.textNode, rawRange.rawEnd);
  const parentRect = input.segment.textNode.parentElement.getBoundingClientRect();
  const measuredRect = Array.from(range.getClientRects()).find((rect) => rect.width > 0 && rect.height > 0)
    ?? range.getBoundingClientRect();
  if (measuredRect.width <= 0 || measuredRect.height <= 0) {
    return null;
  }

  return {
    left: input.itemRect.left + (measuredRect.left - parentRect.left),
    top: input.itemRect.top + (measuredRect.top - parentRect.top),
    width: measuredRect.width,
    height: measuredRect.height,
  };
}

function getItemRectMap(model: PdfPageTextModel): Map<number, PdfPageTextItemRect> {
  return new Map(model.itemRects.map((rect) => [rect.itemIndex, rect]));
}

function getSegmentLayoutClass(segment: PdfPageTextModel["segments"][number]): PdfPageTextLayoutClass {
  return segment.layoutClass ?? "main";
}

function isUsableMeasuredCharRect(input: {
  rect: { left: number; top: number; width: number; height: number } | null;
  itemRect: PdfPageTextItemRect;
  segmentLength: number;
}): input is {
  rect: { left: number; top: number; width: number; height: number };
  itemRect: PdfPageTextItemRect;
  segmentLength: number;
} {
  if (!input.rect || input.rect.width <= 0 || input.rect.height <= 0) {
    return false;
  }

  const expectedMaxCharWidth = input.itemRect.width / Math.max(1, input.segmentLength) * 3;
  return input.rect.width <= Math.max(2, expectedMaxCharWidth);
}

export function buildPdfCanonicalChars(model: PdfPageTextModel): PdfCanonicalChar[] {
  const itemRectMap = getItemRectMap(model);
  const chars: PdfCanonicalChar[] = [];

  model.segments.forEach((segment) => {
    const itemRect = itemRectMap.get(segment.itemIndex);
    const segmentLength = segment.pageTextEnd - segment.pageTextStart;
    if (!itemRect || itemRect.width <= 0 || itemRect.height <= 0 || segmentLength <= 0) {
      return;
    }

    for (let offset = segment.pageTextStart; offset < segment.pageTextEnd; offset += 1) {
      const character = model.normalizedText[offset] ?? "";
      if (!character) {
        continue;
      }

      const localStart = offset - segment.pageTextStart;
      const localEnd = localStart + 1;
      const measuredRect = measureRenderedCharRect({
        model,
        segment,
        itemRect,
        localStart,
        localEnd,
      });
      const usableMeasuredRect = isUsableMeasuredCharRect({
        rect: measuredRect,
        itemRect,
        segmentLength,
      }) ? measuredRect : null;
      const startRatio = localStart / segmentLength;
      const endRatio = localEnd / segmentLength;
      const left = usableMeasuredRect?.left ?? (itemRect.left + (itemRect.width * startRatio));
      const width = usableMeasuredRect?.width ?? Math.max(0, itemRect.width * (endRatio - startRatio));
      const top = usableMeasuredRect?.top ?? itemRect.top;
      const height = usableMeasuredRect?.height ?? itemRect.height;
      if (width <= 0 || height <= 0) {
        continue;
      }

      chars.push({
        normalizedStart: offset,
        normalizedEnd: offset + 1,
        text: character,
        itemIndex: segment.itemIndex,
        lineIndex: segment.lineIndex,
        blockIndex: segment.blockIndex,
        columnIndex: segment.columnIndex,
        layoutClass: getSegmentLayoutClass(segment),
        left,
        top,
        width,
        height,
        right: left + width,
        bottom: top + height,
        centerX: left + (width / 2),
        centerY: top + (height / 2),
      });
    }
  });

  return chars.sort((left, right) => left.normalizedStart - right.normalizedStart);
}

export function buildPdfCanonicalBoundaries(chars: PdfCanonicalChar[]): PdfCanonicalBoundary[] {
  const boundaries = new Map<string, PdfCanonicalBoundary>();

  chars.forEach((char) => {
    const startKey = `${char.normalizedStart}:start`;
    if (!boundaries.has(startKey)) {
      boundaries.set(startKey, {
        offset: char.normalizedStart,
        x: char.left,
        y: char.top,
        height: char.height,
        lineIndex: char.lineIndex,
        blockIndex: char.blockIndex,
        columnIndex: char.columnIndex,
        layoutClass: char.layoutClass,
      });
    }

    const endKey = `${char.normalizedEnd}:end`;
    boundaries.set(endKey, {
      offset: char.normalizedEnd,
      x: char.right,
      y: char.top,
      height: char.height,
      lineIndex: char.lineIndex,
      blockIndex: char.blockIndex,
      columnIndex: char.columnIndex,
      layoutClass: char.layoutClass,
    });
  });

  return [...boundaries.values()].sort((left, right) => left.offset - right.offset || left.x - right.x);
}

export function buildPdfReadableTextFromChars(chars: PdfCanonicalChar[], pageText?: string): string {
  const orderedChars = [...chars]
    .filter((char) => char.text.length > 0)
    .sort(compareReadableCharsByTextOrder);
  let output = "";
  let previousChar: PdfCanonicalChar | null = null;

  for (const char of orderedChars) {
    const character = char.text;
    if (/\s/.test(character)) {
      output = output && !/\s$/.test(output) ? `${output} ` : output;
      previousChar = char;
      continue;
    }

    if (previousChar) {
      const sameVisualLine = areReadableCharsOnSameVisualLine(previousChar, char);
      const newVisualLine = !sameVisualLine;
      const previousOutputChar = output[output.length - 1] ?? "";

      if ((newVisualLine || /\s/.test(previousChar.text)) && previousOutputChar === "-" && isLowercaseReadableLetter(character)) {
        output = output.slice(0, -1);
      } else if (
        shouldInsertReadableSpaceBetweenAdjacentChars({
          previousChar,
          currentChar: char,
          previousOutputChar,
          currentCharacter: character,
          pageText,
        })
      ) {
        output = appendReadableSpace(output, character);
      }
    }

    output += character;
    previousChar = char;
  }

  return repairReadableTextArtifacts(output);
}

export function buildPdfReadableTextForOffsets(
  model: PdfPageTextModel,
  startOffset: number,
  endOffset: number,
): string | null {
  const chars = buildPdfCanonicalChars(model)
    .filter((char) => char.normalizedEnd > startOffset && char.normalizedStart < endOffset);
  if (chars.length === 0) {
    return null;
  }

  const readableText = buildPdfReadableTextFromChars(chars, model.normalizedText);
  return readableText ? readableText : null;
}

function getVerticalDistance(char: Pick<PdfCanonicalChar, "top" | "bottom">, localY: number): number {
  if (localY >= char.top && localY <= char.bottom) {
    return 0;
  }

  return Math.min(
    Math.abs(localY - char.top),
    Math.abs(localY - char.bottom),
  );
}

function getPointDistanceToCharRect(char: PdfCanonicalChar, localX: number, localY: number): number {
  const dx = localX < char.left
    ? char.left - localX
    : localX > char.right
      ? localX - char.right
      : 0;
  const dy = localY < char.top
    ? char.top - localY
    : localY > char.bottom
      ? localY - char.bottom
      : 0;
  return Math.hypot(dx, dy);
}

function choosePreferredLayoutClass(chars: PdfCanonicalChar[]): PdfPageTextLayoutClass {
  const counts = new Map<PdfPageTextLayoutClass, number>();
  chars.forEach((char) => {
    counts.set(char.layoutClass, (counts.get(char.layoutClass) ?? 0) + 1);
  });

  return [...counts.entries()].sort((left, right) => {
    if (right[1] !== left[1]) {
      return right[1] - left[1];
    }
    return MAIN_LAYOUT_PRIORITY[left[0]] - MAIN_LAYOUT_PRIORITY[right[0]];
  })[0]?.[0] ?? "main";
}

function filterCharsByLayoutPriority(input: {
  chars: PdfCanonicalChar[];
  preferredLayoutClass?: PdfPageTextLayoutClass;
  preferredLineIndex?: number;
  preferredBlockIndex?: number;
  preferredColumnIndex?: number;
  fallbackRange?: { startOffset: number; endOffset: number };
}): PdfCanonicalChar[] {
  if (input.chars.length === 0) {
    return input.chars;
  }

  const byRange = input.fallbackRange
    ? input.chars.filter((char) => (
        char.normalizedEnd > input.fallbackRange!.startOffset &&
        char.normalizedStart < input.fallbackRange!.endOffset
      ))
    : input.chars;

  const preferredLayoutClass = input.preferredLayoutClass
    ?? choosePreferredLayoutClass(byRange.length > 0 ? byRange : input.chars);
  const sameLayout = input.chars.filter((char) => char.layoutClass === preferredLayoutClass);
  if (sameLayout.length === 0) {
    return input.chars;
  }

  if (typeof input.preferredLineIndex === "number") {
    const sameLine = sameLayout.filter((char) => char.lineIndex === input.preferredLineIndex);
    if (sameLine.length > 0) {
      return sameLine;
    }
  }

  if (typeof input.preferredColumnIndex === "number") {
    const sameColumn = sameLayout.filter((char) => char.columnIndex === input.preferredColumnIndex);
    if (sameColumn.length > 0) {
      if (typeof input.preferredBlockIndex === "number") {
        const sameBlock = sameColumn.filter((char) => char.blockIndex === input.preferredBlockIndex);
        if (sameBlock.length > 0) {
          return sameBlock;
        }
      }
      return sameColumn;
    }
  }

  if (typeof input.preferredBlockIndex === "number") {
    const sameBlock = sameLayout.filter((char) => char.blockIndex === input.preferredBlockIndex);
    if (sameBlock.length > 0) {
      return sameBlock;
    }
  }

  return sameLayout;
}

export function resolvePdfPointerBoundary(input: {
  model: PdfPageTextModel;
  point: { x: number; y: number };
  pageRect: DOMRect;
  side: "start" | "end";
  currentAnchor?: { startOffset: number; endOffset: number } | null;
  preferredLayoutClass?: PdfPageTextLayoutClass;
  preferredLineIndex?: number;
  preferredBlockIndex?: number;
  preferredColumnIndex?: number;
}): PdfCanonicalPointerBoundaryResult | null {
  const chars = buildPdfCanonicalChars(input.model);
  if (chars.length === 0) {
    return null;
  }

  const localX = input.point.x - input.pageRect.left;
  const localY = input.point.y - input.pageRect.top;
  const scopedChars = filterCharsByLayoutPriority({
    chars,
    preferredLayoutClass: input.preferredLayoutClass,
    preferredLineIndex: input.preferredLineIndex,
    preferredBlockIndex: input.preferredBlockIndex,
    preferredColumnIndex: input.preferredColumnIndex,
    fallbackRange: input.currentAnchor
      ? { startOffset: input.currentAnchor.startOffset, endOffset: input.currentAnchor.endOffset }
      : undefined,
  });
  if (scopedChars.length === 0) {
    return null;
  }

  const verticalBest = scopedChars.reduce((best, char) => {
    if (!best) {
      return char;
    }
    const bestDistance = getVerticalDistance(best, localY);
    const currentDistance = getVerticalDistance(char, localY);
    if (currentDistance === bestDistance) {
      return Math.abs(char.centerY - localY) < Math.abs(best.centerY - localY) ? char : best;
    }
    return currentDistance < bestDistance ? char : best;
  }, scopedChars[0] ?? null);
  if (!verticalBest) {
    return null;
  }

  const lineTolerance = Math.max(4, Math.min(18, verticalBest.height * 0.72));
  const lineScopedChars = scopedChars.filter((char) => (
    Math.abs(char.centerY - verticalBest.centerY) <= lineTolerance
  ));
  const candidateChars = lineScopedChars.length > 0 ? lineScopedChars : scopedChars;
  const closestChar = candidateChars.reduce((best, char) => {
    const score = getPointDistanceToCharRect(char, localX, localY);

    if (!best || score < best.score) {
      return {
        char,
        score,
      };
    }

    if (score === best.score) {
      if (input.side === "start") {
        return char.normalizedStart > best.char.normalizedStart ? { char, score } : best;
      }
      return char.normalizedEnd < best.char.normalizedEnd ? { char, score } : best;
    }

    return best;
  }, null as ({ char: PdfCanonicalChar; score: number }) | null);

  if (!closestChar) {
    return null;
  }

  const closest = closestChar.char;
  const offset = localX > closest.centerX
    ? closest.normalizedEnd
    : closest.normalizedStart;

  return {
    offset,
    layoutClass: closest.layoutClass,
    lineIndex: closest.lineIndex,
    blockIndex: closest.blockIndex,
    columnIndex: closest.columnIndex,
  };
}

export function trimPdfOffsetsToText(
  pageText: string,
  startOffset: number,
  endOffset: number,
): { startOffset: number; endOffset: number } | null {
  let nextStart = startOffset;
  let nextEnd = endOffset;

  while (nextStart < nextEnd && /\s/.test(pageText[nextStart] ?? "")) {
    nextStart += 1;
  }
  while (nextEnd > nextStart && /\s/.test(pageText[nextEnd - 1] ?? "")) {
    nextEnd -= 1;
  }

  if (nextEnd <= nextStart) {
    return null;
  }

  return {
    startOffset: nextStart,
    endOffset: nextEnd,
  };
}

function pdfCanonicalCharsToRect(model: PdfPageTextModel, chars: PdfCanonicalChar[]): BoundingBox {
  const left = Math.min(...chars.map((char) => char.left));
  const right = Math.max(...chars.map((char) => char.right));
  const orderedHeights = chars.map((char) => char.height).sort((leftHeight, rightHeight) => leftHeight - rightHeight);
  const medianHeight = orderedHeights[Math.floor(orderedHeights.length / 2)] ?? 1;
  const hasInlineScriptChars = orderedHeights[0] <= medianHeight * 0.72;
  const referenceHeight = Math.max(
    1,
    hasInlineScriptChars
      ? orderedHeights[Math.floor((orderedHeights.length - 1) * 0.75)] ?? medianHeight
      : medianHeight,
  );
  const bodyChars = chars.filter((char) => char.height >= referenceHeight * 0.82);
  const referenceChars = bodyChars.length > 0 ? bodyChars : chars;
  // PDF fonts may expose math glyphs with a shifted baseline even when they
  // render on the same visual row. Anchor the row to the upper body band so
  // underline/highlight geometry cannot intrude into the following line.
  const top = Math.max(0, Math.min(...referenceChars.map((char) => char.top)));
  const bottom = Math.min(model.viewportHeight, top + referenceHeight);
  return {
    x1: left / model.viewportWidth,
    y1: top / model.viewportHeight,
    x2: right / model.viewportWidth,
    y2: bottom / model.viewportHeight,
  };
}

export function buildPdfRectsForOffsets(
  model: PdfPageTextModel,
  startOffset: number,
  endOffset: number,
): BoundingBox[] {
  const chars = buildPdfCanonicalChars(model)
    .filter((char) => (
      char.normalizedEnd > startOffset &&
      char.normalizedStart < endOffset &&
      !/^\s$/.test(char.text)
    ))
    .sort(compareReadableChars);

  const lineGroups: PdfCanonicalChar[][] = [];
  for (const char of chars) {
    const currentGroup = lineGroups[lineGroups.length - 1];
    const previousChar = currentGroup?.[currentGroup.length - 1];
    if (currentGroup && previousChar && areReadableCharsOnSameVisualLine(previousChar, char)) {
      currentGroup.push(char);
      continue;
    }

    lineGroups.push([char]);
  }

  return lineGroups
    .map((group) => pdfCanonicalCharsToRect(model, group))
    .filter((rect) => rect.x2 > rect.x1 && rect.y2 > rect.y1);
}

function getPdfRectArea(rect: BoundingBox): number {
  return Math.max(0, rect.x2 - rect.x1) * Math.max(0, rect.y2 - rect.y1);
}

function getPdfRectOverlapArea(left: BoundingBox, right: BoundingBox): number {
  const width = Math.max(0, Math.min(left.x2, right.x2) - Math.max(left.x1, right.x1));
  const height = Math.max(0, Math.min(left.y2, right.y2) - Math.max(left.y1, right.y1));
  return width * height;
}

function getPdfRectCenterDistance(left: BoundingBox, right: BoundingBox): number {
  const leftX = left.x1 + ((left.x2 - left.x1) / 2);
  const leftY = left.y1 + ((left.y2 - left.y1) / 2);
  const rightX = right.x1 + ((right.x2 - right.x1) / 2);
  const rightY = right.y1 + ((right.y2 - right.y1) / 2);
  return Math.hypot(leftX - rightX, leftY - rightY);
}

function isUsablePdfPreferredRect(rect: BoundingBox): boolean {
  return Number.isFinite(rect.x1) &&
    Number.isFinite(rect.y1) &&
    Number.isFinite(rect.x2) &&
    Number.isFinite(rect.y2) &&
    rect.x2 > rect.x1 &&
    rect.y2 > rect.y1;
}

function scorePdfQuoteCandidateByRects(input: {
  candidateRects: BoundingBox[];
  preferredRects: BoundingBox[];
}): { overlapRatio: number; overlapArea: number; centerDistance: number } {
  const candidateArea = input.candidateRects.reduce((sum, rect) => sum + getPdfRectArea(rect), 0);
  const overlapArea = input.candidateRects.reduce((sum, candidateRect) => {
    const bestOverlap = input.preferredRects.reduce((best, preferredRect) => (
      Math.max(best, getPdfRectOverlapArea(candidateRect, preferredRect))
    ), 0);
    return sum + bestOverlap;
  }, 0);
  const centerDistance = input.candidateRects.reduce((sum, candidateRect) => {
    const bestDistance = input.preferredRects.reduce((best, preferredRect) => (
      Math.min(best, getPdfRectCenterDistance(candidateRect, preferredRect))
    ), Number.POSITIVE_INFINITY);
    return sum + (Number.isFinite(bestDistance) ? bestDistance : 0);
  }, 0) / Math.max(1, input.candidateRects.length);

  return {
    overlapRatio: candidateArea > 0 ? overlapArea / candidateArea : 0,
    overlapArea,
    centerDistance,
  };
}

export function resolvePdfExactQuoteOffsetCandidates(input: {
  model: PdfPageTextModel;
  exact: string | null | undefined;
  preferredRects?: BoundingBox[];
}): Array<{
  startOffset: number;
  endOffset: number;
  compactIndex: number;
  rects: BoundingBox[];
  score?: { overlapRatio: number; overlapArea: number; centerDistance: number };
}> {
  const exact = input.exact ?? "";
  const strictNeedles = buildPdfExactSearchNeedles(exact);
  if (strictNeedles.length === 0) {
    return [];
  }

  const candidates: Array<{ startOffset: number; endOffset: number; compactIndex: number }> = [];
  const seenCandidates = new Set<string>();
  const addCandidates = (
    compactNeedle: string,
    compactPage: string,
    compactOffsets: number[],
  ) => {
    let compactIndex = compactPage.indexOf(compactNeedle);
    while (compactIndex >= 0) {
      const rawStart = compactOffsets[compactIndex] ?? -1;
      const rawEnd = (compactOffsets[compactIndex + compactNeedle.length - 1] ?? -1) + 1;
      if (rawStart >= 0 && rawEnd > rawStart) {
        const trimmed = trimPdfOffsetsToText(input.model.normalizedText, rawStart, rawEnd);
        const key = trimmed ? `${trimmed.startOffset}:${trimmed.endOffset}` : "";
        if (trimmed && !seenCandidates.has(key)) {
          seenCandidates.add(key);
          candidates.push({ ...trimmed, compactIndex });
        }
      }
      compactIndex = compactPage.indexOf(compactNeedle, compactIndex + 1);
    }
  };

  const strictPage = buildWhitespaceCompactIndex(input.model.normalizedText);
  strictNeedles.forEach((needle) => addCandidates(needle, strictPage.compact, strictPage.offsets));

  if (candidates.length === 0) {
    const fallbackPage = buildHyphenationInsensitiveCompactIndex(input.model.normalizedText);
    strictNeedles
      .map((needle) => buildHyphenationInsensitiveCompactIndex(needle).compact)
      .filter(Boolean)
      .forEach((needle) => addCandidates(needle, fallbackPage.compact, fallbackPage.offsets));
  }

  if (candidates.length === 0) {
    const looseMathPage = buildLooseMathHyphenationInsensitiveCompactIndex(input.model.normalizedText);
    strictNeedles
      .map((needle) => buildLooseMathHyphenationInsensitiveCompactIndex(needle).compact)
      .filter(Boolean)
      .forEach((needle) => addCandidates(needle, looseMathPage.compact, looseMathPage.offsets));
  }

  if (candidates.length === 0) {
    return [];
  }

  const preferredRects = (input.preferredRects ?? []).filter(isUsablePdfPreferredRect);
  const scoredCandidates = candidates.map((candidate) => {
    const candidateRects = buildPdfRectsForOffsets(input.model, candidate.startOffset, candidate.endOffset);
    return {
      candidate,
      rects: candidateRects,
      score: scorePdfQuoteCandidateByRects({
        candidateRects,
        preferredRects,
      }),
    };
  });

  scoredCandidates.sort((left, right) => {
    if (Math.abs(left.score.overlapRatio - right.score.overlapRatio) > 0.000001) {
      return right.score.overlapRatio - left.score.overlapRatio;
    }
    if (Math.abs(left.score.overlapArea - right.score.overlapArea) > 0.000001) {
      return right.score.overlapArea - left.score.overlapArea;
    }
    if (Math.abs(left.score.centerDistance - right.score.centerDistance) > 0.000001) {
      return left.score.centerDistance - right.score.centerDistance;
    }
    return left.candidate.compactIndex - right.candidate.compactIndex;
  });

  return scoredCandidates.map(({ candidate, rects, score }) => ({
    ...candidate,
    rects,
    score: preferredRects.length > 0 ? score : undefined,
  }));
}

export function resolvePdfExactQuoteOffsets(input: {
  model: PdfPageTextModel;
  exact: string | null | undefined;
  preferredRects?: BoundingBox[];
}): { startOffset: number; endOffset: number } | null {
  const candidate = resolvePdfExactQuoteOffsetCandidates(input)[0];
  return candidate ? { startOffset: candidate.startOffset, endOffset: candidate.endOffset } : null;
}

export function buildPdfTextAnchorFromOffsets(input: {
  model: PdfPageTextModel;
  startOffset: number;
  endOffset: number;
  source?: PdfTextQuote["source"];
  fallbackRects?: BoundingBox[];
  /** Keep the validated source range; readable reconstruction may change punctuation. */
  preserveExact?: boolean;
}): PdfCanonicalTextAnchor | null {
  const clampedStart = clampOffset(input.startOffset, input.model.normalizedText.length);
  const clampedEnd = clampOffset(input.endOffset, input.model.normalizedText.length);
  const trimmed = input.preserveExact
    ? (clampedEnd > clampedStart ? { startOffset: clampedStart, endOffset: clampedEnd } : null)
    : trimPdfOffsetsToText(input.model.normalizedText, clampedStart, clampedEnd);
  if (!trimmed) {
    return null;
  }

  const sourceText = input.model.normalizedText.slice(trimmed.startOffset, trimmed.endOffset);
  const exact = input.preserveExact ? sourceText
    : buildPdfReadableTextForOffsets(input.model, trimmed.startOffset, trimmed.endOffset) ?? sourceText;
  if (!normalizeText(exact)) {
    return null;
  }

  return {
    startOffset: trimmed.startOffset,
    endOffset: trimmed.endOffset,
    pageText: input.model.normalizedText,
    textQuote: buildTextQuote(
      input.model.normalizedText,
      trimmed.startOffset,
      trimmed.endOffset,
      exact,
      input.source ?? "pdfjs-text-model",
    ),
    rects: (() => {
      const rebuiltRects = buildPdfRectsForOffsets(input.model, trimmed.startOffset, trimmed.endOffset);
      return rebuiltRects.length > 0 ? rebuiltRects : input.fallbackRects ?? [];
    })(),
  };
}

export function resolveCanonicalPdfTextAnchorFromExact(input: {
  model: PdfPageTextModel;
  exact: string | null | undefined;
  prefix?: string | null | undefined;
  suffix?: string | null | undefined;
  preferredRects?: BoundingBox[];
  requireUnique?: boolean;
  source?: PdfTextQuote["source"];
}): PdfCanonicalTextAnchorResolveResult {
  const exact = normalizePdfReadableText(input.exact ?? "");
  if (!exact) {
    return { ok: false, reason: "empty-exact", candidateCount: 0 };
  }

  const candidates = resolvePdfExactQuoteOffsetCandidates({
    model: input.model,
    exact,
    preferredRects: input.preferredRects,
  });
  if (candidates.length === 0) {
    return { ok: false, reason: "exact-not-found-in-pdf-text-model", candidateCount: 0 };
  }

  const prefixCompact = compactText(input.prefix ?? "");
  const suffixCompact = compactText(input.suffix ?? "");
  const contextCandidates = candidates.filter((candidate) => {
    const contextRadius = Math.max(
      PDF_TEXT_CONTEXT_RADIUS,
      Math.ceil(Math.max(prefixCompact.length, suffixCompact.length) * 2.5),
    );
    const before = input.model.normalizedText.slice(Math.max(0, candidate.startOffset - contextRadius), candidate.startOffset);
    const after = input.model.normalizedText.slice(candidate.endOffset, Math.min(input.model.normalizedText.length, candidate.endOffset + contextRadius));
    return (!prefixCompact || compactText(before).endsWith(prefixCompact)) &&
      (!suffixCompact || compactText(after).startsWith(suffixCompact));
  });
  const scopedCandidates = (prefixCompact || suffixCompact) ? contextCandidates : candidates;
  if (scopedCandidates.length === 0) {
    return {
      ok: false,
      reason: "context-mismatch",
      candidateCount: candidates.length,
      candidates: candidates.map(({ startOffset, endOffset, rects }) => ({ startOffset, endOffset, rects })),
    };
  }

  const usableCandidates = scopedCandidates.filter((candidate) => candidate.rects.length > 0);
  if (usableCandidates.length === 0) {
    return {
      ok: false,
      reason: "invalid-anchor",
      candidateCount: candidates.length,
      candidates: candidates.map(({ startOffset, endOffset, rects }) => ({ startOffset, endOffset, rects })),
    };
  }

  const hasPreferredRects = (input.preferredRects ?? []).some(isUsablePdfPreferredRect);
  if (input.requireUnique !== false && usableCandidates.length > 1) {
    if (!hasPreferredRects) {
      return {
        ok: false,
        reason: "ambiguous-exact-quote",
        candidateCount: usableCandidates.length,
        candidates: usableCandidates.map(({ startOffset, endOffset, rects }) => ({ startOffset, endOffset, rects })),
      };
    }

    const [best, second] = usableCandidates;
    const bestScore = best?.score;
    const secondScore = second?.score;
    const overlapGap = (bestScore?.overlapRatio ?? 0) - (secondScore?.overlapRatio ?? 0);
    const distanceGap = (secondScore?.centerDistance ?? 0) - (bestScore?.centerDistance ?? 0);
    if (
      !bestScore ||
      bestScore.overlapRatio < 0.18 ||
      (
        second &&
        overlapGap < 0.08 &&
        distanceGap < 0.025
      )
    ) {
      return {
        ok: false,
        reason: "ambiguous-geometry",
        candidateCount: usableCandidates.length,
        candidates: usableCandidates.map(({ startOffset, endOffset, rects }) => ({ startOffset, endOffset, rects })),
      };
    }
  }

  const candidate = usableCandidates[0];
  const anchor = buildPdfTextAnchorFromOffsets({
    model: input.model,
    startOffset: candidate.startOffset,
    endOffset: candidate.endOffset,
    source: input.source ?? "pdfjs-text-model",
  });
  if (!anchor || anchor.rects.length === 0) {
    return {
      ok: false,
      reason: "invalid-anchor",
      candidateCount: usableCandidates.length,
      candidates: usableCandidates.map(({ startOffset, endOffset, rects }) => ({ startOffset, endOffset, rects })),
    };
  }

  return {
    ok: true,
    anchor,
    candidateCount: usableCandidates.length,
    ambiguityScore: candidate.score?.overlapRatio,
  };
}

function arePdfAnchorRectsEquivalent(left: BoundingBox[], right: BoundingBox[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((rect, index) => {
    const candidate = right[index];
    return Boolean(
      candidate &&
      Math.abs(rect.x1 - candidate.x1) <= 0.0005 &&
      Math.abs(rect.y1 - candidate.y1) <= 0.0005 &&
      Math.abs(rect.x2 - candidate.x2) <= 0.0005 &&
      Math.abs(rect.y2 - candidate.y2) <= 0.0005
    );
  });
}

function resolvePdfOffsetsBetweenContext(input: {
  model: PdfPageTextModel;
  exact?: string | null;
  prefix?: string | null;
  suffix?: string | null;
  preferredRects?: BoundingBox[];
}): { startOffset: number; endOffset: number } | null {
  const prefix = compactText(input.prefix ?? "");
  const suffix = compactText(input.suffix ?? "");
  if (!prefix || !suffix) {
    return null;
  }

  const page = buildWhitespaceCompactIndex(input.model.normalizedText);
  const expectedLength = compactText(input.exact ?? "").length;
  const candidates: Array<{
    startOffset: number;
    endOffset: number;
    rects: BoundingBox[];
    score: { overlapRatio: number; overlapArea: number; centerDistance: number };
  }> = [];
  let prefixIndex = page.compact.indexOf(prefix);
  while (prefixIndex >= 0) {
    const gapCompactStart = prefixIndex + prefix.length;
    const suffixIndex = page.compact.indexOf(suffix, gapCompactStart);
    if (suffixIndex >= gapCompactStart) {
      const rawStart = (page.offsets[gapCompactStart - 1] ?? -1) + 1;
      const rawEnd = page.offsets[suffixIndex] ?? -1;
      const trimmed = rawStart >= 0 && rawEnd > rawStart
        ? trimPdfOffsetsToText(input.model.normalizedText, rawStart, rawEnd)
        : null;
      if (trimmed) {
        const recoveredLength = compactText(
          input.model.normalizedText.slice(trimmed.startOffset, trimmed.endOffset),
        ).length;
        const lengthLooksPlausible = expectedLength === 0 || (
          recoveredLength >= Math.max(1, Math.floor(expectedLength * 0.55)) &&
          recoveredLength <= Math.ceil(expectedLength * 1.8) + 8
        );
        if (lengthLooksPlausible) {
          const rects = buildPdfRectsForOffsets(input.model, trimmed.startOffset, trimmed.endOffset);
          candidates.push({
            ...trimmed,
            rects,
            score: scorePdfQuoteCandidateByRects({
              candidateRects: rects,
              preferredRects: (input.preferredRects ?? []).filter(isUsablePdfPreferredRect),
            }),
          });
        }
      }
    }
    prefixIndex = page.compact.indexOf(prefix, prefixIndex + 1);
  }

  candidates.sort((left, right) => (
    right.score.overlapRatio - left.score.overlapRatio ||
    right.score.overlapArea - left.score.overlapArea ||
    left.score.centerDistance - right.score.centerDistance ||
    left.startOffset - right.startOffset
  ));
  const best = candidates[0];
  return best ? { startOffset: best.startOffset, endOffset: best.endOffset } : null;
}

function resolvePdfOffsetsFromStoredGeometry(input: {
  model: PdfPageTextModel;
  rects?: BoundingBox[];
}): { startOffset: number; endOffset: number } | null {
  const preferredRects = (input.rects ?? []).filter(isUsablePdfPreferredRect);
  if (preferredRects.length === 0) {
    return null;
  }

  const chars = buildPdfCanonicalChars(input.model).filter((char) => {
    const charRect = {
      x1: char.left / input.model.viewportWidth,
      y1: char.top / input.model.viewportHeight,
      x2: char.right / input.model.viewportWidth,
      y2: char.bottom / input.model.viewportHeight,
    };
    const horizontalTolerance = Math.max(0.002, (char.width / input.model.viewportWidth) * 0.2);
    const verticalTolerance = Math.max(0.003, (char.height / input.model.viewportHeight) * 0.35);
    return preferredRects.some((rect) => (
      charRect.x2 >= rect.x1 - horizontalTolerance &&
      charRect.x1 <= rect.x2 + horizontalTolerance &&
      charRect.y2 >= rect.y1 - verticalTolerance &&
      charRect.y1 <= rect.y2 + verticalTolerance
    ));
  });
  if (chars.length === 0) {
    return null;
  }

  return trimPdfOffsetsToText(
    input.model.normalizedText,
    Math.min(...chars.map((char) => char.normalizedStart)),
    Math.max(...chars.map((char) => char.normalizedEnd)),
  );
}

function buildPdfAnchorRecoverySuccess(input: {
  anchor: PdfCanonicalTextAnchor;
  reason: PdfCanonicalTextAnchorRecoveryReason;
  confidence: number;
  rects?: BoundingBox[];
}): PdfCanonicalTextAnchorRecoveryResult {
  return {
    ok: true,
    ...input.anchor,
    rects: input.rects ?? input.anchor.rects,
    source: input.anchor.textQuote.source,
    confidence: input.confidence,
    reason: input.reason,
  };
}

export function recoverCanonicalPdfTextAnchor(input: {
  model: PdfPageTextModel;
  exact?: string | null;
  prefix?: string | null;
  suffix?: string | null;
  startOffset?: number | null;
  endOffset?: number | null;
  rects?: BoundingBox[];
  source?: PdfTextQuote["source"];
}): PdfCanonicalTextAnchorRecoveryResult {
  const source = input.source ?? "pdfjs-text-model";
  const exactCompact = compactText(normalizePdfReadableText(input.exact ?? ""));
  const hasStoredOffsets = Number.isInteger(input.startOffset) && Number.isInteger(input.endOffset);
  const storedAnchor = hasStoredOffsets
    ? buildPdfTextAnchorFromOffsets({
        model: input.model,
        startOffset: input.startOffset as number,
        endOffset: input.endOffset as number,
        source,
      })
    : null;
  if (storedAnchor && exactCompact === compactText(storedAnchor.textQuote.exact)) {
    const storedRects = (input.rects ?? []).filter(isUsablePdfPreferredRect);
    const preservesStoredGeometry = storedRects.length > 0 &&
      arePdfAnchorRectsEquivalent(storedRects, storedAnchor.rects);
    return buildPdfAnchorRecoverySuccess({
      anchor: storedAnchor,
      reason: preservesStoredGeometry ? "stored-offsets-and-geometry" : "stored-offsets",
      confidence: preservesStoredGeometry ? 1 : 0.99,
      rects: preservesStoredGeometry ? input.rects : undefined,
    });
  }

  const exactResult = resolveCanonicalPdfTextAnchorFromExact({
    model: input.model,
    exact: input.exact,
    prefix: input.prefix,
    suffix: input.suffix,
    preferredRects: input.rects,
    source,
  });
  if (exactResult.ok) {
    const hasContext = Boolean(compactText(input.prefix ?? "") || compactText(input.suffix ?? ""));
    const hasGeometry = (input.rects ?? []).some(isUsablePdfPreferredRect);
    return buildPdfAnchorRecoverySuccess({
      anchor: exactResult.anchor,
      reason: hasContext ? "exact-context" : hasGeometry ? "exact-geometry" : "exact-quote",
      confidence: hasContext ? 0.99 : hasGeometry ? 0.97 : 0.95,
    });
  }

  const contextOffsets = resolvePdfOffsetsBetweenContext(input);
  const contextAnchor = contextOffsets
    ? buildPdfTextAnchorFromOffsets({
        model: input.model,
        ...contextOffsets,
        source,
      })
    : null;
  if (contextAnchor) {
    return buildPdfAnchorRecoverySuccess({
      anchor: contextAnchor,
      reason: "context-recovery",
      confidence: 0.88,
    });
  }

  const geometryOffsets = resolvePdfOffsetsFromStoredGeometry(input);
  const geometryAnchor = geometryOffsets
    ? buildPdfTextAnchorFromOffsets({
        model: input.model,
        ...geometryOffsets,
        source,
      })
    : null;
  if (geometryAnchor) {
    return buildPdfAnchorRecoverySuccess({
      anchor: geometryAnchor,
      reason: "geometry-recovery",
      confidence: 0.72,
    });
  }

  return {
    ok: false,
    reason: "unresolved",
    confidence: 0,
    source,
  };
}
