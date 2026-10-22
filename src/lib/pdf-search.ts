import type { PdfPageTextModel } from "@/lib/pdf-page-text-cache";

export interface PdfSearchMatchRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PdfSearchMatch {
  page: number;
  pageMatchIndex: number;
  caseSensitive: boolean;
  entireWord: boolean;
  index: number;
  normalizedIndex: number;
  normalizedLength: number;
  normalizedQuery: string;
  preview: string;
  rects: PdfSearchMatchRect[];
}

interface PdfNormalizedSearchText {
  text: string;
  indexMap: number[];
}

export interface PdfSearchOptions {
  caseSensitive?: boolean;
  entireWord?: boolean;
}

const PDF_SEARCH_CHARACTER_MAP: Record<string, string> = {
  "\u00a0": " ",
  "\u00ad": "",
  "\u2010": "-",
  "\u2011": "-",
  "\u2012": "-",
  "\u2013": "-",
  "\u2014": "-",
  "\u2018": "'",
  "\u2019": "'",
  "\u201a": "'",
  "\u201b": "'",
  "\u201c": "\"",
  "\u201d": "\"",
  "\u201e": "\"",
  "\u201f": "\"",
  "\ufb00": "ff",
  "\ufb01": "fi",
  "\ufb02": "fl",
  "\ufb03": "ffi",
  "\ufb04": "ffl",
  "\ufb05": "ft",
  "\ufb06": "st",
};

function buildPreview(text: string, start: number, query: string): string {
  const windowSize = 36;
  const previewStart = Math.max(0, start - windowSize);
  const previewEnd = Math.min(text.length, start + query.length + windowSize);
  const prefix = previewStart > 0 ? "..." : "";
  const suffix = previewEnd < text.length ? "..." : "";
  return `${prefix}${text.slice(previewStart, previewEnd)}${suffix}`;
}

function isWhitespace(character: string | undefined): boolean {
  return Boolean(character) && /\s/u.test(character ?? "");
}

function isWordCharacter(character: string | undefined): boolean {
  return Boolean(character) && /[\p{L}\p{N}_]/u.test(character ?? "");
}

function normalizePdfSearchCharacter(character: string, options?: Pick<PdfSearchOptions, "caseSensitive">): string {
  const mapped = PDF_SEARCH_CHARACTER_MAP[character] ?? character;
  if (!mapped) {
    return "";
  }

  const compatibilityNormalized = mapped.normalize("NFKC");
  const withoutDiacritics = compatibilityNormalized
    .normalize("NFD")
    .replace(/\p{M}+/gu, "");
  return options?.caseSensitive ? withoutDiacritics : withoutDiacritics.toLocaleLowerCase();
}

function findNextNonWhitespace(text: string, startIndex: number): { character: string; index: number } | null {
  for (let index = startIndex; index < text.length; index += 1) {
    const character = text[index];
    if (!isWhitespace(character)) {
      return { character, index };
    }
  }
  return null;
}

function shouldRemoveLineBreakHyphen(input: {
  text: string;
  index: number;
  outputText: string;
}): boolean {
  const character = input.text[input.index];
  if (character !== "-" && character !== "\u2010" && character !== "\u2011" && character !== "\u00ad") {
    return false;
  }

  const next = findNextNonWhitespace(input.text, input.index + 1);
  if (!next || next.index === input.index + 1) {
    return character === "\u00ad";
  }

  const skipped = input.text.slice(input.index + 1, next.index);
  if (!/[\r\n]/u.test(skipped)) {
    return false;
  }

  return isWordCharacter(input.outputText.slice(-1)) && isWordCharacter(next.character);
}

function resolveRawRangeForNormalizedOffsets(input: {
  offsets?: number[];
  localStart: number;
  localEnd: number;
}): { rawStart: number; rawEnd: number } | null {
  const offsets = input.offsets;
  if (!offsets || offsets.length < 2) {
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
  return rawEnd > rawStart ? { rawStart, rawEnd } : null;
}

function measureRenderedMatchRects(input: {
  model: PdfPageTextModel;
  segment: PdfPageTextModel["segments"][number];
  itemRect: PdfPageTextModel["itemRects"][number];
  localStart: number;
  localEnd: number;
}): PdfSearchMatchRect[] {
  if (
    typeof document === "undefined" ||
    typeof Text === "undefined" ||
    !(input.segment.textNode instanceof Text) ||
    !input.segment.textNode.parentElement
  ) {
    return [];
  }

  const rawRange = resolveRawRangeForNormalizedOffsets({
    offsets: input.segment.rawToNormalizedOffsets,
    localStart: input.localStart,
    localEnd: input.localEnd,
  });
  if (!rawRange) {
    return [];
  }

  try {
    const range = document.createRange();
    range.setStart(input.segment.textNode, rawRange.rawStart);
    range.setEnd(input.segment.textNode, rawRange.rawEnd);
    const parentRect = input.segment.textNode.parentElement.getBoundingClientRect();
    const measuredRects = typeof range.getClientRects === "function"
      ? Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0)
      : [];
    const fallbackRect = measuredRects.length === 0 && typeof range.getBoundingClientRect === "function"
      ? range.getBoundingClientRect()
      : null;
    if (fallbackRect && fallbackRect.width > 0 && fallbackRect.height > 0) {
      measuredRects.push(fallbackRect);
    }
    if (typeof range.detach === "function") {
      range.detach();
    }

    return measuredRects.map((rect) => ({
      left: (input.itemRect.left + rect.left - parentRect.left) / Math.max(1, input.model.viewportWidth),
      top: (input.itemRect.top + rect.top - parentRect.top) / Math.max(1, input.model.viewportHeight),
      width: rect.width / Math.max(1, input.model.viewportWidth),
      height: rect.height / Math.max(1, input.model.viewportHeight),
    }));
  } catch {
    return [];
  }
}

function buildMatchRects(model: PdfPageTextModel, start: number, end: number): PdfSearchMatchRect[] {
  const rects: PdfSearchMatchRect[] = [];
  const itemRectMap = new Map(model.itemRects.map((rect) => [rect.itemIndex, rect]));

  for (const segment of model.segments) {
    if (segment.pageTextEnd <= start || segment.pageTextStart >= end) {
      continue;
    }

    const itemRect = itemRectMap.get(segment.itemIndex);
    if (!itemRect || itemRect.width <= 0 || itemRect.height <= 0) {
      continue;
    }

    const overlapStart = Math.max(start, segment.pageTextStart);
    const overlapEnd = Math.min(end, segment.pageTextEnd);
    const segmentTextLength = Math.max(1, segment.pageTextEnd - segment.pageTextStart);
    const localStart = overlapStart - segment.pageTextStart;
    const localEnd = overlapEnd - segment.pageTextStart;
    const measuredRects = measureRenderedMatchRects({
      model,
      segment,
      itemRect,
      localStart,
      localEnd,
    });
    if (measuredRects.length > 0) {
      rects.push(...measuredRects);
      continue;
    }

    const startRatio = localStart / segmentTextLength;
    const endRatio = localEnd / segmentTextLength;

    rects.push({
      left: (itemRect.left + itemRect.width * startRatio) / Math.max(1, model.viewportWidth),
      top: itemRect.top / Math.max(1, model.viewportHeight),
      width: Math.max(1, itemRect.width * (endRatio - startRatio)) / Math.max(1, model.viewportWidth),
      height: itemRect.height / Math.max(1, model.viewportHeight),
    });
  }

  return rects;
}

export function resolvePdfSearchMatchCandidate(
  reference: PdfSearchMatch,
  candidates: PdfSearchMatch[],
): PdfSearchMatch | null {
  const compatible = candidates.filter((candidate) => (
    candidate.page === reference.page &&
    candidate.normalizedQuery === reference.normalizedQuery &&
    candidate.caseSensitive === reference.caseSensitive &&
    candidate.entireWord === reference.entireWord
  ));
  if (compatible.length === 0) {
    return null;
  }

  const exact = compatible.find((candidate) => (
    candidate.normalizedIndex === reference.normalizedIndex &&
    candidate.normalizedLength === reference.normalizedLength
  ));
  if (exact) {
    return exact;
  }

  const sameOccurrence = compatible.find((candidate) => (
    candidate.pageMatchIndex === reference.pageMatchIndex
  ));
  if (sameOccurrence) {
    return sameOccurrence;
  }

  return compatible.reduce((best, candidate) => (
    Math.abs(candidate.normalizedIndex - reference.normalizedIndex) <
    Math.abs(best.normalizedIndex - reference.normalizedIndex)
      ? candidate
      : best
  ));
}

export function resolvePdfSearchMatchesForRenderedModel(
  model: PdfPageTextModel,
  references: PdfSearchMatch[],
): PdfSearchMatch[] {
  const candidatesByQuery = new Map<string, PdfSearchMatch[]>();

  return references.map((reference) => {
    const queryKey = [
      reference.normalizedQuery,
      reference.caseSensitive ? "case" : "fold",
      reference.entireWord ? "word" : "partial",
    ].join("\u0001");
    let candidates = candidatesByQuery.get(queryKey);
    if (!candidates) {
      candidates = searchPdfPageTextModel(model, reference.normalizedQuery, {
        caseSensitive: reference.caseSensitive,
        entireWord: reference.entireWord,
      });
      candidatesByQuery.set(queryKey, candidates);
    }
    return resolvePdfSearchMatchCandidate(reference, candidates) ?? reference;
  });
}

export function normalizePdfSearchText(text: string, options?: Pick<PdfSearchOptions, "caseSensitive">): PdfNormalizedSearchText {
  const chars: string[] = [];
  const indexMap: number[] = [];
  let pendingWhitespaceIndex: number | null = null;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (shouldRemoveLineBreakHyphen({ text, index, outputText: chars[chars.length - 1] ?? "" })) {
      while (index + 1 < text.length && isWhitespace(text[index + 1])) {
        index += 1;
      }
      continue;
    }

    if (isWhitespace(char)) {
      if (chars.length > 0 && pendingWhitespaceIndex === null) {
        pendingWhitespaceIndex = index;
      }
      continue;
    }

    const normalized = normalizePdfSearchCharacter(char, options);
    if (!normalized) {
      continue;
    }

    if (pendingWhitespaceIndex !== null && chars.length > 0) {
      chars.push(" ");
      indexMap.push(pendingWhitespaceIndex);
      pendingWhitespaceIndex = null;
    }

    for (const normalizedChar of normalized) {
      chars.push(normalizedChar);
      indexMap.push(index);
    }
  }

  return { text: chars.join(""), indexMap };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildPdfSearchRegExp(normalizedQuery: string): RegExp | null {
  if (!normalizedQuery) {
    return null;
  }

  const parts: string[] = [];
  for (const character of normalizedQuery) {
    if (character === " ") {
      parts.push("[ ]+");
      continue;
    }

    if (/\p{P}/u.test(character)) {
      parts.push(`[ ]*${escapeRegExp(character)}[ ]*`);
      continue;
    }

    parts.push(escapeRegExp(character));
  }

  return new RegExp(parts.join(""), "gu");
}

function isEntireWordMatch(text: string, start: number, end: number): boolean {
  return !isWordCharacter(text[start - 1]) && !isWordCharacter(text[end]);
}

export function searchPdfPageTextModel(model: PdfPageTextModel, query: string, options: PdfSearchOptions = {}): PdfSearchMatch[] {
  const normalizedQuery = normalizePdfSearchText(query.trim(), options).text;
  const queryExpression = buildPdfSearchRegExp(normalizedQuery);
  if (!queryExpression) {
    return [];
  }

  const normalizedPage = normalizePdfSearchText(model.normalizedText, options);
  const text = normalizedPage.text;
  const matches: PdfSearchMatch[] = [];
  let match: RegExpExecArray | null;

  while ((match = queryExpression.exec(text)) !== null) {
    const index = match.index;
    const normalizedLength = match[0].length;
    const normalizedEnd = index + normalizedLength;
    if (options.entireWord && !isEntireWordMatch(text, index, normalizedEnd)) {
      continue;
    }

    const start = normalizedPage.indexMap[index] ?? 0;
    const lastNeedleIndex = normalizedEnd - 1;
    const end = (normalizedPage.indexMap[lastNeedleIndex] ?? start) + 1;
    matches.push({
      page: model.pageNumber,
      pageMatchIndex: matches.length,
      caseSensitive: Boolean(options.caseSensitive),
      entireWord: Boolean(options.entireWord),
      index: start,
      normalizedIndex: index,
      normalizedLength,
      normalizedQuery,
      preview: buildPreview(model.normalizedText, start, model.normalizedText.slice(start, end)),
      rects: buildMatchRects(model, start, end),
    });
    if (queryExpression.lastIndex === index) {
      queryExpression.lastIndex += 1;
    }
  }

  return matches;
}
