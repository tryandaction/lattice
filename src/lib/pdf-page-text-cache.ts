import type { PDFDocumentProxy } from "pdfjs-dist";
import type { TextContent, TextItem, TextStyle } from "pdfjs-dist/types/src/display/api";

export interface PdfPageTextSegment {
  itemIndex: number;
  text: string;
  normalizedText: string;
  hasEOL: boolean;
  pageTextStart: number;
  pageTextEnd: number;
  lineIndex?: number;
  blockIndex?: number;
  columnIndex?: number;
  layoutClass?: PdfPageTextLayoutClass;
  textNode?: Text | null;
  rawToNormalizedOffsets?: number[];
}

export type PdfPageTextLayoutClass =
  | "main"
  | "sidebar"
  | "equation"
  | "caption"
  | "footnote"
  | "metadata"
  | "list"
  | "auxiliary";

export interface PdfPageTextItemRect {
  itemIndex: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PdfPageTextModel {
  pageNumber: number;
  viewportWidth: number;
  viewportHeight: number;
  textContent: TextContent;
  items: TextItem[];
  segments: PdfPageTextSegment[];
  itemRects: PdfPageTextItemRect[];
  normalizedText: string;
  textLayerElement?: HTMLElement | null;
}

interface PdfPageTextCacheEntry {
  promise: Promise<PdfPageTextModel>;
  value: PdfPageTextModel | null;
}

interface RenderedPdfPageTextCacheEntry {
  signature: string;
  value: PdfPageTextModel;
}

export interface PdfPageTextOffsetResolutionInput {
  model: PdfPageTextModel;
  container: Node;
  offset: number;
  affinity: "start" | "end";
}

const pdfPageTextCache = new WeakMap<PDFDocumentProxy, Map<number, PdfPageTextCacheEntry>>();
let renderedPdfPageTextCache = new WeakMap<HTMLElement, RenderedPdfPageTextCacheEntry>();
let pdfPageTextNodeIndex = new WeakMap<PdfPageTextModel, Map<Text, PdfPageTextSegment>>();

interface PdfVisualItemMetadata {
  lineIndex: number;
  blockIndex: number;
}

interface PdfVisualRow {
  lineIndex: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
  centerY: number;
  rects: PdfPageTextItemRect[];
}

interface PdfVisualRunMetadata {
  left: number;
  right: number;
  top: number;
  bottom: number;
  centerX: number;
  lineIndex: number;
  equationLike: boolean;
  blockIndex: number;
}

function isTextItem(item: TextContent["items"][number]): item is TextItem {
  return typeof (item as TextItem).str === "string";
}

export function normalizePdfText(text: string | null | undefined): string {
  return (text ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function inferRenderedTextNodeHasEOL(
  currentRect: DOMRect | null | undefined,
  nextRect: DOMRect | null | undefined,
): boolean {
  if (!currentRect || !nextRect) {
    return false;
  }

  const minimumHeight = Math.max(1, Math.min(currentRect.height, nextRect.height));
  const maximumHeight = Math.max(currentRect.height, nextRect.height);
  const verticalShift = nextRect.top - currentRect.top;
  const horizontalGap = nextRect.left - (currentRect.left + currentRect.width);
  const containsSmallAttachedFragment =
    minimumHeight <= maximumHeight * 0.72 &&
    horizontalGap <= Math.max(8, minimumHeight * 0.8);
  if (containsSmallAttachedFragment) {
    return false;
  }
  return verticalShift >= Math.max(6, minimumHeight * 0.55);
}

function multiplyTransforms(left: number[], right: number[]): number[] {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ];
}

function normalizeTransform(transform: number[] | undefined): number[] {
  if (Array.isArray(transform) && transform.length >= 6) {
    return transform;
  }

  return [1, 0, 0, 1, 0, 0];
}

function resolveFontAscent(style: TextStyle | undefined): number {
  if (!style) {
    return 0.8;
  }

  if (typeof style.ascent === "number" && Number.isFinite(style.ascent)) {
    return style.ascent;
  }

  if (typeof style.descent === "number" && Number.isFinite(style.descent)) {
    return 1 + style.descent;
  }

  return 0.8;
}

function buildTextItemRect(input: {
  item: TextItem;
  itemIndex: number;
  viewportTransform: number[];
  styles: Record<string, TextStyle>;
}): PdfPageTextItemRect {
  const tx = multiplyTransforms(input.viewportTransform, input.item.transform as number[]);
  let angle = Math.atan2(tx[1], tx[0]);
  const style = input.styles[input.item.fontName];
  if (style?.vertical) {
    angle += Math.PI / 2;
  }

  const fontHeight = Math.hypot(tx[2], tx[3]);
  const fontAscent = fontHeight * resolveFontAscent(style);

  let left: number;
  let top: number;
  if (angle === 0) {
    left = tx[4];
    top = tx[5] - fontAscent;
  } else {
    left = tx[4] + fontAscent * Math.sin(angle);
    top = tx[5] - fontAscent * Math.cos(angle);
  }

  const width = Math.abs(style?.vertical ? input.item.height : input.item.width);
  const height = Math.abs(fontHeight);

  return {
    itemIndex: input.itemIndex,
    left,
    top,
    width,
    height,
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
    const character = text[index];
    if (/\s/.test(character)) {
      if (sawNonWhitespace && pendingWhitespaceStart === null) {
        pendingWhitespaceStart = index;
      }
      rawToNormalizedOffsets[index + 1] = normalizedText.length;
      continue;
    }

    if (pendingWhitespaceStart !== null && normalizedText.length > 0) {
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

function indexPdfPageTextModel(model: PdfPageTextModel): PdfPageTextModel {
  const nodeIndex = new Map<Text, PdfPageTextSegment>();
  model.segments.forEach((segment) => {
    if (segment.textNode) {
      nodeIndex.set(segment.textNode, segment);
    }
  });
  pdfPageTextNodeIndex.set(model, nodeIndex);
  return model;
}

function rectsHorizontallyTouch(left: Pick<PdfPageTextItemRect, "left" | "width">, right: Pick<PdfPageTextItemRect, "left" | "width">): boolean {
  return left.left + left.width > right.left && right.left + right.width > left.left;
}

function shouldAttachSmallInlineRectToRow(input: {
  rect: PdfPageTextItemRect;
  row: PdfVisualRow;
}): boolean {
  const rowHeight = Math.max(1, input.row.bottom - input.row.top);
  const rectHeight = Math.max(1, input.rect.height);
  const smallerHeight = Math.min(rowHeight, rectHeight);
  const largerHeight = Math.max(rowHeight, rectHeight);
  const isSmallInlineFragment = smallerHeight <= largerHeight * 0.72;
  if (!isSmallInlineFragment) {
    return false;
  }

  const horizontalGap = input.rect.left > input.row.right
    ? input.rect.left - input.row.right
    : input.row.left > input.rect.left + input.rect.width
      ? input.row.left - (input.rect.left + input.rect.width)
      : 0;
  const allowsInlineAttachment = (
    rectsHorizontallyTouch(input.rect, { left: input.row.left, width: input.row.right - input.row.left }) ||
    horizontalGap <= Math.max(10, rowHeight * 0.45)
  );
  if (!allowsInlineAttachment) {
    return false;
  }

  const verticalGap = (input.rect.top + input.rect.height) < input.row.top
    ? input.row.top - (input.rect.top + input.rect.height)
    : input.rect.top > input.row.bottom
      ? input.rect.top - input.row.bottom
      : 0;

  return verticalGap <= Math.max(8, rowHeight * 0.35);
}

function shouldInsertSpaceBetweenSegments(input: {
  previousSegment: {
    text: string;
    itemIndex: number;
  };
  currentSegment: {
    text: string;
    itemIndex: number;
  };
  itemRectMap: Map<number, PdfPageTextItemRect>;
  visualItemMetadata: Map<number, PdfVisualItemMetadata>;
}): boolean {
  if (/\s$/.test(input.previousSegment.text) || /^\s/.test(input.currentSegment.text)) {
    return true;
  }

  const previousRect = input.itemRectMap.get(input.previousSegment.itemIndex);
  const currentRect = input.itemRectMap.get(input.currentSegment.itemIndex);
  if (!previousRect || !currentRect) {
    return true;
  }

  const horizontalGap = currentRect.left - (previousRect.left + previousRect.width);
  const verticalGap = currentRect.top > previousRect.top + previousRect.height
    ? currentRect.top - (previousRect.top + previousRect.height)
    : previousRect.top > currentRect.top + currentRect.height
      ? previousRect.top - (currentRect.top + currentRect.height)
      : 0;
  const minimumHeight = Math.min(previousRect.height, currentRect.height);
  const maximumHeight = Math.max(previousRect.height, currentRect.height);
  const containsSmallAttachedFragment = minimumHeight <= maximumHeight * 0.72;

  const shouldStayCompact = (
    containsSmallAttachedFragment &&
    horizontalGap <= Math.max(3, minimumHeight * 0.35) &&
    verticalGap <= Math.max(8, maximumHeight * 0.45)
  );
  if (shouldStayCompact) {
    return false;
  }

  const previousMetadata = input.visualItemMetadata.get(input.previousSegment.itemIndex);
  const currentMetadata = input.visualItemMetadata.get(input.currentSegment.itemIndex);
  if (
    previousMetadata?.lineIndex !== currentMetadata?.lineIndex ||
    previousMetadata?.blockIndex !== currentMetadata?.blockIndex
  ) {
    return true;
  }

  return horizontalGap > Math.max(
    3,
    minimumHeight * 0.22,
  );
}

function isEquationLikeRun(input: {
  left: number;
  right: number;
  pageWidth: number;
}): boolean {
  const runWidth = Math.max(0, input.right - input.left);
  const runCenterX = (input.left + input.right) / 2;
  const pageCenterX = input.pageWidth / 2;
  return (
    runWidth <= input.pageWidth * 0.72 &&
    Math.abs(runCenterX - pageCenterX) <= Math.max(48, input.pageWidth * 0.12)
  );
}

function buildRenderedVisualItemMetadata(
  itemRects: PdfPageTextItemRect[],
  viewportWidth?: number,
): Map<number, PdfVisualItemMetadata> {
  const metadata = new Map<number, PdfVisualItemMetadata>();
  if (itemRects.length === 0) {
    return metadata;
  }

  const sortedRects = [...itemRects].sort((left, right) => (
    left.top - right.top ||
    left.left - right.left
  ));
  const rows: PdfVisualRow[] = [];

  sortedRects.forEach((rect) => {
    const rectCenterY = rect.top + (rect.height / 2);
    const matchingRow = rows.find((row) => (
      Math.abs(row.centerY - rectCenterY) <= Math.max(4, Math.min(row.bottom - row.top, rect.height) * 0.65)
    ));
    if (matchingRow) {
      matchingRow.rects.push(rect);
      matchingRow.top = Math.min(matchingRow.top, rect.top);
      matchingRow.bottom = Math.max(matchingRow.bottom, rect.top + rect.height);
      matchingRow.left = Math.min(matchingRow.left, rect.left);
      matchingRow.right = Math.max(matchingRow.right, rect.left + rect.width);
      matchingRow.centerY = (matchingRow.top + matchingRow.bottom) / 2;
      return;
    }

    const attachmentRow = rows.find((row) => shouldAttachSmallInlineRectToRow({
      rect,
      row,
    }));
    if (attachmentRow) {
      attachmentRow.rects.push(rect);
      attachmentRow.top = Math.min(attachmentRow.top, rect.top);
      attachmentRow.bottom = Math.max(attachmentRow.bottom, rect.top + rect.height);
      attachmentRow.left = Math.min(attachmentRow.left, rect.left);
      attachmentRow.right = Math.max(attachmentRow.right, rect.left + rect.width);
      attachmentRow.centerY = (attachmentRow.top + attachmentRow.bottom) / 2;
      return;
    }

    rows.push({
      lineIndex: rows.length,
      top: rect.top,
      bottom: rect.top + rect.height,
      left: rect.left,
      right: rect.left + rect.width,
      centerY: rectCenterY,
      rects: [rect],
    });
  });

  const rowAttachmentTargets = new Map<number, number>();
  rows.forEach((row, rowIndex) => {
    const rowHeight = Math.max(1, row.bottom - row.top);
    const bestHostIndex = rows.findIndex((candidate, candidateIndex) => {
      if (candidateIndex === rowIndex) {
        return false;
      }
      const candidateHeight = Math.max(1, candidate.bottom - candidate.top);
      if (rowHeight > candidateHeight * 0.72) {
        return false;
      }
      return row.rects.every((rect) => shouldAttachSmallInlineRectToRow({
        rect,
        row: candidate,
      }));
    });

    if (bestHostIndex >= 0) {
      rowAttachmentTargets.set(rowIndex, bestHostIndex);
    }
  });

  rowAttachmentTargets.forEach((hostIndex, rowIndex) => {
    const row = rows[rowIndex];
    const host = rows[hostIndex];
    host.rects.push(...row.rects);
    host.top = Math.min(host.top, row.top);
    host.bottom = Math.max(host.bottom, row.bottom);
    host.left = Math.min(host.left, row.left);
    host.right = Math.max(host.right, row.right);
    host.centerY = (host.top + host.bottom) / 2;
  });

  const mergedRows = rows
    .filter((_, rowIndex) => !rowAttachmentTargets.has(rowIndex))
    .sort((left, right) => left.top - right.top || left.left - right.left)
    .map((row, rowIndex) => ({
      ...row,
      lineIndex: rowIndex,
      rects: [...row.rects].sort((left, right) => left.left - right.left || left.top - right.top),
    }));

  let nextBlockIndex = 0;
  const pageWidth = Math.max(viewportWidth ?? 0, ...itemRects.map((rect) => rect.left + rect.width), 0);
  const previousRuns: PdfVisualRunMetadata[] = [];

  mergedRows.forEach((row) => {
      const rowRects = [...row.rects].sort((left, right) => left.left - right.left);
      const runs: Array<{
        rects: PdfPageTextItemRect[];
        left: number;
        right: number;
      }> = [];

      rowRects.forEach((rect) => {
        const previous = runs[runs.length - 1];
        if (!previous) {
          runs.push({
            rects: [rect],
            left: rect.left,
            right: rect.left + rect.width,
          });
          return;
        }

        const gap = rect.left - previous.right;
        const rowHeight = Math.max(rect.height, row.bottom - row.top);
        const pageCenterX = pageWidth / 2;
        const crossesPageCenterGutter = (
          pageWidth > 0 &&
          previous.right < pageCenterX &&
          rect.left > pageCenterX &&
          gap >= Math.max(16, rowHeight * 0.65)
        );
        const allowedGap = Math.max(32, rowHeight * 1.8);
        if (gap > allowedGap || crossesPageCenterGutter) {
          runs.push({
            rects: [rect],
            left: rect.left,
            right: rect.left + rect.width,
          });
          return;
        }

        previous.rects.push(rect);
        previous.right = Math.max(previous.right, rect.left + rect.width);
      });

      const currentRuns: PdfVisualRunMetadata[] = [];

      runs.forEach((run) => {
        const runCenterX = (run.left + run.right) / 2;
        const runEquationLike = isEquationLikeRun({
          left: run.left,
          right: run.right,
          pageWidth,
        });
        const matchingPrevious = previousRuns.find((candidate) => {
          if (row.lineIndex - candidate.lineIndex > 1) {
            return false;
          }
          const rowHeight = Math.max(1, row.bottom - row.top);
          const candidateHeight = Math.max(1, candidate.bottom - candidate.top);
          const rowGap = Math.max(0, row.top - candidate.bottom);
          if (rowGap > Math.max(24, Math.min(rowHeight, candidateHeight) * 0.8)) {
            return false;
          }
          if (
            runEquationLike !== candidate.equationLike &&
            rowGap > Math.max(10, Math.min(rowHeight, candidateHeight) * 0.3)
          ) {
            return false;
          }
          const overlap = Math.min(run.right, candidate.right) - Math.max(run.left, candidate.left);
          const minWidth = Math.min(run.right - run.left, candidate.right - candidate.left);
          return (
            overlap >= Math.max(12, minWidth * 0.18) ||
            Math.abs(candidate.centerX - runCenterX) <= Math.max(36, minWidth * 0.5)
          );
        });

        const blockIndex = matchingPrevious?.blockIndex ?? nextBlockIndex++;
        run.rects.forEach((rect) => {
          metadata.set(rect.itemIndex, {
            lineIndex: row.lineIndex,
            blockIndex,
          });
        });
        currentRuns.push({
          blockIndex,
          left: run.left,
          right: run.right,
          top: row.top,
          bottom: row.bottom,
          centerX: runCenterX,
          lineIndex: row.lineIndex,
          equationLike: runEquationLike,
        });
      });

      previousRuns.length = 0;
      previousRuns.push(...currentRuns);
    });

  return metadata;
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function classifyPdfTextBlock(input: {
  text: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
  pageWidth: number;
  pageHeight: number;
  medianHeight: number;
  lineCount: number;
  totalChars: number;
}): PdfPageTextLayoutClass {
  const normalizedText = normalizePdfText(input.text);
  const compactText = normalizedText.replace(/\s+/g, "");
  const blockWidth = Math.max(0, input.right - input.left);
  const blockHeight = Math.max(0, input.bottom - input.top);
  const widthRatio = input.pageWidth > 0 ? blockWidth / input.pageWidth : 0;
  const centerX = (input.left + input.right) / 2;
  const pageCenterX = input.pageWidth / 2;
  const explicitEquationSymbols = [...normalizedText].filter((character) => /[=+/*^_()[\]{}<>]/.test(character)).length;
  const minusSymbolCount = [...normalizedText].filter((character) => character === "-").length;
  const digitCount = [...compactText].filter((character) => /\d/.test(character)).length;
  const tokenCount = normalizedText ? normalizedText.split(/\s+/).filter(Boolean).length : 0;
  const lineCount = Math.max(1, input.lineCount);
  const medianHeight = Math.max(1, input.medianHeight);
  const isTinyText = blockHeight / lineCount <= medianHeight * 0.82;
  const isFarLeft = input.left <= Math.max(48, input.pageWidth * 0.1);
  const isNarrow = blockWidth <= Math.max(36, input.pageWidth * 0.16);
  const isTopRegion = input.top <= input.pageHeight * 0.2;
  const looksLikeAuthorLine = (
    tokenCount >= 2 &&
    tokenCount <= 12 &&
    /,/.test(normalizedText) &&
    !/[.!?;:]$/.test(normalizedText) &&
    /^[\p{L}\p{M}\p{N}\s,.'\-*†‡]+$/u.test(normalizedText)
  );
  const looksLikeAuthorNamesOnly = (
    tokenCount >= 2 &&
    tokenCount <= 16 &&
    isTopRegion &&
    lineCount <= 2 &&
    widthRatio <= 0.58 &&
    /^[\p{L}\p{M}\p{N}\s,.'\-*†‡]+$/u.test(normalizedText) &&
    (
      /(?:,\s*[\p{Lu}])/u.test(normalizedText) ||
      /^[\p{Lu}][\p{L}\p{M}\-']+(?:\s+[\p{Lu}][\p{L}\p{M}\-']+)+(?:,\s*[\p{Lu}][\p{L}\p{M}\-']+(?:\s+[\p{Lu}][\p{L}\p{M}\-']+)*)*$/u.test(normalizedText)
    )
  );
  const looksLikeJournalHeader = /(published online|doi:|nature|american journal|review article|citation:|view online|table of contents)/i.test(normalizedText);

  if (
    compactText.length > 0 &&
    isFarLeft &&
    (blockHeight >= blockWidth * 1.8 || (isNarrow && input.totalChars <= 18 && blockHeight >= medianHeight * 2.4))
  ) {
    return "sidebar";
  }

  if (/^(figure|fig\.|table|scheme|extended data|supplementary)\b/i.test(normalizedText)) {
    return "caption";
  }

  if (
    /(doi\.org|received:|accepted:|published|correspondence|e-?mail|university|institute|department|school of|laboratory)/i.test(normalizedText) ||
    (isTopRegion && /(doi|accepted|received|published)/i.test(normalizedText)) ||
    (isTopRegion && (looksLikeAuthorLine || looksLikeAuthorNamesOnly || looksLikeJournalHeader))
  ) {
    return "metadata";
  }

  if (/^(\(?\d+[\)\.]|[a-zA-Z][\)\.]|[\u2022\-])\s/.test(normalizedText)) {
    return "list";
  }

  if (
    isTinyText &&
    (
      input.top >= input.pageHeight * 0.72 ||
      /^\[?\d+\]?/.test(normalizedText) ||
      /\b\d{4}\b/.test(normalizedText)
    ) &&
    widthRatio <= 0.72
  ) {
    return "footnote";
  }

  if (
    compactText.length > 0 &&
    widthRatio <= 0.78 &&
    Math.abs(centerX - pageCenterX) <= Math.max(48, input.pageWidth * 0.14) &&
    (
      explicitEquationSymbols >= 2 ||
      /(?:=|≈|≤|≥|∑|∫|√)/.test(normalizedText) ||
      (explicitEquationSymbols >= 1 && digitCount >= 2) ||
      (minusSymbolCount >= 2 && tokenCount <= 6)
    ) &&
    input.lineCount <= 2
  ) {
    return "equation";
  }

  if (
    isNarrow &&
    input.totalChars <= 14 &&
    (
      digitCount >= Math.max(1, compactText.length - 2) ||
      /^\[?\d+[a-z]?\]?$/.test(compactText)
    )
  ) {
    return "auxiliary";
  }

  return "main";
}

function assignPdfSegmentLayoutClasses(input: {
  segments: PdfPageTextSegment[];
  itemRects: PdfPageTextItemRect[];
  viewportWidth: number;
  viewportHeight: number;
}): void {
  const itemRectMap = new Map(input.itemRects.map((rect) => [rect.itemIndex, rect]));
  const blockSegments = new Map<number, PdfPageTextSegment[]>();

  input.segments.forEach((segment) => {
    if (typeof segment.blockIndex !== "number") {
      segment.layoutClass = "main";
      return;
    }

    const current = blockSegments.get(segment.blockIndex) ?? [];
    current.push(segment);
    blockSegments.set(segment.blockIndex, current);
  });

  const medianHeight = median(input.itemRects.map((rect) => rect.height).filter((height) => height > 0));

  blockSegments.forEach((segments) => {
    let left = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    let top = Number.POSITIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;
    const lines = new Set<number>();
    let text = "";
    let totalChars = 0;

    segments.forEach((segment) => {
      const itemRect = itemRectMap.get(segment.itemIndex);
      if (itemRect) {
        left = Math.min(left, itemRect.left);
        right = Math.max(right, itemRect.left + itemRect.width);
        top = Math.min(top, itemRect.top);
        bottom = Math.max(bottom, itemRect.top + itemRect.height);
      }
      if (typeof segment.lineIndex === "number") {
        lines.add(segment.lineIndex);
      }
      text += `${text ? " " : ""}${segment.normalizedText}`;
      totalChars += segment.normalizedText.length;
    });

    const layoutClass = classifyPdfTextBlock({
      text,
      left: Number.isFinite(left) ? left : 0,
      right: Number.isFinite(right) ? right : 0,
      top: Number.isFinite(top) ? top : 0,
      bottom: Number.isFinite(bottom) ? bottom : 0,
      pageWidth: input.viewportWidth,
      pageHeight: input.viewportHeight,
      medianHeight,
      lineCount: Math.max(1, lines.size),
      totalChars,
    });

    segments.forEach((segment) => {
      segment.layoutClass = layoutClass;
    });
  });

  input.segments.forEach((segment) => {
    const itemRect = itemRectMap.get(segment.itemIndex);
    if (!itemRect) {
      return;
    }

    const normalizedText = normalizePdfText(segment.normalizedText);
    const compactText = normalizedText.replace(/\s+/g, "");
    const isTinyFragment = itemRect.height <= Math.max(18, medianHeight * 0.82);
    const isNarrowFragment = itemRect.width <= input.viewportWidth * 0.12;
    const isCitationMarker = /^\[?\d+[a-z]?\]?$/.test(compactText);
    const isYearLike = /^\d{4}[a-z]?$/.test(compactText);
    const isFarRightAttached = itemRect.left >= input.viewportWidth * 0.72;
    const isLowPageFragment = itemRect.top >= input.viewportHeight * 0.72;
    const isTopFragment = itemRect.top <= input.viewportHeight * 0.22;
    const looksLikeAffiliationMarker = /^(?:\d+[†‡*]*|[†‡*]+)$/.test(compactText);
    const looksLikeTopAuthorSegment = (
      isTopFragment &&
      itemRect.width >= input.viewportWidth * 0.22 &&
      itemRect.width <= input.viewportWidth * 0.6 &&
      /^[\p{L}\p{M}\s,.'\-]+$/u.test(normalizedText) &&
      /(?:,\s*[\p{Lu}])/u.test(normalizedText)
    );

    if (isYearLike && isTinyFragment && isLowPageFragment) {
      segment.layoutClass = "footnote";
      return;
    }

    if (looksLikeTopAuthorSegment) {
      segment.layoutClass = "metadata";
      return;
    }

    if (
      isTopFragment &&
      isTinyFragment &&
      (
        looksLikeAffiliationMarker ||
        /^\d+(?:,\d+)+$/.test(compactText)
      )
    ) {
      segment.layoutClass = "auxiliary";
      return;
    }

    if (
      (segment.layoutClass === "main" || segment.layoutClass === "equation") &&
      isTinyFragment &&
      isCitationMarker
    ) {
      segment.layoutClass = "auxiliary";
      return;
    }

    if (
      segment.layoutClass === "main" &&
      isTinyFragment &&
      isNarrowFragment &&
      isFarRightAttached &&
      isCitationMarker
    ) {
      segment.layoutClass = "auxiliary";
      return;
    }

    if (segment.layoutClass === "equation") {
      const hasInlineEquationSyntax = /(?:=|≈|≤|≥|∑|∫|√|[\^_*()[\]{}<>/+])/.test(normalizedText);
      const isPlainProseLike = !hasInlineEquationSyntax && normalizedText.split(/\s+/).filter(Boolean).length >= 4;
      const isBodySized = itemRect.height >= Math.max(18, medianHeight * 0.9) && itemRect.width >= input.viewportWidth * 0.18;
      if (isPlainProseLike && isBodySized) {
        segment.layoutClass = "main";
      }
    }
  });
}

function assignPdfSegmentColumnIndices(input: {
  segments: PdfPageTextSegment[];
  itemRects: PdfPageTextItemRect[];
  viewportWidth: number;
}): void {
  const itemRectMap = new Map(input.itemRects.map((rect) => [rect.itemIndex, rect]));
  const blockSegments = new Map<number, PdfPageTextSegment[]>();

  input.segments.forEach((segment) => {
    if (typeof segment.blockIndex !== "number") {
      return;
    }
    const current = blockSegments.get(segment.blockIndex) ?? [];
    current.push(segment);
    blockSegments.set(segment.blockIndex, current);
  });

  const eligibleBlocks = [...blockSegments.entries()]
    .map(([blockIndex, segments]) => {
      let left = Number.POSITIVE_INFINITY;
      let right = Number.NEGATIVE_INFINITY;
      let top = Number.POSITIVE_INFINITY;
      let bottom = Number.NEGATIVE_INFINITY;

      segments.forEach((segment) => {
        const rect = itemRectMap.get(segment.itemIndex);
        if (!rect) {
          return;
        }
        left = Math.min(left, rect.left);
        right = Math.max(right, rect.left + rect.width);
        top = Math.min(top, rect.top);
        bottom = Math.max(bottom, rect.top + rect.height);
      });

      const layoutClass = segments[0]?.layoutClass ?? "main";
      return {
        blockIndex,
        layoutClass,
        segments,
        left,
        right,
        top,
        bottom,
        width: Math.max(0, right - left),
        centerX: (left + right) / 2,
      };
    })
    .filter((block) => (
      Number.isFinite(block.left) &&
      Number.isFinite(block.right) &&
      (block.layoutClass === "main" || block.layoutClass === "list" || block.layoutClass === "caption") &&
      block.width > 0 &&
      block.width <= input.viewportWidth * 0.52
    ));

  if (eligibleBlocks.length < 2) {
    return;
  }

  const pageCenterX = input.viewportWidth / 2;
  const leftBlocks = eligibleBlocks.filter((block) => block.centerX < pageCenterX - (input.viewportWidth * 0.04));
  const rightBlocks = eligibleBlocks.filter((block) => block.centerX > pageCenterX + (input.viewportWidth * 0.04));
  if (leftBlocks.length === 0 || rightBlocks.length === 0) {
    return;
  }

  const hasVerticalOverlap = leftBlocks.some((leftBlock) => rightBlocks.some((rightBlock) => (
    Math.min(leftBlock.bottom, rightBlock.bottom) - Math.max(leftBlock.top, rightBlock.top) >= Math.min(leftBlock.bottom - leftBlock.top, rightBlock.bottom - rightBlock.top) * 0.2
  )));
  if (!hasVerticalOverlap) {
    return;
  }

  eligibleBlocks.forEach((block) => {
    const columnIndex = block.centerX < pageCenterX ? 0 : 1;
    block.segments.forEach((segment) => {
      segment.columnIndex = columnIndex;
    });
  });
}

function buildPdfPageTextModelFromSegments(input: {
  pageNumber: number;
  viewportWidth: number;
  viewportHeight: number;
  textContent: TextContent;
  items: TextItem[];
  itemRects: PdfPageTextItemRect[];
  sourceSegments: Array<{
    itemIndex: number;
    text: string;
    hasEOL: boolean;
    textNode?: Text | null;
  }>;
  textLayerElement?: HTMLElement | null;
}): PdfPageTextModel {
  const segments: PdfPageTextSegment[] = [];
  let normalizedText = "";
  const visualItemMetadata = buildRenderedVisualItemMetadata(input.itemRects, input.viewportWidth);
  const itemRectMap = new Map(input.itemRects.map((rect) => [rect.itemIndex, rect]));

  input.sourceSegments.forEach((sourceSegment, sourceIndex) => {
    const { normalizedText: normalizedSegmentText, rawToNormalizedOffsets } = buildNormalizedOffsetMap(sourceSegment.text);
    if (!normalizedSegmentText) {
      if (sourceSegment.hasEOL && normalizedText && !normalizedText.endsWith(" ")) {
        normalizedText += " ";
      }
      return;
    }

    const previousSourceSegment = sourceIndex > 0 ? input.sourceSegments[sourceIndex - 1] : null;
    if (
      normalizedText &&
      !normalizedText.endsWith(" ") &&
      previousSourceSegment &&
      shouldInsertSpaceBetweenSegments({
        previousSegment: previousSourceSegment,
        currentSegment: sourceSegment,
        itemRectMap,
        visualItemMetadata,
      })
    ) {
      normalizedText += " ";
    }

    const pageTextStart = normalizedText.length;
    normalizedText += normalizedSegmentText;
    const pageTextEnd = normalizedText.length;

    segments.push({
      itemIndex: sourceSegment.itemIndex,
      text: sourceSegment.text,
      normalizedText: normalizedSegmentText,
      hasEOL: sourceSegment.hasEOL,
      pageTextStart,
      pageTextEnd,
      lineIndex: visualItemMetadata.get(sourceSegment.itemIndex)?.lineIndex,
      blockIndex: visualItemMetadata.get(sourceSegment.itemIndex)?.blockIndex,
      textNode: sourceSegment.textNode ?? null,
      rawToNormalizedOffsets,
    });

    if (sourceSegment.hasEOL && !normalizedText.endsWith(" ")) {
      normalizedText += " ";
    }
  });

  assignPdfSegmentLayoutClasses({
    segments,
    itemRects: input.itemRects,
    viewportWidth: input.viewportWidth,
    viewportHeight: input.viewportHeight,
  });
  assignPdfSegmentColumnIndices({
    segments,
    itemRects: input.itemRects,
    viewportWidth: input.viewportWidth,
  });

  return indexPdfPageTextModel({
    pageNumber: input.pageNumber,
    viewportWidth: input.viewportWidth,
    viewportHeight: input.viewportHeight,
    textContent: input.textContent,
    items: input.items,
    segments,
    itemRects: input.itemRects,
    normalizedText: normalizedText.trim(),
    textLayerElement: input.textLayerElement ?? null,
  });
}

function buildPdfPageTextModel(input: {
  pageNumber: number;
  textContent: TextContent;
  viewportWidth: number;
  viewportHeight: number;
  viewportTransform: number[];
}): PdfPageTextModel {
  const items = input.textContent.items.filter(isTextItem);
  const itemRects = items.map((item, itemIndex) => buildTextItemRect({
    item,
    itemIndex,
    viewportTransform: input.viewportTransform,
    styles: input.textContent.styles,
  }));

  return buildPdfPageTextModelFromSegments({
    pageNumber: input.pageNumber,
    textContent: input.textContent,
    viewportWidth: input.viewportWidth,
    viewportHeight: input.viewportHeight,
    items,
    itemRects,
    sourceSegments: items.map((item, itemIndex) => ({
      itemIndex,
      text: item.str,
      hasEOL: item.hasEOL,
    })),
  });
}

function formatRectSignature(rect: DOMRect): string {
  return [
    rect.left,
    rect.top,
    rect.width,
    rect.height,
  ].map((value) => Number.isFinite(value) ? value.toFixed(3) : "0").join(":");
}

function isUsableRenderedTextRect(rect: DOMRect | null | undefined): rect is DOMRect {
  return Boolean(
    rect &&
    Number.isFinite(rect.left) &&
    Number.isFinite(rect.top) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0,
  );
}

function getRenderedTextNodeRect(textNode: Text, parentRect?: DOMRect | null): DOMRect | null {
  if (typeof document === "undefined" || typeof document.createRange !== "function") {
    return null;
  }

  try {
    const range = document.createRange();
    range.selectNodeContents(textNode);
    const rect = range.getBoundingClientRect();
    if (typeof range.detach === "function") {
      range.detach();
    }
    if (!isUsableRenderedTextRect(rect)) {
      return null;
    }
    if (parentRect && isUsableRenderedTextRect(parentRect)) {
      const startsAtParentTextOrigin = Math.abs(rect.left - parentRect.left) <= Math.max(1, parentRect.width * 0.01);
      const insideParent =
        rect.left >= parentRect.left - 1 &&
        rect.right <= parentRect.right + 1 &&
        rect.top >= parentRect.top - Math.max(2, parentRect.height * 0.4) &&
        rect.bottom <= parentRect.bottom + Math.max(2, parentRect.height * 0.4);
      const verticalOverlap = Math.max(0, Math.min(rect.bottom, parentRect.bottom) - Math.max(rect.top, parentRect.top));
      const minimumHeight = Math.max(1, Math.min(rect.height, parentRect.height));
      if (!startsAtParentTextOrigin || !insideParent || verticalOverlap < minimumHeight * 0.35) {
        return null;
      }
    }
    return rect;
  } catch {
    return null;
  }
}

function buildRenderedPdfPageTextModelSignature(pageElement: HTMLElement, textNodes: Text[]): string {
  const pageRect = pageElement.getBoundingClientRect();
  return textNodes
    .map((node) => {
      const rawParentRect = node.parentElement?.getBoundingClientRect();
      const parentRect = getRenderedTextNodeRect(node, rawParentRect) ?? rawParentRect;
      return [
        node.textContent ?? "",
        parentRect ? formatRectSignature(parentRect) : "missing-rect",
      ].join("\u0002");
    })
    .concat([
      `page=${formatRectSignature(pageRect)}`,
      `scale=${pageElement.querySelector<HTMLElement>("[data-scale]")?.dataset.scale ?? ""}`,
    ])
    .join("\u0001");
}

function findRenderablePdfTextNodes(textLayer: HTMLElement): Text[] {
  const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType !== Node.TEXT_NODE) {
        return NodeFilter.FILTER_SKIP;
      }
      const textNode = node as Text;
      if (!normalizePdfText(textNode.textContent).length) {
        return NodeFilter.FILTER_SKIP;
      }
      if (textNode.parentElement?.closest(".endOfContent")) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const textNodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    textNodes.push(current as Text);
    current = walker.nextNode();
  }

  return textNodes;
}

export function buildRenderedPdfPageTextModel(pageElement: HTMLElement): PdfPageTextModel | null {
  const textLayer = pageElement.querySelector<HTMLElement>(".textLayer");
  if (!textLayer) {
    return null;
  }

  const textNodes = findRenderablePdfTextNodes(textLayer);
  if (textNodes.length === 0) {
    return null;
  }

  const signature = buildRenderedPdfPageTextModelSignature(pageElement, textNodes);
  const cached = renderedPdfPageTextCache.get(pageElement);
  if (cached?.signature === signature) {
    return cached.value;
  }

  const pageRect = pageElement.getBoundingClientRect();
  const pageNumber = Number(pageElement.dataset.pageNumber ?? "0");
  const toPageLocalRect = (rect: DOMRect): { left: number; top: number; width: number; height: number } => {
    const viewportRelativeLeft = rect.left - pageRect.left;
    const viewportRelativeTop = rect.top - pageRect.top;
    const rectLooksPageLocal =
      rect.left >= -1 &&
      rect.top >= -1 &&
      rect.left + rect.width <= pageRect.width + 1 &&
      rect.top + rect.height <= pageRect.height + 1 &&
      (
        viewportRelativeLeft < -1 ||
        viewportRelativeTop < -1 ||
        viewportRelativeLeft + rect.width > pageRect.width + 1 ||
        viewportRelativeTop + rect.height > pageRect.height + 1
      );

    return {
      left: rectLooksPageLocal ? rect.left : viewportRelativeLeft,
      top: rectLooksPageLocal ? rect.top : viewportRelativeTop,
      width: rect.width,
      height: rect.height,
    };
  };
  const items: TextItem[] = [];
  const itemRects: PdfPageTextItemRect[] = [];
  const parentRects = textNodes.map((textNode) => textNode.parentElement?.getBoundingClientRect() ?? null);
  const textRects = textNodes.map((textNode, index) => getRenderedTextNodeRect(textNode, parentRects[index]) ?? parentRects[index]);
  const sourceSegments = textNodes.map((textNode, itemIndex) => {
    const textRect = textRects[itemIndex];
    const nextTextRect = textRects[itemIndex + 1] ?? null;
    items.push({
      str: textNode.textContent ?? "",
      dir: "ltr",
      transform: [1, 0, 0, textRect?.height ?? 0, textRect?.left ?? 0, textRect?.top ?? 0],
      width: textRect?.width ?? 0,
      height: textRect?.height ?? 0,
      fontName: "",
      hasEOL: false,
    } as TextItem);
    if (textRect) {
      const localRect = toPageLocalRect(textRect);
      itemRects.push({
        itemIndex,
        left: localRect.left,
        top: localRect.top,
        width: localRect.width,
        height: localRect.height,
      });
    }

    return {
      itemIndex,
      text: textNode.textContent ?? "",
      hasEOL: inferRenderedTextNodeHasEOL(textRect, nextTextRect),
      textNode,
    };
  });

  const model = buildPdfPageTextModelFromSegments({
    pageNumber: Number.isInteger(pageNumber) && pageNumber > 0 ? pageNumber : 1,
    viewportWidth: Math.max(0, pageRect.width),
    viewportHeight: Math.max(0, pageRect.height),
    textContent: {
      items,
      styles: {},
      lang: null,
    },
    items,
    itemRects,
    sourceSegments,
    textLayerElement: textLayer,
  });

  renderedPdfPageTextCache.set(pageElement, {
    signature,
    value: model,
  });

  return model;
}

function findFirstTextNode(node: Node | null): Text | null {
  if (!node) {
    return null;
  }
  if (node.nodeType === Node.TEXT_NODE) {
    return node as Text;
  }
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  const current = walker.nextNode();
  return current instanceof Text ? current : null;
}

function findLastTextNode(node: Node | null): Text | null {
  if (!node) {
    return null;
  }
  if (node.nodeType === Node.TEXT_NODE) {
    return node as Text;
  }
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  let last: Text | null = null;
  let current = walker.nextNode();
  while (current) {
    last = current as Text;
    current = walker.nextNode();
  }
  return last;
}

function resolveElementBoundary(input: {
  root: HTMLElement;
  container: Node;
  offset: number;
  affinity: "start" | "end";
}): { node: Text; offset: number } | null {
  if (!(input.container instanceof Element || input.container instanceof DocumentFragment)) {
    return null;
  }

  const childNodes = Array.from(input.container.childNodes);
  if (input.affinity === "start") {
    for (let index = input.offset; index < childNodes.length; index += 1) {
      const textNode = findFirstTextNode(childNodes[index]);
      if (textNode) {
        return { node: textNode, offset: 0 };
      }
    }
    for (let index = input.offset - 1; index >= 0; index -= 1) {
      const textNode = findLastTextNode(childNodes[index]);
      if (textNode) {
        return {
          node: textNode,
          offset: textNode.textContent?.length ?? 0,
        };
      }
    }
    const fallback = findFirstTextNode(input.root);
    return fallback ? { node: fallback, offset: 0 } : null;
  }

  for (let index = Math.min(input.offset - 1, childNodes.length - 1); index >= 0; index -= 1) {
    const textNode = findLastTextNode(childNodes[index]);
    if (textNode) {
      return {
        node: textNode,
        offset: textNode.textContent?.length ?? 0,
      };
    }
  }
  for (let index = input.offset; index < childNodes.length; index += 1) {
    const textNode = findFirstTextNode(childNodes[index]);
    if (textNode) {
      return { node: textNode, offset: 0 };
    }
  }
  const fallback = findLastTextNode(input.root);
  return fallback
    ? {
        node: fallback,
        offset: fallback.textContent?.length ?? 0,
      }
    : null;
}

function resolveTextNodeBoundaryWithinElement(input: {
  element: Element;
  offset: number;
  affinity: "start" | "end";
}): { node: Text; offset: number } | null {
  const childNodes = Array.from(input.element.childNodes);
  if (childNodes.length === 0) {
    return null;
  }

  const clampedOffset = Math.max(0, Math.min(childNodes.length, input.offset));
  if (input.affinity === "start") {
    for (let index = clampedOffset; index < childNodes.length; index += 1) {
      const textNode = findFirstTextNode(childNodes[index]);
      if (textNode) {
        return { node: textNode, offset: 0 };
      }
    }
    for (let index = clampedOffset - 1; index >= 0; index -= 1) {
      const textNode = findLastTextNode(childNodes[index]);
      if (textNode) {
        return { node: textNode, offset: textNode.textContent?.length ?? 0 };
      }
    }
  } else {
    for (let index = Math.min(clampedOffset - 1, childNodes.length - 1); index >= 0; index -= 1) {
      const textNode = findLastTextNode(childNodes[index]);
      if (textNode) {
        return { node: textNode, offset: textNode.textContent?.length ?? 0 };
      }
    }
    for (let index = clampedOffset; index < childNodes.length; index += 1) {
      const textNode = findFirstTextNode(childNodes[index]);
      if (textNode) {
        return { node: textNode, offset: 0 };
      }
    }
  }

  return null;
}

export function resolvePdfPageTextOffset(input: PdfPageTextOffsetResolutionInput): number | null {
  const nodeIndex = pdfPageTextNodeIndex.get(input.model);
  if (!nodeIndex) {
    return null;
  }

  let resolvedContainer: Text | null = null;
  let resolvedOffset = input.offset;

  if (input.container instanceof Text) {
    resolvedContainer = input.container;
  } else if (input.container instanceof Element) {
    const directBoundary = resolveTextNodeBoundaryWithinElement({
      element: input.container,
      offset: input.offset,
      affinity: input.affinity,
    });
    if (directBoundary) {
      resolvedContainer = directBoundary.node;
      resolvedOffset = directBoundary.offset;
    }
  } else {
    const textLayerElement = input.model.textLayerElement;
    if (!textLayerElement) {
      return null;
    }
    const resolvedBoundary = resolveElementBoundary({
      root: textLayerElement,
      container: input.container,
      offset: input.offset,
      affinity: input.affinity,
    });
    if (!resolvedBoundary) {
      return null;
    }
    resolvedContainer = resolvedBoundary.node;
    resolvedOffset = resolvedBoundary.offset;
  }

  if (!resolvedContainer) {
    return null;
  }

  const segment = nodeIndex.get(resolvedContainer);
  if (!segment) {
    return null;
  }

  const textLength = resolvedContainer.textContent?.length ?? 0;
  const clampedOffset = Math.max(0, Math.min(textLength, resolvedOffset));
  const rawToNormalizedOffsets = segment.rawToNormalizedOffsets ?? buildNormalizedOffsetMap(segment.text).rawToNormalizedOffsets;

  return segment.pageTextStart + (rawToNormalizedOffsets[clampedOffset] ?? 0);
}

export async function getPdfPageTextModel(
  pdfDocument: PDFDocumentProxy,
  pageNumber: number,
): Promise<PdfPageTextModel> {
  let pageCache: Map<number, PdfPageTextCacheEntry> | undefined = pdfPageTextCache.get(pdfDocument);
  if (!pageCache) {
    pageCache = new Map<number, PdfPageTextCacheEntry>();
    pdfPageTextCache.set(pdfDocument, pageCache);
  }
  const resolvedPageCache = pageCache;

  const cached = resolvedPageCache.get(pageNumber);
  if (cached) {
    return cached.promise;
  }

  const entry: PdfPageTextCacheEntry = {
    promise: Promise.resolve(undefined as never),
    value: null,
  };

  entry.promise = (async () => {
    const page = await pdfDocument.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent({
      includeMarkedContent: false,
    });

    const model = buildPdfPageTextModel({
      pageNumber,
      textContent,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      viewportTransform: normalizeTransform(viewport.transform as number[] | undefined),
    });
    entry.value = model;
    return model;
  })();

  resolvedPageCache.set(pageNumber, entry);

  try {
    return await entry.promise;
  } catch (error) {
    resolvedPageCache.delete(pageNumber);
    throw error;
  }
}

export async function getPdfPageSearchText(
  pdfDocument: PDFDocumentProxy,
  pageNumber: number,
): Promise<string> {
  const model = await getPdfPageTextModel(pdfDocument, pageNumber);
  return model.normalizedText;
}

export function clearPdfPageTextCache(pdfDocument?: PDFDocumentProxy): void {
  if (pdfDocument) {
    pdfPageTextCache.delete(pdfDocument);
    return;
  }

  renderedPdfPageTextCache = new WeakMap<HTMLElement, RenderedPdfPageTextCacheEntry>();
  pdfPageTextNodeIndex = new WeakMap<PdfPageTextModel, Map<Text, PdfPageTextSegment>>();
}

export function peekPdfPageTextModel(
  pdfDocument: PDFDocumentProxy,
  pageNumber: number,
): PdfPageTextModel | null {
  return pdfPageTextCache.get(pdfDocument)?.get(pageNumber)?.value ?? null;
}

export function prefetchPdfPageTextModel(
  pdfDocument: PDFDocumentProxy,
  pageNumber: number,
): void {
  void getPdfPageTextModel(pdfDocument, pageNumber).catch(() => undefined);
}
