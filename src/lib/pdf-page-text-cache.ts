import type { PDFDocumentProxy } from "pdfjs-dist";
import type { TextContent, TextItem, TextStyle } from "pdfjs-dist/types/src/display/api";

export interface PdfPageTextSegment {
  itemIndex: number;
  text: string;
  normalizedText: string;
  hasEOL: boolean;
  pageTextStart: number;
  pageTextEnd: number;
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
  let pendingWhitespace = false;

  for (let index = 0; index < text.length; index += 1) {
    rawToNormalizedOffsets[index] = normalizedText.length;
    const character = text[index];
    if (/\s/.test(character)) {
      if (sawNonWhitespace) {
        pendingWhitespace = true;
      }
      continue;
    }

    if (pendingWhitespace && normalizedText.length > 0) {
      normalizedText += " ";
    }

    normalizedText += character;
    sawNonWhitespace = true;
    pendingWhitespace = false;
  }

  rawToNormalizedOffsets[text.length] = normalizedText.length;

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

  input.sourceSegments.forEach((sourceSegment) => {
    const { normalizedText: normalizedSegmentText, rawToNormalizedOffsets } = buildNormalizedOffsetMap(sourceSegment.text);
    if (!normalizedSegmentText) {
      if (sourceSegment.hasEOL && normalizedText && !normalizedText.endsWith(" ")) {
        normalizedText += " ";
      }
      return;
    }

    if (normalizedText && !normalizedText.endsWith(" ")) {
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

function buildRenderedPdfPageTextModelSignature(textNodes: Text[]): string {
  return textNodes
    .map((node) => node.textContent ?? "")
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

  const signature = buildRenderedPdfPageTextModelSignature(textNodes);
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

export function resolvePdfPageTextOffset(input: PdfPageTextOffsetResolutionInput): number | null {
  const nodeIndex = pdfPageTextNodeIndex.get(input.model);
  if (!nodeIndex) {
    return null;
  }

  let resolvedContainer: Text | null = null;
  let resolvedOffset = input.offset;

  if (input.container instanceof Text) {
    resolvedContainer = input.container;
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

  const segment = resolvedContainer ? nodeIndex.get(resolvedContainer) : undefined;
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
