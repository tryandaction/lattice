/** @vitest-environment node */
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { DOMMatrix, ImageData, Path2D, createCanvas } from '@napi-rs/canvas';
import { getPdfPageTextModel } from '@/lib/pdf-page-text-cache';
import { buildPluginPdfTextPage, readPaintedFormulaRules, selectPluginPdfRegion } from '@/lib/plugins/pdf-geometry';
import { extractPdfFormulasFromPages } from '../extractors';

Object.assign(globalThis, { DOMMatrix, ImageData, Path2D, Text: class Text {} });

describe('real PDF formula extraction', () => {
  it('recovers both columns, vector fraction bar, matrix and scripts; rejects the prose page', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await readFile('public/__lattice-diagnostics/plugin-formulas.pdf')), useSystemFonts: true }).promise;
    try {
      const pages = [];
      for (let number = 1; number <= pdf.numPages; number++) {
        const model = await getPdfPageTextModel(pdf, number);
        const page = await pdf.getPage(number);
        const rules = await readPaintedFormulaRules(page, model, undefined, (width, height) => createCanvas(width, height) as never);
        pages.push(buildPluginPdfTextPage(model, rules));
      }
      expect(pages[0].glyphs?.some((glyph) => glyph.ruleKind === 'fraction-bar')).toBe(true);
      const formulas = extractPdfFormulasFromPages(pages);
      expect(formulas.map((formula) => ({ page: formula.page, latex: formula.latex.replace(/\s/g, '') }))).toEqual([
        { page: 1, latex: 'x^{2}=\\frac{a}{b}' },
        { page: 1, latex: 'M=\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}' },
        { page: 2, latex: 'E=mc^{2}' },
      ]);
      expect(formulas.every((formula) => !formula.needsReview && formula.target?.bbox)).toBe(true);
      const selected=selectPluginPdfRegion(pages[0],{x1:.1,x2:.28,y1:.2,y2:.35});
      expect(extractPdfFormulasFromPages([selected]).map(f=>f.latex.replace(/\s/g,''))).toEqual(['x^{2}=\\frac{a}{b}']);
      const withoutRules={...pages[0],glyphs:pages[0].glyphs?.filter(g=>!g.ruleKind)};
      const missingBar=extractPdfFormulasFromPages([withoutRules]).find(f=>f.bbox!.x1<.5)!;
      expect(missingBar.needsReview).toBe(true);
      expect(missingBar.latex).not.toContain('\\frac');
    } finally { await pdf.destroy(); }
  });
});
