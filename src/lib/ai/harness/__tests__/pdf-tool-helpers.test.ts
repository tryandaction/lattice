import { describe, expect, it } from 'vitest';
import type { AgentSourceChunk, AgentSourceRead } from '@/lib/ai/source-index';
import { appendVerifiedAnnotationDrafts, prepareVerifiedAnnotationDraftBatch, AnnotationQuoteValidationError, isRecoverableAnnotationQuoteError } from '../pdf-tool-helpers';
import { buildEmptyPdfAnnotationDraftsSection, parsePdfAnnotationMarkdownDrafts, PDF_ANNOTATION_DRAFTS_BEGIN } from '@/lib/pdf-annotation-markdown-drafts';

const path = 'synthetic-paper.pdf';
const snapshot: AgentSourceRead['snapshot'] = { path, sourceId: 'synthetic-paper', workspaceKey: 'synthetic-workspace',
  version: 'v1', kind: 'pdf', totalUnits: 15, unitLabel: 'page' };
function chunk(text: string, startOffset = 0, overrides: Partial<AgentSourceChunk> = {}): AgentSourceChunk {
  return { path, sourceId: snapshot.sourceId, version: snapshot.version, unit: 3, locator: path + '#page=3',
    text, startOffset, endOffset: startOffset + text.length, completeUnit: startOffset === 0, unitLength: startOffset + text.length, ...overrides };
}
function read(chunks: AgentSourceChunk[]): AgentSourceRead {
  return { snapshot, chunks, complete: false, readUnits: [], pendingUnits: [1, 2, 3], unreadableUnits: [],
    scannedChars: chunks.reduce((count, value) => count + value.text.length, 0) };
}
const propose = (quote: string, chunks: AgentSourceChunk[], page = 3) => appendVerifiedAnnotationDrafts('', [{ page, quote, type: 'highlight' }], read(chunks));

describe('Harness PDF annotation evidence validation', () => {
  it.each([
    ['#FFE75E', '#FFE75E'], [' #ffe75e ', '#FFE75E'], ['#abc', '#AABBCC'], ['yellow', '#FFFF00'], [' Yellow ', '#FFFF00'], ['blue', '#0000FF'],
  ])('canonicalizes supported annotation color %s without changing its CSS meaning', (color, expected) => {
    const result = appendVerifiedAnnotationDrafts('', [{ page: 3, quote: 'Verified original statement.', type: 'highlight', color }], read([chunk('Verified original statement.')]));
    expect(parsePdfAnnotationMarkdownDrafts(result)[0].color).toBe(expected);
  });

  it('uses the explicit AI default only when optional annotation color is omitted', () => {
    const result = appendVerifiedAnnotationDrafts('', [{ page: 3, quote: 'Verified original statement.', type: 'underline' }], read([chunk('Verified original statement.')]));
    expect(parsePdfAnnotationMarkdownDrafts(result)[0].color).toBe('#FFD400');
  });

  it('keeps a supported CSS color valid when another quote in the same batch is rejected', () => {
    const result = prepareVerifiedAnnotationDraftBatch('', [
      { page: 3, quote: 'Verified original statement.', type: 'highlight', color: 'yellow' },
      { page: 3, quote: 'An invented result.', type: 'underline', color: '#abc' },
    ], read([chunk('Verified original statement.')]));
    expect(result).toMatchObject({ acceptedCount: 1, rejectedCount: 1 });
    expect(parsePdfAnnotationMarkdownDrafts(result.content)[0].color).toBe('#FFFF00');
  });

  it.each(['not-a-color', 'transparent', '#FFE75E00', 'rgb(255,0,0)', 'var(--color)', 'url(javascript:alert(1))'])('rejects unknown or unsupported color %s with a specific color diagnostic', color => {
    expect(() => appendVerifiedAnnotationDrafts('', [{ page: 3, quote: 'Verified original statement.', type: 'highlight', color }], read([chunk('Verified original statement.')]))).toThrow(/annotation color/i);
  });

  it('reports annotation type separately and never converts an unsupported mark into a highlight', () => {
    const invalid = { page: 3, quote: 'Verified original statement.', type: 'area' } as unknown as Parameters<typeof appendVerifiedAnnotationDrafts>[1][number];
    expect(() => appendVerifiedAnnotationDrafts('', [invalid], read([chunk('Verified original statement.')]))).toThrow(/annotation type/i);
  });
  it('accepts an exact original quote crossing adjacent offset reads from the same page', () => {
    const first = 'The pulse cancels amplitude ';
    const second = 'errors while retaining the target rotation.';
    const result = propose(first + second, [chunk(second, first.length), chunk(first, 0, { unitLength: first.length + second.length, completeUnit: false })]);
    expect(result).toContain('- Quote: The pulse cancels amplitude errors while retaining the target rotation.');
  });

  it('accepts overlapping reads only when their common original bytes agree', () => {
    const text = 'Exact overlapping original PDF evidence.';
    expect(propose(text, [chunk(text.slice(0, 21), 0, { unitLength: text.length, completeUnit: false }), chunk(text.slice(14), 14)])).toContain('- Quote: ' + text);
  });

  it('normalizes PDF whitespace and typographic ligatures without changing words', () => {
    const result = propose('High-fidelity gates improve efficiency and flexibility.',
      [chunk('High-fidelity gates\nimprove efﬁciency and ﬂexibility.')]);
    expect(result).toContain('- Quote: High-fidelity gates improve efﬁciency and ﬂexibility.');
    expect(parsePdfAnnotationMarkdownDrafts(result)[0].exact).toBe('High-fidelity gates improve efﬁciency and ﬂexibility.');
  });

  it('never joins excerpts across an unread gap, another page, or another source revision', () => {
    const first = 'Trusted first ';
    const second = 'trusted second.';
    for (const tail of [chunk(second, first.length + 4), chunk(second, first.length, { unit: 4 }),
      chunk(second, first.length, { version: 'v2' }), chunk(second, first.length, { path: 'other.pdf' }),
      chunk(second, first.length, { sourceId: 'other-source' })]) {
      expect(() => propose(first + second, [chunk(first), tail])).toThrow(/引文|正文/u);
    }
  });

  it('rejects an otherwise exact quote carried only by a foreign revision or source', () => {
    for (const overrides of [{ version: 'v2' }, { path: 'other.pdf' }, { sourceId: 'other-source' }]) {
      expect(() => propose('Exact original words.', [chunk('Exact original words.', 0, overrides)])).toThrow(/引文|正文/u);
    }
  });

  it('rejects rewritten claims and wrong pages even when related original evidence was read', () => {
    const evidence = [chunk('The pulse cancels amplitude errors.')];
    expect(() => propose('The pulse removes all quantum errors.', evidence)).toThrow(/引文|正文/u);
    expect(() => propose('The pulse cancels amplitude errors.', evidence, 4)).toThrow(/引文|正文/u);
  });

  it('rejects conflicting overlapping evidence and malformed offset receipts', () => {
    const first = chunk('The original finding.');
    let conflict: unknown;
    try { propose('The original finding.', [first, chunk('conflicting words', 4)]); } catch (error) { conflict = error; }
    expect(conflict).toMatchObject({ details: { issues: [{ reason: 'conflicting_evidence' }] } });
    expect(isRecoverableAnnotationQuoteError(conflict)).toBe(false);
    for (const overrides of [{ startOffset: -1 }, { endOffset: 2 }, { startOffset: Number.NaN }, { unit: 16 }]) {
      expect(() => propose('The original finding.', [chunk('The original finding.', 0, overrides)])).toThrow(AnnotationQuoteValidationError);
    }
  });

  it('does not count duplicate and fully contained read receipts as multiple quote locations', () => {
    const text = 'The original finding remains stable.';
    expect(propose(text, [chunk(text), chunk(text), chunk(text.slice(4, 20), 4, { unitLength: text.length })])).toContain('- Quote: ' + text);
  });

  it('does not match a partial letter inside an original typographic ligature', () => {
    expect(() => propose('f', [chunk('ﬁ')])).toThrow(AnnotationQuoteValidationError);
    expect(() => propose('i', [chunk('ﬁ')])).toThrow(AnnotationQuoteValidationError);
    expect(propose('fi', [chunk('ﬁ')])).toContain('- Quote: ﬁ');
  });

  it('uses Unicode letter identities for historical st ligatures without accepting ft', () => {
    expect(propose('stable', [chunk('ﬅable')])).toContain('- Quote: ﬅable');
    expect(() => propose('ftable', [chunk('ﬅable')])).toThrow(AnnotationQuoteValidationError);
  });

  it('requires a unique original quote and accepts a longer quote resolving the ambiguity', () => {
    const evidence = [chunk('The fidelity improves. With noise suppressed, the fidelity improves. The final result is stable.')];
    expect(() => propose('fidelity improves.', evidence)).toThrow(AnnotationQuoteValidationError);
    expect(propose('With noise suppressed, the fidelity improves.', evidence)).toContain('- Quote: With noise suppressed, the fidelity improves.');
  });

  it('requires actual complete page offsets before declaring any quote unique', () => {
    for (const chunks of [
      [chunk('Original quote.', 0, { completeUnit: false, unitLength: 400 })],
      [chunk('Original quote.', 10, { completeUnit: false, unitLength: 25 })],
      [chunk('Original quote.', 0, { completeUnit: false, unitLength: 40 }), chunk('tail', 36, { unitLength: 40 })],
    ]) {
      const evidence = { ...read(chunks), readUnits: [3], pendingUnits: [] };
      expect(() => appendVerifiedAnnotationDrafts('', [{ page: 3, quote: 'Original quote.', type: 'highlight' }], evidence))
        .toThrow(AnnotationQuoteValidationError);
      try { appendVerifiedAnnotationDrafts('', [{ page: 3, quote: 'Original quote.', type: 'highlight' }], evidence); }
      catch (error) { expect(error).toMatchObject({ details: { issues: [{ reason: 'page_not_read' }] } }); }
    }
  });

  it('reports bounded same-page recovery details without accepting forged or structural failures', () => {
    const text = 'Original same-page context. '.repeat(30);
    let failure: unknown;
    try { propose('A rewritten claim.', [chunk(text), chunk('Other page private text.', 0, { unit: 4 })]); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(AnnotationQuoteValidationError);
    expect(failure).toMatchObject({ code: 'annotation_quote_validation', details: {
      issues: [{ annotationIndex: 0, page: 3, reason: 'quote_not_found' }], readPages: [3, 4] } });
    const details = (failure as AnnotationQuoteValidationError).details;
    expect(details.pageExcerpts).toHaveLength(1);
    expect(details.pageExcerpts[0].page).toBe(3);
    expect(details.pageExcerpts[0].text.length).toBeLessThanOrEqual(240);
    expect(JSON.stringify(details.pageExcerpts)).not.toContain('Other page private text');
    expect(isRecoverableAnnotationQuoteError(failure)).toBe(true);
    expect(isRecoverableAnnotationQuoteError({ code: 'annotation_quote_validation', details })).toBe(false);
    try { propose('', [chunk(text)]); } catch (error) { expect(isRecoverableAnnotationQuoteError(error)).toBe(false); }
  });

  it('preserves prior notes and validates every proposed quote before producing any draft', () => {
    const previous = '# Existing user note\nKeep this unchanged.';
    const result = appendVerifiedAnnotationDrafts(previous, [{ page: 3, quote: 'Exact original words.', type: 'underline' }], read([chunk('Exact original words.')]));
    expect(result).toContain(previous);
    expect(result).toContain('type="underline"');
    expect(() => appendVerifiedAnnotationDrafts(previous, [
      { page: 3, quote: 'Exact original words.', type: 'highlight' },
      { page: 3, quote: 'Invented claim.', type: 'highlight' },
    ], read([chunk('Exact original words.')]))).toThrow(/引文|正文/u);
  });

  it('preserves the user note and returns verified suggestions when one unrelated quote is recoverably invalid', () => {
    const previous = '# Human notes\nKeep this exactly.\n\n' + buildEmptyPdfAnnotationDraftsSection();
    const evidence = read([chunk('The matrix remains positive definite. It is stable for all p.')]);
    const result = prepareVerifiedAnnotationDraftBatch(previous, [
      { page: 3, quote: 'The matrix remains positive definite.', type: 'highlight', comment: 'verified finding' },
      { page: 3, quote: 'A plausible but invented trailing result.', type: 'underline', comment: 'must be rejected' },
    ], evidence);
    expect(result).toMatchObject({ acceptedCount: 1, rejectedCount: 1,
      validationDetails: { issues: [{ annotationIndex: 1, reason: 'quote_not_found' }] } });
    expect(result.content.startsWith(previous.slice(0, previous.indexOf(PDF_ANNOTATION_DRAFTS_BEGIN)))).toBe(true);
    expect(parsePdfAnnotationMarkdownDrafts(result.content)).toHaveLength(1);
    expect(result.content).toContain('The matrix remains positive definite.');
    expect(result.content).not.toContain('A plausible but invented trailing result.');
  });

  it('continues to fail when every requested annotation is invalid or source access is structurally unsafe', () => {
    const evidence = read([chunk('Verified original statement.')]);
    expect(() => prepareVerifiedAnnotationDraftBatch('', [
      { page: 3, quote: 'Invented claim one.', type: 'highlight' },
      { page: 3, quote: 'Invented claim two.', type: 'underline' },
    ], evidence)).toThrow(AnnotationQuoteValidationError);
    expect(() => prepareVerifiedAnnotationDraftBatch('', [
      { page: 3, quote: 'Verified original statement.', type: 'highlight' },
      { page: 16, quote: 'Unverified different page.', type: 'highlight' },
    ], evidence)).toThrow(AnnotationQuoteValidationError);
    expect(() => prepareVerifiedAnnotationDraftBatch('', [
      { page: 3, quote: 'Verified original statement.', type: 'highlight', color: 'not-a-color' },
      { page: 3, quote: 'Invented claim.', type: 'highlight' },
    ], evidence)).toThrow(/annotation color/i);
  });

  it('reports only a recoverably rejected item when earlier review-note content is present', () => {
    const previous = '# Handwritten notes\nDo not rewrite.\n\n' + buildEmptyPdfAnnotationDraftsSection();
    const result = prepareVerifiedAnnotationDraftBatch(previous, [
      { page: 3, quote: 'Verified original statement.', type: 'underline' },
      { page: 3, quote: 'Repeated quote must be precise.', type: 'highlight' },
    ], read([chunk('Verified original statement. Another sentence has enough exact wording to be readable.') ]));
    expect(result.content.slice(0, result.content.indexOf(PDF_ANNOTATION_DRAFTS_BEGIN))).toBe('# Handwritten notes\nDo not rewrite.\n\n');
    expect(result.validationDetails?.issues.map(issue => issue.annotationIndex)).toEqual([1]);
    expect(result.acceptedCount).toBe(1);
    expect(result.rejectedCount).toBe(1);
  });
});
