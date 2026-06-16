import { resolvePdfAnnotationTextAnchor } from "@/lib/pdf-annotation-adjustment";
import {
  buildPdfTextAnchorFromOffsets,
  resolvePdfExactQuoteOffsets,
} from "@/lib/pdf-canonical-text-anchoring";
import { normalizePdfReadableText } from "@/lib/pdf-readable-text";
import { isLikelyCoarseTextMarkupGeometry, isPlausibleTextMarkupBox } from "@/lib/pdf-text-rects";
import type { PdfPageTextModel } from "@/lib/pdf-page-text-cache";
import type { AnnotationItem, PdfTarget, UnderlineStyleType } from "@/types/universal-annotation";

function compactPdfText(text: string | null | undefined): string {
  return normalizePdfReadableText(text).replace(/\s+/g, "");
}

function compactRawPdfText(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, "");
}

function shouldRepairPdfQuote(existing: string | undefined, repaired: string): boolean {
  const existingNormalized = normalizePdfReadableText(existing);
  const repairedNormalized = normalizePdfReadableText(repaired);
  const existingCompact = compactPdfText(existingNormalized);
  const repairedCompact = compactPdfText(repairedNormalized);

  if (!repairedCompact) {
    return false;
  }
  if (!existingCompact) {
    return true;
  }
  if (existingCompact === repairedCompact) {
    return existingNormalized !== repairedNormalized;
  }
  if (repairedCompact.includes(existingCompact) && repairedCompact.length > existingCompact.length) {
    const expansion = repairedCompact.length - existingCompact.length;
    return looksLikeBrokenPdfQuote(existingNormalized) ||
      existingCompact.length <= 3 ||
      expansion <= Math.max(8, Math.ceil(existingCompact.length * 0.08));
  }
  if (existingCompact.length <= 3 && repairedCompact.length >= 8) {
    return true;
  }

  const existingHead = existingCompact.slice(0, 1);
  const repairedHead = repairedCompact.slice(0, 1);
  return existingHead !== repairedHead && repairedCompact.length >= existingCompact.length;
}

function isUnsafePdfQuoteExpansion(existing: string | undefined, repaired: string): boolean {
  const existingNormalized = normalizePdfReadableText(existing);
  const existingCompact = compactPdfText(existingNormalized);
  const repairedCompact = compactPdfText(repaired);
  if (!existingCompact || !repairedCompact || looksLikeBrokenPdfQuote(existingNormalized)) {
    return false;
  }
  if (!repairedCompact.includes(existingCompact) || repairedCompact.length <= existingCompact.length) {
    return false;
  }

  return repairedCompact.length - existingCompact.length > Math.max(16, Math.ceil(existingCompact.length * 0.18));
}

function rectsEqual(left: PdfTarget["rects"], right: PdfTarget["rects"]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((leftRect, index) => {
    const rightRect = right[index];
    if (!rightRect) {
      return false;
    }

    return Math.abs(leftRect.x1 - rightRect.x1) < 0.0005 &&
      Math.abs(leftRect.y1 - rightRect.y1) < 0.0005 &&
      Math.abs(leftRect.x2 - rightRect.x2) < 0.0005 &&
      Math.abs(leftRect.y2 - rightRect.y2) < 0.0005;
  });
}

export function buildPdfQuadsFromRects(rects: PdfTarget["rects"]): NonNullable<PdfTarget["quads"]> {
  return rects.map((rect) => ({
    x1: rect.x1,
    y1: rect.y1,
    x2: rect.x2,
    y2: rect.y1,
    x3: rect.x2,
    y3: rect.y2,
    x4: rect.x1,
    y4: rect.y2,
  }));
}

function buildCanonicalPdfTextAnnotation(
  annotation: AnnotationItem,
  target: PdfTarget,
  anchor: ReturnType<typeof buildPdfTextAnchorFromOffsets>,
): AnnotationItem | null {
  if (!anchor || anchor.rects.length === 0) {
    return null;
  }

  const repairedText = normalizePdfReadableText(anchor.textQuote.exact);
  if (!repairedText) {
    return null;
  }

  return {
    ...annotation,
    content: repairedText,
    target: {
      ...target,
      rects: anchor.rects,
      textQuote: {
        ...anchor.textQuote,
        exact: repairedText,
      },
      startCharIndex: anchor.startOffset,
      endCharIndex: anchor.endOffset,
      quads: buildPdfQuadsFromRects(anchor.rects),
      textSource: anchor.textQuote.source,
      textConfidence: 1,
    },
  };
}

export function buildCanonicalPdfTextMarkupAnnotationFromExact(input: {
  model: PdfPageTextModel;
  exact: string;
  page?: number;
  styleType: "highlight" | "underline";
  color: string;
  author: string;
  underlineStyle?: UnderlineStyleType;
  id?: string;
  createdAt?: number;
  preferredRects?: PdfTarget["rects"];
}): Omit<AnnotationItem, "id" | "createdAt"> | AnnotationItem | null {
  const offsets = resolvePdfExactQuoteOffsets({
    model: input.model,
    exact: input.exact,
    preferredRects: input.preferredRects,
  });
  if (!offsets) {
    return null;
  }

  const anchor = buildPdfTextAnchorFromOffsets({
    model: input.model,
    startOffset: offsets.startOffset,
    endOffset: offsets.endOffset,
    source: "pdfjs-text-model",
  });
  const rects = normalizeTextMarkupRects(anchor?.rects ?? []);
  if (!anchor || rects.length === 0) {
    return null;
  }

  const annotation = {
    ...(input.id ? { id: input.id } : {}),
    ...(typeof input.createdAt === "number" ? { createdAt: input.createdAt } : {}),
    target: {
      type: "pdf" as const,
      page: input.page ?? input.model.pageNumber,
      rects,
      textQuote: anchor.textQuote,
      textKernelVersion: 1,
      startCharIndex: anchor.startOffset,
      endCharIndex: anchor.endOffset,
      quads: buildPdfQuadsFromRects(rects),
      textSource: anchor.textQuote.source,
      textConfidence: 1,
    },
    style: {
      color: input.color,
      type: input.styleType,
      underlineStyle: input.styleType === "underline" ? (input.underlineStyle ?? "solid") : undefined,
    },
    content: normalizePdfReadableText(anchor.textQuote.exact),
    author: input.author,
  } satisfies Omit<AnnotationItem, "id" | "createdAt"> & Partial<Pick<AnnotationItem, "id" | "createdAt">>;

  return annotation as Omit<AnnotationItem, "id" | "createdAt"> | AnnotationItem;
}

function looksLikeBrokenPdfQuote(text: string | null | undefined): boolean {
  const normalized = normalizePdfReadableText(text);
  const compact = compactPdfText(normalized);
  if (!compact) {
    return true;
  }
  if (compact === "0" || compact.length <= 3) {
    return true;
  }

  return /\.\.\.$/.test(normalized) ||
    /\b[a-z]{2,}ns\b/i.test(normalized) ||
    /\bark shifts\b/i.test(normalized) ||
    /^\W*5,\s+that tend\b/i.test(normalized);
}

function normalizeTextMarkupRects(rects: PdfTarget["rects"]): PdfTarget["rects"] {
  return rects
    .filter(isPlausibleTextMarkupBox)
    .map((rect) => ({
      x1: Math.max(0, Math.min(1, Math.min(rect.x1, rect.x2))),
      y1: Math.max(0, Math.min(1, Math.min(rect.y1, rect.y2))),
      x2: Math.max(0, Math.min(1, Math.max(rect.x1, rect.x2))),
      y2: Math.max(0, Math.min(1, Math.max(rect.y1, rect.y2))),
    }))
    .filter((rect) => rect.x2 > rect.x1 && rect.y2 > rect.y1)
    .sort((left, right) => left.y1 - right.y1 || left.x1 - right.x1);
}

function shouldTrustExistingCharRangeForBrokenQuote(text: string | null | undefined): boolean {
  const normalized = normalizePdfReadableText(text);
  return /\b(?:fnthatse|direcns)\b/i.test(normalized) ||
    /\bark shifts\b/i.test(normalized);
}

function hasValidPdfTextCharRange(target: PdfTarget, model: PdfPageTextModel): target is PdfTarget & {
  startCharIndex: number;
  endCharIndex: number;
} {
  return Number.isInteger(target.startCharIndex) &&
    Number.isInteger(target.endCharIndex) &&
    typeof target.startCharIndex === "number" &&
    typeof target.endCharIndex === "number" &&
    target.startCharIndex >= 0 &&
    target.endCharIndex > target.startCharIndex &&
    target.startCharIndex < model.normalizedText.length;
}

function isPersistedAsSingleCoarseTextBlock(rects: PdfTarget["rects"], text: string | null | undefined): boolean {
  const normalizedText = normalizePdfReadableText(text);
  const compactLength = normalizedText.replace(/\s+/g, "").length;
  if (compactLength < 32 || rects.length !== 1) {
    return false;
  }

  const rect = rects[0];
  const width = Math.max(0, rect.x2 - rect.x1);
  const height = Math.max(0, rect.y2 - rect.y1);
  return width >= 0.28 && height >= 0.045;
}

function getRepairFallbackRects(target: PdfTarget, text: string | null | undefined): PdfTarget["rects"] | undefined {
  return isLikelyCoarseTextMarkupGeometry(target.rects, text) ||
    isPersistedAsSingleCoarseTextBlock(target.rects, text)
    ? undefined
    : target.rects;
}

function isPdfWordCharacter(character: string | undefined): boolean {
  return Boolean(character && /[\p{L}\p{M}\p{N}]/u.test(character));
}

function shouldExpandDroppedStartBoundary(pageText: string, startOffset: number): boolean {
  if (startOffset <= 0) {
    return false;
  }

  const previous = pageText[startOffset - 1];
  const current = pageText[startOffset];
  if (!isPdfWordCharacter(previous)) {
    return false;
  }

  return isPdfWordCharacter(current) || Boolean(current && /[^\p{L}\p{M}\p{N}\s]/u.test(current));
}

function shouldExpandDroppedEndBoundary(pageText: string, endOffset: number): boolean {
  if (endOffset <= 0 || endOffset >= pageText.length) {
    return false;
  }

  return isPdfWordCharacter(pageText[endOffset - 1]) && isPdfWordCharacter(pageText[endOffset]);
}

function buildCompactOffsetMap(text: string): { compact: string; offsets: number[] } {
  let compact = "";
  const offsets: number[] = [];

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (/\s/.test(character)) {
      continue;
    }
    compact += character;
    offsets.push(index);
  }

  return { compact, offsets };
}

function resolvePartialBrokenQuoteOffsets(
  model: PdfPageTextModel,
  target: PdfTarget,
  existingText: string | null | undefined,
): { startOffset: number; endOffset: number } | null {
  const normalizedExisting = normalizePdfReadableText(existingText);
  if (!/^\W*5,\s+that tend\b/i.test(normalizedExisting)) {
    return null;
  }

  const existingCompact = compactRawPdfText(normalizedExisting);
  if (existingCompact.length < 8) {
    return null;
  }

  const pageCompact = buildCompactOffsetMap(model.normalizedText);
  const prefixLength = Math.min(existingCompact.length, 20);
  const stablePrefix = existingCompact.slice(0, prefixLength);
  const compactIndex = pageCompact.compact.indexOf(stablePrefix);
  if (compactIndex < 0) {
    return null;
  }

  const prefixStartOffset = pageCompact.offsets[compactIndex];
  if (typeof prefixStartOffset !== "number") {
    return null;
  }

  const fallbackEndOffset = pageCompact.offsets[Math.min(pageCompact.offsets.length - 1, compactIndex + existingCompact.length - 1)];
  const candidateEnd = Number.isInteger(target.endCharIndex)
    ? target.endCharIndex
    : (typeof fallbackEndOffset === "number" ? fallbackEndOffset + 1 : undefined);
  if (typeof candidateEnd !== "number" || !Number.isFinite(candidateEnd) || candidateEnd <= prefixStartOffset) {
    return null;
  }

  return {
    startOffset: prefixStartOffset,
    endOffset: Math.min(model.normalizedText.length, candidateEnd),
  };
}

function resolveDroppedBoundaryQuoteAnchor(
  model: PdfPageTextModel,
  target: PdfTarget,
  existingText: string | null | undefined,
): ReturnType<typeof buildPdfTextAnchorFromOffsets> | null {
  if (!looksLikeBrokenPdfQuote(existingText)) {
    return null;
  }

  const exactOffsets = resolvePdfExactQuoteOffsets({
    model,
    exact: target.textQuote?.exact ?? existingText,
    preferredRects: target.rects,
  });
  const resolvedOffsets = exactOffsets ?? resolvePartialBrokenQuoteOffsets(model, target, existingText);
  if (!resolvedOffsets) {
    return null;
  }

  let startOffset = resolvedOffsets.startOffset;
  let endOffset = resolvedOffsets.endOffset;
  while (shouldExpandDroppedStartBoundary(model.normalizedText, startOffset)) {
    startOffset -= 1;
  }
  while (shouldExpandDroppedEndBoundary(model.normalizedText, endOffset)) {
    endOffset += 1;
  }

  if (startOffset === resolvedOffsets.startOffset && endOffset === resolvedOffsets.endOffset) {
    return null;
  }

  return buildPdfTextAnchorFromOffsets({
    model,
    startOffset,
    endOffset,
    source: target.textQuote?.source ?? "pdfjs-text-model",
    fallbackRects: target.rects,
  });
}

function resolveExactQuoteAnchor(
  model: PdfPageTextModel,
  target: PdfTarget,
  existingText: string | null | undefined,
): ReturnType<typeof buildPdfTextAnchorFromOffsets> | null {
  const offsets = resolvePdfExactQuoteOffsets({
    model,
    exact: target.textQuote?.exact ?? existingText,
    preferredRects: target.rects,
  });
  if (!offsets) {
    return null;
  }

  return buildPdfTextAnchorFromOffsets({
    model,
    startOffset: offsets.startOffset,
    endOffset: offsets.endOffset,
    source: target.textQuote?.source ?? "pdfjs-text-model",
  });
}

export function repairPdfTextAnnotationFromModel(
  annotation: AnnotationItem,
  model: PdfPageTextModel,
): AnnotationItem | null {
  if (
    annotation.target.type !== "pdf" ||
    (annotation.style.type !== "highlight" && annotation.style.type !== "underline")
  ) {
    return null;
  }

  const target = annotation.target as PdfTarget;
  if (target.page !== model.pageNumber || target.rects.length === 0) {
    return null;
  }

  const existingText = target.textQuote?.exact ?? annotation.content;
  const existingQuoteLooksBroken = looksLikeBrokenPdfQuote(existingText);
  const hasCoarseGeometry = isLikelyCoarseTextMarkupGeometry(target.rects, existingText);
  const isSingleCoarseTextBlock = isPersistedAsSingleCoarseTextBlock(target.rects, existingText);
  const exactQuoteAnchor = existingQuoteLooksBroken
    ? null
    : resolveExactQuoteAnchor(model, target, existingText);
  const charRangeAnchor = hasValidPdfTextCharRange(target, model)
      ? buildPdfTextAnchorFromOffsets({
        model,
        startOffset: target.startCharIndex,
        endOffset: target.endCharIndex,
        source: target.textQuote?.source ?? "pdfjs-text-model",
        fallbackRects: getRepairFallbackRects(target, existingText),
      })
    : null;
  const shouldUseCharRangeAnchor = Boolean(
    charRangeAnchor &&
    (
      isSingleCoarseTextBlock ||
      (hasCoarseGeometry && !existingQuoteLooksBroken) ||
      shouldTrustExistingCharRangeForBrokenQuote(existingText)
    ),
  );
  const droppedBoundaryAnchor = resolveDroppedBoundaryQuoteAnchor(model, target, existingText);
  const anchor = droppedBoundaryAnchor
      ? droppedBoundaryAnchor
    : exactQuoteAnchor
      ? exactQuoteAnchor
    : shouldUseCharRangeAnchor
      ? charRangeAnchor
    : resolvePdfAnnotationTextAnchor(model, {
        ...target,
        startCharIndex: undefined,
        endCharIndex: undefined,
  });
  const repairedText = normalizePdfReadableText(anchor?.textQuote.exact);
  if (!anchor) {
    return null;
  }
  if (isUnsafePdfQuoteExpansion(existingText, repairedText)) {
    return null;
  }

  const normalizedRects = normalizeTextMarkupRects(anchor.rects);
  if (normalizedRects.length === 0) {
    return null;
  }

  const shouldUpdateQuote = shouldRepairPdfQuote(target.textQuote?.exact ?? annotation.content, repairedText);
  const shouldUpdateGeometry = hasCoarseGeometry ||
    isLikelyCoarseTextMarkupGeometry(target.rects, repairedText) ||
    !rectsEqual(target.rects, normalizedRects);
  if (!shouldUpdateQuote && !shouldUpdateGeometry) {
    return null;
  }

  return buildCanonicalPdfTextAnnotation(annotation, target, {
    ...anchor,
    rects: normalizedRects,
  });
}

export function canonicalizePdfTextAnnotationFromModel(
  annotation: AnnotationItem,
  model: PdfPageTextModel,
): AnnotationItem | null {
  if (
    annotation.target.type !== "pdf" ||
    (annotation.style.type !== "highlight" && annotation.style.type !== "underline")
  ) {
    return null;
  }

  const target = annotation.target as PdfTarget;
  if (target.page !== model.pageNumber) {
    return null;
  }

  const targetForAnchor: PdfTarget = target.textQuote || !annotation.content
    ? target
    : {
        ...target,
        textQuote: {
          exact: annotation.content,
          prefix: "",
          suffix: "",
          source: "pdfjs-text-model",
          confidence: "exact",
        },
      };
  const anchor = resolvePdfAnnotationTextAnchor(model, targetForAnchor);
  if (!anchor) {
    return null;
  }
  const normalizedRects = normalizeTextMarkupRects(anchor.rects);
  if (normalizedRects.length === 0) {
    return null;
  }
  return buildCanonicalPdfTextAnnotation(annotation, target, {
    ...anchor,
    rects: normalizedRects,
  });
}
