import { describe, expect, it, vi } from 'vitest';
import { resolvePdfEvidenceSnippetFromModels, resolvePdfEvidenceSnippetTarget } from '../pdf-evidence-navigation';
import type { PdfPageTextModel } from '../pdf-page-text-cache';

function pageModel(text: string): PdfPageTextModel {
  return {
    pageNumber: 12,
    viewportWidth: 600,
    viewportHeight: 800,
    textContent: { items: [], styles: {}, lang: null },
    items: [],
    normalizedText: text,
    itemRects: [{ itemIndex: 0, left: 50, top: 100, width: 500, height: 20 }],
    segments: [{ itemIndex: 0, text, normalizedText: text, hasEOL: false, pageTextStart: 0, pageTextEnd: text.length }],
  };
}

describe('precise PDF evidence navigation', () => {
  it('uses source-model coordinates when the rendered layer joins distinct source lines', async () => {
    const quote = 'Low-frequency fields. The left column contains the measured result.';
    const sourceModel = pageModel(quote);
    const renderedModel = pageModel('Low-frequency fields.The left column contains the measured result.');
    expect(resolvePdfEvidenceSnippetTarget(renderedModel, quote)).toBeNull();
    const loadSourceModel = vi.fn(async () => sourceModel);
    const result = await resolvePdfEvidenceSnippetFromModels({ renderedModel, loadSourceModel, snippet: quote });
    expect(result?.model).toBe(sourceModel);
    expect(result?.target.snippet).toBe(quote);
    expect(result?.target.rects.length).toBeGreaterThan(0);
    expect(loadSourceModel).toHaveBeenCalledTimes(1);
  });

  it('does not load a second model when the rendered quote already resolves uniquely', async () => {
    const renderedModel = pageModel('The magnetic field is 58 G.');
    const loadSourceModel = vi.fn();
    const result = await resolvePdfEvidenceSnippetFromModels({ renderedModel, loadSourceModel, snippet: '58 G' });
    expect(result?.model).toBe(renderedModel);
    expect(loadSourceModel).not.toHaveBeenCalled();
  });
  it('preserves literal source typography when the DOM representation only matches after compatibility normalization', async () => {
    const snippet = 'The field is 58 G.';
    const source = pageModel(snippet);
    const rendered = pageModel('The ﬁeld is 58 G.');
    const result = await resolvePdfEvidenceSnippetFromModels({ renderedModel: rendered, loadSourceModel: async () => source, snippet, preserveExact: true });
    expect(result?.model).toBe(source);
    expect(result?.target.snippet).toBe(snippet);
    expect(await resolvePdfEvidenceSnippetFromModels({ renderedModel: rendered, loadSourceModel: async () => rendered, snippet, preserveExact: true })).toBeNull();
  });

  it('still rejects missing or repeated complete quotes in the source fallback', async () => {
    for (const text of ['First result differs.', 'First result. First result.']) {
      expect(await resolvePdfEvidenceSnippetFromModels({ renderedModel: pageModel('Firstresult.'), loadSourceModel: async () => pageModel(text), snippet: 'First result.' })).toBeNull();
    }
  });
  it('distinguishes scientific unit case and maps normalized ligatures to original offsets', () => {
    const model = pageModel('Sample mass: 58 g. Magnetic ﬁeld: 58 G.');
    const target = resolvePdfEvidenceSnippetTarget(model, '58 G');
    expect(target?.startOffset).toBe(model.normalizedText.lastIndexOf('58 G'));
    expect(target?.snippet).toBe('58 G');
    expect(target?.rects.length).toBeGreaterThan(0);
    expect(resolvePdfEvidenceSnippetTarget(pageModel('Sample mass: 58 g.'), '58 G')).toBeNull();
    const ligature = resolvePdfEvidenceSnippetTarget(model, 'Magnetic field: 58 G.');
    expect(ligature?.snippet).toBe('Magnetic ﬁeld: 58 G.');
    expect(ligature?.endOffset).toBe(model.normalizedText.length);
  });

  it('does not turn a partially matching or truncated quote into a successful target', () => {
    const sentence = 'The experiment demonstrates coherent tunneling in the device.';
    expect(resolvePdfEvidenceSnippetTarget(pageModel(sentence), 'The experiment demonstrates coherent tunneling in a different system.')).toBeNull();
    const prefix = 'The experimentally measured magnetic field remains stable. '.repeat(6);
    expect(resolvePdfEvidenceSnippetTarget(pageModel(`${prefix}Confirmed.`), `${prefix}Not confirmed.`)).toBeNull();
  });

  it('rejects repeated quotes until enough original text identifies one passage', () => {
    const model = pageModel('First measurement: 58 G. Second measurement: 58 G.');
    expect(resolvePdfEvidenceSnippetTarget(model, '58 G')).toBeNull();
    const target = resolvePdfEvidenceSnippetTarget(model, 'Second measurement: 58 G.');
    expect(target?.startOffset).toBe(model.normalizedText.indexOf('Second'));
    expect(target?.snippet).toBe('Second measurement: 58 G.');
  });
});
