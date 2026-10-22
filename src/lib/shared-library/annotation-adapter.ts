/**
 * Annotation remote adapter.
 *
 * Bridges the legacy sidecar annotation model (`AnnotationItem` in
 * universal-annotation.ts) and the shared-library remote model (`Annotation`
 * in domain.ts). The canonical shared form keeps a structured, searchable
 * `target` (locator + quote + geometry) while preserving the full original
 * legacy target in `body.legacyTarget` so the boundary is lossless in both
 * directions — annotations created remotely without a legacy target fall back
 * to a structured reverse mapping.
 */

import type {
  Annotation,
  AnnotationKind,
  AnnotationLocatorType,
  SharedAnnotationTarget,
} from "./domain";
import {
  type AnnotationItem,
  type AnnotationStyle,
  type AnnotationStyleType,
  type AnnotationTarget,
  type BoundingBox,
  type ImageAnnotationPreview,
  type PdfTarget,
} from "@/types/universal-annotation";
import { SharedLibraryError } from "./errors";

export interface LegacyToSharedContext {
  itemId: string;
  versionId: string;
}

function isPdfTarget(target: AnnotationTarget): target is PdfTarget {
  return target.type === "pdf";
}

function mapStyleTypeToKind(styleType: AnnotationStyleType): AnnotationKind {
  // The legacy style types map 1:1 onto the shared annotation kinds.
  return styleType as AnnotationKind;
}

function buildSharedTarget(target: AnnotationTarget): SharedAnnotationTarget {
  switch (target.type) {
    case "pdf": {
      const locator: Record<string, string | number | readonly number[]> = {
        page: target.page,
      };
      if (target.startCharIndex !== undefined) {
        locator.startCharIndex = target.startCharIndex;
      }
      if (target.endCharIndex !== undefined) {
        locator.endCharIndex = target.endCharIndex;
      }
      return { locatorType: "pdf-page", locator };
    }
    case "image":
      return {
        locatorType: "image-region",
        locator: { x: target.x, y: target.y, width: target.width, height: target.height },
      };
    case "code_line":
      return { locatorType: "code-line", locator: { line: target.line } };
    case "text_anchor":
      return {
        locatorType: "pptx-slide",
        locator: { elementId: target.elementId, offset: target.offset },
      };
  }
}

function buildQuote(target: AnnotationTarget, content?: string): Record<string, unknown> {
  if (isPdfTarget(target) && target.textQuote?.exact) {
    return {
      exact: target.textQuote.exact,
      ...(target.textQuote.prefix ? { prefix: target.textQuote.prefix } : {}),
      ...(target.textQuote.suffix ? { suffix: target.textQuote.suffix } : {}),
    };
  }
  if (content) {
    return { exact: content };
  }
  return {};
}

function buildGeometry(target: AnnotationTarget): Record<string, unknown> {
  if (isPdfTarget(target)) {
    const geometry: Record<string, unknown> = { rects: target.rects };
    if (target.quads) {
      geometry.quads = target.quads;
    }
    if (target.textSource) {
      geometry.textSource = target.textSource;
    }
    if (target.textConfidence !== undefined) {
      geometry.textConfidence = target.textConfidence;
    }
    return geometry;
  }
  return {};
}

export function fromLegacyAnnotation(
  legacy: AnnotationItem,
  context: LegacyToSharedContext,
): Annotation {
  const createdAt = new Date(legacy.createdAt).toISOString();
  const target = buildSharedTarget(legacy.target);

  const body: Record<string, unknown> = {
    legacyTarget: legacy.target,
  };
  if (legacy.comment) {
    body.comment = legacy.comment;
  }
  if (legacy.tags) {
    body.tags = legacy.tags;
  }
  if (legacy.preview) {
    body.preview = legacy.preview;
  }
  if (legacy.formula) body.formula = legacy.formula;
  if (legacy.authorDisplayName) body.authorDisplayName = legacy.authorDisplayName;

  return {
    id: legacy.id,
    itemId: context.itemId,
    versionId: context.versionId,
    authorId: legacy.author,
    kind: mapStyleTypeToKind(legacy.style.type),
    target,
    quote: buildQuote(legacy.target, legacy.content),
    geometry: buildGeometry(legacy.target),
    style: legacy.style as unknown as Record<string, unknown>,
    body,
    status: "active",
    revision: 1,
    createdAt,
    updatedAt: createdAt,
  };
}

function reverseMapTarget(annotation: Annotation): AnnotationTarget {
  const locatorType: AnnotationLocatorType = annotation.target.locatorType;
  const locator = annotation.target.locator;
  const geometry = annotation.geometry ?? {};

  switch (locatorType) {
    case "pdf-page": {
      const exact = annotation.quote && typeof annotation.quote.exact === "string"
        ? annotation.quote.exact
        : "";
      const prefix = annotation.quote && typeof annotation.quote.prefix === "string"
        ? annotation.quote.prefix
        : "";
      const suffix = annotation.quote && typeof annotation.quote.suffix === "string"
        ? annotation.quote.suffix
        : "";
      return {
        type: "pdf",
        page: Number(locator.page ?? 1),
        rects: (geometry.rects as BoundingBox[] | undefined) ?? [],
        ...(exact
          ? {
              textQuote: {
                exact,
                prefix,
                suffix,
                source: "pdfjs-text-model",
                confidence: "exact" as const,
              },
            }
          : {}),
      };
    }
    case "image-region":
      return {
        type: "image",
        x: Number(locator.x ?? 0),
        y: Number(locator.y ?? 0),
        width: Number(locator.width ?? 0),
        height: Number(locator.height ?? 0),
      };
    case "code-line":
      return { type: "code_line", line: Number(locator.line ?? 1) };
    case "pptx-slide":
      return {
        type: "text_anchor",
        elementId: String(locator.elementId ?? ""),
        offset: Number(locator.offset ?? 0),
      };
    default:
      throw new SharedLibraryError({
        code: "VALIDATION_FAILED",
        message: `Cannot map annotation locator type "${locatorType}" to a legacy target`,
        retryable: false,
      });
  }
}

export function toLegacyAnnotation(annotation: Annotation): AnnotationItem {
  const body = annotation.body ?? {};
  const preservedTarget = body.legacyTarget as AnnotationTarget | undefined;
  const target = preservedTarget ?? reverseMapTarget(annotation);

  const legacy: AnnotationItem = {
    id: annotation.id,
    target,
    style: annotation.style as unknown as AnnotationStyle,
    author: annotation.authorId,
    ...(typeof body.authorDisplayName === "string" ? { authorDisplayName: body.authorDisplayName } : {}),
    createdAt: Date.parse(annotation.createdAt),
  };

  const content = annotation.quote && typeof annotation.quote.exact === "string"
    ? annotation.quote.exact
    : undefined;
  if (content) {
    legacy.content = content;
  }
  if (typeof body.comment === "string") {
    legacy.comment = body.comment;
  }
  if (Array.isArray(body.tags)) {
    legacy.tags = body.tags as string[];
  }
  if (body.preview) {
    legacy.preview = body.preview as ImageAnnotationPreview;
  }
  if (body.formula) legacy.formula = body.formula as AnnotationItem["formula"];
  return legacy;
}
