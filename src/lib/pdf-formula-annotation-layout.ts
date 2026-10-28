import type { PdfPageTextModel } from './pdf-page-text-cache';
import type { AnnotationItem, BoundingBox } from '@/types/universal-annotation';
import { buildPdfTextKernelPage, type PdfTextKernelChar } from './pdf-text-kernel';
import { buildPdfRectsForOffsets, resolveCanonicalPdfTextAnchorFromExact, resolvePdfExactQuoteOffsetCandidates } from './pdf-canonical-text-anchoring';
import { buildPdfFormulaMarkupGeometry } from './pdf-formula-markup-geometry';

export interface PdfFormulaAnnotationLayout {
  formulaRects: BoundingBox[];
  ordinaryRects: BoundingBox[];
}

/** Decorative TeX delimiter pieces vary in count between PDF.js and DOM text layers. */
function delimiterProjection(text: string) {
  let value = ''; const offsets: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (/[\s\uf8eb-\uf8fe]/u.test(char)) continue;
    value += char === '−' ? '-' : char;
    offsets.push(index);
  }
  return { value, offsets };
}

const PROSE = /\b(?:the|for|this|that|where|from|with|which|when|and|are|is|[A-Za-z]{4,})\b|[㐀-鿿]/iu;
const MATH = /[=+−±×÷∑∏∫∂∇ℏα-ωΑ-Ω_^\uf8eb-\uf8fe]/u;

/** Read-only recovery: resolve the exact quote first, then replace only isolated math runs. */
export function resolvePdfFormulaAnnotationLayout(annotation: AnnotationItem, model: PdfPageTextModel): PdfFormulaAnnotationLayout | null {
  if (annotation.target.type !== 'pdf' || annotation.target.page !== model.pageNumber) return null;
  const exact = annotation.target.textQuote?.exact ?? annotation.content ?? '';
  if (!MATH.test(exact)) return null;
  // Match raw formula text before readable-text conversion, which can rewrite
  // fractional/exponent spacing. A single original occurrence is unambiguous.
  const candidates = resolvePdfExactQuoteOffsetCandidates({ model, exact, preferredRects: annotation.target.rects });
  let range: { startOffset: number; endOffset: number } | null = candidates.length === 1 ? candidates[0] : null;
  if (candidates.length > 1) {
    const resolved = resolveCanonicalPdfTextAnchorFromExact({ model, exact, preferredRects: annotation.target.rects,
      prefix: annotation.target.textQuote?.prefix, suffix: annotation.target.textQuote?.suffix, requireUnique: true });
    if (resolved.ok && candidates.some(candidate => candidate.startOffset === resolved.anchor.startOffset
      && candidate.endOffset === resolved.anchor.endOffset)) range = resolved.anchor;
  }
  if (!range && candidates.length === 0 && /[\uf8eb-\uf8fe]/u.test(exact)) {
    const projected = delimiterProjection(model.normalizedText), quote = delimiterProjection(exact).value;
    const index = projected.value.indexOf(quote);
    if (quote.length < 16 || index < 0 || projected.value.indexOf(quote, index + 1) >= 0) return null;
    range = { startOffset: projected.offsets[index], endOffset: projected.offsets[index + quote.length - 1] + 1 };
  }
  if (!range) return null;
  const kernel = buildPdfTextKernelPage({ model });
  const selected = kernel.chars.filter(char => char.charIndex >= range.startOffset && char.charIndex < range.endOffset && char.text.trim());
  const rects = new Map(model.itemRects.map(rect => [rect.itemIndex, rect]));
  const segments = model.segments.filter(segment => segment.pageTextEnd > range.startOffset && segment.pageTextStart < range.endOffset);
  const prose = model.segments.filter(segment => PROSE.test(segment.text) && !/^\s*(?:sin|cos|tan|log|exp|lim|det|max|min)\s*$/u.test(segment.text));
  const runs: Array<{ from: number; to: number; chars: PdfTextKernelChar[] }> = [];
  let run: typeof runs[number] | null = null;
  for (const segment of segments) {
    if (prose.includes(segment) || /^\s*[IVX]+\.\s*$/u.test(segment.text)) { run = null; continue; }
    const chars = selected.filter(char => char.itemIndex === segment.itemIndex);
    if (!chars.length) continue;
    if (!run) { run = { from: Math.max(range.startOffset, segment.pageTextStart), to: Math.min(range.endOffset, segment.pageTextEnd), chars: [] }; runs.push(run); }
    run.to = Math.min(range.endOffset, segment.pageTextEnd); run.chars.push(...chars);
  }
  const accepted = runs.filter(candidate => {
    const text = candidate.chars.map(char => char.text).join('');
    if (candidate.chars.length < 5 || !MATH.test(text)) return false;
    const boxes = candidate.chars.map(char => char.pdfRect);
    const x1 = Math.min(...boxes.map(box => box.x1)), x2 = Math.max(...boxes.map(box => box.x2));
    const y1 = Math.min(...boxes.map(box => box.y1)), y2 = Math.max(...boxes.map(box => box.y2));
    // Inline math sharing a body-text row must remain ordinary text markup.
    return !prose.some(segment => {
      const rect = rects.get(segment.itemIndex); if (!rect) return false;
      const center = (rect.top + rect.height / 2) / model.viewportHeight;
      return center >= y1 && center <= y2 && rect.left / model.viewportWidth <= x2 + .04
        && (rect.left + rect.width) / model.viewportWidth >= x1 - .04;
    });
  });
  if (!accepted.length) return null;
  const formulaRects = accepted.flatMap(candidate => {
    const labelItems = new Set(model.segments.filter(segment => /^\s*\(\d+(?:\.\d+)?[a-z]?\)\s*$/iu.test(segment.text))
      .filter(segment => {
        const label = rects.get(segment.itemIndex); if (!label) return false;
        const rest = candidate.chars.filter(char => char.itemIndex !== segment.itemIndex);
        return rest.length > 0 && label.left / model.viewportWidth - Math.max(...rest.map(char => char.pdfRect.x2))
          > label.height / model.viewportWidth * 1.5;
      }).map(segment => segment.itemIndex));
    const geometry = buildPdfFormulaMarkupGeometry({ glyphs: candidate.chars.filter(char => !labelItems.has(char.itemIndex))
      .map(char => ({ text: char.text, ...char.pdfRect })) });
    return annotation.style.type === 'underline' ? geometry.underlineRects : geometry.highlightRects;
  });
  if (!formulaRects.length) return null;
  const ordinaryRects: BoundingBox[] = [];
  let start = range.startOffset;
  for (const candidate of accepted) {
    if (candidate.from > start) ordinaryRects.push(...buildPdfRectsForOffsets(model, start, candidate.from));
    start = candidate.to;
  }
  if (start < range.endOffset) ordinaryRects.push(...buildPdfRectsForOffsets(model, start, range.endOffset));
  return { formulaRects, ordinaryRects };
}
