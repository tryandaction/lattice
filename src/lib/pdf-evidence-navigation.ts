import { buildPdfRectsForOffsets } from "@/lib/pdf-canonical-text-anchoring";
import type { PdfPageTextModel } from "@/lib/pdf-page-text-cache";
import type { WorkspaceEvidenceRect } from "@/lib/link-router/types";
import { findReferenceTextRange } from "@/lib/reference-text-range";

export interface PdfEvidenceSnippetTarget {
  page: number;
  snippet: string;
  startOffset: number;
  endOffset: number;
  rects: WorkspaceEvidenceRect[];
}

/** DOM text layers can omit inter-line spaces that remain in the PDF source.
 * Re-resolve the entire unique quote against source text; never shorten it or
 * weaken matching to make a proposal save. Geometry comes from that same model.
 */
export async function resolvePdfEvidenceSnippetFromModels(input: {
  renderedModel: PdfPageTextModel | null;
  loadSourceModel: () => Promise<PdfPageTextModel>;
  snippet: string;
  preserveExact?: boolean;
}): Promise<{ model: PdfPageTextModel; target: PdfEvidenceSnippetTarget } | null> {
  if (input.renderedModel) {
    const target = resolvePdfEvidenceSnippetTarget(input.renderedModel, input.snippet);
    if (target && (!input.preserveExact || target.snippet === input.snippet)) return { model: input.renderedModel, target };
  }
  const model = await input.loadSourceModel();
  const target = resolvePdfEvidenceSnippetTarget(model, input.snippet);
  return target && (!input.preserveExact || target.snippet === input.snippet) ? { model, target } : null;
}

export function resolvePdfEvidenceSnippetTarget(
  model: PdfPageTextModel,
  snippet: string,
): PdfEvidenceSnippetTarget | null {
  const range = findReferenceTextRange(model.normalizedText, snippet);
  if (!range) return null;

  const rects = buildPdfRectsForOffsets(model, range.from, range.to).map((rect) => ({
    left: rect.x1,
    top: rect.y1,
    width: Math.max(0, rect.x2 - rect.x1),
    height: Math.max(0, rect.y2 - rect.y1),
  })).filter((rect) => rect.width > 0 && rect.height > 0);
  if (rects.length === 0) return null;

  return {
    page: model.pageNumber,
    snippet: model.normalizedText.slice(range.from, range.to),
    startOffset: range.from,
    endOffset: range.to,
    rects,
  };
}
