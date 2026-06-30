import { describe, expect, it } from 'vitest';
import {
  FORMULA_TEMPLATES,
  getFormulaTemplateForKey,
  getQuickFormulaTemplates,
  latexToVisualPreview,
} from '../formula-templates';

describe('formula templates', () => {
  it('defines the quick templates in the expected structure-first order', () => {
    expect(getQuickFormulaTemplates().map((template) => template.id)).toEqual([
      'fraction',
      'sqrt',
      'superscript',
      'subscript',
      'sum',
      'integral',
      'limit',
      'matrix-2x2',
      'cases-2',
      'vector',
    ]);
  });

  it('keeps every quick template insertable and previewable', () => {
    for (const template of getQuickFormulaTemplates()) {
      expect(template.label).toBeTruthy();
      expect(template.latex).toBeTruthy();
      expect(template.mathLiveLatex).toContain('\\placeholder{}');
      expect(template.previewLatex).toContain('\\square');
      expect(template.keywords.length).toBeGreaterThan(0);
    }
  });

  it('represents matrix and cases as display structures with four slots', () => {
    expect(FORMULA_TEMPLATES['matrix-2x2']).toMatchObject({
      displayMode: true,
      previewLatex: '\\begin{pmatrix}\\square&\\square\\\\\\square&\\square\\end{pmatrix}',
    });
    expect(FORMULA_TEMPLATES['cases-2']).toMatchObject({
      displayMode: true,
      previewLatex: '\\begin{cases}\\square&\\square\\\\\\square&\\square\\end{cases}',
    });
  });

  it('turns raw LaTeX holes into visual placeholder previews', () => {
    expect(latexToVisualPreview('\\frac{}{}')).toBe('\\frac{\\square}{\\square}');
    expect(latexToVisualPreview('^{ }')).toBe('x^{\\square}');
    expect(latexToVisualPreview('')).toBe('\\square');
  });

  it('maps high-frequency physical keys to structural templates', () => {
    expect(getFormulaTemplateForKey('Digit4')?.id).toBe('fraction');
    expect(getFormulaTemplateForKey('KeyF')?.id).toBe('fraction');
    expect(getFormulaTemplateForKey('KeyR')?.id).toBe('sqrt');
    expect(getFormulaTemplateForKey('KeyL')?.id).toBe('limit');
    expect(getFormulaTemplateForKey('KeyM')?.id).toBe('matrix-2x2');
    expect(getFormulaTemplateForKey('KeyX')?.id).toBe('matrix-2x2');
    expect(getFormulaTemplateForKey('KeyB')?.id).toBe('cases-2');
    expect(getFormulaTemplateForKey('KeyA')).toBeNull();
  });
});
