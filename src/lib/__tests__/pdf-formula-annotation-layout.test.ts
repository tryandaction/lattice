import { expect, it } from 'vitest';
import { resolvePdfFormulaAnnotationLayout } from '../pdf-formula-annotation-layout';
import { getPdfPageTextModel } from '../pdf-page-text-cache';
import type { AnnotationItem } from '@/types/universal-annotation';

const rows = [
  { text: 'A verified surrounding theorem.', x: 300, y: 100, w: 240, h: 10 },
  { text: 'Q', x: 330, y: 175, w: 10, h: 10 }, { text: '=', x: 345, y: 175, w: 10, h: 10 },
  { text: '', x: 365, y: 140, w: 5, h: 10 }, { text: '', x: 365, y: 155, w: 5, h: 10 }, { text: '', x: 365, y: 180, w: 5, h: 10 },
  { text: '1 2', x: 380, y: 140, w: 50, h: 10 }, { text: '3 4', x: 380, y: 160, w: 50, h: 10 },
  { text: '5 6', x: 380, y: 180, w: 50, h: 10 },
  { text: '', x: 440, y: 140, w: 5, h: 10 }, { text: '', x: 440, y: 155, w: 5, h: 10 }, { text: '', x: 440, y: 180, w: 5, h: 10 },
  { text: '(73)', x: 540, y: 160, w: 20, h: 10 },
  { text: 'The matrix is positive definite.', x: 300, y: 220, w: 240, h: 10 },
];
async function model(inputRows = rows) {
  const items = inputRows.map(row => ({ str: row.text, transform: [10, 0, 0, 10, row.x, 792 - row.y - row.h], width: row.w, height: row.h, fontName: 'f', hasEOL: true, dir: 'ltr' }));
  return getPdfPageTextModel({ getPage: async () => ({ getViewport: () => ({ width: 612, height: 792, transform: [1, 0, 0, -1, 0, 792] }), getTextContent: async () => ({ items, styles: { f: { ascent: 1 } } }) }) } as never, 1);
}
const annotation = (quote: string): AnnotationItem => ({ id: 'legacy', target: { type: 'pdf', page: 1, rects: [{ x1: .54, x2: .91, y1: .2, y2: .215 }], textQuote: { exact: quote, prefix: '', suffix: '', source: 'pdfjs-text-model', confidence: 'exact' } },
  style: { type: 'highlight', color: '#FFD400' }, author: 'ai', createdAt: 1, content: quote });

it('redraws a legacy mixed prose/matrix quote from actual glyphs without requiring LaTeX metadata', async () => {
  const page = await model();
  const result = resolvePdfFormulaAnnotationLayout(annotation(page.normalizedText), page);
  expect(result).not.toBeNull();
  expect(result!.formulaRects).toHaveLength(1);
  expect(result!.formulaRects[0].y2 - result!.formulaRects[0].y1).toBeGreaterThan(.05);
  expect(result!.formulaRects[0].x2).toBeLessThan(540 / 612);
  expect(result!.ordinaryRects.length).toBeGreaterThan(1);
});
it('preserves ordinary multi-line prose and refuses changed mathematical content', async () => {
  const page = await model();
  expect(resolvePdfFormulaAnnotationLayout(annotation('A verified surrounding theorem.'), page)).toBeNull();
  expect(resolvePdfFormulaAnnotationLayout(annotation(page.normalizedText.replace('3 4', '3 9')), page)).toBeNull();
});
it('matches only decorative split-delimiter and whitespace differences for old PDF text layers', async () => {
  const page = await model();
  const oldQuote = page.normalizedText.replace('', '').replace('', '').replace(/\s/g, '');
  const mark = annotation(oldQuote);
  if (mark.target.type !== 'pdf') throw new Error('Expected PDF target');
  mark.target.textQuote!.prefix = 'Legacy DOM context with a different reading order.';
  expect(resolvePdfFormulaAnnotationLayout(mark, page)?.formulaRects).toHaveLength(1);
});

it('recovers a uniquely present formula despite stale surrounding DOM context', async () => {
  const page = await model([{ text: 'Q=α+β', x: 330, y: 110, w: 100, h: 10 }]);
  const mark = annotation('Q=α+β');
  if (mark.target.type !== 'pdf') throw new Error('Expected PDF target');
  mark.target.textQuote!.prefix = 'Legacy surrounding prose.';
  mark.target.textQuote!.suffix = 'Different PDF text extraction order.';
  expect(resolvePdfFormulaAnnotationLayout(mark, page)?.formulaRects).toHaveLength(1);
});

it('matches stored formula extraction before prose normalization can rewrite numeric spacing', async () => {
  const text = 'x = 10 - 3 MHz';
  const page = await model([{ text, x: 330, y: 110, w: 100, h: 10 }]);
  const mark = annotation(text);
  const before = structuredClone(mark);
  expect(resolvePdfFormulaAnnotationLayout(mark, page)?.formulaRects).toHaveLength(1);
  expect(mark).toEqual(before);
});

it('refuses repeated formulas without an unambiguous anchor and honors the saved context', async () => {
  const page = await model([
    { text: 'First expression.', x: 300, y: 80, w: 240, h: 10 },
    { text: 'Q=α+β', x: 330, y: 110, w: 100, h: 10 },
    { text: 'Second expression.', x: 300, y: 280, w: 240, h: 10 },
    { text: 'Q=α+β', x: 330, y: 310, w: 100, h: 10 },
  ]);
  const mark = annotation('Q=α+β');
  if (mark.target.type !== 'pdf') throw new Error('Expected PDF target');
  mark.target.rects = [];
  expect(resolvePdfFormulaAnnotationLayout(mark, page)).toBeNull();
  mark.target.textQuote!.prefix = 'Second expression.';
  expect(resolvePdfFormulaAnnotationLayout(mark, page)?.formulaRects[0].y1).toBeGreaterThan(300 / 792);
  mark.target.textQuote!.prefix = 'A different context.';
  expect(resolvePdfFormulaAnnotationLayout(mark, page)).toBeNull();
  mark.target.textQuote!.prefix = '';
  mark.target.rects = [{ x1: 330 / 612, x2: 430 / 612, y1: 310 / 792, y2: 320 / 792 }];
  expect(resolvePdfFormulaAnnotationLayout(mark, page)?.formulaRects[0].y1).toBeGreaterThan(300 / 792);
});
