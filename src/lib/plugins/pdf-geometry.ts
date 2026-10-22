import type { PDFPageProxy } from 'pdfjs-dist';
import type { PdfPageTextModel } from '@/lib/pdf-page-text-cache';
import { buildPdfTextKernelPage } from '@/lib/pdf-text-kernel';
import { detectPdfFormulaRules } from '@/lib/pdf-formula-rules';
import type { PdfFormulaGlyph } from '@/lib/pdf-formula-structure';
import type { PluginPdfTextPage } from './types';

/** Native PDF geometry; rendered DOM models are explicitly tagged by the caller. */
export function buildPluginPdfTextPage(model: PdfPageTextModel, rules: PdfFormulaGlyph[] = [], source: PluginPdfTextPage['source'] = 'pdfjs-text-model'): PluginPdfTextPage {
  const kernel = buildPdfTextKernelPage({ model });
  const width = model.viewportWidth, height = model.viewportHeight;
  const normalize = (r: PdfFormulaGlyph) => ({ x1: r.x1 / width, x2: r.x2 / width, y1: r.y1 / height, y2: r.y2 / height });
  const rectByItem = new Map(model.itemRects.map((rect) => [rect.itemIndex, rect]));
  return {
    pageNumber: model.pageNumber, text: model.normalizedText, visible: false, source, width, height,
    items: model.segments.map((segment) => {
      const rect = rectByItem.get(segment.itemIndex);
      return {
        text: segment.text, normalizedText: segment.normalizedText,
        lineIndex: segment.lineIndex, blockIndex: segment.blockIndex, columnIndex: segment.columnIndex, layoutClass: segment.layoutClass,
        bbox: rect ? { x1: rect.left / width, x2: (rect.left + rect.width) / width, y1: rect.top / height, y2: (rect.top + rect.height) / height } : undefined,
      };
    }),
    glyphs: [
      ...kernel.chars.filter((char) => char.text.trim()).map((char) => ({
        text: char.text, bbox: char.pdfRect, charIndex: char.charIndex, itemIndex: char.itemIndex,
        fontSize: (char.fontSize ?? char.viewportRect.height) / height,
        baseline: (char.baseline ?? char.viewportRect.top + char.viewportRect.height) / height,
      })),
      ...rules.map((rule) => ({ text: rule.text, bbox: normalize(rule), ruleKind: 'fraction-bar' as const })),
    ],
  };
}

export function selectPluginPdfRegion(page: PluginPdfTextPage, bbox: {x1:number;y1:number;x2:number;y2:number}): PluginPdfTextPage {
  const inside = (r:typeof bbox) => (r.x1+r.x2)/2 >= bbox.x1 && (r.x1+r.x2)/2 <= bbox.x2 && (r.y1+r.y2)/2 >= bbox.y1 && (r.y1+r.y2)/2 <= bbox.y2;
  const glyphs = page.glyphs?.filter(glyph=>inside(glyph.bbox));
  return {...page,glyphs,text:glyphs?.map(glyph=>glyph.text).join('')??'',items:page.items?.filter(item=>item.bbox&&inside(item.bbox))};
}

/** Render locally at a bounded resolution; a painted rule is evidence, never inferred from text. */
export async function readPaintedFormulaRules(page: PDFPageProxy, model: PdfPageTextModel, signal?: AbortSignal,
  createSurface: (width: number, height: number) => HTMLCanvasElement = (width, height) => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas;
  }): Promise<PdfFormulaGlyph[]> {
  signal?.throwIfAborted();
  const scale = Math.min(1.5, Math.sqrt(3_500_000 / (model.viewportWidth * model.viewportHeight)));
  const viewport = page.getViewport({ scale });
  const canvas = createSurface(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('PDF formula rule rendering is unavailable');
  const renderTask = page.render({ canvasContext: context, canvas, viewport });
  const cancel = () => renderTask.cancel();
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    await renderTask.promise;
    signal?.throwIfAborted();
    const sx = viewport.width / model.viewportWidth, sy = viewport.height / model.viewportHeight;
    const glyphs = buildPdfTextKernelPage({ model }).chars.filter((char) => char.text.trim()).map((char) => ({
      text: char.text, x1: char.pdfRect.x1 * viewport.width, x2: char.pdfRect.x2 * viewport.width,
      y1: char.pdfRect.y1 * viewport.height, y2: char.pdfRect.y2 * viewport.height,
    }));
    return detectPdfFormulaRules({ data: context.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height, glyphs })
      .map((rule) => ({ ...rule, x1: rule.x1 / sx, x2: rule.x2 / sx, y1: rule.y1 / sy, y2: rule.y2 / sy }));
  } finally {
    signal?.removeEventListener('abort', cancel);
    canvas.width = 0; canvas.height = 0;
  }
}
