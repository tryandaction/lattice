import { describe, expect, it } from 'vitest';
import { findReferenceTextRange, findRenderedReferenceRange } from '../reference-text-range';

describe('precise reference text ranges', () => {
  it('retains CRLF, indentation and Unicode source offsets across quote lines', () => {
    const content = '😀 intro\r\n  Exact evidence\r\n    spans lines. End';
    const range = findReferenceTextRange(content, 'Exact evidence spans lines.');
    expect(content.slice(range!.from, range!.to)).toBe('Exact evidence\r\n    spans lines.');
  });

  it('locates case-sensitive scientific units rather than an earlier different unit', () => {
    const content = 'The sample weighs 58 g. The magnetic field is 58 G.';
    const range = findReferenceTextRange(content, '58 G');
    expect(range?.from).toBe(content.lastIndexOf('58 G'));
    expect(content.slice(range!.from, range!.to)).toBe('58 G');
    expect(findReferenceTextRange('The sample weighs 58 g.', '58 G')).toBeNull();
  });

  it('matches normalized ligatures and combining marks while retaining original offsets', () => {
    const content = '😀 Before: ﬁeld and cafe\u0301. After.';
    const range = findReferenceTextRange(content, 'field and café');
    expect(content.slice(range!.from, range!.to)).toBe('ﬁeld and cafe\u0301');
  });

  it('matches explicit prose line-end hyphenation and discretionary soft hyphens with source offsets', () => {
    const content = '😀 The ampli-\r\n  tude devi\u00adations affect the ﬁeld.';
    const range = findReferenceTextRange(content, 'The amplitude deviations affect the field.', { pdfTypography: true });
    expect(content.slice(range!.from, range!.to)).toBe('The ampli-\r\n  tude devi\u00adations affect the ﬁeld.');
    expect(findReferenceTextRange('amplitude deviations', 'ampli-\ntude devi\u00adations', { pdfTypography: true })).toEqual({ from: 0, to: 20 });
    expect(findReferenceTextRange('alpha-\nbeta', 'alphabeta')).toBeNull();
  });

  it('preserves scientific subtraction, formula structure, case and real inline hyphens', () => {
    for (const [source, quote] of [
      ['x-\ny', 'xy'], ['10-\n20', '1020'], ['alpha -\nbeta', 'alpha beta'],
      ['first-order effect', 'firstorder effect'], ['devi-ations', 'deviations'],
      ['δ1 − δ2', 'δ1 δ2'], ['|ψ⟩ = 0', '|ψ > = 0'], ['58 g', '58 G'],
    ]) expect(findReferenceTextRange(source, quote, { pdfTypography: true })).toBeNull();
  });

  it('rejects ambiguity introduced by equivalent PDF typography', () => {
    expect(findReferenceTextRange('devi-\nations and deviations', 'deviations', { pdfTypography: true })).toBeNull();
  });

  it('rejects repeated original text rather than choosing an arbitrary occurrence', () => {
    expect(findReferenceTextRange('First 58 G. Second 58 G.', '58 G')).toBeNull();
    expect(findReferenceTextRange('aaaa', 'aaa')).toBeNull();
    const root = document.createElement('div');
    root.innerHTML = '<p>Repeated evidence.</p><p>Repeated evidence.</p>';
    expect(findRenderedReferenceRange(root, 'Repeated evidence.')).toBeNull();
  });

  it('locates only the quoted fragments across rendered inline elements', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>Unrelated before. <strong>Precise</strong> evidence\ncontinues here. Unrelated after.</p>';
    const range = findRenderedReferenceRange(root, 'Precise evidence continues here.');
    expect(range?.toString()).toBe('Precise evidence\ncontinues here.');
    expect(root.querySelector('strong')?.textContent).toBe('Precise');
  });

  it('preserves paragraph boundaries without adding content to the rendered document', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>First paragraph.</p><p>Second paragraph.</p>';
    const range = findRenderedReferenceRange(root, 'paragraph. Second');
    expect(range?.startContainer.textContent?.slice(range.startOffset)).toBe('paragraph.');
    expect(range?.endContainer.textContent?.slice(0, range.endOffset)).toBe('Second');
  });
});
