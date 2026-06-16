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
  return Math.max(2.5, Math.min(left.height, right.height) * 0.6);
}

function areReadableCharsGeometricallyOnSameLine(left: PdfCanonicalChar, right: PdfCanonicalChar): boolean {
  const minHeight = Math.max(1, Math.min(left.height, right.height));
  const verticalOverlap = Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top);
  const centerDistance = Math.abs(left.centerY - right.centerY);
  if (verticalOverlap >= minHeight * 0.52 && centerDistance <= minHeight * 0.58) {
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
  const top = Math.min(...chars.map((char) => char.top));
  const right = Math.max(...chars.map((char) => char.right));
  const bottom = Math.max(...chars.map((char) => char.bottom));
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

export function resolvePdfExactQuoteOffsets(input: {
  model: PdfPageTextModel;
  exact: string | null | undefined;
  preferredRects?: BoundingBox[];
}): { startOffset: number; endOffset: number } | null {
  const exact = input.exact ?? "";
  const strictNeedles = buildPdfExactSearchNeedles(exact);
  if (strictNeedles.length === 0) {
    return null;
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
    return null;
  }

  const preferredRects = (input.preferredRects ?? []).filter(isUsablePdfPreferredRect);
  if (candidates.length === 1 || preferredRects.length === 0) {
    const { startOffset, endOffset } = candidates[0];
    return { startOffset, endOffset };
  }

  const scoredCandidates = candidates.map((candidate) => {
    const candidateRects = buildPdfRectsForOffsets(input.model, candidate.startOffset, candidate.endOffset);
    return {
      candidate,
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

  const { startOffset, endOffset } = scoredCandidates[0].candidate;
  return { startOffset, endOffset };
}

export function buildPdfTextAnchorFromOffsets(input: {
  model: PdfPageTextModel;
  startOffset: number;
  endOffset: number;
  source?: PdfTextQuote["source"];
  fallbackRects?: BoundingBox[];
}): {
  startOffset: number;
  endOffset: number;
  pageText: string;
  textQuote: PdfTextQuote;
  rects: BoundingBox[];
} | null {
  const clampedStart = clampOffset(input.startOffset, input.model.normalizedText.length);
  const clampedEnd = clampOffset(input.endOffset, input.model.normalizedText.length);
  const trimmed = trimPdfOffsetsToText(input.model.normalizedText, clampedStart, clampedEnd);
  if (!trimmed) {
    return null;
  }

  const exact = buildPdfReadableTextForOffsets(input.model, trimmed.startOffset, trimmed.endOffset)
    ?? input.model.normalizedText.slice(trimmed.startOffset, trimmed.endOffset);
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
