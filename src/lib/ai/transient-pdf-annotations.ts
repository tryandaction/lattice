import type { EvidenceAnchorRect, EvidenceRef } from "./types";
import { canonicalCitationPath } from "./citation-contract";
import type { AnnotationItem, BoundingBox } from "@/types/universal-annotation";

export interface TransientPdfAnnotation {
  id: string;
  documentPath: string;
  page: number;
  rects: BoundingBox[];
  quote: string;
  reason?: string;
  source: EvidenceRef;
}

function normalizeDocumentPath(locator: string): string {
  return canonicalCitationPath(locator);
}

function toBoundingBox(rect: EvidenceAnchorRect): BoundingBox | null {
  const x1 = Math.max(0, Math.min(1, rect.left));
  const y1 = Math.max(0, Math.min(1, rect.top));
  const x2 = Math.max(x1, Math.min(1, rect.left + rect.width));
  const y2 = Math.max(y1, Math.min(1, rect.top + rect.height));
  return x2 > x1 && y2 > y1 ? { x1, y1, x2, y2 } : null;
}

function stableId(documentPath: string, page: number, quote: string): string {
  const seed = `${documentPath}:${page}:${quote}`;
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `transient-ai-${(hash >>> 0).toString(36)}`;
}

export function buildTransientPdfAnnotations(evidenceRefs: EvidenceRef[]): TransientPdfAnnotation[] {
  const seen = new Set<string>();
  const annotations: TransientPdfAnnotation[] = [];

  for (const source of evidenceRefs) {
    const documentPath = normalizeDocumentPath(source.locator);
    const page = source.anchor?.page;
    const quote = (source.anchor?.snippet ?? source.preview ?? "").trim();
    const rects = (source.anchor?.rects ?? [])
      .map(toBoundingBox)
      .filter((rect): rect is BoundingBox => Boolean(rect));
    const isPdf = source.kind === "pdf_page" || source.kind === "pdf_annotation" || /\.pdf$/i.test(documentPath);
    if (!isPdf || !documentPath || !Number.isInteger(page) || page! < 1 || !quote || rects.length === 0) {
      continue;
    }

    const id = stableId(documentPath, page!, quote);
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    annotations.push({ id, documentPath, page: page!, rects, quote, source });
  }

  return annotations;
}

export function confirmTransientPdfAnnotations(
  annotations: TransientPdfAnnotation[],
  author = "ai",
): AnnotationItem[] {
  return annotations.map((annotation) => ({
    id: `ann-${annotation.id}`,
    target: {
      type: "pdf",
      page: annotation.page,
      rects: annotation.rects,
      textQuote: {
        exact: annotation.quote,
        prefix: "",
        suffix: "",
        source: "pdfjs-text-model",
        confidence: "exact",
      },
    },
    style: { type: "highlight", color: "#B9E6FE" },
    content: annotation.quote,
    comment: annotation.reason ?? annotation.source.label,
    tags: ["ai-evidence"],
    author,
    createdAt: Date.now(),
  }));
}
