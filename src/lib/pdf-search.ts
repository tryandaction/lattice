import type { PdfPageTextModel } from "@/lib/pdf-page-text-cache";

export interface PdfSearchMatchRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PdfSearchMatch {
  page: number;
  index: number;
  preview: string;
  rects: PdfSearchMatchRect[];
}

function buildPreview(text: string, start: number, query: string): string {
  const windowSize = 36;
  const previewStart = Math.max(0, start - windowSize);
  const previewEnd = Math.min(text.length, start + query.length + windowSize);
  const prefix = previewStart > 0 ? "..." : "";
  const suffix = previewEnd < text.length ? "..." : "";
  return `${prefix}${text.slice(previewStart, previewEnd)}${suffix}`;
}

function buildMatchRects(model: PdfPageTextModel, start: number, end: number): PdfSearchMatchRect[] {
  const rects: PdfSearchMatchRect[] = [];

  for (const segment of model.segments) {
    if (segment.pageTextEnd <= start || segment.pageTextStart >= end) {
      continue;
    }

    const itemRect = model.itemRects.find((rect) => rect.itemIndex === segment.itemIndex);
    if (!itemRect || itemRect.width <= 0 || itemRect.height <= 0) {
      continue;
    }

    const overlapStart = Math.max(start, segment.pageTextStart);
    const overlapEnd = Math.min(end, segment.pageTextEnd);
    const segmentTextLength = Math.max(1, segment.pageTextEnd - segment.pageTextStart);
    const startRatio = (overlapStart - segment.pageTextStart) / segmentTextLength;
    const endRatio = (overlapEnd - segment.pageTextStart) / segmentTextLength;

    rects.push({
      left: (itemRect.left + itemRect.width * startRatio) / Math.max(1, model.viewportWidth),
      top: itemRect.top / Math.max(1, model.viewportHeight),
      width: Math.max(1, itemRect.width * (endRatio - startRatio)) / Math.max(1, model.viewportWidth),
      height: itemRect.height / Math.max(1, model.viewportHeight),
    });
  }

  return rects;
}

export function searchPdfPageTextModel(model: PdfPageTextModel, query: string): PdfSearchMatch[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [];
  }

  const text = model.normalizedText.toLowerCase();
  const matches: PdfSearchMatch[] = [];
  let index = 0;

  while ((index = text.indexOf(needle, index)) !== -1) {
    matches.push({
      page: model.pageNumber,
      index,
      preview: buildPreview(model.normalizedText, index, needle),
      rects: buildMatchRects(model, index, index + needle.length),
    });
    index += needle.length;
  }

  return matches;
}
