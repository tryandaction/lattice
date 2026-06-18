import {
  buildCanonicalPdfTextMarkupAnnotationFromExact,
  buildPdfQuadsFromRects,
  canonicalizePdfTextAnnotationFromModel,
  repairPdfTextAnnotationFromModel,
} from "@/lib/pdf-annotation-text-repair";
import { resolveCanonicalPdfTextAnchorFromExact } from "@/lib/pdf-canonical-text-anchoring";
import { normalizePdfReadableText } from "@/lib/pdf-readable-text";
import {
  loadAnnotationsFromDisk,
  saveAnnotationsToDisk,
} from "@/lib/universal-annotation-storage";
import type { PdfPageTextModel } from "@/lib/pdf-page-text-cache";
import type {
  AnnotationItem,
  PdfTarget,
  UnderlineStyleType,
  UniversalAnnotationFile,
} from "@/types/universal-annotation";

export type CanonicalPdfTextMarkupType = "highlight" | "underline";

type PdfPageTextModelLookup =
  | Map<number, PdfPageTextModel>
  | Record<number, PdfPageTextModel | null | undefined>
  | ((pageNumber: number) => PdfPageTextModel | null | undefined);

export interface UpsertCanonicalPdfTextMarkupAnnotationInput {
  annotationFile: UniversalAnnotationFile;
  model: PdfPageTextModel;
  exact: string;
  prefix?: string;
  suffix?: string;
  styleType: CanonicalPdfTextMarkupType;
  color: string;
  author: string;
  id?: string;
  createdAt?: number;
  comment?: string;
  tags?: string[];
  underlineStyle?: UnderlineStyleType;
  now?: number;
}

export interface UpsertCanonicalPdfTextMarkupAnnotationResult {
  ok: boolean;
  annotationFile: UniversalAnnotationFile;
  annotation?: AnnotationItem;
  changed: boolean;
  reason?: string;
}

export interface RepairPdfTextMarkupAnnotationsInFileResult {
  annotationFile: UniversalAnnotationFile;
  repairedCount: number;
  changed: boolean;
}

function generateAnnotationId(): string {
  const randomUuid = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (token) => {
        const random = Math.random() * 16 | 0;
        const value = token === "x" ? random : (random & 0x3) | 0x8;
        return value.toString(16);
      });
  return `ann-${randomUuid}`;
}

function getModelForPage(lookup: PdfPageTextModelLookup, pageNumber: number): PdfPageTextModel | null {
  if (typeof lookup === "function") {
    return lookup(pageNumber) ?? null;
  }
  if (lookup instanceof Map) {
    return lookup.get(pageNumber) ?? null;
  }
  return lookup[pageNumber] ?? null;
}

function isTextMarkupAnnotation(annotation: AnnotationItem): annotation is AnnotationItem & { target: PdfTarget } {
  return annotation.target.type === "pdf" &&
    (annotation.style.type === "highlight" || annotation.style.type === "underline");
}

function roundForSignature(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Number(value.toFixed(6))
    : null;
}

function normalizeAnnotationTags(tags: string[] | null | undefined): string[] | undefined {
  const normalized = Array.from(new Set(
    (tags ?? [])
      .map((tag) => tag.trim())
      .filter(Boolean),
  ));
  return normalized.length > 0 ? normalized : undefined;
}

function buildPdfTextMarkupSignature(annotation: AnnotationItem | null | undefined): string {
  if (!annotation || annotation.target.type !== "pdf") {
    return "";
  }

  const target = annotation.target;
  return JSON.stringify({
    content: normalizePdfReadableText(annotation.content),
    comment: annotation.comment ?? null,
    tags: normalizeAnnotationTags(annotation.tags) ?? [],
    author: annotation.author,
    styleType: annotation.style.type,
    color: annotation.style.color,
    underlineStyle: annotation.style.underlineStyle ?? null,
    page: target.page,
    startCharIndex: target.startCharIndex ?? null,
    endCharIndex: target.endCharIndex ?? null,
    textSource: target.textSource ?? null,
    textConfidence: roundForSignature(target.textConfidence),
    textQuote: target.textQuote
      ? {
          exact: normalizePdfReadableText(target.textQuote.exact),
          prefix: target.textQuote.prefix,
          suffix: target.textQuote.suffix,
          source: target.textQuote.source,
          confidence: target.textQuote.confidence,
        }
      : null,
    rects: target.rects.map((rect) => [
      roundForSignature(rect.x1),
      roundForSignature(rect.y1),
      roundForSignature(rect.x2),
      roundForSignature(rect.y2),
    ]),
    quads: (target.quads ?? []).map((quad) => [
      roundForSignature(quad.x1),
      roundForSignature(quad.y1),
      roundForSignature(quad.x2),
      roundForSignature(quad.y2),
      roundForSignature(quad.x3),
      roundForSignature(quad.y3),
      roundForSignature(quad.x4),
      roundForSignature(quad.y4),
    ]),
  });
}

export function arePdfTextMarkupAnnotationsCanonicalEqual(
  left: AnnotationItem | null | undefined,
  right: AnnotationItem | null | undefined,
): boolean {
  return buildPdfTextMarkupSignature(left) === buildPdfTextMarkupSignature(right);
}

function replaceAnnotation(
  annotations: AnnotationItem[],
  annotation: AnnotationItem,
): { annotations: AnnotationItem[]; changed: boolean } {
  const index = annotations.findIndex((candidate) => candidate.id === annotation.id);
  if (index < 0) {
    return { annotations: [...annotations, annotation], changed: true };
  }

  if (arePdfTextMarkupAnnotationsCanonicalEqual(annotations[index], annotation)) {
    return { annotations, changed: false };
  }

  const next = [...annotations];
  next[index] = annotation;
  return { annotations: next, changed: true };
}

export function upsertCanonicalPdfTextMarkupAnnotationInFile(
  input: UpsertCanonicalPdfTextMarkupAnnotationInput,
): UpsertCanonicalPdfTextMarkupAnnotationResult {
  const normalizedExact = normalizePdfReadableText(input.exact);
  if (!normalizedExact) {
    return {
      ok: false,
      annotationFile: input.annotationFile,
      changed: false,
      reason: "empty-exact",
    };
  }

  const existing = input.id
    ? input.annotationFile.annotations.find((annotation) => annotation.id === input.id)
    : null;
  const id = input.id ?? existing?.id ?? generateAnnotationId();
  const createdAt = input.createdAt ?? existing?.createdAt ?? input.now ?? Date.now();
  const resolvedAnchor = resolveCanonicalPdfTextAnchorFromExact({
    model: input.model,
    exact: normalizedExact,
    prefix: input.prefix,
    suffix: input.suffix,
    requireUnique: true,
    source: "pdfjs-text-model",
  });
  if (!resolvedAnchor.ok) {
    return {
      ok: false,
      annotationFile: input.annotationFile,
      changed: false,
      reason: resolvedAnchor.reason,
    };
  }

  const rects = resolvedAnchor.anchor.rects.filter((rect) =>
    Number.isFinite(rect.x1) &&
    Number.isFinite(rect.y1) &&
    Number.isFinite(rect.x2) &&
    Number.isFinite(rect.y2) &&
    rect.x2 > rect.x1 &&
    rect.y2 > rect.y1
  );
  if (rects.length === 0) {
    return {
      ok: false,
      annotationFile: input.annotationFile,
      changed: false,
      reason: "invalid-anchor",
    };
  }

  const annotation: AnnotationItem = {
    id,
    createdAt,
    target: {
      type: "pdf",
      page: input.model.pageNumber,
      rects,
      textQuote: resolvedAnchor.anchor.textQuote,
      textKernelVersion: 1,
      startCharIndex: resolvedAnchor.anchor.startOffset,
      endCharIndex: resolvedAnchor.anchor.endOffset,
      quads: buildPdfQuadsFromRects(rects),
      textSource: resolvedAnchor.anchor.textQuote.source,
      textConfidence: 1,
    },
    style: {
      color: input.color,
      type: input.styleType,
      underlineStyle: input.styleType === "underline" ? (input.underlineStyle ?? "solid") : undefined,
    },
    content: normalizePdfReadableText(resolvedAnchor.anchor.textQuote.exact),
    author: input.author,
    comment: input.comment ?? existing?.comment,
    tags: normalizeAnnotationTags(input.tags ?? existing?.tags),
  };
  const replaced = replaceAnnotation(input.annotationFile.annotations, annotation);
  const annotationFile = replaced.changed
    ? {
        ...input.annotationFile,
        version: 3 as const,
        fileType: input.annotationFile.fileType || "pdf",
        annotations: replaced.annotations,
        lastModified: input.now ?? Date.now(),
      }
    : input.annotationFile;

  return {
    ok: true,
    annotationFile,
    annotation,
    changed: replaced.changed,
  };
}

export function repairPdfTextMarkupAnnotationsInFile(input: {
  annotationFile: UniversalAnnotationFile;
  modelsByPage: PdfPageTextModelLookup;
  now?: number;
}): RepairPdfTextMarkupAnnotationsInFileResult {
  let repairedCount = 0;
  let changed = false;
  const annotations = input.annotationFile.annotations.map((annotation) => {
    if (!isTextMarkupAnnotation(annotation)) {
      return annotation;
    }

    const model = getModelForPage(input.modelsByPage, annotation.target.page);
    if (!model) {
      return annotation;
    }

    const repaired = repairPdfTextAnnotationFromModel(annotation, model) ??
      canonicalizePdfTextAnnotationFromModel(annotation, model);
    if (!repaired || arePdfTextMarkupAnnotationsCanonicalEqual(annotation, repaired)) {
      return annotation;
    }

    repairedCount += 1;
    changed = true;
    return repaired;
  });

  return {
    annotationFile: changed
      ? {
          ...input.annotationFile,
          annotations,
          lastModified: input.now ?? Date.now(),
        }
      : input.annotationFile,
    repairedCount,
    changed,
  };
}

export function assertPdfTextMarkupAnnotationCanonical(input: {
  annotation: AnnotationItem;
  model: PdfPageTextModel;
}): { ok: boolean; repaired?: AnnotationItem; reason?: string } {
  if (!isTextMarkupAnnotation(input.annotation)) {
    return { ok: false, reason: "not-pdf-text-markup" };
  }

  const styleType = input.annotation.style.type;
  if (styleType !== "highlight" && styleType !== "underline") {
    return { ok: false, reason: "not-pdf-text-markup" };
  }

  const exact = input.annotation.target.textQuote?.exact ?? input.annotation.content;
  const canonical = buildCanonicalPdfTextMarkupAnnotationFromExact({
    model: input.model,
    exact: exact ?? "",
    styleType,
    color: input.annotation.style.color,
    author: input.annotation.author,
    underlineStyle: input.annotation.style.underlineStyle,
    id: input.annotation.id,
    createdAt: input.annotation.createdAt,
  });
  if (!canonical) {
    return { ok: false, reason: "exact-not-found-in-pdf-text-model" };
  }

  const repaired: AnnotationItem = {
    ...canonical,
    id: input.annotation.id,
    createdAt: input.annotation.createdAt,
    comment: input.annotation.comment,
    tags: normalizeAnnotationTags(input.annotation.tags),
  };

  return arePdfTextMarkupAnnotationsCanonicalEqual(input.annotation, repaired)
    ? { ok: true }
    : { ok: false, repaired, reason: "annotation-anchor-is-not-canonical" };
}

export async function writeCanonicalPdfTextMarkupAnnotationToDisk(input: {
  rootHandle: FileSystemDirectoryHandle;
  fileId: string;
  model: PdfPageTextModel;
  exact: string;
  prefix?: string;
  suffix?: string;
  styleType: CanonicalPdfTextMarkupType;
  color: string;
  author: string;
  id?: string;
  createdAt?: number;
  comment?: string;
  tags?: string[];
  underlineStyle?: UnderlineStyleType;
}): Promise<UpsertCanonicalPdfTextMarkupAnnotationResult> {
  const annotationFile = await loadAnnotationsFromDisk(input.fileId, input.rootHandle, "pdf");
  const result = upsertCanonicalPdfTextMarkupAnnotationInFile({
    annotationFile,
    model: input.model,
    exact: input.exact,
    prefix: input.prefix,
    suffix: input.suffix,
    styleType: input.styleType,
    color: input.color,
    author: input.author,
    id: input.id,
    createdAt: input.createdAt,
    comment: input.comment,
    tags: input.tags,
    underlineStyle: input.underlineStyle,
  });
  if (result.ok && result.changed) {
    await saveAnnotationsToDisk(result.annotationFile, input.rootHandle);
  }
  return result;
}
