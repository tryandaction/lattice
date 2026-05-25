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
  textNode?: Text | null;
  rawToNormalizedOffsets?: number[];
}

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
  return (text ?? "").replace(/\s+/g, " ").trim();
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

function buildRenderedVisualItemMetadata(itemRects: PdfPageTextItemRect[]): Map<number, PdfVisualItemMetadata> {
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
  const pageWidth = Math.max(...itemRects.map((rect) => rect.left + rect.width), 0);
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
        const allowedGap = Math.max(32, Math.max(rect.height, row.bottom - row.top) * 1.8);
        if (gap > allowedGap) {
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
  const visualItemMetadata = buildRenderedVisualItemMetadata(input.itemRects);
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

function buildRenderedPdfPageTextModelSignature(pageElement: HTMLElement, textNodes: Text[]): string {
  const pageRect = pageElement.getBoundingClientRect();
  return textNodes
    .map((node) => {
      const parentRect = node.parentElement?.getBoundingClientRect();
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
  const items: TextItem[] = [];
  const itemRects: PdfPageTextItemRect[] = [];
  const sourceSegments = textNodes.map((textNode, itemIndex) => {
    const parentRect = textNode.parentElement?.getBoundingClientRect();
    if (parentRect) {
      itemRects.push({
        itemIndex,
        left: parentRect.left - pageRect.left,
        top: parentRect.top - pageRect.top,
        width: parentRect.width,
        height: parentRect.height,
      });
    }

    return {
      itemIndex,
      text: textNode.textContent ?? "",
      hasEOL: false,
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
