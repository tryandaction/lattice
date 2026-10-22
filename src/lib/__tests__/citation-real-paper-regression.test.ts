import { describe, expect, it } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { buildCitationContract, classifyStrictAiLink } from '../ai/citation-contract';
import { getPdfPageTextModel } from '../pdf-page-text-cache';
import { resolvePdfEvidenceSnippetTarget } from '../pdf-evidence-navigation';
import fixture from './fixtures/rydberg-gate-citation-fragments.json';

const path = 'papers/rydberg-gates.pdf';
const tradeOffQuote = 'This is expected because the robust pulses effectively trade sensitivity to imperfections for Rydberg decay';
const originalQuotes = [
  { page: 3, originalId: 'citation-v2-6emvah', quote: 'We say that the pulse is robust against amplitude devi-ations if |ψ (1) q > = 0 for all q' },
  { page: 4, originalId: 'citation-v2-nejs1x', quote: tradeOffQuote },
  { page: 4, originalId: 'citation-v2-nejs1x', quote: 'we demonstrate analytically that no pulse exists for which the implemented gate is first-order insensitive to 𝛿1 and 𝛿2' },
  { page: 8, originalId: 'citation-v2-p2xvxc', quote: tradeOffQuote },
];

function pageFixture(page: number) {
  const source = fixture.pages.find(entry => entry.page === page);
  if (!source) throw new Error(`Missing page fixture ${page}`);
  return source;
}

function contextForPage(page: number) {
  return buildCitationContract({
    kind: 'pdf_page', label: 'Rydberg gates', locator: `${path}#page=${page}`,
    anchor: { page }, preview: pageFixture(page).items.map(item => item.str).join(' '),
  });
}

function classifyQuote(page: number, quote: string) {
  const context = contextForPage(page);
  // IDs are recomputed for these minimal excerpts. Test the reported quotation
  // against the correct source contract, rather than merely rejecting stale IDs.
  return classifyStrictAiLink(`citation:${context.stableId}?quote=${encodeURIComponent(quote)}`, [context]);
}

async function modelForPage(page: number) {
  const source = pageFixture(page);
  const document = {
    getPage: async () => ({
      getViewport: () => fixture.viewport,
      getTextContent: async () => ({ items: source.items, styles: {}, lang: null }),
    }),
  } as unknown as PDFDocumentProxy;
  return getPdfPageTextModel(document, page);
}

const validQuotes = [
  { page: 3, quote: 'We say that the pulse is robust against amplitude', lineCount: 1 },
  { page: 4, quote: 'no pulse exists for which the implemented gate is first-order insensitive', lineCount: 2 },
  { page: 8, quote: 'This is expected because the robust pulses effectively trade sensitivity to imperfections', lineCount: 2 },
  { page: 9, quote: 'the switch and the wait method give identical results', lineCount: 2 },
];

describe('reported real-paper citation failures', () => {
  it.each(originalQuotes)('rejects the original quotation from $originalId on p.$page', ({ page, quote }) => {
    expect(classifyQuote(page, quote)).toEqual({ kind: 'plain_text' });
  });

  it.each(validQuotes)('binds a genuine same-page short quote and its actual text rectangles on p.$page', async ({ page, quote, lineCount }) => {
    const resolved = classifyQuote(page, quote);
    expect(resolved.kind).toBe('citation');
    if (resolved.kind !== 'citation') throw new Error('Expected verified citation');
    expect(resolved.citation.navigationTarget).toMatchObject({ path, page });
    const model = await modelForPage(page);
    const target = resolvePdfEvidenceSnippetTarget(model, resolved.citation.evidenceRef.anchor!.snippet!);
    expect(target).not.toBeNull();
    expect(target!.page).toBe(page);
    expect(model.normalizedText.slice(target!.startOffset, target!.endOffset)).toBe(quote);
    expect(target!.rects).toHaveLength(lineCount);

    // Check measured source geometry and clipped endpoints, not only a nonempty
    // rectangle list. None of these citations selects a full line or whole page.
    const lines = pageFixture(page).items.filter(item => item.str.trim() && item.width > 100);
    target!.rects.forEach((rect, index) => {
      const line = lines[index];
      expect(rect.left).toBeGreaterThanOrEqual(line.transform[4] / fixture.viewport.width - 0.0001);
      expect(rect.left + rect.width).toBeLessThanOrEqual((line.transform[4] + line.width) / fixture.viewport.width + 0.0001);
      expect(rect.top).toBeCloseTo((fixture.viewport.height - line.transform[5] - line.height * 0.8) / fixture.viewport.height, 3);
      expect(rect.height).toBeCloseTo(line.height / fixture.viewport.height, 3);
    });
    const first = target!.rects[0];
    const last = target!.rects.at(-1)!;
    expect(first.width).toBeLessThan(lines[0].width / fixture.viewport.width);
    expect(last.width).toBeLessThan(lines[lineCount - 1].width / fixture.viewport.width);
  });

  it('never fabricates a single-page anchor for a sentence crossing pages 8 and 9', async () => {
    for (const page of [4, 8, 9]) {
      expect(classifyQuote(page, tradeOffQuote)).toEqual({ kind: 'plain_text' });
      expect(resolvePdfEvidenceSnippetTarget(await modelForPage(page), tradeOffQuote)).toBeNull();
    }
  });

  it('does not guess damaged math glyphs or equate the ket bracket with a greater-than operator', async () => {
    const p4 = contextForPage(4).evidenceRef.preview!;
    expect(p4).toContain('\u0006');
    expect(classifyQuote(4, 'first-order insensitive to δ1 and δ2')).toEqual({ kind: 'plain_text' });
    const p3 = await modelForPage(3);
    expect(p3.normalizedText).toContain('〉');
    expect(resolvePdfEvidenceSnippetTarget(p3, '|ψ (1) q > = 0')).toBeNull();
  });
});
