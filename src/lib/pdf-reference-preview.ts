import type { PdfPageTextModel } from "@/lib/pdf-page-text-cache";
import { buildPdfRectsForOffsets as buildCanonicalPdfRectsForOffsets } from "@/lib/pdf-canonical-text-anchoring";

export interface PdfReferencePreviewRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PdfReferenceEntry {
  number: number;
  page: number;
  start: number;
  end: number;
  text: string;
  preview: string;
  rects: PdfReferencePreviewRect[];
}

export interface PdfCitationHotspot {
  id: string;
  page: number;
  start: number;
  end: number;
  label: string;
  referenceNumbers: number[];
  context: string;
  rects: PdfReferencePreviewRect[];
}

export interface PdfReferencePreviewIndex {
  referenceStart: { page: number; offset: number } | null;
  entries: PdfReferenceEntry[];
  entriesByNumber: Record<number, PdfReferenceEntry>;
  hotspots: PdfCitationHotspot[];
}

export function selectPdfReferencePreviewPageNumbers(input: {
  numPages: number;
  renderedPageNumbers: readonly number[];
  tailPageLimit?: number;
}): number[] {
  const numPages = Math.max(0, Math.floor(input.numPages));
  if (numPages === 0) {
    return [];
  }

  const pages = new Set<number>();
  for (const pageNumber of input.renderedPageNumbers) {
    if (Number.isInteger(pageNumber) && pageNumber >= 1 && pageNumber <= numPages) {
      pages.add(pageNumber);
    }
  }

  const tailPageLimit = Math.max(0, Math.floor(input.tailPageLimit ?? 12));
  if (tailPageLimit > 0) {
    const tailStart = Math.max(1, numPages - tailPageLimit + 1);
    for (let pageNumber = tailStart; pageNumber <= numPages; pageNumber += 1) {
      pages.add(pageNumber);
    }
  }

  return [...pages].sort((left, right) => left - right);
}

interface PdfReferenceLine {
  page: number;
  start: number;
  end: number;
  text: string;
}

const REFERENCE_HEADING_PATTERN = /\b(references|bibliography|literature cited|参考文献|参考资料)\b/iu;
const REFERENCE_ENTRY_PATTERN = /^\s*(?:\[(\d{1,4})\]|(\d{1,4})[.)])\s+(.+)/u;
const REFERENCE_LABEL_PATTERN = /\brefs?\.?\s*((?:\d{1,4}\s*(?:[-–]\s*\d{1,4})?\s*(?:,|;|and|&)?\s*){1,120})/giu;
const GROUPED_CITATION_PATTERN = /(^|[([{\s;,:])(\d{1,4}(?:\s*[-–]\s*\d{1,4})?(?:\s*,\s*\d{1,4}(?:\s*[-–]\s*\d{1,4})?){1,12})(?=[)\]}.,;:\s]|$)/gu;
const BRACKETED_CITATION_PATTERN = /[[(]\s*(\d{1,4}(?:\s*[-\u2013\u2014]\s*\d{1,4})?(?:\s*,\s*\d{1,4}(?:\s*[-\u2013\u2014]\s*\d{1,4})?){0,12})\s*[\])]/gu;
const ATTACHED_SUPERSCRIPT_PATTERN = /([\p{L})\]])(\d{1,4})(?=[.,;:)\]\s]|$)/gu;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function compactWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function makePreview(text: string, maxLength = 420): string {
  const compact = compactWhitespace(text);
  if (compact.length <= maxLength) {
    return compact;
  }
  return `${compact.slice(0, maxLength - 1).trimEnd()}...`;
}

function buildContext(text: string, start: number, end: number): string {
  const windowSize = 92;
  const contextStart = Math.max(0, start - windowSize);
  const contextEnd = Math.min(text.length, end + windowSize);
  const prefix = contextStart > 0 ? "..." : "";
  const suffix = contextEnd < text.length ? "..." : "";
  return compactWhitespace(`${prefix}${text.slice(contextStart, contextEnd)}${suffix}`);
}

function buildRectsForOffsets(model: PdfPageTextModel, start: number, end: number): PdfReferencePreviewRect[] {
  return buildCanonicalPdfRectsForOffsets(model, start, end).map((rect) => ({
    left: clamp01(rect.x1),
    top: clamp01(rect.y1),
    width: clamp01(rect.x2 - rect.x1),
    height: clamp01(rect.y2 - rect.y1),
  }));
}

function findReferenceStart(models: PdfPageTextModel[]): { page: number; offset: number } | null {
  for (let index = models.length - 1; index >= 0; index -= 1) {
    const model = models[index];
    const matches = Array.from(model.normalizedText.matchAll(new RegExp(REFERENCE_HEADING_PATTERN, "giu")));
    const match = matches[matches.length - 1];
    if (match?.index !== undefined) {
      return { page: model.pageNumber, offset: match.index };
    }
  }

  return null;
}

function getReferenceComparablePosition(value: { page: number; offset: number }): number {
  return value.page * 1_000_000 + value.offset;
}

function buildReferenceLines(models: PdfPageTextModel[], referenceStart: { page: number; offset: number }): PdfReferenceLine[] {
  const referencePosition = getReferenceComparablePosition(referenceStart);
  const lines: PdfReferenceLine[] = [];

  for (const model of models) {
    const lineGroups = new Map<string, typeof model.segments>();
    for (const segment of model.segments) {
      const segmentPosition = getReferenceComparablePosition({ page: model.pageNumber, offset: segment.pageTextEnd });
      if (segmentPosition < referencePosition) {
        continue;
      }
      const key = `${segment.blockIndex ?? 0}:${segment.columnIndex ?? 0}:${segment.lineIndex ?? segment.pageTextStart}`;
      const group = lineGroups.get(key) ?? [];
      group.push(segment);
      lineGroups.set(key, group);
    }

    for (const group of lineGroups.values()) {
      const ordered = [...group].sort((left, right) => left.pageTextStart - right.pageTextStart);
      const start = Math.min(...ordered.map((segment) => segment.pageTextStart));
      const end = Math.max(...ordered.map((segment) => segment.pageTextEnd));
      const text = compactWhitespace(ordered.map((segment) => segment.normalizedText).join(" "));
      if (text) {
        lines.push({ page: model.pageNumber, start, end, text });
      }
    }
  }

  return lines.sort((left, right) => (
    left.page - right.page ||
    left.start - right.start
  ));
}

function parseReferenceEntries(models: PdfPageTextModel[], referenceStart: { page: number; offset: number }): PdfReferenceEntry[] {
  const modelByPage = new Map(models.map((model) => [model.pageNumber, model]));
  const lines = buildReferenceLines(models, referenceStart);
  const entries: PdfReferenceEntry[] = [];
  let current: {
    number: number;
    page: number;
    start: number;
    end: number;
    lines: string[];
  } | null = null;

  const flush = () => {
    if (!current) {
      return;
    }
    const model = modelByPage.get(current.page);
    const text = compactWhitespace(current.lines.join(" "));
    if (model && text.length > 8) {
      entries.push({
        number: current.number,
        page: current.page,
        start: current.start,
        end: current.end,
        text,
        preview: makePreview(text),
        rects: buildRectsForOffsets(model, current.start, current.end),
      });
    }
    current = null;
  };

  for (const line of lines) {
    const match = REFERENCE_ENTRY_PATTERN.exec(line.text);
    if (match) {
      flush();
      const number = Number(match[1] ?? match[2]);
      if (Number.isInteger(number) && number > 0) {
        current = {
          number,
          page: line.page,
          start: line.start,
          end: line.end,
          lines: [match[3] ? line.text : line.text.replace(REFERENCE_ENTRY_PATTERN, "$3")],
        };
      }
      continue;
    }

    if (current && line.text.length > 1) {
      current.end = line.page === current.page ? Math.max(current.end, line.end) : current.end;
      current.lines.push(line.text);
    }
  }

  flush();
  return entries;
}

function expandCitationNumbers(raw: string, available: Set<number>): number[] {
  const numbers: number[] = [];
  const seen = new Set<number>();
  const tokenPattern = /(\d{1,4})(?:\s*[-–]\s*(\d{1,4}))?/gu;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(raw)) !== null) {
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : start;
    if (!Number.isInteger(start) || !Number.isInteger(end)) {
      continue;
    }

    const low = Math.min(start, end);
    const high = Math.max(start, end);
    const span = Math.min(32, high - low);
    for (let value = low; value <= low + span; value += 1) {
      if (available.has(value) && !seen.has(value)) {
        seen.add(value);
        numbers.push(value);
      }
    }
  }

  return numbers;
}

function trimCitationNumberSpan(raw: string, absoluteStart: number): { text: string; start: number; end: number } {
  const firstDigit = raw.search(/\d/u);
  if (firstDigit < 0) {
    return { text: "", start: absoluteStart, end: absoluteStart };
  }

  let lastDigit = -1;
  for (let index = raw.length - 1; index >= firstDigit; index -= 1) {
    if (/\d/u.test(raw[index] ?? "")) {
      lastDigit = index;
      break;
    }
  }

  if (lastDigit < firstDigit) {
    return { text: "", start: absoluteStart, end: absoluteStart };
  }

  return {
    text: raw.slice(firstDigit, lastDigit + 1),
    start: absoluteStart + firstDigit,
    end: absoluteStart + lastDigit + 1,
  };
}

function shouldAcceptCitationCandidate(input: {
  model: PdfPageTextModel;
  start: number;
  end: number;
  numbers: number[];
  referenceStart: { page: number; offset: number };
}): boolean {
  if (input.numbers.length === 0 || input.numbers.length > 16) {
    return false;
  }
  if (getReferenceComparablePosition({ page: input.model.pageNumber, offset: input.start }) >= getReferenceComparablePosition(input.referenceStart)) {
    return false;
  }
  const before = input.model.normalizedText.slice(Math.max(0, input.start - 2), input.start);
  const after = input.model.normalizedText.slice(input.end, input.end + 2);
  if (/[.\d]$/u.test(before) && /^[.\d]/u.test(after)) {
    return false;
  }
  return true;
}

function pushHotspot(input: {
  hotspots: PdfCitationHotspot[];
  seen: Set<string>;
  model: PdfPageTextModel;
  start: number;
  end: number;
  label: string;
  numbers: number[];
  referenceStart: { page: number; offset: number };
}) {
  const dedupedNumbers = Array.from(new Set(input.numbers)).sort((left, right) => left - right);
  if (!shouldAcceptCitationCandidate({
    model: input.model,
    start: input.start,
    end: input.end,
    numbers: dedupedNumbers,
    referenceStart: input.referenceStart,
  })) {
    return;
  }

  const rects = buildRectsForOffsets(input.model, input.start, input.end);
  if (rects.length === 0) {
    return;
  }

  const key = `${input.model.pageNumber}:${input.start}:${input.end}:${dedupedNumbers.join(",")}`;
  if (input.seen.has(key)) {
    return;
  }
  input.seen.add(key);

  input.hotspots.push({
    id: key,
    page: input.model.pageNumber,
    start: input.start,
    end: input.end,
    label: input.label,
    referenceNumbers: dedupedNumbers,
    context: buildContext(input.model.normalizedText, input.start, input.end),
    rects,
  });
}

function detectCitationHotspots(
  models: PdfPageTextModel[],
  entriesByNumber: Record<number, PdfReferenceEntry>,
  referenceStart: { page: number; offset: number },
): PdfCitationHotspot[] {
  const available = new Set(Object.keys(entriesByNumber).map(Number));
  const hotspots: PdfCitationHotspot[] = [];
  const seen = new Set<string>();

  for (const model of models) {
    const pageStartPosition = getReferenceComparablePosition({ page: model.pageNumber, offset: 0 });
    if (pageStartPosition >= getReferenceComparablePosition(referenceStart)) {
      break;
    }

    let labeledMatch: RegExpExecArray | null;
    REFERENCE_LABEL_PATTERN.lastIndex = 0;
    while ((labeledMatch = REFERENCE_LABEL_PATTERN.exec(model.normalizedText)) !== null) {
      const rawNumbers = labeledMatch[1] ?? "";
      const rawStart = labeledMatch.index + labeledMatch[0].indexOf(rawNumbers);
      const span = trimCitationNumberSpan(rawNumbers, rawStart);
      const numbers = expandCitationNumbers(span.text, available);
      pushHotspot({
        hotspots,
        seen,
        model,
        start: span.start,
        end: span.end,
        label: compactWhitespace(span.text),
        numbers,
        referenceStart,
      });
    }

    let groupedMatch: RegExpExecArray | null;
    BRACKETED_CITATION_PATTERN.lastIndex = 0;
    while ((groupedMatch = BRACKETED_CITATION_PATTERN.exec(model.normalizedText)) !== null) {
      const rawNumbers = groupedMatch[1] ?? "";
      const rawStart = groupedMatch.index + groupedMatch[0].indexOf(rawNumbers);
      const span = trimCitationNumberSpan(rawNumbers, rawStart);
      const numbers = expandCitationNumbers(span.text, available);
      pushHotspot({
        hotspots,
        seen,
        model,
        start: span.start,
        end: span.end,
        label: compactWhitespace(span.text),
        numbers,
        referenceStart,
      });
    }

    GROUPED_CITATION_PATTERN.lastIndex = 0;
    while ((groupedMatch = GROUPED_CITATION_PATTERN.exec(model.normalizedText)) !== null) {
      const rawNumbers = groupedMatch[2] ?? "";
      const rawStart = groupedMatch.index + (groupedMatch[1]?.length ?? 0);
      const span = trimCitationNumberSpan(rawNumbers, rawStart);
      const numbers = expandCitationNumbers(span.text, available);
      pushHotspot({
        hotspots,
        seen,
        model,
        start: span.start,
        end: span.end,
        label: compactWhitespace(span.text),
        numbers,
        referenceStart,
      });
    }

    let attachedMatch: RegExpExecArray | null;
    ATTACHED_SUPERSCRIPT_PATTERN.lastIndex = 0;
    while ((attachedMatch = ATTACHED_SUPERSCRIPT_PATTERN.exec(model.normalizedText)) !== null) {
      const rawNumber = attachedMatch[2] ?? "";
      const numbers = expandCitationNumbers(rawNumber, available);
      pushHotspot({
        hotspots,
        seen,
        model,
        start: attachedMatch.index + (attachedMatch[1]?.length ?? 0),
        end: attachedMatch.index + (attachedMatch[1]?.length ?? 0) + rawNumber.length,
        label: rawNumber,
        numbers,
        referenceStart,
      });
    }
  }

  return hotspots.sort((left, right) => (
    left.page - right.page ||
    left.start - right.start ||
    left.end - right.end
  ));
}

export function buildPdfReferencePreviewIndex(models: PdfPageTextModel[]): PdfReferencePreviewIndex {
  const orderedModels = [...models].sort((left, right) => left.pageNumber - right.pageNumber);
  const referenceStart = findReferenceStart(orderedModels);
  if (!referenceStart) {
    return {
      referenceStart: null,
      entries: [],
      entriesByNumber: {},
      hotspots: [],
    };
  }

  const entries = parseReferenceEntries(orderedModels, referenceStart);
  const entriesByNumber = entries.reduce<Record<number, PdfReferenceEntry>>((map, entry) => {
    map[entry.number] = entry;
    return map;
  }, {});

  return {
    referenceStart,
    entries,
    entriesByNumber,
    hotspots: detectCitationHotspots(orderedModels, entriesByNumber, referenceStart),
  };
}
